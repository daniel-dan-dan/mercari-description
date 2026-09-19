/* Sale campaigns: persist an operation receipt before every external mutation. */
'use strict';
(function (root) {
  const RECEIPT_KEY = 'mercari_sale_pending_v1';
  const DRAFT_KEY = 'mercari_sale_draft_v1';
  function scheduledISO(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('予約日時を入力してください');
    const date = new Date(value + ':00+09:00');
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error('未来の予約日時を指定してください');
    return date.toISOString();
  }
  function readReceipt(storage) {
    const raw = storage.getItem(RECEIPT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.id !== 'string' || !value.path?.startsWith('/sale-comments/') || !value.body) throw new Error('前回の受付記録を確認できません。新規送信を停止しました');
    return value;
  }
  function persistReceipt(storage, value) {
    if (readReceipt(storage)) throw new Error('前回の受付を先に確認してください');
    const raw = JSON.stringify(value);
    storage.setItem(RECEIPT_KEY, raw);
    if (storage.getItem(RECEIPT_KEY) !== raw) throw new Error('受付記録を保存できません。送信していません');
  }
  const helpers = { scheduledISO, readReceipt, persistReceipt, RECEIPT_KEY };
  if (typeof module !== 'undefined' && module.exports) { module.exports = helpers; return; }
  const $ = id => document.getElementById(id);
  let snapshot = { listings: [], complete: false }, selected = new Set(), campaigns = [];
  let preview = null, editing = null, busy = false, refreshInFlight = false, syncJob = null, historyKey = '';
  const states = {scheduled:'予約中',ready:'順次処理待ち',working:'処理中',completed:'完了',paused:'停止中',
    awaiting_confirmation:'予約未送信・確認待ち',needs_review:'確認待ち',cancelled:'取消済み',
    pending:'未送信',preparing:'確認中',sending:'送信確認中',sent:'送信済み',skipped:'見送り',unknown:'送信結果不明',
    deleting:'削除確認中',deleted:'削除済み',delete_review:'削除要確認',delete_unknown:'削除結果不明'};
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(text, fn, disabled=false) {
    const b=node('button',text,'btn small'); b.type='button'; b.disabled=disabled;
    b.addEventListener('click',()=>run(fn)); return b;
  }
  function status(text, error=false) { $('sale-status').textContent=text; $('sale-status').classList.toggle('sale-error',error); }
  function dateText(stamp) { return stamp ? new Date(stamp*1000).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) : ''; }
  function formConfig() {
    return {snapshotId:snapshot.snapshotId, itemIds:[...selected], all:snapshot.complete && selected.size===snapshot.listings.length,
      mode:$('sale-mode').value, template:$('sale-template').value,
      discountType:$('sale-discount-type').value, discountValue:Number($('sale-discount-value').value)};
  }
  function invalidate() {
    preview=null; $('sale-preview').replaceChildren(); $('sale-confirm').hidden=true;
    try { localStorage.setItem(DRAFT_KEY,JSON.stringify({template:$('sale-template').value,mode:$('sale-mode').value,
      discountType:$('sale-discount-type').value,discountValue:$('sale-discount-value').value})); } catch (_) {}
    controls();
  }
  function controls() {
    $('sale-discount-fields').hidden=$('sale-mode').value!=='discount';
    $('sale-schedule-fields').hidden=$('sale-timing').value!=='scheduled';
    $('sale-selection-count').textContent=`${selected.size}件を選択`;
    $('sale-all').disabled=busy||!snapshot.complete||!snapshot.listings.length;
    $('sale-clear').disabled=busy;
    $('sale-sync').disabled=busy||!!syncJob;
    $('sale-preview-btn').disabled=busy||!selected.size;
    $('sale-confirm').disabled=busy;
    $('sale-confirm').textContent=editing?'予約を変更する':$('sale-timing').value==='scheduled'?'この内容で予約する':`${preview?.items.filter(i=>i.status==='pending').length||0}件にコメントを送信`;
    $('sale-edit-note').hidden=!editing;
    $('sale-chars').textContent=`${$('sale-template').value.length} / 1,000文字（差し込み後も確認します）`;
    for (const el of $('sale-form').querySelectorAll('input,select,textarea')) el.disabled=busy;
    for (const input of $('sale-products').querySelectorAll('input')) input.disabled=busy;
    try { $('sale-pending').hidden=!localStorage.getItem(RECEIPT_KEY); } catch (_) {
      $('sale-preview-btn').disabled=true; $('sale-confirm').disabled=true;
      status('端末に受付記録を保存できないため送信を停止しています。',true);
    }
  }
  async function api(path, body, operationId) {
    const base=await getMercariServiceUrl();
    const response=await fetchWithTimeout(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Operation-Id':operationId||crypto.randomUUID()},body:JSON.stringify(body)},25000);
    const data=await response.json();
    if(!response.ok||data.ok===false){const e=new Error(data.error||'通信結果を確認できません');e.status=response.status;throw e;}
    return data;
  }
  async function run(fn) {
    if(busy)return;
    busy=true;controls();
    try {await fn();} catch(e){status(e.message,true);} finally{busy=false;controls();}
  }
  async function submitReceipt(receipt) {
    let result;
    try {
      result=await api(receipt.path,receipt.body,receipt.id);
    } catch(e) {
      // A conclusive rejection (except timeout) is not an accepted job.
      if(e.status>=400&&e.status<500&&e.status!==408) localStorage.removeItem(RECEIPT_KEY);
      else status('受付の結果を確認中です。新しい送信はせず「受付を再確認」を押してください。',true);
      throw e;
    }
    localStorage.removeItem(RECEIPT_KEY);
    preview=null;editing=null;
    $('sale-confirm').hidden=true; $('sale-preview').replaceChildren();
    status('Macに受付を保存しました。結果は送信履歴で確認できます。');
    try { await refresh(); }
    catch (_) { status('Macへの受付は保存済みです。接続回復後に履歴を更新してください。'); }
    return result;
  }
  async function mutate(path,body) {
    const action=async()=>{
      const receipt={id:crypto.randomUUID(),path,body};
      persistReceipt(localStorage,receipt);
      controls();
      return submitReceipt(receipt);
    };
    if(navigator.locks) return navigator.locks.request('mercari-sale-command',{ifAvailable:true}, lock=>{
      if(!lock) throw new Error('別の画面で受付中です'); return action();
    });
    return action();
  }
  function renderListings() {
    const container=$('sale-products');container.replaceChildren();
    $('sale-list-info').textContent=snapshot.fetchedAt?`${snapshot.listings.length}件・取得 ${dateText(snapshot.fetchedAt)}${snapshot.complete?'・全件確認済み':'・一部取得（全選択不可）'}`:'商品を取得してください';
    const frag=document.createDocumentFragment();
    for(const row of snapshot.listings){
      const label=node('label',undefined,'sale-product');
      const check=node('input');check.type='checkbox';check.checked=selected.has(row.itemId);
      check.addEventListener('change',()=>{if(check.checked)selected.add(row.itemId);else selected.delete(row.itemId);invalidate();});
      const img=node('img');img.alt='';img.loading='lazy';
      if(/^https:\/\/static\.mercdn\.net\//.test(row.imageUrl||''))img.src=row.imageUrl;
      const copy=node('span');copy.append(node('strong',row.title),node('span',`¥${Number(row.currentPrice).toLocaleString('ja-JP')}`));
      label.append(check,img,copy);frag.append(label);
    }
    container.append(frag);controls();
  }
  function renderPreview(value) {
    const box=$('sale-preview');box.replaceChildren();
    box.append(node('h3',`${value.items.filter(i=>i.status==='pending').length}件に送信・${value.items.filter(i=>i.status==='skipped').length}件見送り`));
    for(const i of value.items){
      const detail=node('details',undefined,'sale-preview-item');
      detail.append(node('summary',`${i.title}${i.status==='skipped'?'（見送り）':''}`),node('pre',i.body));
      if(i.reason)detail.append(node('p',i.reason,'sale-error'));
      box.append(detail);
    }
    box.append(node('p','販売価格は変更されません。文章に記載した割引は、購入前の価格変更が必要です。','note'));
    $('sale-confirm').hidden=false;controls();
  }
  function renderHistory() {
    const container=$('sale-history');
    const open=new Set([...container.querySelectorAll('details[open]')].map(e=>e.dataset.campaign));
    container.replaceChildren();
    if(!campaigns.length){container.append(node('p','送信・予約履歴はまだありません。','note'));return;}
    for(const c of campaigns){
      const card=node('article',undefined,'sale-history-card');
      const counts={};for(const i of c.items)counts[i.status]=(counts[i.status]||0)+1;
      card.append(node('h3',`${c.mode==='delete'?'コメント削除':'セール送信'}・${states[c.state]||c.state}`));
      card.append(node('p',c.scheduledAt?`予約 ${dateText(c.scheduledAt)}（日本時間）`:`受付 ${dateText(c.createdAt)}`,'note'));
      card.append(node('p',Object.entries(counts).map(([k,n])=>`${states[k]||k} ${n}件`).join(' / ')));
      if(c.reason)card.append(node('p',c.reason,'sale-error'));
      const actions=node('div',undefined,'sale-actions');
      const command=(action)=>mutate(`/sale-comments/campaigns/${c.id}/${action}`,{revision:c.revision});
      if(['ready','working'].includes(c.state))actions.append(button('途中停止',()=>command('stop')));
      if(['scheduled','awaiting_confirmation'].includes(c.state)&&!c.startedAt){
        actions.append(button('予約を変更',()=>loadEdit(c)),button('予約を取り消す',()=>{if(confirm('この予約を取り消しますか？'))return command('cancel');}));
      }
      if(['paused','awaiting_confirmation','needs_review'].includes(c.state)&&!c.items.some(i=>['sending','unknown','deleting','delete_unknown'].includes(i.status))&&c.items.some(i=>i.status===(c.mode==='send'?'pending':'sent'))){
        actions.append(button('未処理分を今すぐ再開',()=>{if(confirm('確定している未処理分だけを今すぐ再開しますか？'))return command('resume');}));
      }
      if(!['ready','working','scheduled'].includes(c.state)&&counts.sent){
        actions.append(button(`今回のコメントを削除（${counts.sent}件）`,()=>{
          if(confirm(`今回送信した${counts.sent}件のコメントを削除します。取り消しはできません。対象を確認しましたか？`))return command('delete');
        }));
      }
      if(c.items.some(i=>['unknown','delete_unknown'].includes(i.status))) actions.append(button('結果を読み直す',async()=>{await api(`/sale-comments/campaigns/${c.id}/review`,{});status('Macでコメントを読み直しています。再送・再削除は行いません。');}));
      card.append(actions);
      const details=node('details');details.dataset.campaign=c.id;details.open=open.has(c.id);details.append(node('summary','商品ごとの文章と結果'));
      for(const i of c.items){
        const row=node('div',undefined,'sale-result');const link=node('a',i.title);
        link.href=`https://jp.mercari.com/item/${encodeURIComponent(i.itemId)}`;link.target='_blank';link.rel='noopener noreferrer';
        row.append(link,node('p',`${states[i.status]||i.status}${i.reason?'：'+i.reason:''}`),node('pre',i.body));details.append(row);
      }
      card.append(details);container.append(card);
    }
  }
  async function loadEdit(c) {
    if(c.mode!=='send')return;
    const value=await api('/sale-comments/snapshot');snapshot=value;
    selected=new Set(c.config.itemIds.filter(id=>snapshot.listings.some(r=>r.itemId===id)));
    $('sale-template').value=c.config.template;$('sale-mode').value=c.config.mode;
    $('sale-discount-type').value=c.config.discountType;$('sale-discount-value').value=c.config.discountValue;
    $('sale-timing').value='scheduled';
    if(c.scheduledAt)$('sale-datetime').value=new Date(c.scheduledAt*1000+9*3600000).toISOString().slice(0,16);
    editing={id:c.id,revision:c.revision};invalidate();renderListings();
    status('予約の変更内容を確認してください。確定するまで元の予約は有効です。');
    $('sale-form').scrollIntoView({block:'start',behavior:'smooth'});
  }
  async function refresh() {
    if(refreshInFlight)return;refreshInFlight=true;
    try{
      const data=await api('/sale-comments/campaigns');campaigns=data.campaigns;
      const key=JSON.stringify(campaigns);if(key!==historyKey){renderHistory();historyKey=key;}
      $('sale-connection').textContent=data.scheduler.ready?'Macの予約管理：稼働中':'Macの予約管理：確認が必要です';
    }catch(e){$('sale-connection').textContent='Macの予約管理：接続を確認できません';throw e;}finally{refreshInFlight=false;}
  }
  async function activate() {
    await run(async()=>{
      snapshot=await api('/sale-comments/snapshot');
      selected=new Set([...selected].filter(id=>snapshot.listings.some(i=>i.itemId===id)));
      renderListings();await refresh();controls();
    });
  }
  $('sale-sync').addEventListener('click',()=>run(async()=>{
    const r=await api('/sale-comments/sync',{});syncJob=r.job_id;
    status('Macで商品一覧を取得しています。画面を閉じても取得は続きます。');
  }));
  $('sale-all').addEventListener('click',()=>{selected=new Set(snapshot.listings.map(r=>r.itemId));invalidate();renderListings();});
  $('sale-clear').addEventListener('click',()=>{selected.clear();invalidate();renderListings();});
  $('sale-refresh').addEventListener('click',()=>run(refresh));
  $('sale-edit-cancel').addEventListener('click',()=>{editing=null;invalidate();status('予約の編集を終了しました。元の予約は変更していません。');});
  $('sale-form').addEventListener('input',invalidate);
  $('sale-form').addEventListener('change',invalidate);
  for(const b of document.querySelectorAll('[data-sale-token]'))b.addEventListener('click',()=>{
    const field=$('sale-template');field.setRangeText('{'+b.dataset.saleToken+'}',field.selectionStart,field.selectionEnd,'end');invalidate();field.focus();
  });
  $('sale-preview-btn').addEventListener('click',()=>run(async()=>{
    if(readReceipt(localStorage))throw new Error('前回の受付を先に確認してください');
    if($('sale-timing').value==='scheduled')scheduledISO($('sale-datetime').value);
    preview=await api('/sale-comments/preview',formConfig());renderPreview(preview);status('商品ごとの完成文を確認してください。');
  }));
  $('sale-confirm').addEventListener('click',()=>run(async()=>{
    if(!preview)throw new Error('送信前の確認をやり直してください');
    const scheduledAt=$('sale-timing').value==='scheduled'?scheduledISO($('sale-datetime').value):null;
    const body={previewId:preview.previewId,scheduledAt};
    if(editing)body.revision=editing.revision;
    await mutate(editing?`/sale-comments/campaigns/${editing.id}/edit`:'/sale-comments/campaigns',body);
  }));
  $('sale-recover').addEventListener('click',()=>run(async()=>{
    const receipt=readReceipt(localStorage);if(!receipt)return;
    try{
      await api('/sale-comments/operations/'+encodeURIComponent(receipt.id));localStorage.removeItem(RECEIPT_KEY);
      status('受付済みでした。再送せず履歴を更新しました。');await refresh();
    }catch(e){if(e.status!==404)throw e;$('sale-retry').hidden=false;status('受付はまだ確認できません。同じ受付番号で再送できます。',true);}
  }));
  $('sale-retry').addEventListener('click',()=>run(async()=>{
    const receipt=readReceipt(localStorage);if(receipt&&confirm('前回と同じ内容・同じ受付番号で確認し直しますか？'))await submitReceipt(receipt);
  }));
  try{
    const saved=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');
    if(saved){$('sale-template').value=saved.template||'';$('sale-mode').value=saved.mode||'common';$('sale-discount-type').value=saved.discountType||'yen';$('sale-discount-value').value=saved.discountValue||'';}
    readReceipt(localStorage);
  }catch(e){status(e.message,true);}
  controls();
  setInterval(async()=>{
    if(document.hidden||$('sale-panel').hidden||busy)return;
    try{
      if(syncJob){
        const data=await api('/status/'+encodeURIComponent(syncJob));
        if(data.status==='done'){snapshot=data.snapshot;syncJob=null;selected.clear();invalidate();renderListings();status('商品一覧を取得しました。');}
        else if(data.status==='error'){syncJob=null;status(data.message,true);}
      }
      await refresh();controls();
    }catch(e){if(syncJob&&e.status===404)syncJob=null;status('接続を確認できません。再接続後に履歴を更新してください。',true);controls();}
  },10000);
  window.addEventListener('storage',e=>{if(e.key===RECEIPT_KEY)controls();});
  root.MercariSale={activate,...helpers};
})(globalThis);

'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const source = ['catalog-data.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
async function check(resolution, validResponse = true, terminalStatus = '') {
  const storage = new Map(), elements = [], ids = new Map();
  const node = () => { const value = { handlers: {}, children: [], textContent: '',
    addEventListener(type, callback) { this.handlers[type] = callback; },
    append(child) { this.children.push(child); }, replaceChildren() { this.children=[]; } };
    elements.push(value); return value; };
  const get = id => { if (!ids.has(id)) ids.set(id,node()); return ids.get(id); };
  const calls = [];
  const ctx = { console, URL, crypto: webcrypto, __MERCARI_TEST__: true, confirm: () => true,
    setTimeout, clearTimeout, localStorage: { getItem: k => storage.get(k) ?? null,
      setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    document: { getElementById: get, createElement: node } };
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
  const h=ctx.MercariAppTestHooks;
  const payload={title:'fixture',price:4000};
  const receipt=h.getOrCreateDraftOperation_(payload,1,'review-workflow');
  ctx.mockFetch=async(url, options={})=>{
    const method=options.method||'GET';calls.push({url,method});
    let data={ok:true,items:[],alerts:[],receipts:[]};
    if(url.includes('/draft/review')) data=method==='POST'
      ? {ok:true,item:{operationId:receipt.operationId,status:validResponse?`resolved_${resolution}`:'needs_review',inventoryLink:{selected:true,status:'needs_review'}}}
      : terminalStatus
        ? {ok:true,items:[],localOperation:{operationId:receipt.operationId,status:terminalStatus,terminal:true,
          manualReviewFields:['brand'],inventoryLink:{selected:true,status:'needs_review'}}}
        : {ok:true,items:[{operationId:receipt.operationId,status:'needs_review'}]};
    return {ok:true,status:200,text:async()=>JSON.stringify(data)};
  };
  vm.runInContext(`getMercariServiceUrl=async()=>'https://fixture.trycloudflare.com';fetchWithTimeout=mockFetch;__MERCARI_TEST__=false;`,ctx);
  vm.runInContext(fs.readFileSync('review.js','utf8'),ctx);
  await get('safety-review-refresh').handlers.click();
  const button=elements.find(n=>n.textContent===(terminalStatus?'この受付の終了状態を確認':resolution==='saved'?'保存済みと確認':'未保存と確認'));
  assert.ok(button);
  await button.handlers.click();
  const latest=h.getOrCreateDraftOperation_(payload,2,'review-workflow');
  assert.equal(latest.operationId,receipt.operationId,'review never drops the receipt');
  assert.equal(latest.completed===true,validResponse&&resolution==='saved');
  if(latest.completed) {
    assert.equal(latest.completedResult.inventoryLink.status,'needs_review');
    if(terminalStatus) assert.equal(latest.completedResult.manualReviewFields[0],'brand');
  }
  if(terminalStatus && !validResponse) assert.match(get('safety-review-status').textContent,/保存結果を確定できない/);
  assert.equal(calls.filter(c=>c.method==='POST').length,terminalStatus?0:1);
  assert.ok(calls.every(c=>!c.url.endsWith('/draft')),'review cannot save a new draft');
}
(async()=>{await check('saved');await check('not_saved');await check('saved',false);
  for(const status of ['confirmed','done','resolved_saved']) await check('saved',true,status);
  for(const status of ['failed','error','resolved_not_saved']) await check('not_saved',true,status);
  await check('saved',false,'unknown');
  console.log('PASS review UI: saved/not_saved and ledger confirmed/failed aliases preserve receipt and warnings; unknown stays unresolved without POST');
})().catch(error=>{console.error(error);process.exitCode=1;});

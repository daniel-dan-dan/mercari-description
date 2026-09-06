'use strict';

// Explicit, human-reviewed resolutions only. Opening this panel never writes.
(() => {
  const dateText = value => {
    const stamp = Date.parse(value || '');
    return Number.isFinite(stamp) ? new Date(stamp).toLocaleString('ja-JP') : '日時未確認';
  };
  const countText = value => Number.isInteger(value) && value >= 0 ? `${value}件` : '未確認';
  function workflowText(receipt = {}) {
    const evidence = receipt.workflow || {};
    const retrieved = evidence.retrieved ?? (['validated', 'committed', 'archived'].includes(receipt.status) ? receipt.itemCount : null);
    return `CSV取得 ${countText(retrieved)} / 今回受信 ${countText(evidence.accepted)} / 再読込確認 ${countText(evidence.verified)} / 今回在庫反映 ${countText(evidence.applied)} / 受信箱未解決総数 ${countText(evidence.unresolvedTotal)}。記録日時 ${dateText(receipt.updatedAt)}。未解決総数は当時の受信箱状態で、現在の全在庫監査ではありません。`;
  }
  if (globalThis.__MERCARI_TEST__) {
    globalThis.MercariReviewTestHooks = { workflowText, countText, dateText };
    return;
  }
  const panel = document.getElementById('safety-review-panel');
  if (!panel) return;
  const status = document.getElementById('safety-review-status');
  const content = document.getElementById('safety-review-content');
  const refresh = document.getElementById('safety-review-refresh');
  const node = (tag, text, parent) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    parent?.append(element);
    return element;
  };
  const link = (parent, title, href) => {
    const anchor = node('a', title, parent);
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  };
  let busy = false;
  let tunnel = '';
  async function api(path, payload) {
    const response = await fetchWithTimeout(`${tunnel}${path}`, payload ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    } : {}, 20000);
    const data = await readJsonResponse(response, '要確認一覧');
    if (!response.ok || !data.ok) throw new Error(data.error || '状態を取得できませんでした');
    return data;
  }
  function action(parent, title, promptText, path, payload, verify) {
    const button = node('button', title, parent);
    button.type = 'button';
    button.className = 'btn small';
    button.addEventListener('click', async () => {
      if (busy || !confirm(promptText)) return;
      const body = typeof payload === 'function' ? payload() : payload;
      if (!body) return;
      busy = true;
      button.disabled = true;
      let resultMessage = '';
      try {
        const response = await api(path, body);
        if (verify && !verify(response)) throw new Error('記録結果が一致しません。自動再送せず再確認してください。');
        if (path === '/draft/review') clearDraftOperation_(body.operationId);
        resultMessage = '確認結果を記録しました。販売価格・出品・在庫反映は実行していません。';
      } catch (error) {
        resultMessage = `確認記録の結果は未確定です。${error.message} 元の保留を確認してください。`;
      } finally {
        busy = false;
        await load();
        status.textContent = resultMessage;
      }
    });
  }
  async function load() {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    status.textContent = 'Macの状態を読み取っています…';
    content.replaceChildren();
    try {
      tunnel = await getMercariServiceUrl();
      let localOperationId = '';
      try { localOperationId = JSON.parse(localStorage.getItem(DRAFT_OPERATION_STORAGE_KEY) || 'null')?.operationId || ''; } catch (_) {}
      const sections = [
        ['下書き保存の要確認', '/draft/review', 'items'],
        ['価格変更の結果不明', '/markdown/ambiguous', 'items'],
        ['在庫紐付けの未解決', '/inventory/links/review', 'items'],
        ['異常・復旧記録（未読の最新100件まで）', '/alerts', 'alerts'],
        ['売上CSVの取得・受信・反映（最新1件）', '/sales/csv-receipts?limit=1', 'receipts'],
      ];
      const results = await Promise.allSettled(sections.map(([, path]) => api(path === '/draft/review' && localOperationId
        ? `${path}?operationId=${encodeURIComponent(localOperationId)}` : path)));
      results.forEach((result, index) => {
        const [title, path, key] = sections[index];
        const section = node('section', null, content);
        node('h3', title, section);
        if (result.status !== 'fulfilled') {
          node('p', `未取得（0件ではありません）: ${result.reason.message}`, section);
          return;
        }
        const rows = result.value[key] || [];
        if (path === '/draft/review' && localOperationId && !rows.some(row => row.operationId === localOperationId)) {
          const local = result.value.localOperation;
          node('p', `この端末の受付: ${local?.status || '未確認'}。受付IDは保持しています。`, section);
          if (local?.terminal && local.operationId === localOperationId) {
            const finish = node('button', 'この受付の終了状態を確認', section);
            finish.type = 'button'; finish.className = 'btn small';
            finish.addEventListener('click', () => {
              if (busy || !confirm(`Macの受付状態は ${local.status} です。この受付の確認を終了しますか？別の商品はこの確認をせずに保存できます。`)) return;
              try { clearDraftOperation_(localOperationId); load(); } catch (error) {
                status.textContent = `受付記録を整理できませんでした。${error.message}`;
              }
            });
          }
        }
        if (!rows.length) node('p', '該当記録なし', section);
        else node('p', `${result.value.count ?? rows.length}件`, section);
        rows.forEach(row => {
          const card = node('article', null, section);
          card.className = 'safety-review-card';
          if (key === 'receipts') { node('p', workflowText(row), card); return; }
          node('p', row.title || row.message || row.operationId || row.itemId || '記録', card);
          node('p', `${row.status || '要確認'} / ${dateText(row.updatedAt || row.attemptedAt || row.lastSeenAt || row.createdAt)}`, card);
          if (path === '/draft/review') {
            link(card, 'メルカリの下書きを開いて確認', 'https://jp.mercari.com/sell/drafts');
            for (const [resolution, label] of [['saved', '保存済みと確認'], ['not_saved', '未保存と確認']]) {
              action(card, label, `受付 ${row.operationId} の実際の下書きを確認し、「${label}」で記録しますか？未保存とすると同じ受付の再実行が可能になります。`, path,
                { operationId: row.operationId, resolution }, data => data.item?.status === `resolved_${resolution}`);
            }
          } else if (path === '/markdown/ambiguous' && /^m\d{8,20}$/.test(row.itemId)) {
            link(card, '商品ページで現在価格を確認', `https://jp.mercari.com/item/${row.itemId}`);
            action(card, '実価格を確認して保留を解決', '商品ページの現在価格を確認しましたか？解決後も自動値下げはOFFのままです。', path, () => {
              const answer = prompt('現在の商品ページの価格を半角数字で入力してください');
              if (answer === null) return null;
              if (!/^\d+$/.test(answer) || Number(answer) < 300) { status.textContent = '300円以上の実価格を入力してください。'; return null; }
              return { itemId: row.itemId, observedPrice: Number(answer), resolution: 'cancelled', note: 'スマホで実価格を確認。自動再開なし' };
            }, data => data.item?.markdownVerificationStatus === 'resolved' && data.item?.autoEnabled === false);
          } else if (key === 'alerts') {
            if (row.recoveredAt) node('p', `復旧確認: ${dateText(row.recoveredAt)}（既読とは別です）`, card);
            action(card, '既読にする', '異常内容を確認しましたか？既読化は保留解除や復旧判定ではありません。', '/alerts', { alertId: row.alertId }, data => Boolean(data.alert?.acknowledgedAt));
          } else {
            node('p', row.reviewReason || '在庫管理側で現物と対応を確認してください。商品名の近似一致による自動解除はしません。', card);
          }
        });
      });
      status.textContent = `読取確認 ${new Date().toLocaleString('ja-JP')}。開くだけでは保留を解除しません。`;
    } catch (error) {
      status.textContent = `取得できませんでした。件数は未確認です。${error.message}`;
    } finally {
      busy = false;
      refresh.disabled = false;
    }
  }
  refresh.addEventListener('click', load);
  panel.addEventListener('toggle', () => { if (panel.open) load(); });
})();

'use strict';

// Inventory stays outside the listing form. Opening/closing this screen never
// collects, resets, or replaces a product's photos and measurements.
(() => {
  const OPERATION_KEY = 'mercari_inventory_hub_pending_v1';
  const STATES = ['unlisted', 'listed', 'review'];
  const STATE_LABELS = { unlisted: '未出品候補', listed: '出品中', review: '確認待ち' };
  const UUID = /^inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const ITEM_ID = /^m\d+$/;
  const text = value => String(value == null ? '' : value).trim();

  function safeListingUrl(item) {
    const id = text(item?.itemId);
    return ITEM_ID.test(id) ? `https://jp.mercari.com/item/${id}` : '';
  }

  function normalizeHub(data) {
    if (data?.ok !== true || !Array.isArray(data.items)) throw new Error(text(data?.error) || '在庫一覧を取得できませんでした。');
    const seen = new Set();
    const items = data.items.filter(item => {
      const uuid = text(item.inventoryUuid);
      const key = text(item.itemKey) || uuid;
      const held = !uuid && /^held:/.test(key);
      if ((!UUID.test(uuid) && !held) || seen.has(key) || text(item.asin) !== 'なし') return false;
      seen.add(key);
      return true;
    }).map(item => {
      const validIdentity = UUID.test(text(item.inventoryUuid)) && !item.holdReason;
      const state = validIdentity && STATES.includes(item.listingState) ? item.listingState : 'review';
      const candidates = validIdentity ? (Array.isArray(item.candidates) ? item.candidates : []).filter(candidate => ITEM_ID.test(text(candidate.itemId))) : [];
      return { ...item, productName: text(item.productName) || '商品名未登録', listingState: state,
        candidates, canList: validIdentity && item.canList === true && state === 'unlisted' && data.inventoryComplete === true };
    });
    // Counts are the displayed eligible inventory, not a possibly partial source total.
    const counts = Object.fromEntries(STATES.map(state => [state, items.filter(item => item.listingState === state).length]));
    return { ...data, items, counts, inventoryComplete: data.inventoryComplete === true };
  }

  function filterItems(items, state, query) {
    const normalized = text(query).normalize('NFKC').toLowerCase();
    return items.filter(item => item.listingState === state && `${item.productName} ${item.sku || ''}`.normalize('NFKC').toLowerCase().includes(normalized));
  }

  function createController({ request, storage, operationId, onChange = () => {}, isVisible = () => true,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const state = { data: null, pending: null, loading: false, working: false, stale: false, message: '', kind: '', storageError: false };
    let refreshVersion = 0;
    try {
      const saved = JSON.parse(storage.getItem(OPERATION_KEY) || 'null');
      if (saved) {
        if (!/^[a-zA-Z0-9_-]{10,120}$/.test(text(saved.operationId)) || !['reconcile', 'confirm'].includes(saved.kind)) throw new Error('invalid operation');
        state.pending = saved;
      }
    } catch (_) {
      state.storageError = true;
      state.message = '端末に照合の受付情報を保存できません。端末の保存設定を確認してください。';
      state.kind = 'error';
    }
    const emit = () => onChange(state);
    function remember(value) {
      // Persist before a write so that closing the app cannot lose its identity.
      if (value) {
        const serialized = JSON.stringify(value);
        storage.setItem(OPERATION_KEY, serialized);
        if (storage.getItem(OPERATION_KEY) !== serialized) throw new Error('照合の受付情報を保存できませんでした。処理は送信していません。');
      } else {
        storage.removeItem(OPERATION_KEY);
        if (storage.getItem(OPERATION_KEY) != null) throw new Error('照合の結果を端末に保存できませんでした。「結果を再確認」で確認してください。');
      }
      state.pending = value;
    }
    function notice(message, kind = '') { state.message = text(message); state.kind = kind; emit(); }
    async function refresh() {
      const version = ++refreshVersion;
      state.loading = true;
      emit();
      try {
        const data = normalizeHub(await request('/inventory/hub'));
        if (version === refreshVersion) {
          if (state.stale && state.kind === 'error') { state.message = ''; state.kind = ''; }
          state.data = data; state.stale = false;
        }
        return data;
      } catch (error) {
        if (version === refreshVersion) {
          state.stale = true;
          notice(`${state.data ? '前回の一覧を表示しています。' : ''}${text(error.message) || '在庫を取得できませんでした。'}「更新」で再確認できます。`, 'error');
        }
        throw error;
      } finally { if (version === refreshVersion) { state.loading = false; emit(); } }
    }
    function accept(result) {
      const pending = state.pending;
      if (!pending) return false;
      if (result?.ok === false && result.requestAccepted === false && result.code === 'OPERATION_NOT_FOUND') {
        remember(null);
        notice('処理は受け付けられていませんでした。もう一度「メルカリと照合」を押してください。', 'warn');
        return true;
      }
      if (result?.operationId !== pending.operationId) return false;
      if (result.status === 'needs_review' && result.serverStoredHold === true) {
        remember(null);
        notice('反映を確認できない商品を「確認待ち」に残しました。他の商品の確認・出品を続けられます。', 'warn');
        return true;
      }
      if (result.status === 'done' && result.ok === true) {
        if (pending.kind === 'confirm') {
          const receipt = result.receipt;
          if (!receipt || receipt.readbackVerified !== true || receipt.listingChecked !== true
            || receipt.inventoryUuid !== pending.inventoryUuid || receipt.itemId !== pending.itemId) {
            notice('チェックの反映をまだ確認できません。「結果を再確認」で確認してください。', 'warn');
            return false;
          }
        }
        remember(null);
        const updated = Number(result.summary?.updated);
        notice(pending.kind === 'confirm' ? '在庫シートへのチェックを確認しました。'
          : `照合しました。${Number.isFinite(updated) ? `${updated}件のチェックを反映しました。` : ''}確認待ちの商品もご確認ください。`, 'success');
        return true;
      }
      if (result.status === 'error') {
        remember(null);
        notice(text(result.message || result.error) || '照合を完了できませんでした。内容を確認してからもう一度お試しください。', 'error');
        return true;
      }
      notice(text(result.message || result.error) || (result.status === 'needs_review'
        ? '反映状況の確認が必要です。「結果を再確認」で確認してください。'
        : 'メルカリの商品と在庫を確認しています…'), result.status === 'needs_review' ? 'warn' : '');
      return false;
    }
    async function poll() {
      // Start with one persisted operation; continue only while visible/pending;
      // stop at a verified terminal result, failure, or 30 read-only polls.
      for (let attempt = 0; attempt < 30 && state.pending && isVisible(); attempt++) {
        const id = state.pending.operationId;
        let result;
        try { result = await request(`/inventory/hub/result?operationId=${encodeURIComponent(id)}`); }
        catch (_) {
          notice('通信が途切れました。受付情報は残っています。「結果を再確認」で続きの結果を確認できます。', 'warn');
          return;
        }
        if (state.pending?.operationId !== id) return;
        if (accept(result)) { await refresh().catch(() => {}); return; }
        if (result?.status === 'needs_review' || result?.ok === false) return;
        if (attempt < 29) await wait(2000);
      }
      if (state.pending && isVisible()) notice('処理の結果をまだ確認できません。「結果を再確認」で続きの結果を確認できます。', 'warn');
    }
    async function resume() {
      if (!state.pending || state.working) return;
      state.working = true;
      emit();
      try { await poll(); }
      catch (error) { notice(text(error.message) || '照合結果を確認できませんでした。', 'error'); }
      finally { state.working = false; emit(); }
    }
    async function start(kind, payload = {}) {
      if (state.pending || state.working || state.loading || state.storageError) return false;
      const id = operationId();
      state.working = true;
      try {
        remember({ operationId: id, kind, startedAt: new Date().toISOString(),
          ...(kind === 'confirm' ? { inventoryUuid: payload.inventoryUuid, itemId: payload.itemId } : {}) });
        notice(kind === 'confirm' ? '選んだ商品を在庫シートに反映しています…' : 'メルカリと照合しています…');
        let result;
        try {
          result = await request(`/inventory/hub/${kind}`, { method: 'POST', body: { ...payload, operationId: id } });
        } catch (_) {
          notice('受付結果を確認しています。同じ処理は再送しません。', 'warn');
        }
        const rejected = result?.ok === false && (result.requestAccepted === false
          || (result.httpStatus === 401 && result.code === 'UNAUTHORIZED')
          || (result.httpStatus === 429 && result.code === 'RATE_LIMITED'));
        if (rejected) {
          remember(null);
          notice(text(result.error) || '処理は受け付けられていません。接続と入力内容を確認してください。', 'error');
          return false;
        }
        if (accept(result)) await refresh().catch(() => {});
        else await poll();
        return true;
      } catch (error) {
        notice(text(error.message) || '照合の受付情報を保存できませんでした。', 'error');
        return false;
      } finally { state.working = false; emit(); }
    }
    return { state, refresh, start, resume, notice };
  }

  function mount({ document: doc, window: win, request, storage, operationId, showScreen, ready,
    locked, hasInput, selectedUuid, startListing }) {
    const get = id => doc.getElementById(id);
    let filter = 'unlisted';
    let returnScroll = 0;
    let switching = false;
    const node = (tag, className, content) => {
      const element = doc.createElement(tag);
      if (className) element.className = className;
      if (content != null) element.textContent = String(content);
      return element;
    };
    const button = (label, className, action) => {
      const element = node('button', className, label);
      element.type = 'button';
      element.addEventListener('click', action);
      return element;
    };
    const controller = createController({ request, storage, operationId,
      isVisible: () => !get('inventory-hub-screen').hidden && doc.visibilityState !== 'hidden', onChange: render });
    const disabled = () => switching || controller.state.loading || controller.state.working || !!controller.state.pending || controller.state.stale;

    function dateLabel(value) {
      const date = new Date(value);
      return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未確認';
    }
    function appendListing(parent, listing) {
      const row = node('div', 'inventory-hub-match-product');
      try {
        const url = new URL(listing.imageUrl);
        if (url.protocol === 'https:' && url.hostname === 'static.mercdn.net' && !url.username && !url.password) {
          const img = node('img'); img.src = url.href; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; row.append(img);
        }
      } catch (_) {}
      const copy = node('div');
      copy.append(node('strong', '', text(listing.title) || '商品名を確認してください'));
      if (Number.isFinite(Number(listing.price)) && Number(listing.price) > 0) copy.append(node('p', 'inventory-hub-meta', `${Number(listing.price).toLocaleString('ja-JP')}円`));
      const url = safeListingUrl(listing);
      if (url) {
        const link = node('a', 'inventory-hub-link', 'メルカリで確認');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; copy.append(link);
      }
      row.append(copy); parent.append(row);
    }
    function ask({ title, message, item, candidate, label, action }) {
      const dialog = node('dialog', 'inventory-hub-dialog');
      const heading = node('h2', '', title); heading.id = 'inventory-hub-dialog-title';
      dialog.setAttribute('aria-labelledby', heading.id);
      dialog.append(heading, node('p', 'note', message));
      if (item) {
        const source = node('div', 'inventory-hub-identity');
        source.append(node('small', '', '在庫管理シート'), node('strong', '', item.productName), node('p', 'inventory-hub-meta', item.sku ? `管理番号 ${item.sku}` : '管理番号未登録'));
        dialog.append(source);
      }
      if (candidate) {
        const target = node('div', 'inventory-hub-identity');
        target.append(node('small', '', 'メルカリの出品')); appendListing(target, candidate); dialog.append(target);
      }
      const error = node('p', 'status error'); error.hidden = true; error.setAttribute('role', 'alert'); dialog.append(error);
      const actions = node('div', 'inventory-hub-dialog-actions');
      let submitting = false;
      const cancel = button('キャンセル', 'btn', () => dialog.close());
      const confirm = button(label, 'btn primary', async () => {
        if (submitting) return;
        submitting = true; confirm.disabled = true; cancel.disabled = true; error.hidden = true;
        try { await action(); dialog.close(); }
        catch (err) { error.textContent = text(err.message) || '操作できませんでした。'; error.hidden = false; }
        finally { submitting = false; confirm.disabled = false; cancel.disabled = false; }
      });
      dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      actions.append(cancel, confirm); dialog.append(actions); doc.body.append(dialog); dialog.showModal(); cancel.focus();
    }
    async function choose(item, saveCurrent) {
      switching = true; render();
      try {
        const data = await controller.refresh();
        const fresh = data.items.find(value => value.inventoryUuid === item.inventoryUuid);
        if (!fresh?.canList || fresh.listingState !== 'unlisted') throw new Error('この商品の状態が変わりました。一覧を確認してください。');
        await startListing(fresh, { saveCurrent });
        showScreen('main-screen');
        win.scrollTo({ top: 0, behavior: 'instant' });
        const banner = get('inventory-started-note');
        if (banner) { banner.textContent = `在庫「${fresh.productName}」を選択しました。写真・採寸を入力してください。`; banner.hidden = false; }
      } finally { switching = false; render(); }
    }
    function select(item) {
      if (disabled() || locked()) return;
      if (hasInput() && selectedUuid() !== item.inventoryUuid) {
        ask({ title: '入力中の商品を一時保存', message: '今の写真・採寸・説明文を一時保存して、選んだ商品の出品準備を始めます。', item,
          label: '保存して切り替える', action: () => choose(item, true) });
      } else choose(item, false).catch(error => controller.notice(error.message, 'error'));
    }
    function review(item, candidate) {
      if (disabled()) return;
      ask({ title: '同じ商品か確認', message: '商品名・サイズ・色・管理番号を確認してください。一致を確定すると、在庫シートの出品チェックを入れます。', item, candidate,
        label: '同じ商品としてチェック', action: async () => {
          const data = await controller.refresh();
          const fresh = data.items.find(value => value.inventoryUuid === item.inventoryUuid);
          const match = fresh?.candidates.find(value => value.itemId === candidate.itemId && value.title === candidate.title);
          if (!fresh || !match || fresh.listingState !== 'review') throw new Error('候補が変わりました。一覧からもう一度確認してください。');
          if (data.schemaReady !== true || !data.inventoryComplete) throw new Error('在庫の読み込みが完了していません。「更新」後に確認してください。');
          const started = await controller.start('confirm', { inventoryUuid: fresh.inventoryUuid, itemId: match.itemId, expectedTitle: match.title });
          if (!started) throw new Error(controller.state.message || '照合を受け付けられませんでした。入力内容は変更していません。');
        } });
    }
    function card(item) {
      const article = node('article', 'inventory-hub-card');
      article.append(node('h2', '', item.productName));
      const meta = [item.sku ? `管理番号 ${item.sku}` : '管理番号未登録', item.purchaseDate ? `仕入日 ${text(item.purchaseDate).slice(0, 10)}` : ''];
      article.append(node('p', 'inventory-hub-meta', meta.filter(Boolean).join('　')));
      if (item.reason) article.append(node('p', 'inventory-hub-reason', item.reason));
      if (item.listingState === 'listed' && item.listing) appendListing(article, item.listing);
      if (item.listingState === 'review') {
        for (const candidate of item.candidates) {
          const match = node('div', 'inventory-hub-candidate');
          match.append(node('small', 'inventory-hub-candidate-label', '一致しそうな出品'));
          appendListing(match, candidate);
          if (candidate.reason) match.append(node('p', 'inventory-hub-meta', candidate.reason));
          const confirm = button('同じ商品か確認する', 'btn small', () => review(item, candidate)); confirm.disabled = disabled() || controller.state.data.schemaReady !== true || !controller.state.data.inventoryComplete;
          match.append(confirm); article.append(match);
        }
        if (!item.candidates.length && item.listing) appendListing(article, item.listing);
      }
      if (item.canList) {
        const start = button('この商品を出品する', 'btn inventory-hub-start', () => select(item)); start.disabled = disabled() || locked(); article.append(start);
      }
      return article;
    }
    function render() {
      const state = controller.state;
      get('inventory-hub-status').hidden = !state.message;
      get('inventory-hub-status').textContent = state.message;
      get('inventory-hub-status').className = `status ${state.kind}`;
      get('inventory-hub-back').disabled = switching;
      get('inventory-hub-reconcile').disabled = disabled() || !state.data || !state.data.inventoryComplete || state.data.schemaReady !== true || state.storageError;
      get('inventory-hub-reconcile').textContent = state.working ? '確認中…' : 'メルカリと照合';
      get('inventory-hub-refresh').disabled = state.loading || state.working || switching;
      get('inventory-hub-resume').hidden = !state.pending;
      get('inventory-hub-resume').disabled = state.working || switching;
      get('inventory-hub-resume').textContent = '結果を再確認';
      get('inventory-hub-last-checked').textContent = `最終照合：${dateLabel(state.data?.lastCheckedAt)}`;
      const notice = state.data?.notice || '未出品候補は、出品済みと確認できていない在庫です。';
      get('inventory-hub-notice').textContent = state.data && !state.data.inventoryComplete
        ? '在庫の取得が途中です。更新が完了するまで出品を始められません。'
        : state.data && state.data.schemaReady !== true
          ? '在庫シートの出品チェック欄を確認できません。「更新」で、もう一度確認してください。'
          : notice;
      for (const key of STATES) {
        get(`inventory-hub-count-${key}`).textContent = state.data ? String(state.data.counts[key]) : '—';
        doc.querySelector(`[data-inventory-hub-filter="${key}"]`).setAttribute('aria-pressed', String(filter === key));
      }
      const list = get('inventory-hub-list'); list.replaceChildren(); list.setAttribute('aria-busy', String(state.loading));
      if (!state.data) {
        list.append(node('p', 'inventory-hub-empty', state.loading ? '在庫を読み込んでいます…' : '「更新」で在庫を読み込めます。'));
        get('inventory-hub-result-count').textContent = '';
        return;
      }
      const visible = filterItems(state.data.items, filter, get('inventory-hub-search').value);
      get('inventory-hub-result-count').textContent = `${STATE_LABELS[filter]} ${visible.length}件${state.stale ? '（前回の一覧）' : ''}`;
      if (visible.length) visible.forEach(item => list.append(card(item)));
      else list.append(node('p', 'inventory-hub-empty', get('inventory-hub-search').value ? '検索に一致する商品はありません。' : `${STATE_LABELS[filter]}の商品はありません。`));
    }
    get('inventory-hub-open').addEventListener('click', async () => {
      if (!ready() || locked()) return;
      returnScroll = win.scrollY;
      showScreen('inventory-hub-screen'); win.scrollTo({ top: 0, behavior: 'instant' }); get('inventory-hub-title').focus({ preventScroll: true });
      await controller.refresh().catch(() => {});
      if (controller.state.pending) controller.resume();
    });
    get('inventory-hub-back').addEventListener('click', () => {
      if (switching) return;
      showScreen('main-screen'); win.scrollTo({ top: returnScroll, behavior: 'instant' }); get('inventory-hub-open').focus({ preventScroll: true });
    });
    get('inventory-hub-refresh').addEventListener('click', () => controller.refresh().catch(() => {}));
    get('inventory-hub-reconcile').addEventListener('click', () => controller.start('reconcile'));
    get('inventory-hub-resume').addEventListener('click', () => controller.resume());
    get('inventory-hub-search').addEventListener('input', render);
    doc.querySelectorAll('[data-inventory-hub-filter]').forEach(control => control.addEventListener('click', () => { filter = control.dataset.inventoryHubFilter; render(); }));
    render();
    return controller;
  }

  globalThis.MercariInventoryHub = Object.freeze({ normalizeHub, filterItems, safeListingUrl, createController, mount, OPERATION_KEY });
  if (!globalThis.__MERCARI_TEST__) mount({ document, window, storage: localStorage,
    ready: () => inventoryHubReady_, locked: () => isProductInputLocked_() || inventoryHubSwitchInProgress_,
    operationId: () => createOperationId_('inventory-hub'), showScreen,
    hasInput: hasMeaningfulCurrentInput_, selectedUuid: () => normalizeInventoryUuid_(el('inventory-uuid-input')?.value), startListing: startListingFromInventory_,
    request: async (path, options = {}) => {
      const service = await getMercariServiceUrl();
      const requestOptions = options.method === 'POST' ? { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operation-Id': options.body.operationId }, body: JSON.stringify(options.body) } : {};
      const response = await fetchWithTimeout(`${service}${path}`, requestOptions, 30000);
      const data = await readJsonResponse(response, '在庫照合');
      return { ...data, httpStatus: response.status };
    },
  });
})();

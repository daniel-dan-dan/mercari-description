'use strict';

(() => {
  if (window.lucide) window.lucide.createIcons();
  if (!('serviceWorker' in navigator)) return;
  const version = globalThis.MercariPublicConfig?.version || 'v20260920q';
  function releaseNumber(value) {
    const match = /^v(\d{8})([a-z]+)$/.exec(String(value || ''));
    return match ? [Number(match[1]), [...match[2]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 96, 0)] : null;
  }
  function isNewer(target) {
    const a = releaseNumber(target), b = releaseNumber(version);
    return !!(a && b && (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])));
  }
  function hideUpdate() {
    document.getElementById('app-update-note')?.remove();
  }
  function showWaitingUpdate(target) {
    let note = document.getElementById('app-update-note');
    if (!note) {
      note = document.createElement('p');
      note.id = 'app-update-note';
      note.className = 'app-update-note';
      note.setAttribute('role', 'status');
      document.getElementById('app')?.prepend(note);
    }
    note.textContent = `新しい版（${target}）があります。入力を終えたら、アプリの画面をすべて閉じて開き直してください。`;
  }
  function workerVersion(worker) {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = value => {
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 2000);
      channel.port1.onmessage = event => finish(event.data?.type === 'APP_VERSION' ? event.data.version : null);
      try { worker.postMessage({ type: 'GET_APP_VERSION' }, [channel.port2]); }
      catch (_) { finish(null); }
    });
  }
  let revision = 0;
  // A fixed worker URL avoids reinstalling identical code when old/new pages coexist.
  // Never reload a page or activate a waiting worker while product input is open.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(registration => {
      async function refreshNotice() {
        const currentRevision = ++revision;
        const waiting = registration.waiting;
        if (!waiting || !navigator.serviceWorker.controller) { hideUpdate(); return; }
        const target = await workerVersion(waiting);
        if (currentRevision !== revision) return;
        if (registration.waiting === waiting && waiting.state === 'installed' && isNewer(target)) showWaitingUpdate(target);
        else hideUpdate();
      }
      const observed = new WeakSet();
      function observe(worker) {
        if (!worker || observed.has(worker)) return;
        observed.add(worker);
        worker.addEventListener('statechange', refreshNotice);
      }
      observe(registration.waiting);
      observe(registration.installing);
      refreshNotice();
      registration.addEventListener('updatefound', () => {
        observe(registration.installing);
        refreshNotice();
      });
      navigator.serviceWorker.addEventListener('controllerchange', refreshNotice);
      window.addEventListener('pageshow', refreshNotice);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshNotice();
      });
      return registration.update().then(refreshNotice);
    })
    .catch(error => console.warn('アプリ更新確認に失敗しました:', error));
})();

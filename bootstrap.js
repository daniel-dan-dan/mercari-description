'use strict';

(() => {
  if (window.lucide) window.lucide.createIcons();
  if (!('serviceWorker' in navigator)) return;
  const version = globalThis.MercariPublicConfig?.version || 'v20260907a';
  function showWaitingUpdate() {
    let note = document.getElementById('app-update-note');
    if (!note) {
      note = document.createElement('p');
      note.id = 'app-update-note';
      note.className = 'app-update-note';
      note.setAttribute('role', 'status');
      document.getElementById('app')?.prepend(note);
    }
    note.textContent = '更新の準備ができました。入力を終えたら、このアプリの画面をすべて閉じて開き直してください。';
  }
  // Do not reload other tabs: they may contain photos or an in-flight draft.
  navigator.serviceWorker
    .register(`sw.js?v=${encodeURIComponent(version.replace(/^v/, ''))}`, { updateViaCache: 'none' })
    .then(registration => {
      if (registration.waiting && navigator.serviceWorker.controller) showWaitingUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showWaitingUpdate();
        });
      });
      return registration.update();
    })
    .catch(error => console.warn('アプリ更新確認に失敗しました:', error));
})();

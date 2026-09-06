'use strict';

(() => {
  if (window.lucide) window.lucide.createIcons();
  if (!('serviceWorker' in navigator)) return;

  const version = globalThis.MercariPublicConfig?.version || 'v20260906b';
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const reloadKey = `mercari_sw_reloaded_${version}`;
    try {
      if (sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, '1');
    } catch (_) {
      return;
    }
    location.reload();
  });

  navigator.serviceWorker
    .register(`sw.js?v=${encodeURIComponent(version.replace(/^v/, ''))}`, { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(error => console.warn('アプリ更新確認に失敗しました:', error));
})();

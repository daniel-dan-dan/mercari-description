'use strict';

// この値は公開Webアプリの接続先であり、秘密情報ではありません。
// 任意URLへ端末情報を送らないため、利用可能なGASをここで1つに固定します。
(() => {
  const config = Object.freeze({
    version: 'v20260907a',
    gasUrl: 'https://script.google.com/macros/s/AKfycbwYfwDG7Kqplk2oVeX7kF_gsAKTlK087ToE4LGp5R7PglTFMARP2lrA6ZV9m3MD0LEs/exec',
  });
  Object.defineProperty(globalThis, 'MercariPublicConfig', {
    value: config,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})();

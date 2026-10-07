'use strict';
(function (root) {
  const MODEL_EDGE = 320;
  const scriptRoot = typeof document !== 'undefined' ? new URL('.', document.currentScript.src).href : '';
  function normalizedMask(data) {
    if (!data || data.length !== MODEL_EDGE * MODEL_EDGE) throw Error('切り抜き結果のサイズが不正です');
    let min = Infinity, max = -Infinity;
    for (const value of data) {
      if (!Number.isFinite(value)) throw Error('切り抜き結果を読み取れませんでした');
      min = Math.min(min, value); max = Math.max(max, value);
    }
    if (max - min < 0.001) throw Error('服の輪郭を見つけられませんでした');
    const mask = Uint8ClampedArray.from(data, value => 255 * (value - min) / (max - min));
    let count = 0;
    for (const value of mask) if (value > 127) count++;
    if (count < mask.length * 0.01 || count > mask.length * 0.98) throw Error('服の輪郭を確認できませんでした。別の写真をお試しください');
    return mask;
  }
  function bounds(mask, width, height) {
    if (mask.length !== width * height) throw Error('輪郭のサイズが不正です');
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (mask[y * width + x] < 128) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) throw Error('服の輪郭が空です');
    return { left, top, right, bottom };
  }
  function fit(box, sourceWidth, sourceHeight, size = 84, edge = 1080) {
    const padding = 3;
    const x = Math.max(0, box.left * sourceWidth / MODEL_EDGE - padding);
    const y = Math.max(0, box.top * sourceHeight / MODEL_EDGE - padding);
    const right = Math.min(sourceWidth, (box.right + 1) * sourceWidth / MODEL_EDGE + padding);
    const bottom = Math.min(sourceHeight, (box.bottom + 1) * sourceHeight / MODEL_EDGE + padding);
    const w = right - x, h = bottom - y;
    const scale = edge * Math.max(65, Math.min(90, Number(size) || 84)) / 100 / Math.max(w, h);
    return { x, y, w, h, dx: (edge - w * scale) / 2, dy: (edge - h * scale) / 2, dw: w * scale, dh: h * scale };
  }
  function canvas(width, height) {
    const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
  }
  function render(image, background, mask, size, edge = 1080) {
    const sw = image.naturalWidth || image.width, sh = image.naturalHeight || image.height;
    const box = bounds(mask, MODEL_EDGE, MODEL_EDGE);
    const alpha = canvas(MODEL_EDGE, MODEL_EDGE), ac = alpha.getContext('2d');
    const pixels = ac.createImageData(MODEL_EDGE, MODEL_EDGE);
    for (let i = 0; i < mask.length; i++) {
      pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
      // Keep the garment opaque; taper only the uncertain edge of the model mask.
      pixels.data[i * 4 + 3] = Math.max(0, Math.min(255, (mask[i] - 20) * 255 / 210));
    }
    ac.putImageData(pixels, 0, 0);
    const foreground = canvas(sw, sh), fc = foreground.getContext('2d');
    fc.drawImage(image, 0, 0); fc.globalCompositeOperation = 'destination-in'; fc.drawImage(alpha, 0, 0, sw, sh);
    const result = canvas(edge, edge), ctx = result.getContext('2d');
    ctx.drawImage(background, 0, 0, edge, edge);
    const f = fit(box, sw, sh, size, edge);
    ctx.save(); ctx.shadowColor = 'rgba(20,20,20,0.13)'; ctx.shadowBlur = edge * 0.004; ctx.shadowOffsetY = edge * 0.002;
    ctx.drawImage(foreground, f.x, f.y, f.w, f.h, f.dx, f.dy, f.dw, f.dh); ctx.restore();
    return result;
  }
  function cutout(image, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(`background-worker.js?v=${root.MercariPublicConfig?.version?.slice(1) || '20261007f'}`, scriptRoot).href);
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(new DOMException('操作をキャンセルしました', 'AbortError'));
      const timer = setTimeout(() => finish(Error('切り抜きが時間内に終わりませんでした。もう一度お試しください')), 120000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      worker.onerror = () => finish(Error('切り抜き機能を準備できませんでした。通信と空き容量を確認してください'));
      worker.onmessage = event => {
        if (event.data.progress) { onProgress?.(event.data.progress); return; }
        if (event.data.error) { finish(Error(event.data.error)); return; }
        try { finish(null, normalizedMask(new Float32Array(event.data.mask))); } catch (error) { finish(error); }
      };
      const sample = canvas(MODEL_EDGE, MODEL_EDGE); sample.getContext('2d').drawImage(image, 0, 0, MODEL_EDGE, MODEL_EDGE);
      const pixels = sample.getContext('2d').getImageData(0, 0, MODEL_EDGE, MODEL_EDGE).data;
      worker.postMessage({ pixels: pixels.buffer }, [pixels.buffer]);
    });
  }
  function paintMask(mask, x, y, radius, value) {
    if (mask.length !== MODEL_EDGE * MODEL_EDGE || ![x, y, radius].every(Number.isFinite)) return;
    for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(319, Math.ceil(y + radius)); py++) {
      for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(319, Math.ceil(x + radius)); px++) {
        if ((px - x) ** 2 + (py - y) ** 2 <= radius ** 2) mask[py * 320 + px] = value === 255 ? 255 : 0;
      }
    }
  }
  const api = { normalizedMask, bounds, fit, render, cutout, paintMask };
  root.MercariBackgroundTemplate = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);

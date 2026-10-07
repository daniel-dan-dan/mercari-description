'use strict';
const assert = require('node:assert/strict');
const { restoreConnectedFabric } = require('../background-template.js');
const n = 320 * 320;
function fixture(background = [250, 240, 230]) {
  const mask = new Uint8ClampedArray(n), pixels = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) pixels.set([...background, 255], i * 4);
  function rect(x1, y1, x2, y2, rgb, alpha) {
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
      const i = y * 320 + x; pixels.set([...rgb, 255], i * 4); mask[i] = alpha;
    }
  }
  rect(90, 100, 230, 280, [110, 105, 100], 255);
  rect(125, 30, 195, 60, [110, 105, 100], 255);
  // Model misses the whole fur band, splitting the cap from the jacket.
  rect(105, 60, 215, 102, [197, 167, 154], 2);
  return { mask, pixels, rect };
}
let f = fixture();
f.rect(20, 20, 27, 27, [197, 167, 154], 0);
const beforeMask = f.mask.slice(), beforePixels = f.pixels.slice();
let fixed = restoreConnectedFabric(f.mask, f.pixels);
for (const [x, y] of [[150, 60], [150, 80], [110, 85], [180, 98]]) assert.equal(fixed[y * 320 + x], 255, 'connected missing fabric restored');
assert.equal(fixed[20 * 320 + 20], 0, 'disconnected similarly coloured background stays removed');
assert.equal(fixed[80 * 320 + 60], 0, 'bright carpet stays removed');
for (let i = 0; i < n; i++) assert.ok(fixed[i] >= f.mask[i], 'never removes previously retained garment pixels');
assert.deepEqual(f.mask, beforeMask, 'input mask retained');
assert.deepEqual(f.pixels, beforePixels, 'original garment colours and pattern untouched');
for (const bg of [[70, 70, 70], [110, 130, 180], [250, 180, 140]]) {
  f = fixture(bg); assert.deepEqual(restoreConnectedFabric(f.mask, f.pixels), f.mask, 'uncertain/non-white background is not guessed');
}
f = fixture(); f.rect(105, 60, 215, 102, [249, 240, 232], 2);
assert.equal(restoreConnectedFabric(f.mask, f.pixels)[80 * 320 + 150], 2, 'fabric indistinguishable from background is not guessed');
f = fixture(); f.rect(12, 12, 308, 308, [150, 150, 150], 0); f.rect(130, 140, 190, 190, [90, 90, 90], 255);
assert.deepEqual(restoreConnectedFabric(f.mask, f.pixels), f.mask, 'broad shadow-like growth rejected');
assert.throws(() => restoreConnectedFabric(new Uint8Array(2), new Uint8Array(8)));
assert.deepEqual(restoreConnectedFabric(new Uint8ClampedArray(n), new Uint8ClampedArray(n * 4)), new Uint8ClampedArray(n));
console.log('PASS connected fabric recovery: hood bridge, background separation, unchanged originals, ambiguous backgrounds, pale fabric and excessive-growth guards');

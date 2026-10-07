'use strict';
const assert = require('node:assert/strict');
const engine = require('../photo-adjust.js');
function image(shift = 0, colour = 0, flat = false, alpha = 255) {
  const width = 128, height = 128, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = flat ? 128 : (x < 20 || x > 107 || y < 20 || y > 115 ? 235 : 90 + (x + y) % 70);
    const v = Math.max(0, Math.min(255, value + shift));
    data.set([v + colour, v, v - colour, alpha], (y * width + x) * 4);
  }
  return { width, height, data };
}
const source = image(); const before = source.data.slice();
const profile = engine.exposureProfile(source);
assert.ok(profile.spread >= 12);
assert.deepEqual(source.data, before, 'comparing exposure never edits pixels');
assert.equal(engine.similarExposure(profile, engine.exposureProfile(image())), true);
assert.equal(engine.similarExposure(profile, engine.exposureProfile(image(7))), true, 'nearby exposure can form a review group');
assert.equal(engine.similarExposure(profile, engine.exposureProfile(image(45))), false, 'different lighting is held for individual review');
assert.equal(engine.similarExposure(profile, engine.exposureProfile(image(0, 25))), false, 'substantially different colour is not grouped');
assert.equal(engine.similarExposure(profile, engine.exposureProfile(image(0, 0, true))), false, 'flat/clipped photos lack evidence');
assert.equal(engine.exposureProfile(image(0, 0, false, 0)), null);
assert.equal(engine.similarExposure(profile, null), false);
assert.equal(engine.similarExposure(null, profile), false);
assert.equal(engine.similarExposure(profile, { ...profile, aspect: 2 }), false, 'very different framing is separate');
const tiny = { width: 8, height: 8, data: new Uint8ClampedArray(256).fill(255) };
assert.equal(engine.exposureProfile(tiny), null);
assert.throws(() => engine.exposureProfile(null), /RGBA ImageData/);
console.log('PASS similar photo exposure: bounded read-only evidence, nearby exposure, distinct colour/framing, transparent and insufficient sources');

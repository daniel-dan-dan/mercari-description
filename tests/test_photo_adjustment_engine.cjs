'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../photo-adjust.js');

function fixture(width, height, colourAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const colour = colourAt(pixel, pixel % width, Math.floor(pixel / width));
    data.set(colour.length === 3 ? [...colour, 255] : colour, pixel * 4);
  }
  return { width, height, data };
}
const grey = value => [value, value, value];
const neutral = { brightness: 0, contrast: 0, shadows: 0, highlights: 0, temp: 0 };

assert.deepEqual(engine.normalizeAdjust({ brightness: '100', contrast: -80, temp: 50 }), { ...neutral, brightness: 30, contrast: -20 });
for (const value of [undefined, null, NaN, Infinity, -Infinity, 'invalid', {}, Symbol('invalid')]) {
  assert.deepEqual(engine.normalizeAdjust({ brightness: value, contrast: value, shadows: value, highlights: value }), neutral);
}
assert.deepEqual(engine.normalizeAdjust(null), neutral);
assert.deepEqual(engine.normalizeAdjust({ brightness: -3.5, contrast: '7.5' }), { ...neutral, brightness: -3.5, contrast: 7.5 });

const dark = fixture(64, 64, p => grey(30 + p % 101));
const originalDark = dark.data.slice();
const automatic = engine.autoAdjust(dark);
assert.ok(automatic.brightness >= 2 && automatic.brightness <= 12, 'underexposed image receives a restrained lift');
assert.equal(automatic.contrast, 0, 'automatic correction preserves contrast setting');
assert.equal(automatic.temp, 0, 'automatic correction does not change temperature');
assert.deepEqual(dark.data, originalDark, 'exposure analysis never edits the photo');

const noChangeCases = {
  bright: fixture(64, 64, p => grey(120 + p % 100)),
  black: fixture(64, 64, () => grey(0)),
  white: fixture(64, 64, () => grey(255)),
  flat: fixture(64, 64, () => grey(70)),
  tiny: fixture(8, 8, p => grey(30 + p % 70)),
  narrow: fixture(8, 128, p => grey(30 + p % 70)),
  blackAndWhite: fixture(64, 64, p => grey(p % 2 ? 0 : 255)),
  blackGarmentWhiteBackground: fixture(64, 64, (p, x, y) => grey(x < 3 || y < 3 || x > 60 || y > 60 ? 240 : 12 + p % 35)),
  smallWhiteBackground: fixture(64, 64, p => grey(p % 20 === 0 ? 238 : 15 + p % 90)),
  wellExposedSaturatedColour: fixture(64, 64, p => [240, 15 + p % 50, 10]),
  fullyTransparent: fixture(64, 64, p => [...grey(30 + p % 100), 0]),
  mostlyTransparent: fixture(64, 64, p => [...grey(30 + p % 100), p < 200 ? 255 : 0]),
};
for (const [name, image] of Object.entries(noChangeCases)) {
  assert.deepEqual(engine.autoAdjust(image), neutral, `${name} is not automatically brightened`);
}

assert.equal(engine.applyToImageData(dark, automatic), dark, 'in-place API returns the original ImageData');
for (let i = 0; i < dark.data.length; i += 4) {
  assert.ok(dark.data[i] > originalDark[i], 'underexposed detail is raised');
  assert.ok(dark.data[i] - originalDark[i] <= 13, 'automatic lift remains modest');
  assert.equal(dark.data[i], dark.data[i + 1]);
  assert.equal(dark.data[i + 1], dark.data[i + 2]);
  assert.equal(dark.data[i + 3], 255);
}

const untouched = fixture(32, 32, p => [p % 255, 50, 200, p % 256]);
const untouchedBytes = untouched.data.slice();
engine.applyToImageData(untouched, neutral);
assert.deepEqual(untouched.data, untouchedBytes, 'zero correction is byte-for-byte unchanged');

// All control extremes keep order, black/white endpoints and the full byte range.
// Adjacent values may round together but darker dirt cannot become brighter than
// the surrounding surface. Wider real-world tonal details remain distinguishable.
for (const brightness of [-30, 0, 12, 30]) {
  for (const contrast of [-20, 0, 20]) {
    for (const shadows of [0, 12, 50]) {
      for (const highlights of [0, 12, 50]) {
    const gradient = fixture(256, 1, p => grey(p));
    engine.applyToImageData(gradient, { brightness, contrast, shadows, highlights });
    assert.equal(gradient.data[0], 0);
    assert.equal(gradient.data[255 * 4], 255);
    for (let p = 1; p < 256; p++) assert.ok(gradient.data[p * 4] >= gradient.data[(p - 1) * 4]);
    for (let p = 8; p <= 248; p += 8) assert.ok(gradient.data[p * 4] > gradient.data[(p - 8) * 4]);
      }
    }
  }
}

const dirt = fixture(2, 1, p => grey(p === 0 ? 65 : 80));
engine.applyToImageData(dirt, { brightness: 12 });
assert.ok(dirt.data[0] < dirt.data[4], 'dark blemish remains visible after automatic correction');
assert.ok(dirt.data[4] - dirt.data[0] >= 14, 'automatic exposure does not flatten the blemish');

for (const adjustment of [{ brightness: 30, contrast: 20 }, { brightness: -30, contrast: -20 }, { shadows: 50 }, { highlights: 50 }, { brightness: 30, contrast: 20, shadows: 50, highlights: 50 }, automatic]) {
  const colours = fixture(5, 1, p => [
    [120, 60, 30, 255], [50, 100, 150, 128], [250, 245, 240, 255],
    [255, 70, 20, 255], [40, 80, 160, 0],
  ][p]);
  const before = colours.data.slice();
  engine.applyToImageData(colours, adjustment);
  for (let i = 0; i < colours.data.length; i += 4) {
    assert.equal(colours.data[i + 3], before[i + 3], 'alpha is preserved');
    if (before[i + 3] === 0) {
      assert.deepEqual(colours.data.slice(i, i + 4), before.slice(i, i + 4));
      continue;
    }
    for (const channel of [1, 2]) {
      const expected = colours.data[i] * before[i + channel] / before[i];
      assert.ok(Math.abs(colours.data[i + channel] - expected) <= 2.1, 'RGB ratios stay within byte-rounding error');
    }
  }
  assert.ok(colours.data[8] < 255, 'near-white highlight does not clip');
}

const contrastPhoto = fixture(3, 1, p => grey([48, 128, 208][p]));
engine.applyToImageData(contrastPhoto, { contrast: 20 });
assert.ok(contrastPhoto.data[0] < 48 && contrastPhoto.data[8] > 208, 'manual contrast affects both sides of midgrey');

// Shadow/highlight-only controls are effective while preserving known endpoints.
assert.deepEqual(engine.normalizeAdjust({ shadows: '80', highlights: -10 }), { ...neutral, shadows: 50 });
const toneGradient = fixture(256, 1, p => grey(p));
const lifted = fixture(256, 1, p => grey(p));
const restrained = fixture(256, 1, p => grey(p));
engine.applyToImageData(lifted, { shadows: 50 });
engine.applyToImageData(restrained, { highlights: 50 });
assert.ok(lifted.data[32 * 4] > 32, 'shadow detail receives a lift');
assert.ok(lifted.data[32 * 4] - 32 > lifted.data[224 * 4] - 224, 'shadow lift is concentrated in dark tones');
assert.ok(restrained.data[232 * 4] < 232, 'near-white detail is lowered');
assert.ok(232 - restrained.data[232 * 4] > 32 - restrained.data[32 * 4], 'highlight suppression is concentrated in light tones');
assert.ok(restrained.data[248 * 4] - restrained.data[232 * 4] > 16, 'near-white differences become more visible');
assert.equal(lifted.data[0], 0, 'black pixels cannot gain invented detail');
assert.equal(restrained.data[255 * 4], 255, 'clipped white pixels remain without invented detail');

const mixedExposure = fixture(100, 100, p => {
  const band = p % 100;
  return grey(band < 20 ? 15 + band : band < 80 ? 80 + band - 20 : 225 + band - 80);
});
const mixedBytes = mixedExposure.data.slice();
const mixedAuto = engine.autoAdjust(mixedExposure);
assert.ok(mixedAuto.shadows > 0 && mixedAuto.shadows <= 12, 'mixed scenes receive restrained shadow correction');
assert.ok(mixedAuto.highlights > 0 && mixedAuto.highlights <= 12, 'mixed scenes receive restrained highlight correction');
assert.equal(mixedAuto.brightness, 0, 'the whole mixed scene is not brightened');
assert.deepEqual(mixedExposure.data, mixedBytes, 'tone analysis is read-only');
engine.applyToImageData(mixedExposure, mixedAuto);
assert.ok(mixedExposure.data[5 * 4] > mixedBytes[5 * 4]);
assert.ok(mixedExposure.data[90 * 4] < mixedBytes[90 * 4]);
const highKeyWhiteGarment = fixture(64, 64, p => grey(218 + p % 38));
assert.deepEqual(engine.autoAdjust(highKeyWhiteGarment), neutral, 'a dominantly white garment is not automatically greyed');

// A confirmed black garment photographed pale on a bright rug must approach
// the requested reference without assigning that real-world colour to grey.
const paleBlackPuffer = fixture(160, 160, (p, x, y) => {
  if (x < 24 || x > 135 || y < 24 || y > 145) return [240, 235, 229];
  if (x > 115 && y < 60) return [238, 30, 38];
  return grey(p % 20 === 0 ? 96 : 124 + p % 15);
});
const pufferBytes = paleBlackPuffer.data.slice();
const blackAuto = engine.autoAdjust(paleBlackPuffer, 'black');
assert.deepEqual(blackAuto, { ...neutral, contrast: -20, highlights: 50 });
assert.equal(engine.autoAdjust(paleBlackPuffer).contrast, 0, 'unknown grey/black colour never triggers the black profile');
assert.deepEqual(engine.autoAdjust(paleBlackPuffer, 'untrusted'), engine.autoAdjust(paleBlackPuffer));
assert.deepEqual(paleBlackPuffer.data, pufferBytes, 'black analysis does not mutate the source');
engine.applyToImageData(paleBlackPuffer, blackAuto);
let sourceFabric = 0, correctedFabric = 0, fabricCount = 0;
for (let y = 60; y < 136; y++) for (let x = 48; x < 110; x++) {
  const i = (y * 160 + x) * 4;
  sourceFabric += pufferBytes[i]; correctedFabric += paleBlackPuffer.data[i]; fabricCount++;
}
assert.ok(correctedFabric / fabricCount > 95 && correctedFabric / fabricCount < sourceFabric / fabricCount - 12,
  'pale black fabric is restrained but not crushed to black');
const darkerBlack = fixture(160, 160, (p, x, y) => grey(x < 24 || x > 135 ? 240 : 78 + p % 18));
const darkerAuto = engine.autoAdjust(darkerBlack, 'black');
assert.ok(darkerAuto.highlights > 0 && darkerAuto.highlights < blackAuto.highlights, 'already dark fabric receives less correction');
assert.equal(darkerAuto.shadows, 0, 'black profile never whitens dark seams');
for (const image of [noChangeCases.blackGarmentWhiteBackground, highKeyWhiteGarment,
  noChangeCases.wellExposedSaturatedColour, noChangeCases.tiny, noChangeCases.fullyTransparent]) {
  assert.deepEqual(engine.autoAdjust(image, 'black'), neutral, 'unsupported or already deep black sources stay unchanged');
}
const stitchedFabric = fixture(3, 1, p => grey([96, 128, 148][p]));
engine.applyToImageData(stitchedFabric, blackAuto);
assert.ok(stitchedFabric.data[0] < stitchedFabric.data[4] && stitchedFabric.data[4] < stitchedFabric.data[8],
  'seams and fabric reflections remain ordered and distinguishable');

assert.throws(() => engine.autoAdjust(null), /RGBA ImageData/);
assert.throws(() => engine.applyToImageData({ width: 4, height: 4, data: new Uint8ClampedArray(8) }, automatic), /RGBA ImageData/);

const browser = vm.createContext({ Uint8ClampedArray, Uint32Array, ArrayBuffer });
vm.runInContext(fs.readFileSync(require.resolve('../photo-adjust.js'), 'utf8'), browser);
assert.equal(typeof browser.MercariPhotoAdjust.applyToImageData, 'function', 'standalone browser global is available');
assert.equal(browser.MercariPhotoAdjust.autoAdjust(fixture(64, 64, p => grey(30 + p % 101))).brightness, automatic.brightness);
console.log('PASS photo tone engine: conservative exposure decisions, shadow/highlight recovery limits, bounded controls, RGB/alpha preservation, monotonic detail and browser export');

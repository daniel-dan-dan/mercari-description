'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../photo-text.js');

function fakeCanvas(width, height, { oldMetrics = false } = {}) {
  const calls = [], stack = [];
  const context = {
    font: '10px serif', textAlign: 'right', textBaseline: 'top',
    globalAlpha: .3, globalCompositeOperation: 'multiply', filter: 'blur(10px)',
    direction: 'rtl',
    save() { stack.push(Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function'))); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) {
      const size = Number(/([.\d]+)px/.exec(this.font)[1]);
      const width = Array.from(text).reduce((sum, character) => sum + (/[^\u0000-\u007f]/.test(character) ? size : size * .6), 0);
      return oldMetrics ? { width } : { width, actualBoundingBoxLeft: size * .06,
        actualBoundingBoxRight: width + size * .14,
        actualBoundingBoxAscent: size * .83, actualBoundingBoxDescent: size * .23 };
    },
    createLinearGradient(x0, y0, x1, y1) {
      return { x0, y0, x1, y1, stops: [], addColorStop(offset, colour) { this.stops.push([offset, colour]); } };
    },
    strokeText(text, x, y) { calls.push({ kind: 'stroke', text, x, y, width: this.lineWidth, style: this.strokeStyle }); },
    fillText(text, x, y) { calls.push({ kind: 'fill', text, x, y, style: this.fillStyle }); },
  };
  return { width, height, calls, context, getContext(kind) { assert.equal(kind, '2d'); return context; } };
}

assert.deepEqual(engine.normalizeOverlay(null), { version: 1, text: '', style: 'white-black',
  fontSize: .075, x: .04, y: .04, stroke: .006, italic: true });
const normalized = engine.normalizeOverlay({ text: '  A\r\nB\tC\u0000\u202e  ', style: '__proto__',
  fontSize: Infinity, x: -2, y: '2', stroke: NaN, italic: 'false', version: 100 });
assert.deepEqual(normalized, { version: 1, text: 'A\nB C', style: 'white-black',
  fontSize: .075, x: 0, y: 1, stroke: .006, italic: true });
assert.equal(engine.normalizeOverlay({ style: 'red-white', italic: false, stroke: 0 }).italic, false);
assert.equal(engine.normalizeOverlay({ style: 'red-white', stroke: 0 }).stroke, 0);
assert.equal(engine.normalizeOverlay({ text: '1\n2\n3\n4\n5\n6' }).text, '1\n2\n3\n4 5 6');
assert.equal(Array.from(engine.normalizeOverlay({ text: 'あ'.repeat(101) }).text).length, 100);
assert.equal(engine.normalizeOverlay({ text: '👩‍👩‍👧‍👦'.repeat(101) }).text.endsWith('👩‍👩‍👧‍👦'), true);
assert.equal(engine.normalizeOverlay({ fontSize: '', x: null }).fontSize, .075);
assert.equal(engine.normalizeOverlay({ fontSize: '0.05', stroke: '-2' }).fontSize, .05);
assert.equal(engine.normalizeOverlay({ fontSize: 0, stroke: '-2' }).fontSize, .025);
assert.equal(engine.normalizeOverlay({ fontSize: 1 }).fontSize, .18);

assert.equal(engine.draw({ width: 0, height: 100 }, { text: 'x' }), null);
assert.equal(engine.layout({ width: Infinity, height: 100 }, { text: 'x' }), null);
assert.throws(() => engine.layout({ width: 100, height: 100 }, { text: 'x' }), /2D canvas/);
const empty = fakeCanvas(1080, 1080);
assert.equal(engine.draw(empty, { text: '\n \t' }), null);
assert.deepEqual(empty.calls, []);

for (const [width, height] of [[1080, 1080], [1080, 320], [320, 1080], [1, 1], [10000, 2], [2, 10000]]) {
  for (const text of ['De’Longhi\nEC885J-M', '長い商品名の日本語テキスト'.repeat(7), 'A'.repeat(100), '上下\n位置\n確認\nテキスト']) {
    for (const oldMetrics of [false, true]) {
      const canvas = fakeCanvas(width, height, { oldMetrics });
      const overlay = { text, x: 1, y: 1, fontSize: .18, stroke: .025 };
      const bounds = engine.layout(canvas, overlay);
      assert.ok(bounds, `${width}x${height} ${oldMetrics}`);
      assert.ok(bounds.x >= 0 && bounds.y >= 0);
      assert.ok(bounds.x + bounds.width <= width + 1e-6);
      assert.ok(bounds.y + bounds.height <= height + 1e-6);
      assert.ok(bounds.lines.length <= engine.MAX_LINES);
      assert.ok(bounds.fontSize > 0 && Number.isFinite(bounds.fontSize));
      assert.deepEqual(engine.draw(canvas, overlay), bounds);
      assert.equal(canvas.context.font, '10px serif');
      assert.equal(canvas.context.globalAlpha, .3);
      assert.equal(canvas.context.filter, 'blur(10px)');
    }
  }
}

const outlined = fakeCanvas(1080, 1080);
const request = { text: '一行目\n二行目', style: 'white-black' };
const before = JSON.stringify(request);
engine.draw(outlined, request);
assert.equal(JSON.stringify(request), before);
assert.deepEqual(outlined.calls.map(call => call.kind), ['stroke', 'stroke', 'fill', 'fill']);
assert.equal(outlined.calls[0].style, '#161616');
assert.equal(outlined.calls.at(-1).style, '#ffffff');
assert.ok(outlined.calls[0].width > 0);

for (const style of Object.keys(engine.STYLES)) {
  const canvas = fakeCanvas(1080, 1080);
  engine.draw(canvas, { text: 'Text', style, stroke: 0 });
  assert.deepEqual(canvas.calls.map(call => call.kind), ['fill']);
  assert.equal(canvas.calls[0].style, engine.STYLES[style].fill);
}

// Gold must keep white interiors, stable per-line sheen, and fitting bounds at every output size.
assert.equal(engine.normalizeOverlay({ style: 'white-gold' }).style, 'white-gold');
for (const edge of [180, 640, 1024, 1080]) {
  const gold = fakeCanvas(edge, edge);
  const bounds = engine.draw(gold, { text: 'SAMPLE\nMODEL 123', style: 'white-gold' });
  const strokes = gold.calls.filter(call => call.kind === 'stroke');
  const fills = gold.calls.filter(call => call.kind === 'fill');
  assert.equal(strokes.length, 4);
  assert.equal(fills.length, 2);
  assert.ok(fills.every(call => call.style === '#ffffff'));
  assert.deepEqual(strokes[1].style.stops, strokes[3].style.stops);
  assert.notEqual(strokes[1].style.y0, strokes[3].style.y0);
  assert.ok(strokes[1].style.y1 > strokes[1].style.y0);
  assert.ok(bounds.x + bounds.width <= edge && bounds.y + bounds.height <= edge);
  assert.ok(gold.calls.slice(-2).every(call => call.kind === 'fill'));
}
const fallback = fakeCanvas(640, 640);
delete fallback.context.createLinearGradient;
engine.draw(fallback, { text: 'Text', style: 'white-gold' });
assert.equal(fallback.calls[0].style, engine.STYLES['white-gold'].stroke);

const browser = { Intl };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../photo-text.js'), 'utf8'), browser);
assert.equal(typeof browser.MercariPhotoText.draw, 'function');
assert.equal(browser.MercariPhotoText.normalizeOverlay({ text: 'browser' }).text, 'browser');
console.log('photo text engine: normalization, complete bounds, Unicode, strokes and context restoration passed');

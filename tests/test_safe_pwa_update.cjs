'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sw = fs.readFileSync('sw.js', 'utf8');
assert.doesNotMatch(sw, /self\.skipWaiting\s*\(/, 'New workers must wait while existing product inputs are open');
const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
let reloads = 0, updates = 0, inserted = 0;
let updateFound, stateChange;
const worker = { state: 'installing', addEventListener: (name, fn) => { assert.equal(name, 'statechange'); stateChange = fn; } };
const registration = { waiting: {}, installing: worker,
  addEventListener: (name, fn) => { assert.equal(name, 'updatefound'); updateFound = fn; },
  update: async () => { updates += 1; } };
let note;
const ctx = { console, encodeURIComponent,
  MercariPublicConfig: { version: 'v20260907a' },
  location: { reload: () => { reloads += 1; } },
  document: {
    getElementById: id => id === 'app-update-note' ? note : id === 'app' ? { prepend: element => { inserted += 1; note = element; } } : null,
    createElement: () => ({ setAttribute: () => {} }),
  },
  navigator: { serviceWorker: { controller: {}, register: async () => registration } },
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx); vm.runInContext(bootstrap, ctx);
setImmediate(() => {
  assert.equal(updates, 1); assert.equal(inserted, 1); assert.equal(reloads, 0);
  assert.match(note.textContent, /入力を終えたら/);
  updateFound(); worker.state = 'installed'; stateChange();
  assert.equal(inserted, 1); assert.equal(reloads, 0);
  assert.doesNotMatch(bootstrap, /location\.reload\s*\(/);
  console.log('PASS PWA update: worker waits, one update notice, no forced reload of active input');
});

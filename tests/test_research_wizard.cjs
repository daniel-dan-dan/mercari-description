#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  URL,
  globalThis: null,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
context.globalThis = context;
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const source = [
  fs.readFileSync('catalog-data.js', 'utf8'),
  fs.readFileSync('app.js', 'utf8'),
].join('\n');
vm.runInContext(source, context, { filename: 'app.js' });

const hooks = context.MercariAppTestHooks;
const authStorage = new Map([['daniel_api_auth_token', 'legacy-route-token']]);
context.localStorage.getItem = key => authStorage.get(key) || null;
context.localStorage.setItem = (key, value) => authStorage.set(key, value);
assert.equal(context.getApiAuthToken(), 'legacy-route-token');
assert.equal(authStorage.get('mercari_api_auth_token'), 'legacy-route-token');
authStorage.set('mercari_api_auth_token', 'dedicated-mercari-token');
assert.equal(context.getApiAuthToken(), 'dedicated-mercari-token');

assert.equal(hooks.normalizeResearchWizardStep(1), 1);
assert.equal(hooks.normalizeResearchWizardStep('2'), 2);
assert.equal(hooks.normalizeResearchWizardStep(3), 3);
assert.equal(hooks.normalizeResearchWizardStep(0), 1);
assert.equal(hooks.normalizeResearchWizardStep(4), 1);
assert.equal(hooks.normalizeResearchWizardStep('invalid'), 1);

assert.equal(hooks.isResearchPriceRangeValid(5000, 20000), true);
assert.equal(hooks.isResearchPriceRangeValid(20000, 5000), false);
assert.equal(hooks.isResearchPriceRangeValid(0, 5000), true);
assert.equal(hooks.isResearchPriceRangeValid(5000, 0), true);

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    contains: value => values.has(value),
    toggle: (value, force) => {
      if (force) values.add(value);
      else values.delete(value);
    },
  };
}

const panels = [1, 2, 3].map(step => ({
  dataset: { researchStepPanel: String(step) },
  hidden: step !== 1,
  classList: makeClassList(step === 1 ? ['active'] : []),
}));
const buttons = [1, 2, 3].map(step => ({
  dataset: { researchStep: String(step) },
  classList: makeClassList(step === 1 ? ['active'] : []),
  attributes: { 'aria-selected': String(step === 1) },
  setAttribute(name, value) {
    this.attributes[name] = value;
  },
}));
const heading = { textContent: '' };
const count = { textContent: '' };
context.document = {
  getElementById(id) {
    return {
      'research-wizard-heading': heading,
      'research-wizard-count': count,
    }[id] || null;
  },
  querySelectorAll(selector) {
    if (selector === '[data-research-step-panel]') return panels;
    if (selector === '#research-wizard-progress [data-research-step]') return buttons;
    return [];
  },
};

hooks.setResearchWizardStep(2, { scroll: false });
assert.equal(panels[0].hidden, true);
assert.equal(panels[1].hidden, false);
assert.equal(panels[2].hidden, true);
assert.equal(buttons[1].classList.contains('active'), true);
assert.equal(buttons[1].attributes['aria-selected'], 'true');
assert.equal(heading.textContent, '絞り込み');
assert.equal(count.textContent, '2/3');

const indexHtml = fs.readFileSync('index.html', 'utf8');
assert.match(indexHtml, /data-research-step-panel="1"/);
assert.match(indexHtml, /data-research-step-panel="2" hidden/);
assert.match(indexHtml, /data-research-step-panel="3" hidden/);
assert.match(indexHtml, />次へ：絞り込み</);
assert.match(indexHtml, />次へ：確認</);
assert.match(indexHtml, />調査依頼を保存</);
assert.match(indexHtml, />保存済みの依頼を見る</);
assert.match(indexHtml, /id="research-saved-section"/);
assert.match(indexHtml, /styles\.css\?v=20260725g/);
assert.match(indexHtml, /app\.js\?v=20260725g/);
assert.match(indexHtml, /v20260725g \/ 最新商品を即時取得/);

const serviceWorker = fs.readFileSync('sw.js', 'utf8');
assert.match(serviceWorker, /mercari-description-v20260725g/);

const pairHtml = fs.readFileSync('pair.html', 'utf8');
assert.match(pairHtml, /mercari_api_auth_token/);
assert.doesNotMatch(pairHtml, /const key = 'daniel_api_auth_token'/);

[
  'research-brand',
  'research-category',
  'research-keyword',
  'research-size',
  'research-condition',
  'research-gender',
  'research-sale-status',
  'research-min-price',
  'research-max-price',
  'research-sample-size',
  'research-sort',
  'research-period-months',
  'research-excludes',
  'research-note',
  'research-title',
  'research-save-btn',
  'research-copy-btn',
].forEach(id => {
  const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
  assert.equal(matches.length, 1, `${id} should exist exactly once`);
});

console.log(JSON.stringify({
  ok: true,
  steps: [1, 2, 3],
  invalidStepFallback: 1,
  priceRangeGuard: true,
  preservedResearchFields: 17,
  authStorageMigrated: true,
}));

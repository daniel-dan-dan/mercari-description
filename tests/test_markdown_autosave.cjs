#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const storage = new Map();
  const context = {
    console,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    CSS: { escape: value => String(value) },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    globalThis: null,
  };
  context.globalThis = context;
  context.__MERCARI_TEST__ = true;
  vm.createContext(context);

  const source = [
    fs.readFileSync('catalog-data.js', 'utf8'),
    fs.readFileSync('app.js', 'utf8'),
  ].join('\n');
  vm.runInContext(source, context, { filename: 'app.js' });

  const resultPromise = vm.runInContext(`
    (async () => {
      const posts = [];
      let failNext = false;
      getMercariServiceUrl = async () => 'https://mac-service.example';
      fetchWithTimeout = async (_url, options) => {
        const body = JSON.parse(options.body);
        posts.push(body);
        if (failNext) {
          failNext = false;
          return {
            status: 500,
            text: async () => JSON.stringify({ ok: false, error: 'test failure' }),
          };
        }
        return {
          status: 200,
          text: async () => JSON.stringify({ ok: true, settings: body.items }),
        };
      };

      markdownRows = [{
        itemId: 'm00000000101',
        title: '自動保存テスト商品',
        currentPrice: 2000,
        minPrice: 1000,
        autoEnabled: false,
      }];

      handleMarkdownFieldChange({
        type: 'change',
        target: {
          dataset: { markdownAuto: 'm00000000101' },
          checked: true,
        },
      });
      await waitForMarkdownSettingsWrites_();
      const firstPost = posts[0];
      const firstState = markdownAutoSaveStates.get('m00000000101').status;

      handleMarkdownFieldChange({
        type: 'change',
        target: {
          dataset: { markdownAuto: 'm00000000101' },
          checked: false,
        },
      });
      handleMarkdownFieldChange({
        type: 'change',
        target: {
          dataset: { markdownAuto: 'm00000000101' },
          checked: true,
        },
      });
      await waitForMarkdownSettingsWrites_();
      const rapidPosts = posts.slice(1, 3).map(body => body.items[0].autoEnabled);
      const rapidFinalState = markdownAutoSaveStates.get('m00000000101').status;

      const beforeMinInput = posts.length;
      handleMarkdownFieldChange({
        type: 'input',
        target: {
          dataset: { markdownMin: 'm00000000101' },
          value: '900',
        },
      });
      const postsAfterMinInput = posts.length;
      handleMarkdownFieldChange({
        type: 'change',
        target: {
          dataset: { markdownMin: 'm00000000101' },
          value: '900',
        },
      });
      await waitForMarkdownSettingsWrites_();
      const minPricePost = posts.at(-1);

      markdownRows = [
        {
          itemId: 'm00000000101',
          currentPrice: 2000,
          minPrice: 900,
          autoEnabled: true,
        },
        {
          itemId: 'm00000000102',
          currentPrice: 3000,
          minPrice: 1500,
          autoEnabled: true,
        },
      ];
      document.querySelector = selector => {
        if (selector.includes('m00000000101') && selector.includes('markdown-min')) {
          return { value: '900' };
        }
        if (selector.includes('m00000000101') && selector.includes('markdown-auto')) {
          return { checked: true };
        }
        return null;
      };
      const collected = collectMarkdownRowsFromDom();

      document.querySelector = () => null;
      failNext = true;
      markdownRows = [{
        itemId: 'm00000000101',
        title: '自動保存テスト商品',
        currentPrice: 2000,
        minPrice: 900,
        autoEnabled: false,
      }];
      await queueMarkdownRowAutoSave_('m00000000101');
      await waitForMarkdownSettingsWrites_();

      return {
        firstPost,
        firstState,
        rapidPosts,
        rapidFinalState,
        beforeMinInput,
        postsAfterMinInput,
        minPricePost,
        hiddenRowStillEnabled: collected[1].autoEnabled,
        failureState: markdownAutoSaveStates.get('m00000000101').status,
      };
    })()
  `, context);
  const result = await resultPromise;

  assert.equal(result.firstPost.items.length, 1);
  assert.equal(result.firstPost.items[0].itemId, 'm00000000101');
  assert.equal(result.firstPost.items[0].autoEnabled, true);
  assert.equal(result.firstState, 'saved');
  assert.deepEqual([...result.rapidPosts], [false, true]);
  assert.equal(result.rapidFinalState, 'saved');
  assert.equal(result.postsAfterMinInput, result.beforeMinInput);
  assert.equal(result.minPricePost.items.length, 1);
  assert.equal(result.minPricePost.items[0].minPrice, 900);
  assert.equal(result.hiddenRowStillEnabled, true);
  assert.equal(result.failureState, 'error');

  const appJs = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');
  assert.match(appJs, /if \(autoItemId && event\.type !== 'change'\) return;/);
  assert.match(appJs, /queueMarkdownRowAutoSave_\(itemId\)/);
  assert.match(appJs, /markdownSettingsWriteTail = task\.catch/);
  assert.doesNotMatch(
    styles,
    /\.markdown-card\.enabled \.markdown-card-note\s*\{\s*display:\s*none/,
  );
  assert.match(
    styles,
    /\.markdown-card\.enabled \.markdown-card-note > span:first-child\s*\{\s*display:\s*none/,
  );

  console.log(JSON.stringify({
    ok: true,
    oneItemWrites: true,
    rapidToggleOrder: result.rapidPosts,
    minPriceSavesOnCommit: true,
    filteredRowsPreserved: true,
    visibleStates: ['保存中…', '保存済み', '保存失敗'],
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

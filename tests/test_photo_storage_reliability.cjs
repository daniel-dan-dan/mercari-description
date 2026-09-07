'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('catalog-data.js', 'utf8') + '\n' + fs.readFileSync(process.env.MERCARI_STORAGE_TEST_SOURCE || 'app.js', 'utf8');
const fixtureError = name => Object.assign(new Error(name), { name });
function harness() {
  const values = new Map(), connections = [];
  const control = { failure: '', connections, values };
  function open() {
    const db = { closed: false, close() { this.closed = true; }, transaction(names) {
      if (control.failure === 'create') { control.failure = ''; throw fixtureError('InvalidStateError'); }
      const failure = control.failure; control.failure = '';
      names = Array.isArray(names) ? names : [names];
      names.forEach(name => { if (!values.has(name)) values.set(name, new Map()); });
      const draft = new Map(names.map(name => [name, structuredClone(values.get(name))]));
      const queue = []; let aborted = false;
      const tx = { error: null, abort() { aborted = true; } };
      const request = operation => {
        const req = {};
        queue.push(() => { req.result = operation(); req.onsuccess?.({ target: req }); }); return req;
      };
      tx.objectStore = name => ({
        get: id => request(() => structuredClone(draft.get(name).get(id))),
        getAll: () => request(() => [...draft.get(name).values()].map(value => structuredClone(value))),
        put(value) {
          const copy = structuredClone(value);
          if (failure === 'summary' && name === control.summaryName) throw fixtureError('QuotaExceededError');
          return request(() => draft.get(name).set(copy.id, copy));
        },
        delete: id => request(() => draft.get(name).delete(id)),
      });
      setImmediate(() => {
        try {
          if (failure === 'abort') aborted = true;
          while (queue.length && !aborted) queue.shift()();
          if (failure === 'readAbort') aborted = true;
        } catch (error) {
          aborted = true; tx.error = error; tx.onerror?.({ target: { error } });
        }
        setImmediate(() => {
          if (aborted) tx.onabort?.({ target: tx });
          else { for (const [name, data] of draft) values.set(name, data); tx.oncomplete?.({ target: tx }); }
        });
      });
      return tx;
    } };
    connections.push(db); return db;
  }
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout, crypto: webcrypto,
    __MERCARI_TEST__: true, __fixtureOpen: open,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  });
  context.window = context; context.globalThis = context;
  vm.runInContext(source + '\nopenDb = async () => __fixtureOpen();', context);
  control.summaryName = vm.runInContext('DB_TEMPORARY_DRAFT_SUMMARY_STORE', context);
  return { context, control };
}
const record = (id = 'fixture') => ({ id, createdAt: Date.now(), updatedAt: Date.now(), status: 'saved',
  snapshot: { photos: [{ base64: 'Zml4dHVyZQ==', mediaType: 'image/jpeg' }], measurements: { shoulder: '40' }, category: 'tops' } });

(async () => {
  const { context: app, control } = harness();
  // Every storage entry point must release a DB if transaction creation fails.
  const methods = [
    ['saveSession', [{}]], ['loadSession', []], ['clearSessionDb', []],
    ['putTemporaryDraft_', [record()]], ['claimTemporaryDraftGeneration_', ['fixture', {}]],
    ['touchTemporaryDraftGeneration_', ['fixture', 'token']], ['finalizeTemporaryDraftGeneration_', ['fixture', 'token', {}]],
    ['getTemporaryDraft_', ['fixture']], ['listTemporaryDrafts_', []], ['pruneExpiredTemporaryDrafts_', []],
    ['deleteTemporaryDraft_', ['fixture']], ['recoverInterruptedTemporaryDraft_', ['fixture', Date.now()]],
  ];
  for (const [name, args] of methods) {
    control.failure = 'create';
    await assert.rejects(app[name](...args), { name: 'InvalidStateError' });
    assert.equal(control.connections.at(-1).closed, true, `${name} releases failed DB connection`);
  }
  await app.saveSession({ title: 'original', photos: ['fixture photo'] });
  await assert.rejects(app.saveSession({ title: 'bad', invalid: () => {} }), { name: 'DataCloneError' });
  assert.equal(control.connections.at(-1).closed, true);
  assert.equal((await app.loadSession()).title, 'original');
  control.failure = 'abort';
  await assert.rejects(app.saveSession({ title: 'not committed' }));
  assert.equal((await app.loadSession()).title, 'original');

  const original = record();
  assert.equal((await app.putTemporaryDraft_(original)).saved, true);
  for (const [name, args] of [['getTemporaryDraft_', ['fixture']], ['listTemporaryDrafts_', []]]) {
    control.failure = 'readAbort';
    await assert.rejects(app[name](...args), undefined, `${name} cannot resolve before abort`);
    assert.equal(control.connections.at(-1).closed, true);
  }
  control.failure = 'summary';
  await assert.rejects(app.putTemporaryDraft_({ ...original, displayName: 'must roll back' }), { name: 'QuotaExceededError' });
  assert.equal((await app.getTemporaryDraft_('fixture')).displayName, undefined);
  assert.notEqual((await app.listTemporaryDrafts_())[0].displayName, 'must roll back');

  // Existing generation ownership and cross-store consistency stay intact.
  const claimed = await app.claimTemporaryDraftGeneration_('fixture', original.snapshot);
  assert.equal(claimed.claimed, true);
  assert.equal((await app.claimTemporaryDraftGeneration_('fixture', {})).claimed, false);
  assert.equal(await app.finalizeTemporaryDraftGeneration_('fixture', 'wrong', { status: 'ready' }), false);
  assert.equal(await app.finalizeTemporaryDraftGeneration_('fixture', claimed.token, { status: 'ready' }), true);
  assert.equal((await app.getTemporaryDraft_('fixture')).status, 'ready');
  assert.equal((await app.listTemporaryDrafts_())[0].status, 'ready');
  assert.equal(control.connections.every(db => db.closed), true);
  console.log('PASS photo storage: 12 creation-failure paths release DBs; abort, clone/quota rollback, read completion and generation ownership verified');
})().catch(error => { console.error(error); process.exitCode = 1; });

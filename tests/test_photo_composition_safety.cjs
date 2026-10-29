'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = ['catalog-data.js', 'app.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
const tick = () => new Promise(setImmediate);
const image = id => ({ id, naturalWidth: 1024, naturalHeight: 1024 });
function harness(count = 3) {
  const nodes = new Map(), errors = [], prompts = [], pending = [], saves = [], locks = [];
  let failDrawing = false;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.handlers = {}; this.dataset = {};
      this.value = ''; this.hidden = false; this.disabled = false; this.style = {}; this.isConnected = true;
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    set id(value) { this._id = value; nodes.set(value, this); }
    get id() { return this._id; }
    set innerHTML(value) {
      const disconnect = node => { node.isConnected = false; node.children.forEach(disconnect); };
      this.children.forEach(disconnect); this.children = []; this.html = value;
      if (value.includes('replace-base-chk')) {
        const input = new Element('input'); input.id = 'replace-base-chk'; input.checked = value.includes('checked'); this.appendChild(input);
      }
    }
    appendChild(node) { this.children.push(node); return node; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    querySelector() { return this.children[0] || null; }
    querySelectorAll() { return this.children; }
    getContext() {
      return new Proxy({}, { get(_, name) {
        if (name === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (name === 'drawImage') return () => { if (failDrawing) throw Error('canvas allocation failed'); };
        return () => {};
      } });
    }
    toDataURL() { return 'data:image/jpeg;base64,TkVX'; }
  }
  const get = id => { if (!nodes.has(id)) { const element = new Element(); element.id = id; } return nodes.get(id); };
  const ctx = { URL, setTimeout, clearTimeout, __MERCARI_TEST__: true, pending, saves, locks,
    console: { ...console, error: (...args) => errors.push(args) }, localStorage: { getItem: () => null },
    document: { getElementById: get, createElement: tag => new Element(tag), body: { style: {} } },
    confirm: message => (prompts.push(message), ctx.answer), alert: message => prompts.push(message), addEventListener() {}, answer: true };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const run = code => vm.runInContext(code, ctx);
  run(`uploadedImages = Array.from({length:${count}}, (_, index) => ({ id: 'p' + index, dataUrl: 'photo-' + index, originalBase64HQ: 'original-' + index, textOverlay: {text:'keep-'+index} }));
    setPhotoProcessingLock_ = value => locks.push(value);
    invalidateGeneratedResultAfterInputChange_ = () => {}; renderPreviews = () => {}; updateGenerateButton = () => {}; updateDraftChecklist = () => {};
    scheduleSave = () => saves.push(uploadedImages.slice()); createThumbnailBase64FromCanvas_ = () => 'VEhVTUI=';
    loadImage = async src => ({id:src,naturalWidth:1024,naturalHeight:1024});`);
  const photos = run('uploadedImages.slice()');
  const deferred = () => run('loadImage = src => new Promise((resolve,reject) => pending.push({src,resolve,reject}));');
  const setupCutout = (replace = true) => {
    ctx.openImageCompose();
    run(`composeState.step=4; composeState.sourceIdx=0; composeState.baseIdx=1;
      composeState.baseImg={naturalWidth:1024,naturalHeight:1024}; composeState.croppedCanvas={width:160,height:80}; composeState.replaceBase=${replace};`);
    ctx.renderComposeStep();
  };
  const setupGrid = async (mode = 2) => {
    ctx.openGridCompose(mode); run(`gridComposeState.selected=Array.from({length:${mode}},(_,i)=>i);`);
    ctx.renderGridPreviewStep(); await tick();
    return get('compose-actions').children.find(node => node.textContent === '➕ アプリに追加');
  };
  const unchanged = () => {
    const actual = run('uploadedImages'); assert.equal(actual.length, photos.length);
    photos.forEach((photo, index) => assert.equal(actual[index], photo)); assert.equal(saves.length, 0);
  };
  return { ctx, run, get, photos, pending, saves, locks, errors, prompts, setupCutout, setupGrid, deferred, unchanged,
    failDrawing: value => { failDrawing = value; } };
}
(async () => {
  let cases = 0;
  for (const failure of ['decode', 'canvas']) {
    const h = harness(30); h.setupCutout();
    if (failure === 'decode') h.run('loadImage=async()=>{throw Error("decode failed")};'); else h.failDrawing(true);
    assert.equal(await h.ctx.applyCompose(), false); h.unchanged();
    assert.match(h.get('compose-step-label').textContent, /元の写真は変更していません/);
    assert.equal(h.run('photoProcessingInProgress'), false); assert.deepEqual(h.locks, [true, false]); cases++;
  }
  for (const replace of [false, true]) {
    const h = harness(3); h.setupCutout(replace); assert.equal(await h.ctx.applyCompose(), true);
    const actual = h.run('uploadedImages'); assert.equal(actual.length, replace ? 3 : 4);
    assert.equal(actual[replace ? 0 : 1], h.photos[0]); assert.equal(actual[replace ? 2 : 3], h.photos[2]);
    assert.equal(actual.includes(h.photos[1]), !replace);
    if (replace) assert.equal(actual[1].dataUrl, 'data:image/jpeg;base64,TkVX');
    assert.equal(h.prompts.length, 0); assert.equal(h.saves.length, 1); cases++;
  }
  { const h = harness(30); h.setupCutout(false); assert.equal(await h.ctx.applyCompose(), false); h.unchanged();
    assert.match(h.get('compose-step-label').textContent, /差し替える/); cases++; }
  { const h = harness(30); h.setupCutout(true); assert.equal(await h.ctx.applyCompose(), true);
    assert.equal(h.run('uploadedImages.length'), 30); assert.equal(h.run('uploadedImages')[0], h.photos[0]);
    assert.equal(h.run('uploadedImages').includes(h.photos[1]), false); assert.equal(h.saves.length, 1); cases++; }
  for (const mode of [2, 4]) {
    const h = harness(30); const apply = await h.setupGrid(mode); h.run('loadImage=async()=>{throw Error("decode failed")};');
    await apply.handlers.click(); h.unchanged(); assert.equal(h.run('photoProcessingInProgress'), false); cases++;
  }
  for (const [mode, remove, count] of [[2,true,30], [4,true,30], [2,false,4]]) {
    const h = harness(count); h.ctx.answer = remove; const apply = await h.setupGrid(mode); await apply.handlers.click();
    const actual = h.run('uploadedImages'); assert.equal(actual.length, count + 1 - (remove ? mode : 0));
    h.photos.forEach((photo, index) => assert.equal(actual.includes(photo), !remove || index >= mode)); assert.equal(h.saves.length, 1); cases++;
  }
  { const h = harness(30); h.ctx.answer = false; const apply = await h.setupGrid(); await apply.handlers.click();
    h.unchanged(); assert.equal(h.locks.length, 0); cases++; }
  { const h = harness(3); h.setupCutout(); h.deferred(); const first = h.ctx.applyCompose();
    assert.equal(await h.ctx.applyCompose(), false); assert.equal(h.pending.length, 1);
    h.pending[0].resolve(image('composed')); assert.equal(await first, true); assert.equal(h.saves.length, 1);
    assert.equal(h.run('uploadedImages.length'), 3); cases++; }
  for (const change of ['cancel', 'product', 'reorder', 'replace-photo', 'operation']) {
    const h = harness(3); h.setupCutout(); h.deferred(); const applying = h.ctx.applyCompose();
    if (change === 'cancel') h.ctx.closeImageCompose();
    if (change === 'product') h.run('currentProductWorkflowId="new-product"');
    if (change === 'reorder') h.run('uploadedImages.reverse()');
    if (change === 'replace-photo') h.run('uploadedImages[2]={id:"new-photo"}');
    if (change === 'operation') h.run('photoProcessingOperationId++');
    const current = h.run('uploadedImages.slice()'); h.pending[0].resolve(image('composed'));
    assert.equal(await applying, false); const actual = h.run('uploadedImages');
    current.forEach((photo, index) => assert.equal(actual[index], photo)); assert.equal(actual.length, current.length);
    assert.equal(h.saves.length, 0); assert.equal(h.run('photoProcessingInProgress'), false); cases++;
  }
  for (const role of ['source', 'base']) {
    const h = harness(3); h.ctx.openImageCompose();
    if (role === 'base') { h.run('composeState.step=3;composeState.sourceIdx=2;composeState.croppedCanvas={width:160,height:80};'); h.ctx.renderComposeStep(); }
    h.deferred(); const grid = h.get('compose-body').children[0];
    const a = grid.children[0].handlers.click(), b = grid.children[1].handlers.click();
    h.pending[1].resolve(image('B')); await b; h.pending[0].resolve(image('A')); await a;
    assert.equal(h.run(`composeState.${role}Idx`), 1); assert.equal(h.run(`composeState.${role}Img.id`), 'B'); h.unchanged(); cases++;
  }
  for (const action of ['close-reopen', 'back', 'product', 'reorder']) {
    const h = harness(3); h.ctx.openImageCompose(); h.run('composeState.step=3;composeState.sourceIdx=2;'); h.ctx.renderComposeStep(); h.deferred();
    const picking = h.get('compose-body').children[0].children[0].handlers.click();
    if (action === 'close-reopen') { h.ctx.closeImageCompose(); h.ctx.openImageCompose(); }
    if (action === 'back') { h.run('composeState.step=1;'); h.ctx.renderComposeStep(); }
    if (action === 'product') h.run('currentProductWorkflowId="new-product"');
    if (action === 'reorder') h.run('uploadedImages.reverse()');
    const expectedStep = h.run('composeState.step'); h.pending[0].resolve(image('stale')); await picking;
    assert.equal(h.run('composeState.step'), expectedStep); assert.equal(h.run('composeState.baseImg'), null); cases++;
  }
  { const h = harness(3); h.ctx.openImageCompose(); h.run('loadImage=async()=>{throw Error("load failed")};');
    await h.get('compose-body').children[0].children[0].handlers.click(); assert.equal(h.run('composeState.step'), 1);
    assert.match(h.get('compose-step-label').textContent, /もう一度選んで/); h.unchanged(); cases++; }
  { const h = harness(4); h.ctx.openGridCompose(2); h.run('gridComposeState.selected=[0,1]'); h.deferred(); h.ctx.renderGridPreviewStep();
    const oldApply = h.get('compose-actions').children[2]; h.ctx.renderGridSelectStep(); h.pending[0].resolve(image('old')); await tick();
    assert.equal(oldApply.disabled, true); assert.equal(h.pending.length, 1); h.unchanged(); cases++; }
  { const h = harness(4); const apply = await h.setupGrid(); h.deferred(); const first = apply.handlers.click();
    await apply.handlers.click(); assert.equal(h.pending.length, 1); h.ctx.closeImageCompose(); h.pending[0].resolve(image('cancelled'));
    await first; h.unchanged(); cases++; }
  { const h = harness(3); h.ctx.MercariPublicConfig = { version: 'v-test-current' };
    h.ctx.openImageCompose(); assert.match(h.get('compose-title').html, /v-test-current/);
    h.ctx.closeImageCompose(); assert.match(h.get('compose-title').html, /v-test-current/);
    h.ctx.openGridCompose(2); assert.match(h.get('compose-title').html, /v-test-current/); cases++; }
  console.log(`PASS photo composition safety: ${cases} cases (atomic cutout/grid, replacement choice, errors, duplicate apply, cancel/product/order/late loads)`);
})().catch(error => { console.error(error); process.exitCode = 1; });

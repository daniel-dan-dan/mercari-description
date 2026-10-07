'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map(), errors = [], rendered = [];
const context = { console: { ...console, error: (...args) => errors.push(args) }, URL, setTimeout, clearTimeout,
  __MERCARI_TEST__: true, localStorage: { getItem: () => null },
  document: { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', checked: true, scrollIntoView() {} });
    return nodes.get(id);
  } },
  __render: () => rendered.push(true),
};
context.window = context; context.globalThis = context;
vm.createContext(context);
vm.runInContext(['catalog-data.js','photo-adjust.js','app.js'].map(f => fs.readFileSync(f,'utf8')).join('\n'),context);
vm.runInContext(`
  setPhotoProcessingLock_ = () => {}; setPhotoEditorControls_ = () => {};
  renderPhotoEditorTargets_ = () => __render();
  photoCanvas_ = image => image.canvas;
  loadImage = source => __load(source);
`, context);
function canvas(offset = 0) {
  const width = 64, height = 64, data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const value = 90 + p % 70 + offset; data.set([value,value,value,255],p*4);
  }
  return {width,height,getContext: () => ({getImageData: () => ({width,height,data})})};
}
function start() {
  errors.length = 0; rendered.length = 0;
  context.photos = ['a','b','c'].map(base64 => ({base64,mediaType:'image/jpeg',adjustSourceVersion:1,
    originalBase64HQ:base64,originalDataUrl:'data:image/jpeg;base64,'+base64,adjust:{brightness:0}}));
  context.referenceImage = {canvas:canvas()}; context.pending = [];
  context.__load = source => new Promise((resolve,reject) => context.pending.push({source,resolve,reject}));
  vm.runInContext(`
    uploadedImages = photos.slice(); activeTemporaryDraftId = 'product'; photoProcessingInProgress = false;
    photoEditorState = {photo: photos[0],photos: photos.slice(),scope:'current',selectedPhotos:new Set([photos[0]]),
      draftId:'product',image:referenceImage,busy:false,adjust:{brightness:28,warmth:-12}};
  `,context);
}
async function tick() {await Promise.resolve(); await Promise.resolve();}
(async()=>{
  start(); const success = context.suggestPhotoEditorTargets_();
  assert.equal(vm.runInContext('photoProcessingInProgress',context),true);
  assert.equal(context.pending.length,1);
  context.pending.shift().resolve({canvas:canvas(55)}); await tick();
  context.pending.shift().resolve({canvas:canvas(5)}); await success;
  assert.equal(vm.runInContext('photoEditorState.scope',context),'selected');
  assert.deepEqual([...vm.runInContext('Array.from(photoEditorState.selectedPhotos).map(p=>p.base64)',context)],['a','c']);
  assert.equal(rendered.length,1);
  assert.ok(vm.runInContext('uploadedImages.every((p,i)=>p===photos[i])',context),'proposal alone never modifies photos');
  assert.equal(vm.runInContext('photoEditorState.adjust.brightness',context),28);

  start(); const failure = context.suggestPhotoEditorTargets_();
  context.pending.shift().reject(new Error('decode failure')); await failure;
  assert.equal(rendered.length,0); assert.equal(errors.length,1);
  assert.equal(vm.runInContext('photoEditorState.scope',context),'current');
  assert.equal(vm.runInContext('photoEditorState.busy',context),false);
  assert.equal(vm.runInContext('photoProcessingInProgress',context),false);

  for (const change of ["activeTemporaryDraftId='other';",'uploadedImages.reverse();','photoProcessingOperationId++;','photoEditorState=null;']) {
    start(); const running = context.suggestPhotoEditorTargets_();
    vm.runInContext(change,context);
    context.pending.shift().resolve({canvas:canvas()}); await running;
    assert.equal(rendered.length,0,'stale reads cannot replace selection with a suggestion');
    assert.equal(context.pending.length,0,'stop before further reads');
    assert.equal(vm.runInContext('photoProcessingInProgress',context),false);
  }
  console.log('PASS photo proposal review: similar candidates, separate exposure, no changes before apply, decode failure and stale-owner guards');
})().catch(error=>{console.error(error);process.exitCode=1;});

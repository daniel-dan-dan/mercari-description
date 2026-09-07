'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const context = { console, URL, __MERCARI_TEST__: true,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { getElementById: id => nodes.get(id) || null, querySelectorAll: () => [] },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('catalog-data.js', 'utf8') + '\n' + fs.readFileSync('app.js', 'utf8'), context);
const h = context.MercariAppTestHooks;
assert.equal(h.getSizeProfileKey('unknown', 'outer', 'men'), 'outer');
assert.equal(h.getSizeProfileKey('unknown', 'outer', 'women'), 'womenOuter');
assert.equal(h.getSizeProfileKey('unknown', 'tops', 'men'), 'tops');
assert.equal(h.getSizeProfileKey('unknown', 'tops', 'women'), 'womenTops');
assert.equal(h.getSizeProfileKey('unknown', 'outer', 'other'), '');
assert.equal(h.getSizeProfileKey('unknown', 'legacyUpper', 'women'), '');
const coat = vm.runInContext('MERCARI_CATEGORY_OPTIONS.find(x => x.path[1] === "メンズ" && x.path.at(-1) === "チェスターコート").key', context);
assert.equal(h.getSizeProfileKey(coat, 'outer', 'men'), 'menCoat');
assert.equal(h.getSizeProfileKey(coat, 'tops', 'men'), 'tops');
assert.equal(h.getSizeProfileKey('women_shirt_blouse', 'outer', 'women'), 'womenOuter');
for (const key of ['tops','menShirt','menRelaxedTop','womenTops','outer','menTailoredOuter','menCoat','womenOuter']) {
  const p = h.SIZE_PROFILES[key];
  for (let i = 0; i < 7; i++) {
    assert.equal(h.estimateBySizeProfile(key, {chest:p.fields.chest.centers[i], shoulder:p.fields.shoulder.centers[i], length:98, sleeve:60}, false).index, i, `${key} center ${i}`);
  }
  const base = {chest:p.fields.chest.centers[2], shoulder:p.fields.shoulder.centers[2]};
  assert.equal(h.estimateBySizeProfile(key, {...base,length:50,sleeve:15},false).score,
    h.estimateBySizeProfile(key, {...base,length:140,sleeve:85},false).score);
  assert.equal(h.estimateBySizeProfile(key, {length:98}, false), null);
  assert.equal(h.estimateBySizeProfile(key, {chest:51}, false), null);
  assert.equal(h.estimateBySizeProfile(key, {chest:510,shoulder:38}, false), null);
  const raglan = h.estimateBySizeProfile(key, {...base,shoulder:70},true);
  assert.equal(raglan.index,2);
  assert.equal(raglan.referenceOnly,true);
}
const example={chest:51,shoulder:38,length:98};
assert.equal(h.estimateBySizeProfile('womenOuter',example,false).size,'M');
assert.equal(h.estimateBySizeProfile('womenTops',example,false).size,'L');
assert.equal(h.restoredMeasurementCategory_({category:'tops'}),'legacyUpper');
assert.equal(h.restoredMeasurementCategory_({category:'tops',measurementCategoryVersion:2}),'tops');
assert.equal(h.restoredMeasurementCategory_({category:'outer',measurementCategoryVersion:2}),'outer');
assert.equal(h.restoredMeasurementCategory_({category:'suit'}),'suit');
assert.equal(h.restoredMeasurementCategory_({category:'unexpected'}),'');
const fields=['shoulder','chest','sleeve','length','yuki'].map((key,i)=>{
  const n={id:`m-${key}`,value:['38','51','60.5','98','80'][i]}; nodes.set(n.id,n); return n;
});
nodes.set('category',{value:'outer'});
nodes.set('measurement-fields',{dataset:{category:'tops'},querySelectorAll:()=>fields});
nodes.set('raglan-toggle',{checked:true});
nodes.set('raglan-field',{hidden:false});
const saved=h.captureUpperMeasurementsForSwitch_();
assert.equal(saved.values['m-chest'],'51');
fields.forEach(n=>{n.value='';});
nodes.get('raglan-toggle').checked=false;
h.restoreUpperMeasurementsAfterSwitch_(saved);
assert.equal(nodes.get('m-sleeve').value,'60.5');
assert.equal(nodes.get('m-length').value,'98');
assert.equal(nodes.get('m-yuki').value,'80');
assert.equal(nodes.get('raglan-toggle').checked,true);
assert.match(h.formatMeasurements(h.collectMeasurements()),/着丈：98cm/);
assert.match(h.formatMeasurements(h.collectMeasurements()),/ゆき丈：80cm/);
nodes.get('category').value='bottoms';
assert.equal(h.captureUpperMeasurementsForSwitch_(),null);
const s=h.compactTemporaryDraftState_({category:'outer',measurementCategoryVersion:2,measurements:saved.values,photos:[]});
assert.equal(h.hydrateTemporaryDraftState_(s).category,'outer');
assert.equal(h.hydrateTemporaryDraftState_(s).measurements['m-chest'],'51');
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/value="tops">トップス/);
assert.match(html,/value="outer">アウター/);
assert.doesNotMatch(html,/value="legacyUpper"/);
assert.doesNotMatch(html,/旧：アウター/);
nodes.get('category').value='';
nodes.get('measurement-fields').dataset.category='legacyUpper';
assert.equal(h.pendingMeasurementCategory_(),'legacyUpper');
assert.equal(h.restoredMeasurementCategory_({category:h.pendingMeasurementCategory_(),measurementCategoryVersion:2}),'legacyUpper');
nodes.get('category').value='outer';
assert.equal(h.pendingMeasurementCategory_(),'outer');
assert.equal(h.captureUpperMeasurementsForSwitch_().values['m-chest'],'51');
const source=fs.readFileSync('app.js','utf8');
assert.match(source,/el\('category'\)\.value = restoredCategory === 'legacyUpper' \? '' : restoredCategory/);
assert.match(source,/renderMeasurements\(restoredCategory\)/);
console.log(JSON.stringify({ok:true,test:'upper-size-profiles',centersChecked:56,example:{womenOuter:'M',womenTops:'L'}}));

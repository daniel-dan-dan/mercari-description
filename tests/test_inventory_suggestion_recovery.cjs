'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const nodes=new Map(),timers=new Map();let n=0;
 const c={console,URL,__MERCARI_TEST__:true,localStorage:{getItem:()=>null},
 setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id),
 document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,classList:{add(){}}});return nodes.get(id);}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('catalog-data.js','utf8')+'\n'+fs.readFileSync('app.js','utf8'),c);
 vm.runInContext('getMercariServiceUrl=async()=>"https://example.test";readJsonResponse=async r=>r;',c);
 return {c,h:c.MercariAppTestHooks,nodes,timers};
}
const item=(n,name,row=n)=>({inventoryUuid:`inv_550e8400-e29b-41d4-a716-${String(n).padStart(12,'0')}`,productName:name,row,asin:'なし'});
(async()=>{
 let {c,h,nodes}=fixture();
 const title=nodes.get('title-text')||c.document.getElementById('title-text');title.value='バーバリーロンドン ダウンコート 紺 38';
 c.document.getElementById('m-brand').value='BURBERRY LONDON';
 const older=item(12,'BURBERRY LONDON ダウンコート ネイビー 38',12);
 const latest=item(1060,'別のブランドの白いシャツ M',1060);
 const r=h.rankInventoryCandidates_([older,latest],{title:title.value,brands:['BURBERRY LONDON','バーバリーロンドン'],size:'38'});
 assert.equal(r.suggested[0].row,12);assert.match(r.reasons[older.inventoryUuid].join(' '),/ブランド.*サイズ/);
 assert.equal(h.rankInventoryCandidates_([older],{title:'バーバリーロンドン',brands:['BURBERRY LONDON']}).suggested.length,0);
 assert.deepEqual(Array.from(h.inventorySuggestionQueries_({brands:['BURBERRY LONDON','BURBERRY LONDON','---']})),['BURBERRY','バーバリー']);
 assert.deepEqual(Array.from(h.inventorySuggestionQueries_({brands:['---'],title:'美品 トレンチコート ネイビー M'})),['トレンチコート','ネイビー']);
 let queries=[];c.mock=async url=>{queries.push(new URL(url).searchParams.get('query'));return {ok:true,items:new URL(url).searchParams.get('query')==='バーバリー'?[]:new URL(url).searchParams.get('query')?[older]:[latest]};};
 vm.runInContext('fetchWithTimeout=mock;',c);
 await h.loadInventoryCandidates_();
 assert.doesNotMatch(nodes.get('inventory-candidate-list').innerHTML,/BURBERRY LONDON ダウンコート/);
 await h.loadInventorySuggestions_();
 let html=nodes.get('inventory-candidate-list').innerHTML;
 assert.match(html,/この商品の候補（推定）/);assert.match(html,/BURBERRY LONDON ダウンコート/);assert.match(html,/ブランド名が近い/);
 assert.ok(html.indexOf('BURBERRY LONDON ダウンコート')<html.indexOf('別のブランド'));
 assert.equal(queries.length,3);assert.equal(queries[1],'BURBERRY');
 assert.equal(c.document.getElementById('inventory-uuid-input').value,'');
 // Completed reads are cached; an explicit force makes a new read, never a write.
 await h.loadInventorySuggestions_();assert.equal(queries.length,3);
 await h.loadInventorySuggestions_({force:true});assert.equal(queries.length,5);
 // Choosing and clearing use the exact UUID; no sheet mapping is sent here.
 vm.runInContext('scheduleSave=()=>{};updateDraftChecklist=()=>{};',c);
 c.choice={target:{closest:()=>({dataset:{inventoryCandidateUuid:older.inventoryUuid,inventoryCandidateName:older.productName,inventoryCandidateMeta:'SKU fixture'}})}};
 vm.runInContext('handleInventoryCandidateSelection_(choice);',c);
 assert.equal(c.document.getElementById('inventory-uuid-input').value,older.inventoryUuid);
 assert.match(nodes.get('inventory-selected-summary').innerHTML,/BURBERRY LONDON ダウンコート/);
 vm.runInContext('clearInventorySelection_();',c);assert.equal(c.document.getElementById('inventory-uuid-input').value,'');assert.equal(nodes.get('inventory-candidate-status').textContent,'');
 // Failed lookup stays visible and can be retried; does not select a guess.
 c.mock=async()=>({ok:false,error:'offline'});vm.runInContext('fetchWithTimeout=mock;',c);
 await assert.rejects(h.loadInventorySuggestions_({force:true}));assert.match(nodes.get('inventory-candidate-list').innerHTML,/再試行/);
 assert.equal(nodes.get('inventory-suggest-btn').disabled,false);
 assert.equal(nodes.get('inventory-uuid-input').value,'');
 // A late response from product A may cache data, never publish it for B.
 ({c,h,nodes}=fixture());c.document.getElementById('title-text').value='ブランドA ネイビー ダウンコート';c.document.getElementById('m-brand').value='ブランドA';
 let release;c.mock=async()=>await new Promise(r=>release=r);vm.runInContext('fetchWithTimeout=mock;',c);
 const pending=h.loadInventorySuggestions_();await new Promise(setImmediate);
 c.document.getElementById('title-text').value='別の商品 ブラウン ニット';h.refreshInventorySuggestions_();
 release({ok:true,items:[item(99,'ブランドA ネイビー ダウンコート')]});await pending;
 assert.doesNotMatch(nodes.get('inventory-candidate-list').innerHTML,/ブランドA ネイビー ダウンコート/);
 assert.equal(nodes.get('inventory-suggest-btn').disabled,false);
 // Auto lookup is delayed and product edits replace it before any request.
 // The timer hooks are checked via the original fixture, not real network.
 const auto=fixture();vm.runInContext('getApiAuthToken=()=>"test-device";',auto.c);
 auto.c.document.getElementById('title-text').value='トレンチコート';auto.h.refreshInventorySuggestions_();assert.equal(auto.timers.size,1);
 auto.c.document.getElementById('title-text').value='';auto.h.refreshInventorySuggestions_();assert.equal(auto.timers.size,0);
 assert.match(auto.nodes.get('inventory-candidate-list').innerHTML,/商品名が入ると/);
 console.log('PASS inventory restoration: old rows, notation differences, reasons, explicit selection, cached/bounded reads, failure and stale-product guards');
})().catch(e=>{console.error(e);process.exitCode=1;});

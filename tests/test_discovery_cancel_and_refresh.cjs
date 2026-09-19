'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
 const storage = new Map([['mercari_device_auth_v1', 'fixture-token']]);
 const ctx = { console, URL, AbortController, __MERCARI_TEST__: true,
  setTimeout: fn => setTimeout(fn, 0), clearTimeout,
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) } };
 ctx.globalThis=ctx; vm.createContext(ctx);
 vm.runInContext(['catalog-data.js','app.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n'),ctx);
 return {ctx,h:ctx.MercariAppTestHooks};
}
(async()=>{
 const {ctx,h}=harness();
 h.cacheMacServiceUrl_('https://live.trycloudflare.com');
 const requests=[];
 ctx.mock=async(url)=>{requests.push(url);return {ok:true,status:200,text:async()=>JSON.stringify({ok:true})};};
 vm.runInContext('fetchWithTimeout = mock;',ctx);
 assert.equal(await h.createMacServiceUrlRefresher_(()=>{})(),'https://live.trycloudflare.com');
 assert.deepEqual(requests,['https://live.trycloudflare.com/ping'],'upload recovery must not discard healthy URL or call GAS');

 // Cancel one waiter immediately while another still uses the shared discovery.
 h.clearCachedMacServiceUrl_();let resolveDiscovery;let runs=0;
 ctx.deferred=()=>{runs++;return new Promise(resolve=>{resolveDiscovery=resolve;});};
 vm.runInContext('discoverMercariServiceUrl_ = deferred;',ctx);
 const abort=new AbortController();const first=h.getMercariServiceUrl(()=>{}, {signal:abort.signal});
 const other=h.getMercariServiceUrl(()=>{});abort.abort();
 await assert.rejects(first,/待機を中止/);assert.equal(runs,1);
 resolveDiscovery('https://new.trycloudflare.com');assert.equal(await other,'https://new.trycloudflare.com');
 const preAborted=new AbortController();preAborted.abort();await assert.rejects(h.getMercariServiceUrl(()=>{}, {signal:preAborted.signal}),/待機を中止/);assert.equal(runs,1);

 const fresh=harness();const timeouts=[];
 fresh.ctx.mock=async(_url,_opts,ms)=>{timeouts.push(ms);if(ms<30000)throw Object.assign(new Error('slow'),{name:'TimeoutError'});return {ok:true,text:async()=>JSON.stringify({success:true,data:{url:'https://fresh.trycloudflare.com'}})};};
 vm.runInContext('fetchWithTimeout = mock;',fresh.ctx);
 assert.equal(await fresh.h.fetchTunnelUrlFromGas('https://script.google.com/example'),'https://fresh.trycloudflare.com');
 assert.deepEqual(timeouts,[10000,20000,30000]);
 console.log('PASS discovery: healthy cache retained, cancel immediate, shared caller survives, pre-cancel no work, bounded progressive deadlines');
})().catch(e=>{console.error(e);process.exitCode=1;});

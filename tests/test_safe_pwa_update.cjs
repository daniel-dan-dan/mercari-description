'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sw = fs.readFileSync('sw.js', 'utf8');
const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
assert.doesNotMatch(sw, /self\.skipWaiting\s*\(/);
assert.doesNotMatch(bootstrap, /location\.reload\s*\(/);
function fixture(waitingVersion) {
  let note, inserted=0, updates=0;
  const events={}, registrationEvents={}, windowEvents={}, deferred=[];
  const worker = version => ({state:'installed',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},
    postMessage(data,ports){assert.equal(data.type,'GET_APP_VERSION');if(version==='deferred')deferred.push(ports[0]);else ports[0].postMessage({type:'APP_VERSION',version});}});
  const registration={waiting: waitingVersion ? worker(waitingVersion) : null,installing:null,
    addEventListener(name,fn){registrationEvents[name]=fn;},update:async()=>{updates++;}};
  const ctx={console,WeakSet,setTimeout,clearTimeout,
    MessageChannel:class {constructor(){this.port1={close(){}};this.port2={close(){},postMessage:data=>queueMicrotask(()=>this.port1.onmessage?.({data}))};}},
    MercariPublicConfig:{version:'v20260920m'},
    addEventListener:(name,fn)=>windowEvents[name]=fn,
    document:{visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn,
      getElementById:id=>id==='app-update-note'?note:id==='app'?{prepend:element=>{inserted++;note=element;}}:null,
      createElement:()=>({setAttribute(){},remove(){note=undefined;}})},
    navigator:{serviceWorker:{controller:{},addEventListener:(name,fn)=>events[name]=fn,
      register:async(url,options)=>{assert.equal(url,'sw.js');assert.equal(options.updateViaCache,'none');return registration;}}}};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(bootstrap,ctx);
  return {registration,worker,events,registrationEvents,windowEvents,deferred,get note(){return note;},get inserted(){return inserted;},get updates(){return updates;}};
}
const tick=()=>new Promise(setImmediate);
(async()=>{
 for(const version of [null,'v20260920m','v20260920l','unknown']) {
  const h=fixture(version);await tick();assert.equal(h.note,undefined,`no false update for ${version}`);assert.equal(h.updates,1);
 }
 const h=fixture('v20260920p');await tick();assert.match(h.note.textContent,/v20260920p/);assert.equal(h.inserted,1);
 h.windowEvents.pageshow();await tick();assert.equal(h.inserted,1);
 h.registration.waiting=null;h.events.controllerchange();await tick();assert.equal(h.note,undefined,'notice clears after activation');
 h.registration.installing=h.worker('v20260921a');h.registration.installing.state='installing';h.registrationEvents.updatefound();
 h.registration.waiting=h.registration.installing;h.registration.waiting.state='installed';h.registration.waiting.listeners.statechange();
 await tick();assert.match(h.note.textContent,/v20260921a/);
 h.registration.waiting.state='redundant';h.registration.waiting.listeners.statechange();await tick();assert.equal(h.note,undefined);
 const stale=fixture('deferred');await tick();stale.registration.waiting=null;stale.events.controllerchange();
 stale.deferred.forEach(port=>port.postMessage({type:'APP_VERSION',version:'v20260921a'}));await tick();assert.equal(stale.note,undefined,'late response cannot resurrect notice');
 const listeners={};vm.runInNewContext(sw,{self:{addEventListener:(name,fn)=>listeners[name]=fn}});
 let reply;listeners.message({data:{type:'GET_APP_VERSION'},ports:[{postMessage:data=>reply=data}]});assert.equal(reply.version,fs.readFileSync('public-config.js','utf8').match(/version: '([^']+)'/)[1]);
 console.log('PASS update notice: fixed URL, release handshake, same/older/new release, activation, redundant worker and stale response; no forced reload');
})().catch(error=>{console.error(error);process.exitCode=1;});

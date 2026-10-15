'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={console,URL,__MERCARI_TEST__:true,localStorage:{getItem:()=>null}};vm.createContext(c);
vm.runInContext(fs.readFileSync('catalog-data.js','utf8')+'\n'+fs.readFileSync('app.js','utf8'),c);
const error=c.MercariAppTestHooks.makeDescriptionApiError_({code:'OPENAI_OUTPUT_EMPTY',error:'private-provider-response',attempts:3,requestId:'5fa3da52-fixture'},503);
assert.equal(error.code,'OPENAI_OUTPUT_EMPTY');assert.match(error.message,/自動で2回再試行/);assert.match(error.message,/写真が多すぎるためとは確認できません/);assert.match(error.message,/写真と採寸はこの端末に残っています/);assert.match(error.message,/30秒/);assert.match(error.message,/5fa3da52/);assert.doesNotMatch(error.message,/private-provider|処理量の上限に達しました|Billing/);
const recovered=c.MercariAppTestHooks.makeDescriptionApiError_({code:'OPENAI_OUTPUT_EMPTY',attempts:3,message:'private'},503);assert.match(recovered.message,/自動で2回再試行/);
for(const attempts of [undefined,0,1,NaN,99,'bad',2.5]){const e=c.MercariAppTestHooks.makeDescriptionApiError_({code:'OPENAI_OUTPUT_EMPTY',attempts},503);assert.doesNotMatch(e.message,/自動で/);}
assert.match(c.MercariAppTestHooks.makeDescriptionApiError_({code:'OPENAI_OUTPUT_INCOMPLETE',error:'実際の出力上限'},502).message,/実際の出力上限/);
console.log('PASS zero-usage error: separate cause, bounded retry note, retained input and direct/GET recovery guidance');
(async()=>{
 const storage=new Map();c.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 c.crypto=require('node:crypto').webcrypto;c.TextEncoder=TextEncoder;c.window=c;
 c.photos=Array.from({length:12},(_,i)=>({mediaType:'image/jpeg',base64:`fixture-${i}`,base64HQ:`hq-${i}`}));
 const before=JSON.stringify(c.photos);let sends=0;
 c.mockFetch=async(url,options)=>{sends++;const sent=JSON.parse(options.body);assert.equal(sent.images.length,12);return {ok:false,status:503,text:async()=>JSON.stringify({ok:false,code:'OPENAI_OUTPUT_EMPTY',requestId:'5fa3da52-fixture',attempts:3})};};
 vm.runInContext('getSelectedProductGender=()=>"mens";getMercariServiceUrl=async()=>"https://example.test";fetchListingStyleFromMac=async()=>"";buildDescriptionSystemPrompt=()=>"fixture";fetchWithTimeout=mockFetch;',c);
 await assert.rejects(vm.runInContext('callDescriptionAi(photos)',c),e=>e.code==='OPENAI_OUTPUT_EMPTY');
 assert.equal(sends,1);assert.equal(JSON.stringify(c.photos),before);assert.equal(c.photos.length,12);
 console.log('PASS twelve original photos/HQ retained after empty failure; no automatic PWA replay');
})().catch(e=>{console.error(e);process.exitCode=1;});

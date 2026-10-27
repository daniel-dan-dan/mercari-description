'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
class Element {
  constructor(id=''){this.id=id;this.value='';this.checked=false;this.disabled=false;this.open=false;this.isConnected=true;this.textContent='';this.dataset={};this.handlers={};this.children=[];this.attrs={};this.classList={add(){},remove(){}};}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}
  fire(name,extra={}){const event={type:name,target:this,preventDefault(){},...extra};for(const fn of this.handlers[name]||[])fn(event);}
  setAttribute(name,value){this.attrs[name]=value;}
  appendChild(child){this.children.push(child);}
  replaceChildren(){this.children=[];}
  focus(){this.focused=true;}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
  getBoundingClientRect(){return {left:0,top:0,width:320,height:320};}
  getContext(){return {clearRect(){},drawImage(){}};}
  setPointerCapture(id){(this.pointerIds??=new Set()).add(id);}
  hasPointerCapture(id){return this.pointerIds?.has(id)||false;}
  releasePointerCapture(id){this.pointerIds?.delete(id);}
}
const ids=['dialog','preview','value','photo-select','close','cancel','apply','clear','remove','count','stroke','italic','stroke-value','details','status','reset-position'];
const nodes=new Map(ids.map(id=>['photo-text-'+id,new Element('photo-text-'+id)]));
const styles=['white-black','black-white','red-white','white-gold'].map(style=>{const e=new Element();e.dataset.textStyle=style;return e;});
const dialog=nodes.get('photo-text-dialog');
dialog.querySelectorAll=selector=>selector==='[data-text-style]'?styles:[...nodes.values(),...styles];
const pending=[];
class ImageMock {
  constructor(){this.naturalWidth=1000;this.naturalHeight=1000;}
  set src(value){this.source=value;pending.push(this);}
}
let rendered;
const engine={normalizeOverlay:require('../photo-text.js').normalizeOverlay,draw:(c,o)=>{rendered={...o};return o.text?{x:o.x*c.width,y:o.y*c.height,width:100,height:50}:null;}};
const context={document:{getElementById:id=>nodes.get(id),createElement:()=>new Element(),activeElement:new Element(),fonts:{ready:Promise.resolve()}},Image:ImageMock,setTimeout,clearTimeout,console,MercariPhotoText:engine};
vm.createContext(context);vm.runInContext(fs.readFileSync('photo-text-editor.js','utf8'),context);
let photos=[{dataUrl:'data:image/jpeg;base64,ONE',base64HQ:'HQ',textOverlay:{text:'Before'}}];
let key='product-a',applied=0,fail=false,callback;
const editor=context.MercariPhotoTextEditor.create({getPhotos:()=>photos,getContextKey:()=>key,isLocked:()=>false,onApply:async(photo,overlay,isCurrent)=>{assert(isCurrent());applied++;callback=isCurrent;if(fail)throw new Error('sample failure');photos[0]={...photo,textOverlay:overlay};return true;}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function load(){const image=pending.shift();assert(image);image.onload();await tick();}
(async()=>{
 assert.equal(editor.open(),true);await load();assert.equal(nodes.get('photo-text-value').value,'Before');assert.equal(nodes.get('photo-text-preview').width,640);
 nodes.get('photo-text-value').value='Changed';nodes.get('photo-text-value').fire('input');assert.equal(nodes.get('photo-text-count').textContent,'7/100');
 editor.close();assert.equal(applied,0);assert.equal(photos[0].textOverlay.text,'Before');
 editor.open();await load();nodes.get('photo-text-value').value='Applied';nodes.get('photo-text-value').fire('input');
 const canvas=nodes.get('photo-text-preview');
 const touch=(name,id,x,y)=>canvas.fire(name,{pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y,isPrimary:id===1});
 touch('pointerdown',1,20,20);touch('pointermove',1,45,45);touch('pointerup',1,45,45);
 const dragged={x:rendered.x,y:rendered.y};assert.ok(dragged.x>.04&&dragged.y>.04);
 touch('pointerdown',1,40,120);touch('pointerdown',2,140,120);
 touch('pointermove',2,240,120);assert.equal(rendered.fontSize,.15);
 touch('pointermove',2,2000,120);assert.equal(rendered.fontSize,.18);
 touch('pointermove',2,41,120);assert.equal(rendered.fontSize,.025);
 touch('pointermove',2,240,120);assert.equal(rendered.fontSize,.15);
 touch('pointerup',2,240,120);touch('pointermove',1,45,125);touch('pointerup',1,45,125);
 assert.equal(rendered.x,dragged.x);assert.equal(rendered.y,dragged.y);
 styles[3].fire('click');assert.equal(rendered.style,'white-gold');assert.equal(rendered.fontSize,.15);
 assert.equal(rendered.x,dragged.x);assert.equal(rendered.y,dragged.y);
 touch('pointerdown',1,40,120);touch('pointerdown',2,140,120);touch('pointercancel',2,140,120);
 touch('pointermove',1,240,120);assert.equal(rendered.fontSize,.15);assert.equal(canvas.pointerIds.size,0);
 nodes.get('photo-text-apply').fire('click');await tick();assert.equal(applied,1);assert.equal(editor.isOpen(),false);assert.equal(photos[0].textOverlay.text,'Applied');assert.equal(photos[0].textOverlay.style,'white-gold');assert.equal(photos[0].textOverlay.fontSize,.15);assert.equal(photos[0].textOverlay.x,dragged.x);assert.equal(photos[0].textOverlay.y,dragged.y);assert.equal(callback(),false);
 editor.open();await load();fail=true;nodes.get('photo-text-apply').fire('click');await tick();assert.equal(editor.isOpen(),true);assert.equal(nodes.get('photo-text-status').textContent,'sample failure');assert.equal(nodes.get('photo-text-apply').disabled,false);editor.close();fail=false;
 editor.open();await load();photos=photos.slice();nodes.get('photo-text-value').value='Stale';nodes.get('photo-text-value').fire('input');assert.equal(nodes.get('photo-text-apply').disabled,true);nodes.get('photo-text-apply').fire('click');await tick();assert.equal(applied,2);editor.close();
 editor.open();const old=pending.shift();editor.close();editor.open();const fresh=pending.shift();fresh.onload();await tick();old.onload();await tick();assert.equal(editor.isOpen(),true);assert.equal(nodes.get('photo-text-value').value,'Applied');editor.close();
 console.log('editor cancel, commit replacement, failure recovery, stale photo array, late image completion: passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const floatingSource=fs.readFileSync(path.join(root,'public/camera-floating.js'),'utf8');
const videoSource=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');

assert(html.includes('id="liveCameraBtn"')&&html.includes('id="cameraSelfPreview"'));
assert(html.includes('camera-floating.js?v=50.2-arraste-camera'));
assert(html.includes('camera-video.js?v=50.3-trocar-camera'));
assert(/const visible=!!publishing&&!!myVideo;/.test(videoSource), 'prévia local no celular e computador');
assert(css.includes('.live-camera-btn.dragging') && css.includes('.camera-self-preview.dragging'),'feedback de arraste');
assert(css.includes('touch-action:none'),'arraste por toque');
assert(!/MediaRecorder|canvas\.toDataURL|\.upload\(|getUserMedia|srcObject|mediaStreamTrack/.test(floatingSource),'módulo de posição não pode tocar nos dados da câmera');

const stored=new Map();
function makeElement(id,width,height){
  const handlers=new Map();
  const el={id,disabled:false,offsetWidth:width,offsetHeight:height,style:{},listeners:handlers,
    classList:{_classes:new Set(),add(s){this._classes.add(s)},remove(s){this._classes.delete(s)}},
    addEventListener(type,callback,capture=false){const list=handlers.get(type)||[];list.push({callback,capture});handlers.set(type,list)},
    getBoundingClientRect(){return {left:Number.parseFloat(this.style.left)||0,top:Number.parseFloat(this.style.top)||0,bottom:(Number.parseFloat(this.style.top)||0)+height}},
    setPointerCapture(){},releasePointerCapture(){},
    dispatch(type,attrs={}){
      const ev={pointerId:1,button:0,clientX:0,clientY:0,cancelable:true,defaultPrevented:false,blocked:false,
        preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.blocked=true},...attrs};
      const listeners=(handlers.get(type)||[]).sort((a,b)=>Number(b.capture)-Number(a.capture));
      for(const {callback} of listeners){callback(ev);if(ev.blocked)break}
      return ev;
    }
  };
  return el;
}
const btn=makeElement('liveCameraBtn',108,42);
const preview=makeElement('cameraSelfPreview',72,72);
const windowHandlers=new Map();
const w={innerWidth:390,innerHeight:844,
  addEventListener(type,callback){windowHandlers.set(type,callback)}};
const document={getElementById(id){return ({liveCameraBtn:btn,cameraSelfPreview:preview})[id]||null},
  querySelector(selector){return selector==='.topbar'?{getBoundingClientRect(){return {bottom:54}}}:null}};
const localStorage={getItem(k){return stored.get(k)||null},setItem(k,v){stored.set(k,v)}};
vm.runInNewContext(floatingSource,{window:w,document,localStorage,Date,Math,JSON,Number,parseFloat});
assert.equal(btn.style.right,'auto');
assert.equal(preview.style.right,'auto');
const beforeButton=btn.getBoundingClientRect();
btn.dispatch('pointerdown',{clientX:beforeButton.left+5,clientY:beforeButton.top+5});
btn.dispatch('pointermove',{clientX:beforeButton.left-50,clientY:beforeButton.top+90});
btn.dispatch('pointerup',{clientX:beforeButton.left-50,clientY:beforeButton.top+90});
const afterButton=btn.getBoundingClientRect();
assert(afterButton.left<beforeButton.left && afterButton.top>beforeButton.top,'botão da câmera deve se mover');
assert(stored.has('mau-mau-camera-v502-pos:button:mobile'),'posição do botão persistida');
assert(btn.dispatch('click').blocked,'arrastar não pode acionar câmera');
assert(!btn.dispatch('click').blocked,'clique seguinte deve funcionar normalmente');
const beforePreview=preview.getBoundingClientRect();
preview.dispatch('pointerdown',{clientX:beforePreview.left+5,clientY:beforePreview.top+5});
preview.dispatch('pointermove',{clientX:1000,clientY:1000});
preview.dispatch('pointerup',{clientX:1000,clientY:1000});
const afterPreview=preview.getBoundingClientRect();
assert(afterPreview.left<=w.innerWidth-preview.offsetWidth-8,'prévia não pode sair da tela na horizontal');
assert(afterPreview.top<=w.innerHeight-preview.offsetHeight-8,'prévia não pode sair da tela na vertical');
assert(stored.has('mau-mau-camera-v502-pos:preview:mobile'),'posição da prévia persistida');
// Simula mudança de orientação e janela desktop.
w.innerWidth=1180;w.innerHeight=800;windowHandlers.get('resize')();
assert(btn.getBoundingClientRect().left>900,'desktop deve assumir localização própria');
assert(stored.has('mau-mau-camera-v502-pos:button:mobile'),'posição do celular deve ser preservada');
w.innerWidth=390;w.innerHeight=844;windowHandlers.get('resize')();
assert.equal(btn.getBoundingClientRect().left,afterButton.left,'posição do botão deve ser restaurada');
console.log('✓ V50.2: posições flutuantes no celular e desktop, persistência, limites e prevenção de clique testados.');

'use strict';
// V50.3: Teste funcional em memória; não conecta ao LiveKit, não captura nem grava vídeo.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
assert(html.includes('id="cameraSwitchBtn"') && html.includes('camera-video.js?v=50.3-trocar-camera'));
assert(css.includes('.camera-switch-btn') && css.includes('.camera-self-preview.camera-rear'));
assert(!/MediaRecorder|canvas\.toDataURL|\.upload\(|localStorage|indexedDB/.test(source));

function element(id){
  const listeners={};const classes=new Set();
  return {id,disabled:false,style:{},srcObject:null,parentElement:null,
    classList:{toggle(name,on){if(on===undefined? !classes.has(name):on)classes.add(name);else classes.delete(name)},add(name){classes.add(name)},remove(name){classes.delete(name)},contains(name){return classes.has(name)}},
    setAttribute(name,value){this[name]=value},
    addEventListener(name,listener){(listeners[name]??=[]).push(listener)},
    async dispatch(name){const evt={stopped:false,stopPropagation(){this.stopped=true}};let result;for(const listener of listeners[name]||[])result=listener(evt);await result;return evt},
    appendChild(child){this.children??=[];this.children.push(child);child.parentElement=this;return child},
    pause(){},play(){return Promise.resolve()},remove(){if(this.parentElement?.children)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null}
  };
}
function makeEnvironment({mobile,devices}){
  let lastTrackVersion=0;
  const currentMedia=()=>({getSettings(){return {...settings}},readyState:'live',id:'camera-stream-'+(++lastTrackVersion)});
  let settings={facingMode:'user',deviceId:'front'};
  const track={mediaStreamTrack:currentMedia(),getDeviceId:async()=>settings.deviceId,
    async restartTrack(options){
      if(options.facingMode){settings={...settings,facingMode:options.facingMode,deviceId:options.facingMode==='environment'?'back':'front'};}
      else if(options.deviceId){const wanted=options.deviceId.exact||options.deviceId;settings={...settings,deviceId:wanted,facingMode:devices.find(d=>d.deviceId===wanted)?.label?.includes('rear')?'environment':'user'};}
      this.mediaStreamTrack=currentMedia();
    }};
  const socketEvents=new Map(),emitted=[];
  const socket={connected:true,on(name,fn){socketEvents.set(name,fn)},emit(name,payload){emitted.push({name,payload})},timeout(){return {emit(name,payload,fn){fn(null,{ok:true,url:'wss://test.local',token:'fake'})}}}};
  const buttons={liveCameraBtn:element('liveCameraBtn'),liveCameraLabel:element('liveCameraLabel'),cameraSwitchBtn:element('cameraSwitchBtn'),cameraSelfPreview:element('cameraSelfPreview')};
  const avatar=element('avatar');const seat={dataset:{cameraPlayerId:'p1'},querySelector:()=>avatar};
  const ring={querySelectorAll:()=>[seat]};
  const doc={getElementById:id=>id==='playersRing'?ring:buttons[id]||null,createElement:()=>element('video'),head:{appendChild(){} }};
  let isEnabled=false;
  const livekit={Track:{Source:{Camera:'camera'},Kind:{Video:'video'}},RoomEvent:{TrackSubscribed:'sub',TrackUnsubscribed:'unsub',ParticipantDisconnected:'gone',Disconnected:'disconnected'},
    Room:class{
      constructor(){this.state='disconnected';this.localParticipant={
        getTrackPublication:()=>isEnabled?{track}:undefined,
        setCameraEnabled:async(on)=>{isEnabled=on}
      };}
      on(){}async connect(){this.state='connected'}async disconnect(){this.state='disconnected'}
    }};
  const state={code:'ROOM',players:[{id:'p1',isBot:false,connected:true,autoControlled:false}],me:{id:'p1',role:'PLAYER'},viewerRole:'PLAYER'};
  const notices=[];
  const w={LivekitClient:livekit,innerWidth:mobile?390:1200,matchMedia:()=>({matches:mobile}),addEventListener(){}};
  const nav={userAgent:mobile?'Mozilla Android':'Mozilla Linux',mediaDevices:{async enumerateDevices(){return devices}}};
  class MediaStream{constructor(tracks){this.tracks=tracks}}
  const context={window:w,document:doc,navigator:nav,MediaStream,Promise,Set,Map,String,Number,console,
    fetch:async()=>({json:async()=>({enabled:true})})};
  vm.runInNewContext(source,context,{filename:'camera-video.js'});
  return {w,buttons,notices,socket,emitted,track,getSettings:()=>settings,getPreviewTrack:()=>buttons.cameraSelfPreview.children?.find(e=>e.id==='video')?.srcObject?.tracks?.[0],
    async init(){await w.MauCamera.init(socket,{getState:()=>state,toast:msg=>notices.push(msg)})},
    async on(){await buttons.liveCameraBtn.dispatch('click')},
    async flip(){await w.MauCamera.switchCamera()}
  };
}
(async()=>{
  const devices=[{kind:'videoinput',deviceId:'front',label:'front camera'},{kind:'videoinput',deviceId:'back',label:'rear camera'}];
  const phone=makeEnvironment({mobile:true,devices});await phone.init();await phone.on();
  assert.equal(phone.getSettings().facingMode,'user');
  assert(!phone.buttons.cameraSwitchBtn.classList.contains('hidden'),'botão disponível ao ligar a câmera');
  const first=phone.getPreviewTrack();
  await phone.flip();
  assert.equal(phone.getSettings().facingMode,'environment','telefone deve mudar para câmera traseira');
  assert(phone.buttons.cameraSelfPreview.classList.contains('camera-rear'),'traseira não deve espelhar imagem');
  assert.notEqual(first,phone.getPreviewTrack(),'a prévia deve exibir a nova faixa de vídeo');
  await phone.flip();assert.equal(phone.getSettings().facingMode,'user','telefone deve voltar para frontal');
  assert(!phone.buttons.cameraSelfPreview.classList.contains('camera-rear'),'frontal deve espelhar a prévia');
  const click=await phone.buttons.cameraSwitchBtn.dispatch('pointerdown');
  assert(click.stopped,'botão de troca não pode disparar o arraste da prévia');
  await phone.on();assert(phone.buttons.cameraSwitchBtn.classList.contains('hidden'),'botão deve desaparecer ao desligar câmera');
  assert(phone.emitted.every(e=>e.name!=='cameraFrame'),'vídeo nunca vai pelo socket');
  const desktop=makeEnvironment({mobile:false,devices});await desktop.init();await desktop.on();await desktop.flip();
  assert.equal(desktop.getSettings().deviceId,'back','desktop deve alternar webcam');
  const single=makeEnvironment({mobile:false,devices:[devices[0]]});await single.init();await single.on();await single.flip();
  assert.equal(single.getSettings().deviceId,'front','não deve tentar inventar câmera adicional');
  assert(single.notices.some(msg=>msg.includes('Só uma câmera')),'deve avisar usuário de webcam única');
  console.log('✓ V50.3: frente/trás, webcams, prévia atualizada, segurança do botão e indisponibilidade testados.');
})().catch(e=>{console.error(e);process.exitCode=1});

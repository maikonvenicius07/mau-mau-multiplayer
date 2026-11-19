'use strict';
// Simula controlador e DOM de vídeo do observador de torneio, sem rede/dispositivos reais.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','public','camera-video.js'),'utf8');
function el(id,initial=[]){
 const css=new Set(initial),listeners=new Map();
 return {id,style:{},dataset:{},children:[],parentElement:null,srcObject:null,paused:true,
  classList:{contains:x=>css.has(x),add:x=>css.add(x),remove:x=>css.delete(x),toggle(x,on){if(on)css.add(x);else css.delete(x)}},
  setAttribute(name,value){this[name]=value},removeAttribute(name){delete this[name]},
  addEventListener(type,fn){listeners.set(type,fn)},
  async dispatch(type){return listeners.get(type)?.({key:'Enter',preventDefault(){},stopPropagation(){}})},
  appendChild(child){if(child.parentElement)child.remove();this.children.push(child);child.parentElement=this;return child},
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null},
  querySelector(s){return s==='.camera-spectator-name'?this.children.find(x=>x.className==='camera-spectator-name'):null},
  pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()},closest(){return null},focus(){},
 };
}
const ids=['playersRing','liveCameraBtn','liveCameraLabel','cameraSelfPreview','cameraSwitchBtn',
 'cameraOpponentOverlay','cameraOpponentExpandedVideo','cameraOpponentClose','cameraOpponentName','cameraSpectatorStreams'];
const nodes=Object.fromEntries(ids.map(x=>[x,el(x,['hidden'])]));
nodes.playersRing.querySelectorAll=()=>[];
const doc={getElementById:id=>nodes[id]||null,createElement:tag=>el(tag),querySelectorAll:()=>[],
 visibilityState:'visible',head:{appendChild(){}},addEventListener(){}};
let localOn=false,activeRoom;
const track={mediaStreamTrack:{readyState:'live',enabled:true,muted:false,getSettings(){return {}},addEventListener(){}}};
const sdk={Track:{Source:{Camera:'camera'},Kind:{Video:'video'}},
 RoomEvent:{TrackSubscribed:'sub',TrackUnsubscribed:'unsub',ParticipantDisconnected:'gone',Disconnected:'down',Reconnected:'up'},
 Room:class{
  constructor(){this.state='disconnected';this.handlers=new Map();activeRoom=this;this.localParticipant={
   getTrackPublication:()=>localOn?{track}:null,
   setCameraEnabled:async value=>{localOn=value},
  }}
  on(type,fn){this.handlers.set(type,fn)}
  async connect(){this.state='connected'}
  async disconnect(){this.state='disconnected'}
 }};
const state={code:'TBL001',viewerRole:'SPECTATOR',me:{id:'s_1',role:'SPECTATOR'},
 spectators:[{id:'s_1',connected:true,name:'Observadora A'},{id:'s_2',connected:true,name:'Observadora B'}],
 players:[{id:'p1',connected:true}]};
const socketEvents=new Map();const sent=[];
const socket={connected:true,on:(type,fn)=>socketEvents.set(type,fn),emit:(type,payload)=>sent.push({type,payload}),
 timeout(){return{emit(type,payload,cb){cb(null,{ok:true,url:'wss://livekit.invalid',token:'test-token'})}}}};
const window={LivekitClient:sdk,innerWidth:390,MauCameraFloating:{reclamp(){}},
 addEventListener(){},matchMedia:()=>({matches:true}),MauMediaSession:{setDesired(){},ready(){},failed(){}}};
class MediaStream{constructor(tracks){this.tracks=tracks}}
vm.runInNewContext(source,{window,document:doc,console,MediaStream,
 navigator:{userAgent:'Android',mediaDevices:{}},fetch:async()=>({json:async()=>({enabled:true})}),
 String,Number,Promise,Map,Set,Date,setTimeout(fn){return 1},clearTimeout(){}},{filename:'camera-video.js'});
(async()=>{
 await window.MauCamera.init(socket,{getState:()=>state,toast:()=>{}});
 window.MauCamera.onJoined('TBL001',{role:'SPECTATOR',tournamentWatch:true,restoreCamera:false});
 assert.equal(nodes.liveCameraBtn.classList.contains('hidden'),false,'torneio deve mostrar controle de câmera');
 await nodes.liveCameraBtn.dispatch('click');
 assert.equal(localOn,true,'observador deve publicar vídeo após clique');
 assert(sent.some(e=>e.type==='cameraPublishState'&&e.payload.active===true));
 assert.equal(nodes.cameraSelfPreview.classList.contains('hidden'),false,'observador deve ver própria prévia');
 activeRoom.handlers.get('sub')({kind:'video',mediaStreamTrack:{id:'track-observer2'}},null,{identity:'s_s_2'});
 assert.equal(nodes.cameraSpectatorStreams.children.length,1,'observador remoto recebe seu próprio tile');
 assert.equal(nodes.cameraSpectatorStreams.children[0].children.find(x=>x.className==='camera-spectator-name').textContent,'Observadora B');
 assert.equal(nodes.cameraSpectatorStreams.classList.contains('hidden'),false);
 await nodes.liveCameraBtn.dispatch('click');
 assert.equal(localOn,false,'desliga vídeo ao clicar novamente');
 assert(sent.some(e=>e.type==='cameraPublishState'&&e.payload.active===false));
 window.MauCamera.stop();
 assert.equal(nodes.cameraSpectatorStreams.children.length,0,'libera tile remoto ao sair');
 console.log('✓ V40.69.8.39: câmera local do observador, prévia, vídeo remoto, nomes e encerramento.');
})().catch(e=>{console.error(e);process.exitCode=1});

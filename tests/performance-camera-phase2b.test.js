'use strict';
// Fase 2B — teste isolado em memória. Não acessa câmera, rede nem LiveKit real.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
assert(html.includes('camera-video.js?v=50.3-trocar-camera-v50.4-adversarios-maior-perf-phase2b'),
  'novo query de cache para ativar o controlador atualizado');

let createdVideos=0, seatQueries=0;
const counters={buttonReclamps:0,previewReclamps:0,streams:0};
function element(id,initial=[]){
  const classes=new Set(initial),handlers=new Map();
  const e={id,children:[],parentElement:null,style:{},dataset:{},srcObject:null,paused:true,plays:0,sourceAssigns:0,
    classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){
      const next=on===undefined?!classes.has(c):!!on;if(next)classes.add(c);else classes.delete(c);return next;
    }},
    setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},
    addEventListener(k,fn){const list=handlers.get(k)||[];list.push(fn);handlers.set(k,list)},
    async dispatch(k){for(const fn of handlers.get(k)||[])await fn({key:k,stopPropagation(){},preventDefault(){}})},
    appendChild(child){
      if(child.parentElement){child.parentElement.children=child.parentElement.children.filter(n=>n!==child)}
      this.children.push(child);child.parentElement=this;return child;
    },
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null},
    pause(){this.paused=true},play(){this.plays++;this.paused=false;return Promise.resolve()},
    closest(){return null},focus(){}
  };
  let backing=null;
  Object.defineProperty(e,'srcObject',{get(){return backing},set(v){if(backing!==v)e.sourceAssigns++;backing=v}});
  return e;
}
function seat(id,left){
  const el=element('seat-'+id),card=element('card-'+id),avatar=element('avatar-'+id);
  el.dataset.cameraPlayerId=id;el.dataset.playerName=id;el.style.left=String(left);
  el.querySelector=selector=>selector==='.player-card .avatar'?avatar:null;
  avatar.closest=selector=>selector==='.player-card'?card:selector==='.player-seat'?el:null;
  return {el,avatar,card};
}
const s1=seat('p1',50),s2=seat('p2',75);
const ring=element('playersRing');ring.querySelectorAll=()=>{seatQueries++;return [s1.el,s2.el]};
const nodes={playersRing:ring,liveCameraBtn:element('liveCameraBtn',['hidden']),liveCameraLabel:element('liveCameraLabel'),
  cameraSelfPreview:element('cameraSelfPreview',['hidden']),cameraSwitchBtn:element('cameraSwitchBtn',['hidden']),
  cameraOpponentOverlay:element('cameraOpponentOverlay',['hidden']),cameraOpponentExpandedVideo:element('cameraOpponentExpandedVideo'),
  cameraOpponentClose:element('cameraOpponentClose'),cameraOpponentName:element('cameraOpponentName')};
const document={getElementById:id=>nodes[id]||null,
  createElement:tag=>{if(tag==='video')createdVideos++;return element(tag)},
  head:{appendChild(){}},querySelectorAll:()=>[]};
let cameraEnabled=false;
const localTrack={mediaStreamTrack:{id:'local-track-1',getSettings(){return {facingMode:'user'}}}};
let activeRoom=null;
const sdk={Track:{Source:{Camera:'camera'},Kind:{Video:'video'}},
  RoomEvent:{TrackSubscribed:'sub',TrackUnsubscribed:'unsub',ParticipantDisconnected:'gone',Disconnected:'disconnected'},
  Room:class{
    constructor(){this.state='disconnected';this.handlers=new Map();activeRoom=this;
      this.localParticipant={getTrackPublication:()=>cameraEnabled?{track:localTrack}:null,
        setCameraEnabled:async on=>{cameraEnabled=on}}}
    on(k,fn){this.handlers.set(k,fn)}
    async connect(){this.state='connected'}
    async disconnect(){this.state='disconnected'}
  }};
const window={LivekitClient:sdk,innerWidth:390,
  MauCameraFloating:{reclamp(kind){if(kind==='button')counters.buttonReclamps++;else counters.previewReclamps++}},
  addEventListener(){},matchMedia:()=>({matches:true})};
const state={code:'TEST',me:{id:'p1',role:'PLAYER'},viewerRole:'PLAYER',
  players:[{id:'p1',connected:true},{id:'p2',connected:true}]};
const socket={connected:true,on(){},emit(){},timeout(){return {emit(k,v,done){done(null,{ok:true,url:'ws://example.invalid',token:'test'})}}}};
class MediaStream{constructor(tracks){this.tracks=tracks;counters.streams++}}
const context={document,window,console,MediaStream,navigator:{userAgent:'Android',mediaDevices:{}},
  fetch:async()=>({json:async()=>({enabled:true})}),String,Number,Promise,Set,Map};
vm.runInNewContext(source,context,{filename:'camera-video.js'});
(async()=>{
  await window.MauCamera.init(socket,{getState:()=>state,toast:()=>{}});
  for(let i=0;i<50;i++)window.MauCamera.onState();
  assert.equal(counters.buttonReclamps,1,'não recalcular posição do botão a cada estado');
  await nodes.liveCameraBtn.dispatch('click');
  assert.equal(createdVideos,2,'vídeo do avatar e prévia criados uma vez');
  const avatarVideo=s1.avatar.children[0],previewVideo=nodes.cameraSelfPreview.children.find(e=>e.id==='video');
  const myStream=previewVideo.srcObject;
  assert(myStream&&myStream===avatarVideo.srcObject);
  const before={plays:previewVideo.plays,assigns:previewVideo.sourceAssigns,clamps:counters.previewReclamps};
  for(let i=0;i<100;i++){
    window.MauCamera.renderIntoSeats();window.MauCamera.onState();
  }
  assert.equal(previewVideo.plays,before.plays,'não repetir play da prévia');
  assert.equal(previewVideo.sourceAssigns,before.assigns,'não reatribuir srcObject');
  assert.equal(counters.previewReclamps,before.clamps,'não reposicionar preview durante estado estável');
  // Se autoplay ficar pausado/bloqueado, um lote de states não pode iniciar
  // dezenas de novas tentativas de play(). A próxima tentativa é temporizada.
  previewVideo.paused=true;
  const attemptsBefore=previewVideo.plays;
  for(let i=0;i<40;i++)window.MauCamera.renderIntoSeats();
  assert.equal(previewVideo.plays,attemptsBefore,'autoplay pausado não deve gerar tentativas em rajada');
  assert.equal(counters.buttonReclamps,1,'botão sem relayout repetido');
  assert.strictEqual(s1.avatar.children[0],avatarVideo,'vídeo da câmera deve permanecer anexado');
  // Um único DOM query por atualização de assentos, mesmo com vídeos de 2 usuários.
  const remote={mediaStreamTrack:{id:'remote-track-1'}};
  activeRoom.handlers.get('sub')({kind:'video',mediaStreamTrack:remote.mediaStreamTrack},null,{identity:'p_p2'});
  const remoteElement=s2.avatar.children.find(v=>v.id==='video');
  assert(remoteElement,'vídeo remoto anexado ao adversário');
  const videoCount=createdVideos;
  activeRoom.handlers.get('sub')({kind:'video',mediaStreamTrack:remote.mediaStreamTrack},null,{identity:'p_p2'});
  assert.equal(createdVideos,videoCount,'mesma faixa remota não deve recriar vídeo');
  assert.strictEqual(s2.avatar.children.find(v=>v.id==='video'),remoteElement);
  const queriesBefore=seatQueries;
  for(let i=0;i<20;i++)window.MauCamera.renderIntoSeats();
  assert.equal(seatQueries-queriesBefore,20,'deve consultar assentos uma vez, não por vídeo');
  // Ao mudar realmente o stream, a prévia precisa ser atualizada.
  localTrack.mediaStreamTrack={id:'local-track-2',getSettings(){return {facingMode:'user'}}};
  // A troca real é exercitada pela suíte antiga; aqui validamos a limpeza ao sair.
  window.MauCamera.stop();
  assert.equal(nodes.cameraSelfPreview.children.some(v=>v.id==='video'),false,'prévia removida ao sair');
  assert.equal(avatarVideo.srcObject,null,'stream local liberado');
  assert.equal(remoteElement.srcObject,null,'stream remoto liberado');
  console.log('✓ Fase 2B: prévia, DOM dos vídeos, relayout, faixas repetidas e encerramento de câmera.');
})().catch(err=>{console.error(err);process.exitCode=1});

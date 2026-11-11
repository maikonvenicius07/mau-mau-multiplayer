'use strict';
/* Contratos executáveis em memória. A recepção real requer dois navegadores + LiveKit/TURN. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const sessions=fs.readFileSync(path.join(root,'public/media-session.js'),'utf8');
const cameraSource=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
function element(id,classes=[]){
  const cls=new Set(classes),listeners={};
  const e={id,disabled:false,style:{},dataset:{},textContent:'',title:'',parentElement:null,children:[],srcObject:null,paused:true,
    classList:{contains:v=>cls.has(v),add:v=>cls.add(v),remove:v=>cls.delete(v),toggle(v,on){
      if(on===undefined? !cls.has(v):on)cls.add(v);else cls.delete(v);
      return cls.has(v);
    }},
    setAttribute(){},removeAttribute(){},focus(){},closest(){return null},
    addEventListener(name,fn){(listeners[name]??=[]).push(fn)},
    async click(){for(const fn of listeners.click||[])await fn({target:this,preventDefault(){},stopPropagation(){}})},
    appendChild(child){if(child.parentElement)child.remove();this.children.push(child);child.parentElement=this;return child},
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(v=>v!==this);this.parentElement=null},
    pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()},
  };
  return e;
}
function newSession(storage){
  const els={mediaRestorePrompt:element('mediaRestorePrompt',['hidden']),mediaRestoreBtn:element('mediaRestoreBtn'),
    mediaRestoreDetail:element('mediaRestoreDetail')};
  const window={sessionStorage:storage,document:{getElementById:id=>els[id]||null}};
  vm.runInNewContext(sessions,{window,document:window.document,console,Math,Map,Set});
  return{session:window.MauMediaSession,els};
}
function storage(){const map=new Map();return{getItem:k=>map.has(k)?map.get(k):null,
  setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)}}
async function testSession(){
  const box=storage();let x=newSession(box);
  assert.deepEqual({...x.session.joined('ROOM-A','account-one')},{mic:false,camera:false});
  x.session.setDesired('mic',true);x.session.setDesired('camera',true);
  assert(!box.getItem('maumauMediaSessionV1').includes('account-one'),'não salvar identificador em claro');
  x=newSession(box); // F5: novo contexto JavaScript, mesmo sessionStorage.
  assert.deepEqual({...x.session.joined('ROOM-A','account-one')},{mic:true,camera:true},'F5 restaura ambas preferências');
  const calls=[];
  x.session.configure({mic:async()=>{calls.push('mic');x.session.ready('mic')},camera:async()=>{calls.push('camera');x.session.ready('camera')}});
  x.session.failed('mic','Permissão exigida');x.session.failed('camera','Câmera bloqueada');
  assert.equal(x.els.mediaRestorePrompt.classList.contains('hidden'),false);
  assert.equal(x.els.mediaRestoreBtn.textContent,'Restaurar câmera e microfone');
  await x.els.mediaRestoreBtn.click();
  assert.deepEqual(calls,['mic','camera'],'um único toque restaura ambos');
  assert.equal(x.els.mediaRestorePrompt.classList.contains('hidden'),true);
  x.session.setDesired('mic',false);
  x=newSession(box);
  assert.deepEqual({...x.session.joined('ROOM-A','account-one')},{mic:false,camera:true},'desligar é preservado');
  assert.deepEqual({...x.session.joined('ROOM-B','account-one')},{mic:false,camera:false},'nova sala não liga mídia antiga');
  assert.deepEqual({...x.session.joined('ROOM-A','account-two')},{mic:false,camera:false},'outra conta não herda mídia');
  x.session.clear();assert.equal(box.getItem('maumauMediaSessionV1'),null);
}
function makeCamera(){
  const els={};for(const id of ['liveCameraBtn','liveCameraLabel','cameraSwitchBtn','cameraSelfPreview',
    'cameraOpponentOverlay','cameraOpponentExpandedVideo','cameraOpponentClose','cameraOpponentName'])els[id]=element(id,['hidden']);
  const mySeat=element('my-seat'),remoteSeat=element('remote-seat'),myAvatar=element('my-avatar'),remoteAvatar=element('remote-avatar');
  mySeat.dataset.cameraPlayerId='me';remoteSeat.dataset.cameraPlayerId='other';
  mySeat.style.left='50';remoteSeat.style.left='74';
  for(const [seat,avatar] of [[mySeat,myAvatar],[remoteSeat,remoteAvatar]]){
    seat.querySelector=()=>avatar;
    avatar.closest=selector=>selector==='.player-seat'?seat:selector==='.player-card'?element('player-card'):null;
  }
  els.playersRing=element('playersRing');els.playersRing.querySelectorAll=()=>[mySeat,remoteSeat];
  let enabled=false,failPermission=false,created=0,attempts=0;
  let currentRoom;
  const trackListeners=new Map();
  const track={id:'v1',readyState:'live',enabled:true,muted:false,getSettings:()=>({facingMode:'user'}),
    addEventListener(kind,fn){trackListeners.set(kind,fn)}};
  const published={mediaStreamTrack:track};
  const sdk={Track:{Source:{Camera:'camera'},Kind:{Video:'video'}},
    RoomEvent:{TrackSubscribed:'sub',TrackUnsubscribed:'unsub',ParticipantDisconnected:'gone',Disconnected:'disconnected',Reconnected:'reconnected'},
    Room:class{
      constructor(){created++;this.state='disconnected';this.handlers=new Map();currentRoom=this;
        this.localParticipant={getTrackPublication:()=>enabled?{track:published}:null,
          setCameraEnabled:async on=>{
            attempts++;
            if(on&&failPermission){const err=new Error('Negado');err.name='NotAllowedError';throw err}
            enabled=on;track.enabled=on;if(on)track.muted=false;
          }};
      }
      on(k,fn){this.handlers.set(k,fn)}
      async connect(){this.state='connected'}
      async disconnect(){this.state='disconnected';enabled=false}
    }};
  let connected=true;
  const sent=[],wanted=[],blocked=[],success=[];
  const socket={get connected(){return connected},on(){},emit(k,p){sent.push([k,p])},
    timeout(){return{emit(_event,_request,ack){ack(null,{ok:true,url:'wss://local.invalid',token:'mock'})}}}};
  const state={code:'ROOM-A',viewerRole:'PLAYER',me:{id:'me',role:'PLAYER'},players:[
    {id:'me',connected:true},{id:'other',connected:true}]};
  const pageEvents=new Map();
  const win={LivekitClient:sdk,innerWidth:500,MauCameraFloating:{reclamp(){}},addEventListener(kind,fn){pageEvents.set(kind,fn)},
    matchMedia:()=>({matches:true}),MauMediaSession:{setDesired(...args){wanted.push(args)},
      failed(...args){blocked.push(args)},ready(...args){success.push(args)}}};
  let tasks=[],tid=0;
  const clock={set(fn){const t={fn,id:++tid};tasks.push(t);return t.id},clear(id){tasks=tasks.filter(t=>t.id!==id)},async tick(){
    const batch=tasks;tasks=[];for(const task of batch)task.fn();
    for(let i=0;i<20;i++)await Promise.resolve();
  },get pending(){return tasks.length}};
  const documentEvents=new Map();
  const document={visibilityState:'visible',getElementById:id=>els[id]||null,querySelectorAll:()=>[],createElement:tag=>element(tag),
    head:{appendChild(){}},addEventListener(name,fn){documentEvents.set(name,fn)}};
  class MediaStream{constructor(tracks){this.tracks=tracks}}
  vm.runInNewContext(cameraSource,{window:win,document,socket,console,MediaStream,navigator:{userAgent:'iPhone',mediaDevices:{}},
    fetch:async()=>({json:async()=>({enabled:true})}),setTimeout:fn=>clock.set(fn),clearTimeout:id=>clock.clear(id),
    Promise,Set,Map,String,Number,Date});
  return {api:win.MauCamera,els,clock,socket,state,myAvatar,remoteAvatar,track,wanted,blocked,success,sent,
    stats:()=>({created,attempts,enabled,room:currentRoom}),online(value){connected=value},deny(value){failPermission=value},
    pageEvent(name){assert(pageEvents.has(name),`handler ${name} ausente`);return pageEvents.get(name)({persisted:true})},
    visible(value){document.visibilityState=value?'visible':'hidden';documentEvents.get('visibilitychange')?.()},
    trackEvent(name){trackListeners.get(name)?.()},
    async init(){await win.MauCamera.init(socket,{getState:()=>state,toast:()=>{}})}};
}
async function testCamera(){
  const c=makeCamera();await c.init();
  c.api.onJoined('ROOM-A',{role:'PLAYER',restoreCamera:false});
  assert.equal(c.clock.pending,0,'inicialmente desligada continua desligada');
  await c.els.liveCameraBtn.click();
  assert.equal(c.stats().enabled,true);assert.equal(c.stats().attempts,1);
  assert(c.sent.some(([k,p])=>k==='cameraPublishState'&&p?.active===true),'servidor só anuncia câmera após captura');
  assert.equal(c.myAvatar.children.length,1,'prévia local recebe track');
  const remoteTrack={mediaStreamTrack:{id:'v2',readyState:'live'}};
  c.stats().room.handlers.get('sub')({kind:'video',...remoteTrack},null,{identity:'p_other'});
  assert.equal(c.remoteAvatar.children.length,1,'vídeo recebido do outro jogador');
  c.online(false);c.api.stop({keepWanted:true});
  assert.equal(c.stats().enabled,false,'parada desconecta hardware');
  c.online(true);c.api.onJoined('ROOM-A',{role:'PLAYER',restoreCamera:true});
  await c.clock.tick();
  assert.equal(c.stats().enabled,true,'reentrada da sala republica câmera');
  assert.equal(c.stats().attempts,2,'um único setCameraEnabled(true) após reconexão');
  await Promise.all([c.api.restore(),c.api.restore(),c.api.restore()]);
  assert.equal(c.stats().created,2,'sem salas/transmissões duplicadas');
  // Desconexão inesperada de LiveKit recupera a publicação sem aguardar estado do jogo.
  c.stats().room.handlers.get('disconnected')();
  await c.clock.tick();
  assert.equal(c.stats().enabled,true,'LiveKit reconectado e republicado');
  // O LiveKit pode reconectar sem evento joined do Socket.IO.
  const announces=c.sent.filter(([event,value])=>event==='cameraPublishState'&&value?.active).length;
  c.stats().room.handlers.get('reconnected')();
  assert.equal(c.sent.filter(([event,value])=>event==='cameraPublishState'&&value?.active).length,announces+1,
    'LiveKit reconnected reafirma publicação com trilha ativa');
  // Safari/iOS: restauração do bfcache não dispara joined quando o socket permaneceu aberto.
  c.pageEvent('pagehide');
  assert.equal(c.stats().enabled,false,'pagehide libera câmera e LiveKit');
  const beforePageRestore=c.stats().attempts;
  c.pageEvent('pageshow');
  await c.clock.tick();
  assert.equal(c.stats().enabled,true,'pageshow recupera câmera sem joined adicional');
  assert.equal(c.stats().attempts,beforePageRestore+1,'somente uma republicação no retorno do bfcache');
  c.pageEvent('pageshow');
  await c.clock.tick();
  assert.equal(c.stats().attempts,beforePageRestore+1,'pageshow repetido não duplica vídeo');
  c.pageEvent('pagehide');
  c.online(false);
  const beforeOfflineReturn=c.stats().attempts;
  c.pageEvent('pageshow');
  await c.clock.tick();
  assert.equal(c.stats().attempts,beforeOfflineReturn,'sem Socket.IO não publica antes de reentrar na sala');
  c.online(true);
  c.api.onJoined('ROOM-A',{role:'PLAYER',restoreCamera:true});
  await c.clock.tick();
  assert.equal(c.stats().enabled,true,'reentrada posterior restaura câmera após pageshow offline');
  await c.els.liveCameraBtn.click(); // desligamento voluntário
  const count=c.stats().attempts;
  c.api.stop({keepWanted:true});c.api.onJoined('ROOM-A',{role:'PLAYER',restoreCamera:false});
  await c.clock.tick();assert.equal(c.stats().attempts,count,'desligamento voluntário não reativa mídia');
  assert(c.wanted.some(([device,on])=>device==='camera'&&on===false));
  // Permissão do navegador bloqueada: notifica e espera clique, sem loop.
  c.deny(true);c.api.onJoined('ROOM-A',{role:'PLAYER',restoreCamera:true});
  await c.clock.tick();
  assert(c.blocked.some(([kind,reason])=>kind==='camera'&&/Autorize/.test(reason)));
  assert.equal(c.clock.pending,0,'bloqueio não inicia tentativas infinitas');
  c.deny(false);await c.api.restore({userGesture:true});
  assert.equal(c.stats().enabled,true,'um toque depois da permissão republica vídeo');
  assert(c.success.some(([kind])=>kind==='camera'));
  // Navegadores móveis podem silenciar a captura sem terminar a track nem
  // disparar pagehide. O indicador não deve mentir e o retorno tenta recuperar.
  c.visible(false);c.track.muted=true;c.trackEvent('mute');
  assert.equal(c.els.liveCameraBtn.classList.contains('camera-on'),false,
    'vídeo silenciado em segundo plano não aparece como transmissão ativa');
  assert.equal(c.clock.pending,0,'não solicitar nova captura enquanto a página está oculta');
  const previousAttempts=c.stats().attempts;
  c.visible(true);await c.clock.tick(); // check ao voltar: detecta muted
  assert.equal(c.els.liveCameraBtn.classList.contains('camera-on'),false);
  await c.clock.tick(); // desativa a track anterior e publica uma nova
  assert.equal(c.stats().enabled,true,'captura deve ser recuperada ao voltar ao primeiro plano');
  assert.equal(c.track.muted,false,'nova captura elimina estado de vídeo silenciado no mock');
  assert.equal(c.stats().attempts,previousAttempts+2,'um desligamento e uma republicação, sem duplicidade');
  c.pageEvent('pageshow');await c.clock.tick();
  assert.equal(c.stats().attempts,previousAttempts+2,'pageshow com mídia saudável não reinicia a câmera');
  await c.els.liveCameraBtn.click();
  c.visible(false);c.visible(true);await c.clock.tick();
  assert.equal(c.clock.pending,0,'desligamento voluntário não agenda recuperação da câmera');
}

async function testMicrophone(){
  const received=[],stopped=[],errors=[],issued=[];
  let sequence=0,denied=false,configFail=false;
  const ctx=vm.createContext({
    window:{MauMediaSession:{ready:kind=>received.push(kind),failed:(...args)=>errors.push(args),setDesired:()=>{}}},
    navigator:{mediaDevices:{getUserMedia(){
      if(denied)return Promise.reject(Object.assign(new Error('no permission'),{name:'NotAllowedError'}));
      const track={readyState:'live',enabled:true,onended:null,stop(){this.readyState='ended';stopped.push(this)}};
      return Promise.resolve({getAudioTracks:()=>[track],getTracks:()=>[track]});
    }}},
    socket:{connected:true,id:'local-socket',emit(...parts){issued.push(parts)}},
    state:{me:{id:'p1'}},voiceRecorder:null,
    liveVoiceSupported:()=>true,loadLiveVoiceRtcConfig:async()=>{if(configFail)throw new Error('Config indisponível')},liveVoiceAudioConstraints:()=>({audio:true}),
    liveVoiceSession:()=>`voice-session-${++sequence}`,updateLiveMicUI:()=>{},syncLiveVoiceRelayCapture:()=>{},
    clearLiveMicRestartTimer:()=>{},refreshQuickAudioMusicDuck:()=>{},requestUnhealthyInboundLiveVoiceRefresh:()=>{},
    isSpectatorState:()=>false,toast:()=>{},scheduleLiveMicRestart:()=>{},closeOutboundLivePeer:()=>{},
    stopLiveVoiceRelayCapture:()=>{},renderPlayers:()=>{},renderSpectatorLivePanel:()=>{},
    clearTimeout:()=>{},liveMicOutboundPeers:new Map(),liveMicPeerInfo:new Map(),
    liveVoiceRelayFallbackPeers:new Set(),liveVoiceConnectTimers:new Map(),
    liveVoiceRelayPlaybackNext:new Map(),liveVoiceRelayJitterState:new Map(),liveVoiceActivePlayerIds:new Set(),
  });
  const from=app.indexOf('async function startLiveMic('),to=app.indexOf('function resetLiveVoice(',from);
  assert(from!==-1&&to>from);
  vm.runInContext(`let liveMicOn=false,liveMicStarting=false,liveMicStream=null,liveMicSessionId=null,liveMicWanted=true;
    let liveMicCaptureRequestId=0,liveMicRestartAttempts=0,liveVoiceTransportRecoveryTimer=null;
    ${app.slice(from,to)}`,ctx);
  await vm.runInContext("startLiveMic({recovery:true,reason:'room-rejoined'})",ctx);
  assert.equal(sequence,1);
  assert.equal(vm.runInContext('liveMicOn',ctx),true);
  assert.equal(issued.filter(([k])=>k==='liveVoiceJoin').length,1,'microfone anuncia presença após capturar');
  assert.equal(received.includes('mic'),true);
  vm.runInContext('stopLiveMic({notify:false,keepWanted:true})',ctx);
  assert.equal(stopped.length,1,'quebra da rede libera faixas antigas');
  assert.equal(vm.runInContext('liveMicWanted',ctx),true,'reconexão preserva intenção');
  await vm.runInContext("startLiveMic({recovery:true,reason:'room-rejoined'})",ctx);
  assert.equal(sequence,2,'nova sessão WebRTC ao retornar');
  assert.equal(issued.filter(([k])=>k==='liveVoiceJoin').length,2,'novo remetente anunciado ao servidor');
  vm.runInContext('stopLiveMic({notify:true,keepWanted:false})',ctx);
  assert.equal(stopped.length,2);
  assert.equal(vm.runInContext('liveMicWanted',ctx),false,'desligamento voluntário não agenda reinício');
  denied=true;
  await vm.runInContext('startLiveMic()',ctx);
  assert.equal(vm.runInContext('liveMicOn',ctx),false,'sem ícone ativo para captura negada');
  assert(errors.some(([kind])=>kind==='mic'),'bloqueio oferece recuperação manual');
  denied=false;configFail=true;
  const tracksStoppedBeforeConfigFailure=stopped.length;
  await vm.runInContext('startLiveMic()',ctx);
  assert.equal(stopped.length,tracksStoppedBeforeConfigFailure+1,
    'falha na configuração concorrente deve encerrar getUserMedia já concedido');
  assert.equal(vm.runInContext('liveMicOn',ctx),false,'configuração com falha não anuncia microfone ativo');
  configFail=false;
  await vm.runInContext("startLiveMic({recovery:true,reason:'user-gesture'})",ctx);
  assert.equal(vm.runInContext('liveMicOn',ctx),true,'novo gesto recupera microfone após falha');
  vm.runInContext('stopLiveMic({notify:false})',ctx);
}
async function testOutboundVoicePeer(){
  let created=0,trackAdds=0;
  const signaling=[];
  const peers=new Map(),peerInfo=new Map();
  const socket={id:'self',connected:true};
  const audioTrack={readyState:'live'};
  const ctx=vm.createContext({
    socket,liveMicOn:true,liveMicStream:{getAudioTracks:()=>[audioTrack]},
    liveMicSessionId:'session-a',liveMicPeerInfo:peerInfo,liveMicOutboundPeers:peers,
    LIVE_VOICE_RTC_MAX_PEERS:6,loadLiveVoiceRtcConfig:async()=>{},
    newLiveVoicePeer(){created++;return{
      addTrack(track){assert.equal(track,audioTrack);trackAdds++;return {}},
      createOffer:async()=>({type:'offer',sdp:'mock-sdp'}),
      async setLocalDescription(offer){this.localDescription=offer},
    }},
    bindOutboundLivePeerHealth:()=>{},scheduleLiveVoiceConnectTimeout:()=>{},tuneLiveVoiceSender:()=>{},
    signalLiveVoice:(...args)=>signaling.push(args),setLiveVoiceRelayFallback:()=>{},
    closeOutboundLivePeer:()=>{},scheduleOutboundLiveVoiceRecovery:()=>{},updateLiveMicUI:()=>{},
  });
  const from=app.indexOf('async function createOutboundLivePeer('),to=app.indexOf('async function acceptInboundLiveOffer(',from);
  vm.runInContext(app.slice(from,to),ctx);
  await vm.runInContext("createOutboundLivePeer({socketId:'remote'})",ctx);
  await vm.runInContext("createOutboundLivePeer({socketId:'remote'})",ctx);
  assert.equal(created,1,'peers duplicados bloqueados');
  assert.equal(trackAdds,1,'cada destinatário recebe somente uma track de áudio');
  assert(signaling.some(([,kind,,sessionId])=>kind==='offer'&&sessionId==='session-a'));
  peers.clear();peerInfo.clear();
  vm.runInContext("liveMicSessionId='session-b'",ctx);
  await vm.runInContext("createOutboundLivePeer({socketId:'remote'})",ctx);
  assert.equal(created,2,'remetente recriado após sessão nova');
  assert.equal(trackAdds,2,'faixa republicada na nova conexão');
  assert(signaling.some(([,kind,,sessionId])=>kind==='offer'&&sessionId==='session-b'));
}
(async()=>{
  assert(html.includes('media-session.js')&&html.includes('id="mediaRestoreBtn"'));
  assert(css.includes('.media-restore-prompt.hidden'));
  assert(app.includes("MauMediaSession?.joined(data.code,permanentPlayerKey())"));
  assert(app.includes('stop({keepWanted:true})'));
  assert(app.includes("startLiveMic({recovery:true,reason:'room-rejoined'})"));
  assert(app.includes('socket.emit(\'liveVoiceJoin\')'));
  assert(app.includes('closeOtherInboundLivePeers(from,key)'));
  await testSession();await testCamera();await testMicrophone();await testOutboundVoicePeer();
  console.log('✓ Reconexão de mídia: F5, bfcache iOS, LiveKit reconnected, tracks liberadas em falhas, reconexão e bloqueio.');
})().catch(error=>{console.error(error);process.exitCode=1});

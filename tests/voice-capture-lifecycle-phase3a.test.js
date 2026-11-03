'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function portion(from,to){
  const begin=source.indexOf(from),end=source.indexOf(to,begin+from.length);
  assert(begin>=0&&end>begin,`trecho não encontrado: ${from}`);
  return source.slice(begin,end);
}
function deferred(){let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no});return{promise,resolve,reject}}
function stream(){
  const track={stopped:0,stop(){this.stopped++},onended:null};
  return{track,getTracks(){return[track]},getAudioTracks(){return[track]}};
}
async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve()}

async function microphoneLifecycle(){
  const requests=[],emitted=[];
  const ctx=vm.createContext({
    navigator:{mediaDevices:{getUserMedia(){const d=deferred();requests.push(d);return d.promise}}},
    socket:{connected:true,id:'local',emit(...args){emitted.push(args)}},
    state:{me:{id:'local-player'}},voiceRecorder:null,
    liveVoiceSupported:()=>true,loadLiveVoiceRtcConfig:async()=>{},
    liveVoiceAudioConstraints:()=>({audio:true}),liveVoiceSession:()=>`session-${emitted.length+1}`,
    updateLiveMicUI:()=>{},syncLiveVoiceRelayCapture:()=>{},
    clearLiveMicRestartTimer:()=>{},refreshQuickAudioMusicDuck:()=>{},
    requestUnhealthyInboundLiveVoiceRefresh:()=>{},isSpectatorState:()=>false,
    toast:()=>{},scheduleLiveMicRestart:()=>{},closeOutboundLivePeer:()=>{},
    stopLiveVoiceRelayCapture:()=>{},renderPlayers:()=>{},renderSpectatorLivePanel:()=>{},
    clearTimeout:()=>{},liveMicOutboundPeers:new Map(),liveMicPeerInfo:new Map(),
    liveVoiceRelayFallbackPeers:new Set(),liveVoiceConnectTimers:new Map(),
    liveVoiceRelayPlaybackNext:new Map(),liveVoiceRelayJitterState:new Map(),
    liveVoiceActivePlayerIds:new Set(),
  });
  vm.runInContext(`let liveMicOn=false,liveMicStarting=false,liveMicStream=null,liveMicSessionId=null,liveMicWanted=false;
    let liveMicCaptureRequestId=0,liveMicRestartAttempts=0,liveVoiceTransportRecoveryTimer=null;
    ${portion('async function startLiveMic(', 'function resetLiveVoice(')}`,ctx);
  // Permissão concedida depois de sair: descartar a track, não ligar microfone.
  const first=vm.runInContext('startLiveMic()',ctx);
  await flush();assert.equal(requests.length,1);
  vm.runInContext('stopLiveMic({notify:false})',ctx);
  const oldStream=stream();requests[0].resolve(oldStream);await first;
  assert.equal(oldStream.track.stopped,1,'track da captura cancelada deve ser encerrada');
  assert.equal(vm.runInContext('liveMicOn',ctx),false,'captura antiga não deve religar o microfone');
  assert.equal(emitted.filter(([name])=>name==='liveVoiceJoin').length,0);

  // Nova captura durante uma solicitação anterior pendente: a anterior não toma o lugar da nova.
  const delayed=vm.runInContext('startLiveMic()',ctx);await flush();
  vm.runInContext('stopLiveMic({notify:false})',ctx);
  const fresh=vm.runInContext('startLiveMic()',ctx);await flush();
  assert.equal(requests.length,3);
  const freshStream=stream();requests[2].resolve(freshStream);await fresh;
  assert.equal(vm.runInContext('liveMicOn',ctx),true);
  const staleStream=stream();requests[1].resolve(staleStream);await delayed;
  assert.equal(staleStream.track.stopped,1);
  assert.equal(freshStream.track.stopped,0);
  assert.equal(vm.runInContext('liveMicStream',ctx),freshStream);
  assert.equal(emitted.filter(([name])=>name==='liveVoiceJoin').length,1);
  vm.runInContext('stopLiveMic({notify:false})',ctx);
  assert.equal(freshStream.track.stopped,1);
}

async function quickAudioLifecycle(){
  const requests=[];let recorderStarts=0;
  class MockMediaRecorder{
    constructor(s){this.stream=s;this.state='inactive';this.mimeType='audio/webm'}
    start(){recorderStarts++;this.state='recording'}
    stop(){this.state='inactive';this.onstop?.()}
  }
  const ui={classList:{add(){},remove(){}},textContent:'',disabled:false};
  const ctx=vm.createContext({
    navigator:{mediaDevices:{getUserMedia(){const d=deferred();requests.push(d);return d.promise}}},
    socket:{connected:true},state:{me:{id:'a'}},MediaRecorder:MockMediaRecorder,
    '$':()=>ui,liveMicOn:false,liveMicStream:null,liveVoiceAudioConstraints:()=>({audio:true}),
    quickAudioSupported:()=>true,quickAudioMime:()=>'',isSpectatorState:()=>false,
    clearVoiceDraft:()=>{},setVoiceIdleUI:()=>{},refreshQuickAudioMusicDuck:()=>{},
    clearVoiceTimers:()=>{},stopVoiceTracks:()=>{},formatRecordClock:()=>'',
    finishVoiceRecording:()=>{},toast:()=>{},Date,QUICK_AUDIO_MAX_MS:15000,
    setInterval:()=>1,setTimeout:()=>2,
  });
  vm.runInContext(`let voiceRecorder=null,voiceStream=null,voiceChunks=[],voiceStartedAt=0,voiceTickTimer=null,voiceMaxTimer=null,voiceCancelOnStop=false;
    let voiceCaptureRequestId=0,voiceCaptureStarting=false;
    ${portion('async function startQuickAudio()', 'async function sendVoiceDraft()')}`,ctx);
  const first=vm.runInContext('startQuickAudio()',ctx);
  await flush();
  const duplicate=vm.runInContext('startQuickAudio()',ctx);await duplicate;
  assert.equal(requests.length,1,'duplo toque não pode pedir dois microfones');
  vm.runInContext('stopQuickAudio(true)',ctx);
  const cancelledStream=stream();requests[0].resolve(cancelledStream);await first;
  assert.equal(cancelledStream.track.stopped,1,'a captura pendente cancelada deve liberar o microfone');
  assert.equal(recorderStarts,0);

  const next=vm.runInContext('startQuickAudio()',ctx);await flush();
  const ok=stream();requests[1].resolve(ok);await next;
  assert.equal(recorderStarts,1,'gravação nova deve iniciar normalmente');
  assert.equal(vm.runInContext('voiceRecorder.state',ctx),'recording');
  vm.runInContext('stopQuickAudio(true)',ctx);
  assert.equal(vm.runInContext('voiceRecorder.state',ctx),'inactive');
}

async function outboundPeerLifecycle(){
  const config=deferred();let created=0;
  const ctx=vm.createContext({
    socket:{id:'self',connected:true},liveMicOn:true,
    liveMicStream:stream(),liveMicSessionId:'session-old',
    liveMicPeerInfo:new Map(),liveMicOutboundPeers:new Map(),
    LIVE_VOICE_RTC_MAX_PEERS:6,loadLiveVoiceRtcConfig:()=>config.promise,
    newLiveVoicePeer(){created++;throw new Error('PC deveria ser descartado')},
    setLiveVoiceRelayFallback:()=>{},
  });
  vm.runInContext(portion('async function createOutboundLivePeer(', 'async function acceptInboundLiveOffer('),ctx);
  const pending=vm.runInContext("createOutboundLivePeer({socketId:'other',name:'Pessoa'})",ctx);
  await flush();vm.runInContext('liveMicOn=false;liveMicStream=null;liveMicSessionId=null;liveMicPeerInfo.clear()',ctx);
  config.resolve();await pending;
  assert.equal(created,0,'não criar RTCPeerConnection depois de desligar o microfone');
}

(async()=>{
  await microphoneLifecycle();
  await quickAudioLifecycle();
  await outboundPeerLifecycle();
  assert(source.includes("if(voiceCaptureStarting){voiceCaptureRequestId++;voiceCaptureStarting=false}"),'desconexão deve invalidar getUserMedia pendente do Áudio Rápido');
  console.log('✓ Fase 3A: permissão tardia, duplo toque, saída/reentrada e WebRTC obsoleto protegidos.');
})().catch(e=>{console.error(e);process.exitCode=1});

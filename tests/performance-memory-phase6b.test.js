'use strict';
// Fase 6B — regressões de limpeza em memória sem acesso a microfone, rede ou banco.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

function segment(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,`Trecho ausente: ${start}`);
  return source.slice(a,b);
}

async function testRtcStats(){
  const inbound=new Map(),health=new Map();
  let calls=0,resolveSlow;
  const slowPc={getStats(){calls++;return new Promise(resolve=>{resolveSlow=resolve})}};
  inbound.set('socket-old:session',slowPc);
  const context={Map,Number,String,Date,liveMicInboundPeers:inbound,liveVoiceInboundRtpHealth:health,
    liveVoiceInboundRtpHealthSampling:false};
  vm.createContext(context);
  vm.runInContext(segment('async function sampleLiveVoiceInboundRtpHealth(){','function syncLiveVoiceInboundRtpHealthMonitor(){'),context);
  const first=context.sampleLiveVoiceInboundRtpHealth();
  const second=context.sampleLiveVoiceInboundRtpHealth();
  assert.equal(calls,1,'getStats não deve executar em paralelo para o mesmo monitor');
  inbound.delete('socket-old:session');
  resolveSlow([{type:'inbound-rtp',kind:'audio',bytesReceived:800,packetsReceived:8}]);
  await Promise.all([first,second]);
  assert.equal(health.has('socket-old'),false,'resultado de peer removido não pode reter estado');
  const freshPc={async getStats(){calls++;return [{type:'inbound-rtp',kind:'audio',bytesReceived:200,packetsReceived:2}]}};
  inbound.set('socket-new:session',freshPc);
  await context.sampleLiveVoiceInboundRtpHealth();
  assert.equal(health.get('socket-new').bytes,200,'monitor deve continuar após a coleta antiga');
  assert.equal(calls,2);
  inbound.delete('socket-new:session');health.clear();
  await context.sampleLiveVoiceInboundRtpHealth();
  assert.equal(health.size,0,'sem peers, monitor não cria referências');
}

function testChatAudioUrl(){
  const revoked=[];let renders=0;
  const context={
    chatMessages:[{id:'voice-old',kind:'voice',audioUrl:'blob:old'}],
    URL:{revokeObjectURL:url=>revoked.push(url)},
    socket:{on(name,callback){assert.equal(name,'chatMessage');this.receive=callback}},
    state:{me:{id:'me'}},
    isSpectatorState:()=>false,
    $:()=>({classList:{contains:()=>false}}),
    activeSideTab:'log',unreadChat:0,
    renderChat(){renders++},renderChatBadge(){},playGameSound(){},
  };
  for(let i=1;i<60;i++)context.chatMessages.push({id:`msg-${i}`,text:'oi'});
  vm.createContext(context);
  vm.runInContext(segment("socket.on('chatMessage',message=>{","socket.on('voiceMessage',message=>{"),context);
  context.socket.receive({playerId:'me',text:'nova mensagem'});
  assert.equal(context.chatMessages.length,60);
  assert.deepEqual(revoked,['blob:old'],'uma mensagem de texto deve liberar o Blob antigo');
  assert.equal(renders,1,'chat continua renderizando normalmente');
  context.socket.receive({playerId:'me',text:'mais uma'});
  assert.deepEqual(revoked,['blob:old'],'texto comum não deve liberar URLs inexistentes');
}

(async()=>{
  await testRtcStats();
  testChatAudioUrl();
  console.log('✓ Fase 6B: coleta WebRTC sem sobreposição/resultado obsoleto e liberação de Blob no chat.');
})().catch(error=>{console.error(error);process.exitCode=1});

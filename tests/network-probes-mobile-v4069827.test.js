'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const start=src.indexOf('const NETWORK_PROBE_INTERVAL_MS=');
const end=src.indexOf('const AVATAR_ASSET_CACHE_MAX=',start);
const fnStart=src.indexOf('function runNetworkProbe(){');
const fnEnd=src.indexOf('function vibrationSupported(){',fnStart);
assert.ok(start>0&&end>start&&fnStart>0&&fnEnd>fnStart);
const emits=[],intervals=[],timeouts=[],events={};
const dialog={open:false,showModal(){this.open=true;}};
const context={
  console,
  Map,Set,Date,TextEncoder,
  socket:{connected:true,io:{engine:{transport:{name:'websocket'}}},timeout(){return this},emit(name,payload,ack){emits.push({name,payload,ack});}},
  document:{visibilityState:'visible',getElementById(id){return id==='networkDiagnosticsDialog'?dialog:null},addEventListener(type,cb){events[type]=cb;}},
  performance:{now(){return 100;}},
  $:()=>dialog,
  updateNetworkDiagnosticsUI(){},networkDiagnostics:{},
  recordNetworkProbe(ok,rtt){context.samples.push({ok,rtt});},samples:[],
  liveMicOutboundPeers:new Map(),liveMicInboundPeers:new Map(),
  setInterval(fn,ms){const t={fn,ms};intervals.push(t);return t;},clearInterval(){},
  setTimeout(fn,ms){const t={fn,ms};timeouts.push(t);return t;},clearTimeout(){},
};
vm.createContext(context);
// Executa o agendador real com mocks; sem construir a página ou acessar mídia.
vm.runInContext(src.slice(start,end)+'\n'+src.slice(fnStart,fnEnd),context);
context.startNetworkDiagnostics();
assert.equal(emits.length,1,'sonda inicial única');
assert.equal(intervals.length,1,'um timer de sondas');
assert.equal(intervals[0].ms,5000);
assert.equal(timeouts[0].ms,20000,'getStats não é solicitado a cada cinco segundos com modal fechado');
context.runNetworkProbe();assert.equal(emits.length,1,'não duplicar sonda pendente');
emits[0].ack(null);
assert.equal(context.samples.length,1);
context.runNetworkProbe();assert.equal(emits.length,2);
context.stopNetworkDiagnostics();
emits[1].ack(null);
assert.equal(context.samples.length,1,'ack antigo deve ser ignorado após desconexão');
context.document.visibilityState='hidden';
context.startNetworkDiagnostics();
assert.equal(emits.length,2,'sonda não deve competir com o jogo em segundo plano');
context.document.visibilityState='visible';
context.runNetworkProbe();assert.equal(emits.length,3);
context.stopNetworkDiagnostics();
dialog.open=true;
context.socket.connected=true;
context.startNetworkDiagnostics();
assert.equal(timeouts.at(-1).ms,5000,'modal aberto usa coleta detalhada de cinco segundos');
assert.ok(!/socket\.io\.on\('reconnect',\(\)=>\{[^}]*startNetworkDiagnostics\(/.test(src),
  'o evento reconnect não deve iniciar nova coleta após connect');
// O status visual é consultado em todo state; qualidade idêntica não deve
// provocar novas invalidações CSS e escrituras ARIA no navegador móvel.
const uiStart=src.indexOf('function updateNetworkDiagnosticsUI(){');
const uiEnd=src.indexOf('function recordNetworkProbe(',uiStart);
assert.ok(uiStart>0&&uiEnd>uiStart);
const names=new Set();let cssWrites=0,attributeWrites=0;
const chip={title:'',classList:{contains:n=>names.has(n),remove(...ns){cssWrites++;ns.forEach(n=>names.delete(n));},add(n){cssWrites++;names.add(n);}},
  setAttribute(){attributeWrites++;}};
const uiContext={
  networkDiagnostics:{lastRtt:60,transport:'websocket'},
  socket:{io:{engine:{transport:{name:'websocket'}}}},
  networkVoiceMode:()=> 'Desligado',networkQuality:()=>({key:'good',label:'Boa'}),
  $:selector=>selector==='#connectionChip'?chip:{open:false},
};
vm.createContext(uiContext);
vm.runInContext(src.slice(uiStart,uiEnd),uiContext);
uiContext.updateNetworkDiagnosticsUI();
const before=[cssWrites,attributeWrites];
for(let i=0;i<25;i++)uiContext.updateNetworkDiagnosticsUI();
assert.deepEqual([cssWrites,attributeWrites],before,'mesma qualidade não reescreve DOM');
uiContext.networkDiagnostics.lastRtt=85;
uiContext.updateNetworkDiagnosticsUI();
assert.equal(cssWrites,before[0],'novo RTT não altera a classe');
assert.equal(attributeWrites,before[1]+1,'novo RTT atualiza somente descrição');
async function testConcurrentRtcStats(){
  let requests=0;const releases=[];
  const peer={connectionState:'connected',getStats(){
    requests++;
    return new Promise(resolve=>releases.push(resolve));
  }};
  context.liveMicOutboundPeers.set('peer1',peer);
  context.document.visibilityState='visible';
  const first=context.sampleLiveVoiceRtcStats();
  const second=context.sampleLiveVoiceRtcStats();
  assert.equal(requests,1,'não consultar um mesmo peer em paralelo');
  context.stopNetworkDiagnostics();
  context.startNetworkDiagnostics();
  assert.equal(requests,2,'reconexão não deve ficar bloqueada por getStats anterior pendente');
  releases[0](new Map());
  await Promise.all([first,second]);
  assert.equal(vm.runInContext('networkRtcStatsInFlight',context),true,
    'amostra antiga não libera a nova amostra');
  releases[1](new Map());
  await new Promise(resolve=>setImmediate(resolve));
  context.liveMicOutboundPeers.clear();
  context.stopNetworkDiagnostics();
  assert.equal(vm.runInContext('networkRtcStatsInFlight',context),false,
    'liberar amostra após o novo getStats concluir');
}
testConcurrentRtcStats().then(()=>console.log('✓ V40.69.8.27: sondas únicas, RTC adaptativo, execução única e menos escritas DOM'))
  .catch(err=>{console.error(err);process.exitCode=1;});

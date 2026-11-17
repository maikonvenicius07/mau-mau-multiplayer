'use strict';

// Telemetria leve, sem identificadores pessoais, tokens, mãos ou conteúdo das salas.
// O agrupamento de desconexões é sempre ativo; amostragem de event loop/RSS
// é opt-in porque depende das características do plano de hospedagem.
const {monitorEventLoopDelay} = require('node:perf_hooks');

const BURST_WINDOW_MS = 6000;
const BURST_COOLDOWN_MS = 15000;
const HEALTH_SAMPLE_MS = 60000;
function safeReason(reason){
  return String(reason||'unknown').replace(/[^a-zA-Z0-9 _.-]/g,'').slice(0,40)||'unknown';
}
function createRuntimeConnectionMonitor({
  now=()=>Date.now(),
  log=record=>console.warn(JSON.stringify(record)),
  sampleEnabled=false,
  histogramFactory=()=>monitorEventLoopDelay({resolution:20}),
  memory=()=>process.memoryUsage(),
  cpuUsage=previous=>process.cpuUsage(previous),
  setIntervalFn=setInterval,
  clearIntervalFn=clearInterval,
}={}){
  const recent=[];
  let bursts=0,lastBurstAt=-Infinity,lastSample=null,sampleTimer=null,histogram=null;
  let lastCpu=null,lastCpuAt=null,shuttingDown=false;
  function recordDisconnect(reason){
    // SIGTERM esperado no deploy não equivale a queda não planejada.
    // Desconexões iniciadas explicitamente pelo servidor também não contam.
    if(shuttingDown||reason==='server namespace disconnect')return false;
    const time=now();
    recent.push({time,reason:safeReason(reason)});
    while(recent.length && time-recent[0].time>BURST_WINDOW_MS)recent.shift();
    if(recent.length<3 || time-lastBurstAt<BURST_COOLDOWN_MS)return false;
    lastBurstAt=time;bursts++;
    const reasons={};
    for(const event of recent)reasons[event.reason]=(reasons[event.reason]||0)+1;
    try{log({ts:new Date(time).toISOString(),scope:'connectivity',event:'disconnect-burst',
      count:recent.length,windowMs:BURST_WINDOW_MS,reasons});}catch{} // monitoramento não altera a conexão
    return true;
  }
  function sample(){
    if(!sampleEnabled||!histogram)return null;
    const m=memory();
    const at=now();
    const usage=cpuUsage(lastCpu||undefined);
    const duration=lastCpuAt===null?null:Math.max(1,at-lastCpuAt);
    lastCpu=cpuUsage();lastCpuAt=at;
    // cpuUsage retorna microssegundos. Pode superar 100% em múltiplos núcleos;
    // é utilização do processo, não a porcentagem total do plano Render.
    const cpuPercent=duration===null?null:Math.round(((usage.user+usage.system)/1000)/duration*1000)/10;
    const p95=Number(histogram.percentile(95))/1e6;
    const max=Number(histogram.max)/1e6;
    lastSample={rssMB:Math.round(Number(m.rss||0)/1024/1024),
      heapUsedMB:Math.round(Number(m.heapUsed||0)/1024/1024),
      cpuPercent,
      eventLoopP95Ms:Number(p95.toFixed(1)),eventLoopMaxMs:Number(max.toFixed(1))};
    histogram.reset();
    try{log({ts:new Date(now()).toISOString(),scope:'runtime',event:'minute-health',...lastSample});}catch{}
    return lastSample;
  }
  function start(){
    if(!sampleEnabled||sampleTimer)return;
    histogram=histogramFactory();histogram.enable();
    lastCpu=cpuUsage();lastCpuAt=now();
    sampleTimer=setIntervalFn(sample,HEALTH_SAMPLE_MS);
    sampleTimer?.unref?.();
  }
  function stop(){
    if(sampleTimer)clearIntervalFn(sampleTimer);
    sampleTimer=null;
    if(histogram)histogram.disable();
    histogram=null;lastCpu=null;lastCpuAt=null;
  }
  function summary(){return {disconnectBursts:bursts,lastBurstAt:Number.isFinite(lastBurstAt)?lastBurstAt:null,
    ...(lastSample?{runtime:lastSample}:{})};}
  function markShutdown(){shuttingDown=true;stop();}
  return {recordDisconnect,sample,start,stop,markShutdown,summary};
}
module.exports={createRuntimeConnectionMonitor,safeReason,BURST_WINDOW_MS,BURST_COOLDOWN_MS};

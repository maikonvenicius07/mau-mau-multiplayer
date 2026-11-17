'use strict';
const assert=require('node:assert/strict');
const {createRuntimeConnectionMonitor,safeReason}=require('../runtime-connection-monitor');

let clock=100000;
const logs=[];
const monitor=createRuntimeConnectionMonitor({now:()=>clock,log:line=>logs.push(line)});
assert.equal(monitor.recordDisconnect('transport close'),false);
clock+=900;
assert.equal(monitor.recordDisconnect('ping timeout'),false);
clock+=900;
assert.equal(monitor.recordDisconnect('transport close'),true);
assert.equal(logs.length,1);
assert.equal(logs[0].event,'disconnect-burst');
assert.equal(logs[0].count,3);
assert.deepEqual(logs[0].reasons,{'transport close':2,'ping timeout':1});
assert.ok(!JSON.stringify(logs[0]).includes('playerKey'));
assert.equal(monitor.summary().disconnectBursts,1);
clock+=1000;
assert.equal(monitor.recordDisconnect('transport close'),false,'não criar tempestade de logs');
clock+=17000;
assert.equal(monitor.recordDisconnect('transport close'),false,'descartar eventos antigos');
clock+=100;
monitor.recordDisconnect('transport close');
clock+=100;
assert.equal(monitor.recordDisconnect('transport close'),true,'registrar outro pico após cooldown');
assert.equal(monitor.summary().disconnectBursts,2);
assert.equal(safeReason('<token:abc>'), 'tokenabc');
monitor.markShutdown();
assert.equal(monitor.recordDisconnect('transport close'),false,'shutdown planejado não aparece como queda simultânea');
assert.equal(monitor.summary().disconnectBursts,2);

let tick=null,cleared=null,enabled=0,disabled=0,resets=0;
let cpuTick=0;
const runtimeLogs=[];
const histogram={enable(){enabled++;},disable(){disabled++;},reset(){resets++;},percentile(){return 8000000;},max:40000000};
const runtime=createRuntimeConnectionMonitor({sampleEnabled:true,now:()=>clock,log:line=>runtimeLogs.push(line),
  histogramFactory:()=>histogram,memory:()=>({rss:150*1024*1024,heapUsed:60*1024*1024}),
  cpuUsage:previous=>{cpuTick+=1;return previous?{user:120000,system:30000}:{user:cpuTick*120000,system:0};},
  setIntervalFn:(fn,delay)=>{assert.equal(delay,60000);tick=fn;return {unref(){}};},
  clearIntervalFn:id=>{cleared=id;}});
runtime.start();runtime.start();assert.equal(enabled,1,'não repetir timer');
clock+=60000;tick();
assert.deepEqual(runtime.summary().runtime,{rssMB:150,heapUsedMB:60,cpuPercent:0.3,eventLoopP95Ms:8,eventLoopMaxMs:40});
assert.equal(runtimeLogs[0].event,'minute-health');
assert.equal(resets,1);
runtime.stop();assert.equal(disabled,1);assert.ok(cleared);
console.log('✓ V40.69.8.27: monitoramento agregado de desconexões e event loop');

'use strict';
// V40.69.8.9: regressão do foco do chat na mesa móvel e recuperação da câmera.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const camera=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const a=app.indexOf('function focusChatInputWithoutPageJump()');
const b=app.indexOf('// Painel compacto exclusivo do Observador',a);
const c=app.indexOf('function setSideTab('),d=app.indexOf('function renderChatBadge(',c);
assert(a>=0&&b>a&&c>=0&&d>c);
assert(camera.includes("document.addEventListener?.('visibilitychange'"));
assert(camera.includes('scheduleWakeCheck(1000)'));
assert(camera.includes('mediaStreamTrack.muted===true'));
assert(html.includes('wake-v406989')&&html.includes('mobile-wake-406989'),
  'scripts atualizados precisam de cache-busting para celulares');
function element(){
  const classes=new Set();
  return {classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle(v,val){if(val)classes.add(v);else classes.delete(v)}},setAttribute(){}};
}
const elements={};for(const name of ['#sidePanel','#chatInput','#logTabBtn','#chatTabBtn','#logView','#chatView'])elements[name]=element();
const calls=[],scheduled=[];
elements['#chatInput'].focus=opts=>calls.push(opts||null);
let unreadChat=2;
const ctx={
  $:name=>elements[name],
  setTimeout(fn,delay){scheduled.push({fn,delay})},
  closePlayerAuxPanels(){elements['#sidePanel'].classList.remove('open')},
  updatePlayerAuxButtons(){},renderChatBadge(){},
  openSpectatorDrawer(){},isSpectatorState(){return false},
  playerAuxOpen:null,activeSideTab:'log',unreadChat,
};
vm.createContext(ctx);
vm.runInContext(app.slice(a,b)+app.slice(c,d),ctx);
vm.runInContext("openPlayerSide('chat',true)",ctx);
assert.equal(scheduled.length,1,'abrir chat não deve agendar foco duplicado');
scheduled.shift().fn();
assert.equal(calls.length,1);
assert.equal(calls[0].preventScroll,true,'foco do chat não deve solicitar rolagem da página');
// Caminho de abertura que passa por setSideTab também deve ter foco único.
calls.length=0;elements['#sidePanel'].classList.remove('open');vm.runInContext("setSideTab('chat',true)",ctx);
assert.equal(scheduled.length,1,'troca de aba não deve duplicar o foco');
scheduled.shift().fn();assert.equal(calls.length,1);
// Fallback de navegadores que não aceitam a opção preventScroll.
calls.length=0;elements['#chatInput'].focus=opts=>{calls.push(opts||null);if(opts)throw new TypeError('legacy')};
vm.runInContext('focusChatInputWithoutPageJump()',ctx);
assert.equal(calls.length,2,'fallback de foco sem opções continua disponível');
console.log('✓ V40.69.8.9: foco único do chat sem scroll vertical, fallback legado e verificação de retorno da câmera.');

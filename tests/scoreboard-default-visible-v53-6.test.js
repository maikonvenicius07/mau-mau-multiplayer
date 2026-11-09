'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');

function cls(){
  const items=new Set();
  return {contains:k=>items.has(k),add:k=>items.add(k),remove:k=>items.delete(k),toggle(k,value){
    const next=value===undefined?!items.has(k):!!value;
    if(next)items.add(k);else items.delete(k);
  }};
}
function el(){return {classList:cls(),attrs:{},setAttribute(k,v){this.attrs[k]=v}};}
const nodes={
  '#scoreboard':el(), '#sidePanel':el(), '#scoreToggleBtn':el(), '#tableInfoToggleBtn':el()
};
const $=sel=>nodes[sel];
let activeSideTab='log';
// Exercita as funções originais de abrir/fechar sem iniciar o servidor Socket.IO.
const begin=app.indexOf('function updatePlayerAuxButtons(){');
const end=app.indexOf('function openPlayerSide(',begin);
assert(begin>=0&&end>begin,'controle do placar deve estar no app.js');
// Como playerAuxOpen é global no aplicativo, o valor de teste vive no escopo da função.
const funcs=new Function('$','isSpectatorState','activeSideTab',
  `let playerAuxOpen=null;${app.slice(begin,end)};return {updatePlayerAuxButtons,closePlayerAuxPanels,togglePlayerScoreboard,read:()=>playerAuxOpen}`)($,()=>false,activeSideTab);
funcs.togglePlayerScoreboard();
assert(nodes['#scoreboard'].classList.contains('open'),'botão abre o placar');
assert.equal(nodes['#scoreToggleBtn'].attrs['aria-expanded'],'true','estado acessível quando aberto');
funcs.togglePlayerScoreboard();
assert(!nodes['#scoreboard'].classList.contains('open'),'mesmo botão fecha o placar');
assert.equal(nodes['#scoreToggleBtn'].attrs['aria-expanded'],'false','estado acessível quando fechado');

// Exercita a inicialização real, que precisa ser executada somente na troca de contexto.
const cStart=app.indexOf('  const contextKey=`${state.code||');
const cEnd=app.indexOf('  const players=state.players||[];',cStart);
assert(cStart>=0&&cEnd>cStart,'inicialização por contexto deve existir');
const contextLogic=app.slice(cStart,cEnd);
function runContext(state,spectator,previousKey,scoreOpen){
  const score=nodes['#scoreboard'],side=nodes['#sidePanel'];
  if(scoreOpen)score.classList.add('open');else score.classList.remove('open');
  side.classList.add('open');
  const run=new Function('state','spectator','$','updatePlayerAuxButtons','renderContextKey',
    `let force=false, playerAuxOpen=null;const renderSignatures=new Map();${contextLogic};return {contextKey:renderContextKey,force,playerAuxOpen};`);
  const result=run(state,spectator,$,funcs.updatePlayerAuxButtons,previousKey);
  return {result,opened:score.classList.contains('open'),sideOpen:side.classList.contains('open')};
}
const state={code:'ABCD12',me:{id:'p1'},matchSerial:1};
const first=runContext(state,false,'',false);
assert(first.opened,'ao entrar como jogador, o placar começa visível');
assert(!first.sideOpen,'o painel de mesa/chat não se sobrepõe ao placar');
const same=runContext(state,false,first.result.contextKey,false);
assert(!same.opened,'fechamento escolhido pelo jogador persiste durante a partida');
const next=runContext({...state,matchSerial:2},false,first.result.contextKey,false);
assert(next.opened,'nova partida começa com o placar aberto');
const observer=runContext({code:'ABCD12',me:{id:'p1',role:'SPECTATOR'},matchSerial:2},true,next.result.contextKey,false);
assert(!observer.opened,'observador permanece usando a gaveta, sem autoabertura');

assert(app.includes('score-swipe-hint')&&app.includes('score-rows'),'placar contém trilho responsivo');
assert(css.includes('touch-action:pan-x;'),'placar no celular pode deslizar por toque');
assert(css.includes('position:relative!important')&&css.includes('width:calc(100% - 56px)!important'),'painel móvel não deve cobrir as cartas');
assert(html.includes('v53.6-scoreboard-default')&&html.includes('v53.6-scoreboard-default'),'CSS e JS devem ter versão nova contra cache');
console.log('✓ V53.6: abertura padrão, fechamento manual, nova partida, observador e layout móvel');

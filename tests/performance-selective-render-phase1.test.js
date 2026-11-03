'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function section(start,end){
  const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,`Trecho de performance ausente: ${start}`);
  return source.slice(i,j);
}
// Executa o helper original do cliente, em vez de recriar sua lógica no teste.
const registry=section('const renderSignatures=new Map();','function render(force=false){');
const context=vm.createContext({JSON,Map});
vm.runInContext(`${registry}\nthis.api={renderWhenChanged,clearRenderSignatures,renderSignatures};`,context);
const {renderWhenChanged,clearRenderSignatures,renderSignatures}=context.api;
let updates=0;
const update=()=>updates++;
assert.equal(renderWhenChanged('players',[{id:'a',cards:5}],update),true);
assert.equal(renderWhenChanged('players',[{id:'a',cards:5}],update),false,'Estado equivalente não deve remontar o DOM');
assert.equal(updates,1);
assert.equal(renderWhenChanged('log',[{id:'new'}],update),true,'A assinatura de outro componente é independente');
assert.equal(renderWhenChanged('players',[{id:'a',cards:4}],update),true,'Mudança de cartas exige atualização dos jogadores');
assert.equal(renderWhenChanged('players',[{id:'a',cards:4}],update,true),true,'Novo avatar precisa permitir renderização forçada');
assert.equal(updates,4);
clearRenderSignatures();
assert.equal(renderSignatures.size,0);
assert.equal(renderWhenChanged('players',[{id:'a',cards:4}],update),true,'Troca de sala deve invalidar a assinatura');

for (const name of ['spectator','players','score','center','hand','log','controls']) {
  assert.ok(source.includes(`renderWhenChanged('${name}'`),`${name} deve ter renderização seletiva`);
}
assert.ok(source.includes('render(true);'),'Novos avatares precisam forçar renderização');

// O timer dos convites só existe enquanto houver convite pendente.
const inviteJs=section('let inviteCountdownTimer=null;','function renderInviteInbox(){');
const inviteCards=new Map(),timers=new Map();let id=0;
const inviteCtx=vm.createContext({
  inviteCards,
  inviteSeconds:expires=>expires,
  $$:()=>[],
  setTimeout:(fn,ms)=>{const k=++id;timers.set(k,{fn,ms});return k;},
  clearTimeout:k=>timers.delete(k),
  renderInviteInbox:()=>{},
});
vm.runInContext(`${inviteJs}\nthis.sync=syncInviteCountdownTimer;`,inviteCtx);
inviteCtx.sync();
assert.equal(timers.size,0,'Sem convites o timer não deve iniciar');
inviteCards.set('i1',{id:'i1',uiState:'pending',expiresAt:5});
inviteCtx.sync();inviteCtx.sync();
assert.equal(timers.size,1,'Convites pendentes não podem criar timers duplicados');
assert.equal([...timers.values()][0].ms,1000);
inviteCards.get('i1').uiState='ready';
inviteCtx.sync();
assert.equal(timers.size,0,'Convite concluído deve parar o timer');

assert.ok(!source.includes('setInterval(updateMatchmakingCountdown,250)'));
assert.ok(!source.includes('setInterval(updateReconnectCountdown,250)'));
assert.ok(source.includes('if(!matchmakingCountdownTimer)matchmakingCountdownTimer=setInterval(updateMatchmakingCountdown,1000)'));
assert.ok(source.includes('if(!reconnectCountdownTimer)reconnectCountdownTimer=setInterval(updateReconnectCountdown,1000)'));


// Exercita o dispatcher real de renderização com dados representativos.
const renderJs=section('function canAct(){','function playerDisplayOrderFromMe(){');
const calls={};
const mockEl=()=>({classList:{toggle(){},add(){},remove(){}},textContent:'',dataset:{}});
const nodes=new Map();
const mock=(name)=>{calls[name]=(calls[name]||0)+1};
const rendererCtx=vm.createContext({
  JSON,Map,Set,
  state:{
    code:'AB1234',matchSerial:1,viewerRole:'PLAYER',status:'playing',round:1,rounds:5,
    direction:-1,paused:false,currentPlayerId:'p1',winnerId:null,deckCount:75,
    topCard:{id:'c1',rank:'9',suit:'clubs'},requestedSuit:null,pendingSeven:0,
    openingReaction:false,continuationPlayerId:null,me:{id:'p1',role:'PLAYER',host:true,hand:[],legalCardIds:[],quickActionCardIds:[],burnableCardIds:[],doublePairs:[]},
    players:[{id:'p1',name:'P1',score:0,cardCount:3,connected:true},{id:'p2',name:'P2',score:0,cardCount:3,connected:true}],
    spectators:[],log:[{id:1,message:'início'}],roundReview:null,replay:null,rules:{rounds:5},isPublic:true
  },
  socket:{connected:true},handSort:'suit',passPending:false,
  liveVoiceActivePlayerIds:new Set(),
  isSpectatorState:()=>rendererCtx.state.viewerRole==='SPECTATOR',
  $:s=>{if(!nodes.has(s))nodes.set(s,mockEl());return nodes.get(s);},
  syncSpectatorCompactUI:()=>{},syncReconnectCountdownTimer:()=>{},
  renderSpectatorLivePanel:()=>mock('spectator'),renderPlayers:()=>mock('players'),
  renderScore:()=>mock('score'),renderCenter:()=>mock('center'),
  renderHand:()=>mock('hand'),renderLog:()=>mock('log'),renderControls:()=>mock('controls'),
  updateLiveMicUI:()=>{},updateFloatingGameActions:()=>{},
  window:{MauCamera:{onState:()=>{}}}
});
vm.runInContext(`${renderJs}\nthis.renderTest=render;`,rendererCtx);
rendererCtx.renderTest();
for(const key of ['players','score','center','hand','log','controls','spectator'])assert.equal(calls[key],1,key+' deve aparecer inicialmente');
rendererCtx.state.log=[...rendererCtx.state.log,{id:2,message:'um novo acontecimento'}];
rendererCtx.renderTest();
assert.equal(calls.log,2,'Novo log atualiza histórico');
for(const key of ['players','score','center','hand','controls'])assert.equal(calls[key],1,'Novo log não deve reconstruir '+key);
rendererCtx.state.me.hand=[{id:'c2',suit:'hearts',rank:'7'}];
rendererCtx.renderTest();
assert.equal(calls.hand,2,'Mão alterada precisa atualizar');
assert.equal(calls.players,1,'Mão alterada não deve remexer nas câmeras');
rendererCtx.state.currentPlayerId='p2';
rendererCtx.renderTest();
assert.equal(calls.players,2,'Mudança de turno atualiza destaque de jogador');
assert.equal(calls.center,2,'Mudança de turno atualiza banner');
assert.equal(calls.hand,3,'Mudança de turno atualiza permissões das cartas');
rendererCtx.renderTest(true);
assert.equal(calls.players,3,'Novos avatares podem solicitar atualização forçada');
rendererCtx.state.viewerRole='SPECTATOR';rendererCtx.state.me={id:'obs1',role:'SPECTATOR'};
rendererCtx.renderTest();
assert.equal(calls.players,4,'Troca de papel precisa invalidar todas as assinaturas');

console.log('✓ Renderização seletiva e timers sob demanda: OK');

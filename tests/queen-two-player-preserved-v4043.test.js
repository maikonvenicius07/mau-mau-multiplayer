'use strict';
const assert=require('assert');
const E=require('../game-engine');

function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room2(dir=-1){
  const r=E.createRoom('Q2KEEP',{name:'Ana',avatar:'a',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Bruno',avatar:'b',socketId:'s2',token:'t2'});
  r.status='playing';r.round=1;r.direction=dir;r.currentPlayer=0;r.deck=E.createDeck();
  r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.finishedRound=false;p.connected=true;p.declaration=null;p.justDrawnCardId=null;});
  return r;
}

for(const initialDirection of [-1,1]){
  const r=room2(initialDirection);const a=r.players[0];
  a.hand=[card('Q','hearts','q'),card('2','clubs','keep')];
  E.playCard(r,a.id,'q');
  assert.equal(r.direction,-initialDirection,'Q deve inverter o sentido exatamente uma vez');
  assert.equal(r.currentPlayer,0,'com 2 jogadores, quem jogou Q deve jogar novamente');
  assert(r.log.some(e=>e.kind==='special'&&/com 2 jogadores.*joga novamente/i.test(e.message)),'log da regra Q2 deve ser preservado');
  const audit=r.turnAudit?.[r.turnAudit.length-1];
  assert(audit&&audit.reason==='queen-reverse-two-player-replay','auditoria deve reconhecer a exceção Q2 sem tratá-la como pulo por Ás');
}

// A continua sendo o pulo: com 2 jogadores, pular o único adversário devolve a vez ao mesmo jogador.
{
  const r=room2(-1);const a=r.players[0];
  a.hand=[card('A','hearts','a'),card('2','clubs','keep')];
  E.playCard(r,a.id,'a');
  assert.equal(r.direction,-1,'A não pode inverter o sentido');
  assert.equal(r.currentPlayer,0,'A deve pular exatamente o adversário em partida de 2');
}

console.log('✓ V40.43: regra validada da Dama com 2 jogadores preservada integralmente.');

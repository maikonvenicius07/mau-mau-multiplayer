'use strict';
const assert = require('assert');
const E = require('../game-engine');

function card(rank,suit,id){return {rank,suit,id:id||`${rank}${suit}${Math.random()}`,copy:1};}
function room2(){
  const r=E.createRoom('ABC123',{name:'Ana',avatar:'👩',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Bruno',avatar:'🧑',socketId:'s2',token:'t2'});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;r.deck=E.createDeck();r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.roundHistory=[];p.score=0;p.connected=true;p.finishedRound=false;});
  return r;
}

assert.equal(E.createDeck().length,104,'dois baralhos sem curingas = 104 cartas');
assert.equal(E.cardPoints(card('A','hearts')),1);
assert.equal(E.cardPoints(card('J','hearts')),11);
assert.equal(E.cardPoints(card('Q','hearts')),12);
assert.equal(E.cardPoints(card('K','hearts')),13);
assert.equal(E.cardPoints(card('10','hearts')),10);

{
  const r=room2(),p=r.players[0];
  p.hand=[card('5','clubs','a'),card('9','hearts','b'),card('J','spades','c'),card('3','clubs','d')];
  assert(E.legalCard(r,p.hand[0],p)); // mesmo valor
  assert(E.legalCard(r,p.hand[1],p)); // mesmo naipe
  assert(E.legalCard(r,p.hand[2],p)); // J livre
  assert(!E.legalCard(r,p.hand[3],p));
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('7','hearts','a7'),card('2','clubs','a2')];
  b.hand=[card('7','clubs','b7'),card('4','spades','b4')];
  E.playCard(r,a.id,'a7');
  assert.equal(r.pendingSeven,2);
  assert.equal(r.currentPlayer,1);
  E.playCard(r,b.id,'b7');
  assert.equal(r.pendingSeven,4);
  assert.equal(r.currentPlayer,0);
  // Ana não tem mais 7 e deve comprar 4.
  const before=a.hand.length;
  E.drawAction(r,a.id);
  assert.equal(a.hand.length,before+4);
  assert.equal(r.pendingSeven,0);
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  // queimando duas cartas iguais + continuação
  a.hand=[card('5','hearts','x1'),card('5','hearts','x2'),card('5','clubs','x3'),card('2','spades','x4')];
  b.hand=[card('4','clubs','b1')];
  E.burnPair(r,a.id,'x1');
  assert.equal(a.hand.length,2);
  assert.equal(r.continuationPlayerId,a.id);
  E.playCard(r,a.id,'x3');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(r.currentPlayer,1);
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('9','hearts','m1'),card('2','spades','m2')];
  // precisa anunciar ao ficar com uma; sem anúncio compra +2
  E.playCard(r,a.id,'m1');
  assert.equal(a.hand.length,3);
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('J','spades','j1')];
  b.hand=[card('K','clubs','k1'),card('10','hearts','t1')];
  E.playCard(r,a.id,'j1');
  assert.equal(r.status,'between-rounds');
  assert.equal(b.roundScore,(13+10)*2,'Valete final dobra pontos dos demais');
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('4','clubs','q1'),card('4','clubs','q2')];
  b.hand=[card('2','hearts','b')];
  // top 5♥ -> 4♣ não é jogável, então muda topo para 4♥ para validar por valor.
  r.discard=[card('4','hearts','top4')];
  assert.throws(()=>E.burnPair(r,a.id,'q1'),/Mau-Mau batendo/);
  E.declare(r,a.id,'batendo');
  E.burnPair(r,a.id,'q1');
  assert.equal(r.status,'between-rounds');
  assert.equal(r.winnerId,a.id);
}

console.log('✓ Todos os testes do motor do Mau-Mau passaram.');

// Penalidade do 7 ainda é resolvida depois da batida.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('7','hearts','last7')];
  b.hand=[card('3','clubs','b3')];
  E.playCard(r,a.id,'last7');
  assert.equal(r.winnerId,a.id);
  assert.equal(r.pendingSeven,2);
  assert.equal(r.status,'playing');
  const before=b.hand.length;
  E.drawAction(r,b.id);
  assert.equal(b.hand.length,before+2);
  assert.equal(r.status,'between-rounds');
}


// A sala não pode travar por causa de jogador fantasma desconectado antes da 1ª rodada.
{
  const r=E.createRoom('GHOST1',{name:'Host',avatar:'🧑',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Conectado',avatar:'👩',socketId:'s2',token:'t2'});
  const ghost=E.addPlayer(r,{name:'Fantasma',avatar:'😴',socketId:null,token:'t3'});
  ghost.connected=false;
  E.startRound(r);
  assert.equal(r.status,'playing');
  assert.equal(r.players.length,2,'jogador desconectado no lobby deve ser removido antes de iniciar');
  assert(r.players.every(p=>p.connected));
}

console.log('✓ Correção de jogadores fantasmas/reconexão validada.');

'use strict';

// V40.69.4 — Compras e penalidades são operações sem perda de cartas.
const assert = require('node:assert/strict');
const E = require('../game-engine');

const card = (rank, suit, id) => ({id,rank,suit,copy:1});
function room3() {
  const room = E.createRoom('DRAW94', {name:'Ana', socketId:'s-a',token:'t-a',avatar:'A'});
  E.addPlayer(room,{name:'Bruno',socketId:'s-b',token:'t-b',avatar:'B'});
  E.addPlayer(room,{name:'Carla',socketId:'s-c',token:'t-c',avatar:'C'});
  room.status='playing';room.round=1;room.direction=1;room.currentPlayer=0;
  room.deck=[];room.discard=[card('5','hearts','top')];
  for (const p of room.players) {p.hand=[];p.score=0;p.roundHistory=[];p.roundScore=0;p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;}
  return room;
}
function cardIds(room) {
  return [...room.deck,...room.discard,...room.players.flatMap(p=>p.hand)].map(c=>c.id).sort();
}
function expectRejectionWithoutMutation(room, action, name) {
  const before=JSON.stringify(room);
  const idBefore=cardIds(room);
  assert.throws(action, /Não há cartas suficientes|Não há cartas disponíveis/i, name);
  assert.equal(JSON.stringify(room),before,`${name}: a operação rejeitada não pode alterar nenhum campo da sala`);
  assert.deepEqual(cardIds(room),idBefore,`${name}: nenhuma carta foi perdida ou duplicada`);
}

// Falha reproduzida na V40.69.3: deck.pop() retira carta antes de a penalidade falhar.
{
  const r=room3();r.pendingSeven=3;
  r.players[0].hand=[card('3','clubs','own')];
  r.deck=[card('9','spades','only')];
  expectRejectionWithoutMutation(r,()=>E.drawAction(r,r.players[0].id),'cadeia de 7 com monte insuficiente');
}

// Reembaralhamento parcial tampouco pode consumir cartas antes do erro.
{
  const r=room3();r.pendingSeven=4;
  r.players[0].hand=[card('3','clubs','own')];
  r.deck=[card('9','spades','only')];
  r.discard=[card('2','hearts','recyclable-1'),card('4','clubs','recyclable-2'),card('5','hearts','top')];
  expectRejectionWithoutMutation(r,()=>E.drawAction(r,r.players[0].id),'cadeia de 7 com descarte insuficiente');
}

// Mesmo a cadeia de 7 após uma batida não deve concluir rodada se não puder pagar.
{
  const r=room3();r.pendingSeven=3;r.finishPendingSeven=true;r.winnerId=r.players[2].id;
  r.players[0].hand=[card('3','clubs','own')];r.deck=[card('9','spades','only')];
  expectRejectionWithoutMutation(r,()=>E.drawAction(r,r.players[0].id),'cadeia final de 7 sem cartas');
}

// Com cartas suficientes, compra completa, incluindo reciclagem e preservação do topo.
{
  const r=room3();r.pendingSeven=4;
  const p=r.players[0];p.hand=[card('3','clubs','own')];
  r.deck=[card('9','spades','one')];
  r.discard=[card('2','hearts','recyclable-1'),card('4','clubs','recyclable-2'),card('6','diamonds','recyclable-3'),card('5','hearts','top')];
  const before=cardIds(r),topId=r.discard.at(-1).id;
  E.drawAction(r,p.id);
  assert.equal(p.hand.length,5);
  assert.equal(r.pendingSeven,0);
  assert.equal(r.discard.at(-1).id,topId);
  assert.deepEqual(cardIds(r),before,'a compra de 4 não deve criar ou perder cartas');
}

// Uma compra normal continua permitindo reciclar o descarte; só pode comprar uma vez.
{
  const r=room3(),p=r.players[0];p.hand=[card('3','clubs','own')];
  r.discard=[card('9','spades','recycle'),card('5','hearts','top')];
  const before=cardIds(r);
  E.drawAction(r,p.id);
  assert.equal(p.justDrawnCardId,'recycle');
  assert.equal(r.discard.at(-1).id,'top');
  assert.deepEqual(cardIds(r),before);
  assert.throws(()=>E.drawAction(r,p.id),/já comprou/);
}

// Uma compra normal impossível não pode alterar mão, turno ou descarte.
{
  const r=room3();r.players[0].hand=[card('3','clubs','own')];
  expectRejectionWithoutMutation(r,()=>E.drawAction(r,r.players[0].id),'compra normal sem monte nem descarte reciclável');
}

// Rei/8 podem exigir cartas depois que a carta jogada entra no descarte.
// Toda a operação deve ser validada ANTES da remoção da mão.
{
  const r=room3(),p=r.players[0];
  p.hand=[card('8','hearts','played-eight'),card('3','clubs','remaining')];
  expectRejectionWithoutMutation(r,()=>E.playCard(r,p.id,'played-eight'),'8 sem cartas para efeito');
}
{
  const r=room3(),p=r.players[0];
  p.hand=[card('8','hearts','winning-eight')];
  r.players[1].hand=[card('2','clubs','b')];
  r.players[2].hand=[card('3','clubs','c')];
  expectRejectionWithoutMutation(r,()=>E.playCard(r,p.id,'winning-eight'),'batida de 8 sem cartas para efeito final');
}

// Uma única jogada pode gerar DUAS compras obrigatórias: +2 Mau-Mau e +2 do Oito.
// Somar os custos evita penalidade incompleta entre duas chamadas drawCards().
{
  const r=room3(),p=r.players[0];
  p.hand=[card('8','hearts','eight'),card('3','clubs','remaining')];
  r.deck=[card('2','clubs','d1'),card('4','clubs','d2')];
  expectRejectionWithoutMutation(r,()=>E.playCard(r,p.id,'eight'),'penalidade Mau-Mau mais efeito do 8');
}
{
  const r=room3(),p=r.players[0];
  p.hand=[card('8','hearts','eight'),card('3','clubs','remaining')];
  r.deck=[card('2','clubs','d1'),card('4','clubs','d2'),card('6','clubs','d3')];
  const before=cardIds(r);
  E.playCard(r,p.id,'eight');
  assert.equal(p.hand.length,3,'duas cartas de Mau-Mau foram entregues');
  assert.equal(r.players[2].hand.length,2,'duas cartas de efeito do 8 foram entregues');
  assert.equal(r.discard.at(-1).id,'eight');
  assert.deepEqual(cardIds(r),before);
}

// Penalidade Mau-Mau após carta normal também não pode descartar antes de falhar.
{
  const r=room3(),p=r.players[0];
  p.hand=[card('5','clubs','normal'),card('2','clubs','remaining')];
  expectRejectionWithoutMutation(r,()=>E.playCard(r,p.id,'normal'),'Mau-Mau normal sem cartas suficientes');
}

// Carta Dupla de três para uma carta e sem Mau-Mau: +2 por omissão.
// Ela pode reciclar as duas cartas que ficam abaixo do novo topo.
{
  const r=room3(),p=r.players[0];
  p.hand=[card('5','clubs','pair-1'),card('5','clubs','pair-2'),card('3','diamonds','remaining')];
  const before=cardIds(r);
  E.playDoubleCard(r,p.id,'pair-1','pair-2');
  assert.equal(p.hand.length,3);
  assert.equal(r.discard.at(-1).id,'pair-2');
  assert.deepEqual(cardIds(r),before);
}
{
  const r=room3(),p=r.players[0];
  p.hand=[card('5','clubs','pair-1'),card('5','clubs','pair-2'),card('3','diamonds','remaining')];
  r.rules.mauMauPenalty=3;
  expectRejectionWithoutMutation(r,()=>E.playDoubleCard(r,p.id,'pair-1','pair-2'),'Carta Dupla com insuficiência da penalidade configurada');
}

// Ação Rápida é fora da vez, mas a penalidade Mau-Mau precisa ser atômica.
{
  const r=room3(),p=r.players[1];
  p.hand=[card('5','hearts','quick'),card('3','clubs','remaining')];
  r.reactionTopCardId='top';r.reactionSourcePlayerId=r.players[2].id;
  r.reactionNextPlayerId=r.players[0].id;
  expectRejectionWithoutMutation(r,()=>E.quickAction(r,p.id,'quick'),'Ação Rápida com Mau-Mau sem cartas');
}

// Rei mais penalidade Mau-Mau: não iniciar +2 se o +1 seguinte não couber.
{
  const r=room3(),p=r.players[0];
  p.hand=[card('K','hearts','king'),card('3','clubs','remaining')];
  r.deck=[card('2','clubs','only')];
  expectRejectionWithoutMutation(r,()=>E.playCard(r,p.id,'king'),'Rei e Mau-Mau sem capacidade para ambos');
}

// Mesmo após um 7 rebatido, a cobrança obrigatória de Mau-Mau é validada antes.
{
  const r=room3(),p=r.players[0];
  r.pendingSeven=2;
  p.hand=[card('7','hearts','reply-seven'),card('2','clubs','remaining')];
  expectRejectionWithoutMutation(r,()=>E.playCard(r,p.id,'reply-seven'),'rebate de Sete e Mau-Mau com monte insuficiente');
}

// Com Rei válido e monte reciclável, seu efeito deve ser entregue integralmente.
{
  const r=room3(),p=r.players[0];
  p.hand=[card('K','hearts','winning-king')];
  r.players[1].hand=[card('2','clubs','b')];
  r.players[2].hand=[card('3','clubs','c')];
  const original=cardIds(r);
  E.playCard(r,p.id,'winning-king');
  assert.equal(r.status,'between-rounds');
  assert.equal(r.players[2].hand.length,2,'Rei final deve entregar 1 carta ao jogador anterior');
  assert.deepEqual(cardIds(r),original);
}

// No embaralhamento e distribuição usuais, há exatamente dois baralhos,
// nenhuma carta desaparece, e o mesmo vale para a primeira compra válida.
{
  const r=E.createRoom('FULL94',{name:'A',socketId:'sa',token:'ta',avatar:'A'});
  E.addPlayer(r,{name:'B',socketId:'sb',token:'tb',avatar:'B'});
  E.addPlayer(r,{name:'C',socketId:'sc',token:'tc',avatar:'C'});
  E.startRound(r);
  const original=cardIds(r);
  assert.equal(original.length,104);
  assert.equal(new Set(original).size,104);
  const current=r.players[r.currentPlayer];
  E.drawAction(r,current.id);
  assert.deepEqual(cardIds(r),original,'104 cartas devem permanecer nas mãos e nos dois montes');
}

// Matriz de estoque: 5 tamanhos de monte × 5 tamanhos de descarte ×
// 7 comprimentos de cadeia de 7. Conservação e rejeição sem mutação.
for (let deckCount=0; deckCount<=4; deckCount++) {
  for (let recyclable=0; recyclable<=4; recyclable++) {
    for (let penalty=1; penalty<=7; penalty++) {
      const r=room3(),p=r.players[0];
      p.hand=[card('9','clubs','own')];
      r.pendingSeven=penalty;
      r.deck=Array.from({length:deckCount},(_,i)=>card('2','spades',`deck-${i}`));
      r.discard=[...Array.from({length:recyclable},(_,i)=>card('4','diamonds',`recycle-${i}`)),card('5','hearts','top')];
      const original=cardIds(r);
      if (deckCount + recyclable < penalty) {
        expectRejectionWithoutMutation(r,()=>E.drawAction(r,p.id),`matriz ${deckCount}/${recyclable}/${penalty}`);
      } else {
        E.drawAction(r,p.id);
        assert.equal(p.hand.length,penalty+1);
        assert.equal(r.pendingSeven,0);
        assert.equal(r.discard.at(-1).id,'top');
        assert.deepEqual(cardIds(r),original);
      }
    }
  }
}

console.log('✓ V40.69.4: compras, reciclagem, cadeia de 7, Mau-Mau, 8, Carta Dupla e Ação Rápida atômicos.');

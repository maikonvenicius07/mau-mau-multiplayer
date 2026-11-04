'use strict';
// Regressão: uma compra ou passe não substitui a carta do descarte.
// A oportunidade de Ação Rápida pertence ao topo, não ao instante da última compra.
const assert=require('node:assert/strict');
const E=require('../game-engine');
const card=(rank,suit,id)=>({rank,suit,id,copy:1});
function room(){
  const r=E.createRoom('QADRAW',{name:'Ana',socketId:'s0',token:'t0'});
  for(const [i,name] of ['Bruno','Carla','Diego'].entries()) E.addPlayer(r,{name,socketId:`s${i+1}`,token:`t${i+1}`});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;
  r.discard=[card('5','clubs','base')];
  r.deck=[card('3','diamonds','buy-1'),card('9','clubs','buy-2'),card('2','clubs','buy-3')];
  for(const p of r.players){p.hand=[];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;}
  const [ana,bruno,carla,diego]=r.players;
  ana.hand=[card('5','hearts','source'),card('8','diamonds','other-a'),card('10','clubs','other-a2')];
  bruno.hand=[card('5','hearts','quick'),card('3','spades','other-b'),card('4','clubs','other-b2')];
  carla.hand=[card('7','clubs','other-c'),card('6','diamonds','other-c2'),card('10','clubs','other-c3')];
  diego.hand=[card('9','spades','other-d'),card('3','clubs','other-d2'),card('4','diamonds','other-d3')];
  E.playCard(r,ana.id,'source');
  assert.equal(r.currentPlayer,3,'anti-horário: Diego na vez');
  assert.deepEqual(E.canQuickAction(r,bruno).map(c=>c.id),['quick']);
  return {r,ana,bruno,carla,diego};
}
// Compra normal mantém topo e Ação Rápida de quem está fora da vez.
{
  const {r,bruno,diego}=room();
  const initialTop=r.discard.at(-1).id, originalTurn=r.currentPlayer;
  E.drawAction(r,diego.id);
  assert.equal(r.discard.at(-1).id,initialTop,'comprar não altera carta no topo');
  assert.deepEqual(E.canQuickAction(r,bruno).map(c=>c.id),['quick'],'compra não pode fechar Ação Rápida');
  assert.deepEqual(E.roomPublicState(r,bruno.id).me.quickActionCardIds,['quick'],'botão ⚡ deve receber a oportunidade');
  E.quickAction(r,bruno.id,'quick');
  assert.equal(r.currentPlayer,originalTurn,'Ação Rápida após compra não rouba vez de Diego');
  assert.equal(r.discard.at(-1).id,'quick');
  assert.deepEqual(E.canQuickAction(r,bruno),[],'a primeira Ação Rápida encerra sua oportunidade');
}
// Passar depois da compra mantém a chance sobre o mesmo topo, mas muda o turno.
{
  const {r,bruno,carla,diego}=room();
  E.drawAction(r,diego.id);
  E.passTurn(r,diego.id);
  assert.equal(r.currentPlayer,2,'passou de Diego para Carla');
  assert.equal(r.discard.at(-1).id,'source','topo ainda é o 5♥');
  assert.deepEqual(E.canQuickAction(r,bruno).map(c=>c.id),['quick'],'passe sem descarte não fecha Ação Rápida');
  assert.equal(E.canQuickAction(r,carla).length,0,'jogador agora na vez não faz Ação Rápida');
  assert.equal(r.reactionNextPlayerId,carla.id,'a referência deve acompanhar o turno atual');
  E.quickAction(r,bruno.id,'quick');
  assert.equal(r.currentPlayer,2,'Ação Rápida depois do passe preserva a vez de Carla');
}
// Falha em compra duplicada não deve invalidar uma oportunidade existente.
{
  const {r,bruno,diego}=room();
  E.drawAction(r,diego.id);
  assert.throws(()=>E.drawAction(r,diego.id),/já comprou/i);
  assert.equal(E.canQuickAction(r,bruno).length,1);
}
// A chance permanece em passes sucessivos enquanto o topo não muda.
{
  const {r,bruno,diego,carla}=room();
  E.drawAction(r,diego.id);E.passTurn(r,diego.id);
  E.drawAction(r,carla.id);E.passAfterDraw(r,carla.id);
  assert.equal(r.currentPlayer,1,'Bruno recebe a vez');
  assert.equal(E.canQuickAction(r,bruno).length,0,'quem está na vez não faz Ação Rápida');
  assert.equal(r.reactionTopCardId,'source','sem descarte novo, topo e janela permanecem');
}
// Duas compras e passes: reação tardia preserva a vez atual, sem voltar atrás.
{
  const {r,bruno,carla,diego}=room();
  carla.hand.push(card('5','hearts','late-quick'));
  E.drawAction(r,diego.id); E.passTurn(r,diego.id);
  E.drawAction(r,carla.id); E.passTurn(r,carla.id);
  assert.equal(r.players[r.currentPlayer].id,bruno.id);
  assert.equal(r.discard.at(-1).id,'source');
  assert.deepEqual(E.canQuickAction(r,carla).map(c=>c.id),['late-quick']);
  E.quickAction(r,carla.id,'late-quick');
  assert.equal(r.players[r.currentPlayer].id,bruno.id,'reação após dois passes não reverte o turno');
}

// Se o jogador na vez JOGAR outra carta, a oportunidade antiga acaba.
{
  const {r,bruno,diego}=room();
  E.drawAction(r,diego.id);
  diego.hand.push(card('3','hearts','new-top'));
  E.playCard(r,diego.id,'new-top');
  assert.equal(r.discard.at(-1).id,'new-top');
  assert.equal(E.canQuickAction(r,bruno).length,0,'5♥ não pode reagir a 3♥');
  assert.equal(r.reactionTopCardId,'new-top');
}
// Abertura: a carta virada continua reagível mesmo após compra e passe.
{
  const {r,bruno,diego}=room();
  r.discard=[card('5','hearts','starter')];
  r.openingReaction=true;r.reactionTopCardId='starter';r.reactionSourcePlayerId=null;
  r.reactionNextPlayerId=diego.id;
  E.drawAction(r,diego.id);E.passTurn(r,diego.id);
  assert.deepEqual(E.canQuickAction(r,bruno).map(c=>c.id),['quick']);
  assert.equal(r.openingReaction,true,'a carta da abertura continua até ser substituída');
  E.quickAction(r,bruno.id,'quick');
  assert.equal(r.currentPlayer,2,'a vez permanece com Carla');
  assert.equal(r.openingReaction,false);
}
// Cartas especiais, cadeia de 7 e continuação de Queima seguem bloqueadas.
{
  const {r,bruno}=room();
  r.pendingSeven=2;
  assert.equal(E.canQuickAction(r,bruno).length,0);
  r.pendingSeven=0;r.continuationPlayerId=r.players[r.currentPlayer].id;
  assert.equal(E.canQuickAction(r,bruno).length,0);
  r.continuationPlayerId=null;
  r.discard.push(card('A','hearts','special-top'));r.reactionTopCardId='special-top';
  bruno.hand.push(card('A','hearts','special-copy'));
  assert.equal(E.canQuickAction(r,bruno).length,0);
}
console.log('✓ V53.1: compra, passe, abertura, turno preservado, troca de topo e restrições da Ação Rápida.');

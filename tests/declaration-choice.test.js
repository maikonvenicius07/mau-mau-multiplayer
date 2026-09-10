'use strict';
const assert=require('assert');
const Engine=require('../game-engine');
const pkg=require('../package.json');
assert.equal(pkg.version,'40.18.0');
function card(rank,suit,id){return {rank,suit,id,copy:0};}
function room2(){
  const r=Engine.createRoom('T4012',{socketId:'a',token:'ta',playerKey:'ga',name:'A',avatar:'macaco'});
  Engine.addPlayer(r,{socketId:'b',token:'tb',playerKey:'gb',name:'B',avatar:'boi'});
  r.status='playing';r.round=1;r.currentPlayer=0;r.direction=1;
  r.players.forEach(p=>{p.finishedRound=false;p.roundHistory=[];p.score=0;p.declaration=null;});
  return r;
}
// Sem anúncio, não pode encerrar com Carta Dupla.
{
  const r=room2(),a=r.players[0];
  r.discard=[card('4','clubs','top')];
  a.hand=[card('4','hearts','a1'),card('4','hearts','a2')];
  assert.throws(()=>Engine.playDoubleCard(r,a.id,'a1','a2'),/anuncie antes/);
}
// Mau-Mau simples pode encerrar com Carta Dupla.
{
  const r=room2(),a=r.players[0];
  r.discard=[card('5','clubs','top')];
  a.hand=[card('5','hearts','a1'),card('5','hearts','a2')];
  Engine.declare(r,a.id,'mau-mau');
  Engine.playDoubleCard(r,a.id,'a1','a2');
  assert.equal(r.winnerId,a.id);
}
// Mau-Mau simples pode encerrar por Queima + continuação.
{
  const r=room2(),a=r.players[0];
  r.discard=[card('6','hearts','top')];
  a.hand=[card('6','hearts','a1'),card('9','hearts','a2')];
  Engine.declare(r,a.id,'mau-mau');
  Engine.burnMatch(r,a.id,'a1');
  Engine.playCard(r,a.id,'a2');
  assert.equal(r.winnerId,a.id);
}
// Batendo/queimando continua válido para a mesma batida.
{
  const r=room2(),a=r.players[0];
  r.discard=[card('3','hearts','top')];
  a.hand=[card('3','hearts','a1'),card('9','hearts','a2')];
  Engine.declare(r,a.id,'batendo');
  Engine.burnMatch(r,a.id,'a1');
  Engine.playCard(r,a.id,'a2');
  assert.equal(r.winnerId,a.id);
}
console.log('✓ V40.12: Mau-Mau simples e batendo/queimando podem concluir as duas últimas cartas.');

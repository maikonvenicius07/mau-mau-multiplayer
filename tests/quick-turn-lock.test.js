'use strict';
const assert=require('assert');
const E=require('../game-engine');
function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room4(){
  const r=E.createRoom('QTL36',{name:'Ana',socketId:'sa',token:'ta'});
  E.addPlayer(r,{name:'Bruno',socketId:'sb',token:'tb'});
  E.addPlayer(r,{name:'Carla',socketId:'sc',token:'tc'});
  E.addPlayer(r,{name:'Diego',socketId:'sd',token:'td'});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;r.deck=E.createDeck();
  r.players.forEach(p=>{p.hand=[];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;p.roundHistory=[];p.score=0;});
  return r;
}

// Ana joga 5♥. No anti-horário, Diego é o próximo. Bruno está fora da vez.
// Bruno pode fazer Ação Rápida com outro 5♥, mas não pode Queimar nem jogar segunda carta.
{
  const r=room4(),ana=r.players[0],bruno=r.players[1],diego=r.players[3];
  r.discard=[card('5','clubs','base')];
  ana.hand=[card('5','hearts','source'),card('2','clubs','a2'),card('10','diamonds','a10')];
  bruno.hand=[card('5','hearts','quick'),card('9','hearts','second'),card('4','clubs','left')];
  diego.hand=[card('5','hearts','d-burn'),card('8','hearts','d-second'),card('3','clubs','d-left')];

  E.playCard(r,ana.id,'source');
  assert.equal(r.players[r.currentPlayer].id,diego.id);
  assert.equal(E.canBurnMatch(r,bruno).length,0,'fora da vez, Bruno não pode Queimar');
  assert(E.canQuickAction(r,bruno).some(c=>c.id==='quick'));

  E.quickAction(r,bruno.id,'quick');
  assert.equal(r.players[r.currentPlayer].id,diego.id,'Ação Rápida não pode roubar a vez de Diego');
  assert.equal(r.continuationPlayerId,null,'Ação Rápida nunca abre segunda carta');
  assert.throws(()=>E.playCard(r,bruno.id,'second'),/Não é a sua vez/i,'Bruno não pode jogar segunda carta fora da vez');

  // Diego continua na vez. Como o topo continua 5♥ e ele tem 5♥, pode Queimar na própria vez.
  assert(E.canBurnMatch(r,diego).some(c=>c.id==='d-burn'));
  E.burnMatch(r,diego.id,'d-burn');
  assert.equal(r.continuationPlayerId,diego.id);
  E.playCard(r,diego.id,'d-second');
  assert.equal(r.continuationPlayerId,null);
}

console.log('✓ V36: Ação Rápida não rouba a vez; segunda carta só após Queima na própria vez.');

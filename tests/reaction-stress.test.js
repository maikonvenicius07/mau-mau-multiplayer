'use strict';
const assert = require('assert');
const E = require('../game-engine');

function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room4(tag){
  const r=E.createRoom(`S${tag}`,{name:'A',socketId:'sa',token:`ta${tag}`});
  E.addPlayer(r,{name:'B',socketId:'sb',token:`tb${tag}`});
  E.addPlayer(r,{name:'C',socketId:'sc',token:`tc${tag}`});
  E.addPlayer(r,{name:'D',socketId:'sd',token:`td${tag}`});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;r.deck=E.createDeck();
  r.players.forEach(p=>{p.hand=[];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;p.roundHistory=[];p.score=0;});
  return r;
}
const ranks=['2','3','4','5','6','9','10'];
const suits=['hearts','diamonds','clubs','spades'];

for(let i=0;i<250;i++){
  const r=room4(i),a=r.players[0],b=r.players[1];
  const rank=ranks[i%ranks.length], suit=suits[i%suits.length];
  const topSuit=suits[(i+1)%suits.length];
  r.discard=[card(rank,topSuit,`base-${i}`)];
  a.hand=[card(rank,suit,`src-${i}`),card('A',topSuit,`a1-${i}`),card('K',topSuit,`a2-${i}`)];
  b.hand=[card(rank,suit,`copy-${i}`),card('9',suit,`follow-${i}`),card('4',topSuit,`left-${i}`)];
  E.playCard(r,a.id,`src-${i}`);
  assert.equal(r.currentPlayer,3);
  assert(E.canBurnMatch(r,b).some(c=>c.id===`copy-${i}`));
  assert(E.canQuickAction(r,b).some(c=>c.id===`copy-${i}`));

  if(i%2===0){
    E.declare(r,b.id,'mau-mau');
    E.burnMatch(r,b.id,`copy-${i}`);
    assert.equal(r.currentPlayer,1);
    assert.equal(r.continuationPlayerId,b.id);
    E.playCard(r,b.id,`follow-${i}`);
    assert.equal(b.hand.length,1);
    assert.equal(r.continuationPlayerId,null);
    assert.equal(r.currentPlayer,0);
  }else{
    E.quickAction(r,b.id,`copy-${i}`);
    assert.equal(b.hand.length,2);
    assert.equal(r.currentPlayer,3);
    assert.equal(r.reactionTopCardId,null);
  }
}

for(let i=0;i<250;i++){
  const r=room4(`d${i}`),a=r.players[0];
  const rank=ranks[i%ranks.length], suit=suits[i%suits.length];
  const topSuit=suits[(i+1)%suits.length];
  r.discard=[card(rank,topSuit,`dtop-${i}`)];
  a.hand=[card(rank,suit,`d1-${i}`),card(rank,suit,`d2-${i}`),card('A',topSuit,`d3-${i}`),card('K',topSuit,`d4-${i}`)];
  const pairs=E.canPlayDouble(r,a);
  assert.equal(pairs.length,1);
  E.playDoubleCard(r,a.id,`d1-${i}`,`d2-${i}`);
  assert.equal(a.hand.length,2);
  assert.equal(r.currentPlayer,3);
}

console.log('✓ V18 regressão: 500 cenários de Queima/Ação Rápida/Carta Dupla passaram.');

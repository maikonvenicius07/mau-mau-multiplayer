'use strict';
const assert=require('assert');
const E=require('../game-engine');
function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room3(){
  const r=E.createRoom('REV',{name:'Ana',avatar:'mulher',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Bruno',avatar:'homem',socketId:'s2',token:'t2'});
  E.addPlayer(r,{name:'Carla',avatar:'macaco',socketId:'s3',token:'t3'});
  r.status='playing';r.round=1;r.direction=1;r.currentPlayer=0;r.deck=E.createDeck();r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.roundHistory=[];p.score=0;p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;});
  return r;
}

// Cartas e calculo devem ser revelados somente depois do encerramento.
{
  const r=room3(),[a,b,c]=r.players;
  a.hand=[card('J','spades','j')];
  b.hand=[card('K','clubs','k'),card('A','hearts','a')];
  c.hand=[card('10','diamonds','10')];
  assert.equal(E.roomPublicState(r,a.id).roundReview,null,'nao pode revelar maos durante a rodada');
  E.playCard(r,a.id,'j');
  const pub=E.roomPublicState(r,a.id);
  assert(pub.roundReview,'deve existir conferencia apos a rodada');
  const rb=pub.roundReview.players.find(p=>p.id===b.id);
  const rc=pub.roundReview.players.find(p=>p.id===c.id);
  assert.equal(rb.basePoints,14); assert.equal(rb.multiplier,2); assert.equal(rb.roundScore,28);
  assert.equal(rc.basePoints,10); assert.equal(rc.roundScore,20);
  assert.equal(rb.cards.length,2);
}

// Batida com 8: cartas compradas antes do fechamento devem aparecer na fotografia final.
{
  const r=room3(),[a,b,c]=r.players;
  a.hand=[card('8','hearts','win8')];
  b.hand=[card('2','clubs','b2')];
  c.hand=[card('3','clubs','c3')];
  const before=c.hand.length;
  E.playCard(r,a.id,'win8');
  const rc=r.roundReview.players.find(p=>p.id===c.id);
  assert.equal(rc.cards.length,before+2,'conferencia precisa incluir compra final do 8');
  assert.equal(rc.roundScore,rc.cards.reduce((sum,x)=>sum+x.points,0));
}

// Comecou uma nova rodada: a conferencia anterior nao pode vazar durante o jogo.
{
  const r=room3(),[a,b,c]=r.players;
  a.hand=[card('5','hearts','win')]; b.hand=[card('2','clubs','b')]; c.hand=[card('3','clubs','c')];
  E.playCard(r,a.id,'win');
  assert(r.roundReview);
  E.startRound(r);
  assert.equal(r.roundReview,null);
  assert.equal(E.roomPublicState(r,a.id).roundReview,null);
}
console.log('✓ V38: conferencia de cartas e pontuacao por rodada aprovada.');

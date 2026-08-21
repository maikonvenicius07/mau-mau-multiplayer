'use strict';
const assert=require('assert');
const E=require('../game-engine');

function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room3(tag){
  const r=E.createRoom(`F${tag}`,{name:'Carla',socketId:'sa',token:`ta${tag}`});
  E.addPlayer(r,{name:'Paulo',socketId:'sb',token:`tb${tag}`});
  E.addPlayer(r,{name:'Rosa',socketId:'sc',token:`tc${tag}`});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;
  r.players.forEach(p=>{p.hand=[];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;p.roundHistory=[];p.score=0;});
  r.deck=[];
  return r;
}

const ranks=['2','3','4','5','6','9','10'];
const suits=['hearts','diamonds','clubs','spades'];

for(let i=0;i<500;i++){
  const r=room3(`pass-${i}`),carla=r.players[0],paulo=r.players[1];
  const rank=ranks[i%ranks.length], suit=suits[i%suits.length];
  const baseSuit=suits[(i+1)%suits.length];
  r.discard=[card(rank,baseSuit,`base-${i}`)];
  carla.hand=[
    card(rank,suit,`source-${i}`),
    card('A',baseSuit,`ca-${i}`),
    card('K',baseSuit,`ck-${i}`),
    card('3',suits[(i+2)%4],`cx-${i}`)
  ];
  paulo.hand=[
    card(rank,suit,`burn-${i}`),
    card('9',suit,`follow-${i}`),
    card('2',suits[(i+2)%4],`left-${i}`),
    card('3',suits[(i+3)%4],`left2-${i}`)
  ];

  E.playCard(r,carla.id,`source-${i}`);
  assert(E.canBurnMatch(r,paulo).some(c=>c.id===`burn-${i}`));
  E.burnMatch(r,paulo.id,`burn-${i}`);
  assert.equal(r.continuationPlayerId,paulo.id);
  const beforePass=paulo.hand.length;
  E.passTurn(r,paulo.id);
  assert.equal(paulo.hand.length,beforePass);
  assert.equal(r.continuationPlayerId,null);
  assert.notEqual(r.currentPlayer,1);
}

for(let i=0;i<500;i++){
  const r=room3(`draw-${i}`),carla=r.players[0],paulo=r.players[1];
  const rank=ranks[i%ranks.length], suit=suits[i%suits.length];
  const baseSuit=suits[(i+1)%suits.length];
  let otherSuit=suits[(i+2)%suits.length];
  if(otherSuit===suit) otherSuit=suits[(i+3)%suits.length];
  r.discard=[card(rank,baseSuit,`dbase-${i}`)];
  carla.hand=[
    card(rank,suit,`dsource-${i}`),
    card('A',baseSuit,`dca-${i}`),
    card('K',baseSuit,`dck-${i}`),
    card('3',otherSuit,`dcx-${i}`)
  ];
  // Cartas restantes deliberadamente incompatíveis com a carta queimada.
  const badRanks=['2','3','4','6','9','10'].filter(x=>x!==rank).slice(0,3);
  paulo.hand=[
    card(rank,suit,`dburn-${i}`),
    card(badRanks[0],otherSuit,`dbad1-${i}`),
    card(badRanks[1],otherSuit,`dbad2-${i}`),
    card(badRanks[2],otherSuit,`dbad3-${i}`)
  ];
  const drawn = i%2===0
    ? card('J','spades',`draw-${i}`)
    : card(rank,suits[(suits.indexOf(suit)+1)%4],`draw-${i}`);
  r.deck=[drawn];

  E.playCard(r,carla.id,`dsource-${i}`);
  E.burnMatch(r,paulo.id,`dburn-${i}`);
  assert.equal(paulo.hand.filter(c=>E.legalCard(r,c,paulo)).length,0);
  assert.throws(()=>E.passTurn(r,paulo.id),/Compre 1 carta/i);
  E.drawAction(r,paulo.id);
  assert.equal(paulo.justDrawnCardId,`draw-${i}`);
  assert(E.legalCard(r,paulo.hand.find(c=>c.id===`draw-${i}`),paulo));
  E.passTurn(r,paulo.id);
  assert(paulo.hand.some(c=>c.id===`draw-${i}`),'a carta jogável comprada deve poder ser guardada');
  assert.equal(paulo.justDrawnCardId,null);
  assert.equal(r.continuationPlayerId,null);
}

console.log('✓ V18 stress: 1.000 cenários de passe/compra após Queima Flexível passaram.');

// V18: bot também respeita a nova Queima Flexível e pode guardar um Valete comprado.
{
  const Bot=require('../bot-player');
  const r=room3('bot-flex'),carla=r.players[0],bot=r.players[1];
  bot.isBot=true;bot.name='Máquina';
  r.discard=[card('2','hearts','bot-flex-base')];
  carla.hand=[card('5','hearts','bot-flex-source'),card('3','clubs','bot-flex-c1'),card('4','diamonds','bot-flex-c2')];
  bot.hand=[card('5','hearts','bot-flex-burn'),card('2','clubs','bot-flex-b1'),card('3','diamonds','bot-flex-b2')];
  r.deck=[card('J','spades','bot-flex-j')];
  E.playCard(r,carla.id,'bot-flex-source');
  const br=Bot.takeBurnOpportunity(r,bot,E);
  assert.equal(br.action,'burn-match');
  const dr=Bot.takeTurn(r,bot,E);
  assert.equal(dr.action,'burn-draw');
  const pr=Bot.takeTurn(r,bot,E);
  assert.equal(pr.action,'burn-pass-drawn');
  assert(bot.hand.some(c=>c.id==='bot-flex-j'));
  assert.equal(r.continuationPlayerId,null);
}

console.log('✓ V18 bot: compra e guarda Valete após Queima Flexível.');

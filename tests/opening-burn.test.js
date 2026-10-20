'use strict';
const assert = require('assert');
const E = require('../game-engine');

function add(r,name,i){return E.addPlayer(r,{name,avatar:name[0],socketId:`s${i}`,token:`t${i}`});}
function card(rank,suit,id){return {rank,suit,id,copy:1};}

// Regressão: carta inicial normal, outro jogador tem a mesma carta, mas não é sua vez.
// Ele deve poder fazer AÇÃO RÁPIDA sem assumir a vez e sem segunda carta.
for(const n of [2,3,4,5]) {
  const r=E.createRoom(`OPN${n}`,{name:'Ana',avatar:'A',socketId:'s0',token:'t0'});
  for(let i=1;i<n;i++) add(r,`Jogador ${i}`,i);
  E.startRound(r);
  const top=card('5','clubs',`top-${n}`);
  r.discard=[top];
  r.reactionTopCardId=top.id;
  r.burnTopCardId=top.id;
  r.reactionSourcePlayerId=null;
  r.reactionNextPlayerId=r.players[r.currentPlayer].id;
  r.openingReaction=true;
  const openingTurn=r.currentPlayer;
  const outsider=r.players[(openingTurn+1)%n];
  const current=r.players[openingTurn];
  outsider.hand=[card('5','clubs',`quick-${n}`),card('9','clubs',`follow-${n}`),card('3','spades',`keep-${n}`)];
  current.hand=[card('5','clubs',`burn-${n}`),card('9','clubs',`next-${n}`),card('2','diamonds',`remain-${n}`)];

  assert(E.canQuickAction(r,outsider).some(c=>c.id===`quick-${n}`),'ação rápida permitida na abertura');
  assert.equal(E.canQuickAction(r,current).length,0,'jogador que começa não faz ação rápida');
  assert.equal(E.canBurnMatch(r,outsider).length,0,'fora da vez não existe Queima, nem na abertura');
  assert(E.canBurnMatch(r,current).some(c=>c.id===`burn-${n}`),'jogador da vez mantém Queima normal');
  assert.throws(()=>E.burnMatch(r,outsider.id,`quick-${n}`),/própria vez|Ação Rápida/i);

  const oldDirection=r.direction;
  E.quickAction(r,outsider.id,`quick-${n}`);
  assert.equal(r.currentPlayer,openingTurn,`a vez inicial deve permanecer, com ${n} jogadores`);
  assert.equal(r.direction,oldDirection,'Ação Rápida não muda direção');
  assert.equal(r.continuationPlayerId,null,'Ação Rápida não concede segunda jogada');
  assert.equal(r.discard.at(-1).id,`quick-${n}`);
  assert.equal(r.openingReaction,false,'a janela da abertura deve fechar');
  assert.equal(E.canQuickAction(r,outsider).length,0,'a primeira reação fecha a oportunidade');
  assert.throws(()=>E.playCard(r,outsider.id,`follow-${n}`),/Não é a sua vez/i);
  // O mesmo jogador que tinha a vez continua podendo jogar uma carta legal.
  E.playCard(r,current.id,`burn-${n}`);
  assert.equal(r.currentPlayer,openingTurn===undefined?-1:(openingTurn-1+n)%n,'o turno só avança pela jogada normal');
}

// Se a primeira ação for do próprio jogador inicial, ele pode Queimar com continuação.
{
  const r=E.createRoom('OPEN-OWN',{name:'Ana',avatar:'A',socketId:'s0',token:'t0'});
  add(r,'Bruno',1);add(r,'Carla',2);
  E.startRound(r);
  const current=r.players[r.currentPlayer];
  const top=card('5','hearts','opening-top');
  r.discard=[top];r.openingReaction=true;r.reactionTopCardId=top.id;
  r.reactionSourcePlayerId=null;r.reactionNextPlayerId=current.id;
  current.hand=[card('5','hearts','burn-own'),card('9','hearts','follow'),card('2','clubs','remain')];
  E.burnMatch(r,current.id,'burn-own');
  assert.equal(r.continuationPlayerId,current.id);
  assert.equal(r.players[r.currentPlayer].id,current.id);
  E.playCard(r,current.id,'follow');
  assert.equal(r.continuationPlayerId,null);
}

// O fim da abertura sem reação não cria permissões adicionais.
{
  const r=E.createRoom('OPEN-END',{name:'Ana',avatar:'A',socketId:'s0',token:'t0'});
  add(r,'Bruno',1);add(r,'Carla',2);add(r,'Diego',3);
  E.startRound(r);
  const top=card('5','hearts','starter');
  r.discard=[top];r.openingReaction=true;r.reactionTopCardId=top.id;
  r.reactionSourcePlayerId=null;r.reactionNextPlayerId=r.players[r.currentPlayer].id;
  const p=r.players[(r.currentPlayer+1)%4];
  p.hand=[card('5','hearts','late'),card('3','clubs','keep')];
  const current=r.players[r.currentPlayer];
  current.hand=[card('5','hearts','first-normal'),card('9','clubs','keep')];
  assert(E.canQuickAction(r,p).some(c=>c.id==='late'));
  E.playCard(r,current.id,'first-normal');
  assert.equal(r.openingReaction,false);
  assert.equal(E.canBurnMatch(r,p).length,0);
}

// Cartas especiais não podem iniciar Ação Rápida, mesmo no início da rodada.
{
  const r=E.createRoom('OPEN-SPEC',{name:'Ana',avatar:'A',socketId:'s0',token:'t0'});
  add(r,'Bruno',1);add(r,'Carla',2);
  E.startRound(r);
  const top=card('Q','hearts','special');
  r.discard=[top];r.openingReaction=true;r.reactionTopCardId=top.id;
  r.reactionSourcePlayerId=null;r.reactionNextPlayerId=r.players[r.currentPlayer].id;
  const outside=r.players[(r.currentPlayer+1)%3];
  outside.hand=[card('Q','hearts','special-copy'),card('3','clubs','remain')];
  assert.equal(E.canQuickAction(r,outside).length,0);
  assert.throws(()=>E.quickAction(r,outside.id,'special-copy'),/especiais/i);
}

console.log('✓ Abertura: Ação Rápida conserva vez e direção (2–5 jogadores); Queima apenas na vez.');

'use strict';
const assert=require('assert');
const E=require('../game-engine');

function add(r,name,i){return E.addPlayer(r,{name,avatar:name[0],socketId:`s${i}`,token:`t${i}`});}

// Reproduz o caso relatado: a primeira carta virada é 2♣ e um jogador que NÃO
// está na vez possui outro 2♣. Ele deve conseguir QUEIMAR a abertura.
{
  const r=E.createRoom('OPEN01',{name:'Ana',avatar:'A',socketId:'s0',token:'t0'});
  add(r,'Bruno',1);add(r,'Carla',2);add(r,'Diego',3);
  E.startRound(r);
  const top=r.discard.at(-1);
  assert(r.openingReaction,'a rodada deve abrir a janela especial de Queima da primeira carta');
  assert.equal(r.reactionTopCardId,top.id,'a reação de abertura precisa apontar para a carta inicial');

  const current=r.players[r.currentPlayer];
  const outsider=r.players.find(p=>p.id!==current.id);
  outsider.hand[0]={...top,id:'opening-copy'};

  const burnable=E.canBurnMatch(r,outsider);
  assert(burnable.some(c=>c.id==='opening-copy'),'jogador fora da vez deve poder queimar cópia exata da primeira carta');
  assert.equal(E.canQuickAction(r,outsider).length,0,'na abertura, a reação especial é Queima, não Ação Rápida');

  E.burnMatch(r,outsider.id,'opening-copy');
  assert.equal(r.currentPlayer,r.players.findIndex(p=>p.id===outsider.id),'quem queima a abertura assume a jogada');
  assert.equal(r.continuationPlayerId,outsider.id,'Queima da abertura deve conceder continuação normal');
  assert.equal(r.openingReaction,false,'a primeira Queima válida deve fechar a janela da abertura');
}

// Se ninguém queimar e o primeiro jogador iniciar sua ação normal, a exceção termina.
{
  const r=E.createRoom('OPEN02',{name:'Ana',avatar:'A',socketId:'s0',token:'t0'});
  add(r,'Bruno',1);add(r,'Carla',2);add(r,'Diego',3);
  E.startRound(r);
  const top=r.discard.at(-1);
  const currentIndex=r.currentPlayer;
  const current=r.players[currentIndex];
  // Escolhe alguém que também não será o próximo jogador após a primeira jogada,
  // para provar que a permissão fora da vez veio somente da abertura.
  const outsider=r.players[(currentIndex+2)%r.players.length];
  outsider.hand[0]={...top,id:'late-opening-copy'};
  assert(E.canBurnMatch(r,outsider).some(c=>c.id==='late-opening-copy'));

  // Força uma jogada normal válida do jogador da vez; isso fecha a abertura.
  current.hand[0]={rank:top.rank,suit:top.suit,id:'current-normal',copy:1};
  E.playCard(r,current.id,'current-normal');
  assert.equal(r.openingReaction,false);
  assert.equal(E.canBurnMatch(r,outsider).length,0,'depois da primeira ação normal, não existe mais Queima de abertura fora da vez');
}

console.log('✓ V40.3: Queima da primeira carta virada funciona mesmo fora da vez e fecha após a primeira ação.');

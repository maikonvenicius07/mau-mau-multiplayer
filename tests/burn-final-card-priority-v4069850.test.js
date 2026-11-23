'use strict';
// V40.69.8.50 — batida da ultima carta tem prioridade sobre a continuacao da Queima.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../game-engine');
const C=(rank,suit,id)=>({rank,suit,id,copy:1});
function setup({n=2,tournament=false,rounds=5}={}){
  const room=E.createRoom('QUEIMA-FINAL-50',{name:'Ana',socketId:'s1',token:'t1',playerKey:'a'});
  for(let i=2;i<=n;i++)E.addPlayer(room,{name:`Jogador ${i}`,socketId:`s${i}`,token:`t${i}`,playerKey:`key${i}`});
  room.status='playing';room.round=1;room.rules.rounds=rounds;
  room.direction=1;room.currentPlayer=0;
  room.discard=[C('6','spades','top')];
  room.deck=[C('2','hearts','d1'),C('3','hearts','d2'),C('4','hearts','d3'),C('5','hearts','d4')];
  room.players.forEach((p,i)=>{p.hand=[C('9','clubs',`opponent-${i}`),C('10','clubs',`other-${i}`)];p.score=0;p.roundHistory=[];p.declaration=null;p.finishedRound=false;p.justDrawnCardId=null;});
  if(tournament)room.tournament={id:'event-50',name:'Copa',rosterKeys:room.players.map(p=>p.playerKey)};
  return room;
}
// Mau-Mau e declarado e validado pelo motor ao passar de duas cartas para uma.
function reachLastCardWithCorrectDeclaration(room){
  const p=room.players[0];
  p.hand=[C('6','diamonds','penultimate'),C('6','hearts','last')];
  E.declare(room,p.id,'mau-mau');
  E.playCard(room,p.id,'penultimate');
  assert.equal(p.hand.length,1);
  assert.equal(p.declaration,null,'o anuncio e consumido ao passar para uma carta');
  assert.equal(room.continuationPlayerId,null,'o primeiro descarte nao era Queima');
  const next=room.players[1];
  next.hand=[C('6','hearts','opponent-play'),C('9','hearts','opponent-stays'),C('10','clubs','opponent-stays2')];
  E.playCard(room,next.id,'opponent-play');
  assert.equal(room.currentPlayer, nPlayerIndex(room,0),'a vez retorna ao dono da ultima carta para mesas com dois jogadores');
  assert.equal(E.canBurnMatch(room,p).length,1);
  return p;
}
function nPlayerIndex(room,i){return i;}
// Caminho real do aviso de Mau-Mau, descarte intermediario, ultima carta e pontuacao.
for(const mode of ['direct','button'])for(const tournament of [false,true]){
  const room=setup({tournament,rounds:tournament?1:5});
  const p=reachLastCardWithCorrectDeclaration(room);
  const count=room.deck.length;
  if(mode==='direct')E.playCard(room,p.id,'last');
  else E.burnMatch(room,p.id,'last');
  assert.equal(room.winnerId,p.id,`${mode}/${tournament}: venceu com a ultima carta`);
  assert.equal(room.status,tournament?'finished':'between-rounds');
  assert.equal(room.lastWinnerCard.id,'last');
  assert.equal(room.continuationPlayerId,null,'nunca deixa continuacao pendente apos batida');
  assert.equal(p.finishedRound,true);
  assert.equal(p.hand.length,0,'mao vazia');
  assert.equal(room.deck.length,count,'sem compra silenciosa');
  assert.equal(room.roundReview.winnerId,p.id);
  assert.equal(p.roundHistory.length,1);
  assert.equal(p.roundScore,0);
  assert(room.players[1].roundScore>0,'oponente recebe pontuacao real');
  assert.equal(E.roomPublicState(room,p.id).me.burnMustDraw,false);
  assert.throws(()=>E.burnMatch(room,p.id,'last'),/rodada não está em andamento/i,'duplicar o evento nao reinicia a rodada');
}
// Mesas com 3 ou 4 jogadores mantem a mesma prioridade de batida.
for(const n of [3,4]){
  const r=setup({n,rounds:1});const p=r.players[0];
  r.discard=[C('6','hearts','top')];p.hand=[C('6','hearts','last')];
  E.playCard(r,p.id,'last');
  assert.equal(r.winnerId,p.id);assert.equal(r.status,'finished');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(r.roundReview.players.length,n);
}
// Queima comum: com cartas restantes ainda exige jogar mais uma ou comprar manualmente.
for(const route of ['direct','button']){
  const r=setup();const p=r.players[0];r.discard=[C('6','hearts','top')];
  p.hand=[C('6','hearts','burn'),C('2','clubs','other'),C('3','diamonds','extra')];
  const deckCount=r.deck.length;
  if(route==='direct')E.playCard(r,p.id,'burn');else E.burnMatch(r,p.id,'burn');
  assert.equal(r.status,'playing');assert.equal(r.winnerId,null);
  assert.equal(r.continuationPlayerId,p.id);assert.equal(p.hand.length,2);
  assert.equal(r.deck.length,deckCount);
  assert.throws(()=>E.passTurn(r,p.id),/COMPRAR/i);
  E.drawAction(r,p.id);assert.equal(r.deck.length,deckCount-1);
  E.passTurn(r,p.id);assert.equal(r.continuationPlayerId,null);
}
// A infracao de Mau-Mau continua recebendo a penalidade quando se chegaria a 1 carta.
{
  const r=setup(),p=r.players[0];
  r.discard=[C('4','hearts','top')];
  p.hand=[C('9','hearts','play'),C('6','clubs','remaining')];
  E.playCard(r,p.id,'play');
  assert.equal(p.hand.length,3,'a compra de +2 impede uma batida indevida por falta do anuncio');
  assert.equal(r.winnerId,null);
  assert.match(r.log.map(x=>x.message).join(' '),/esqueceu de anunciar Mau-Mau/i);
}
// Sem o anuncio de Mau-Mau, a Queima com duas cartas ainda eh rejeitada sem alterar cartas.
{
  const r=setup(),p=r.players[0];r.discard=[C('6','hearts','top')];
  p.hand=[C('6','hearts','burn'),C('2','clubs','rest')];
  const snapshot=JSON.stringify({hand:p.hand,discard:r.discard,deck:r.deck});
  assert.throws(()=>E.playCard(r,p.id,'burn'),/anuncie.*Mau-Mau/i);
  assert.equal(JSON.stringify({hand:p.hand,discard:r.discard,deck:r.deck}),snapshot);
}
// Regras de baralho especial, Ação Rápida e Carta Dupla permanecem fora do novo caminho.
{
  const r=setup(),p=r.players[0];r.discard=[C('7','hearts','top')];
  p.hand=[C('7','hearts','seven')];E.playCard(r,p.id,'seven');
  assert.equal(r.finishPendingSeven,true,'cadeia final do 7 continua tendo precedencia');
}
const src=fs.readFileSync(path.join(__dirname,'../game-engine.js'),'utf8');
const burn=src.slice(src.indexOf('function burnMatch('),src.indexOf('function burnPair('));
assert(!/drawCards\(|drawOne\(/.test(burn),'nenhuma compra automatica dentro de burnMatch');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
assert.match(server,/socket\.on\('playCard',[\s\S]*?Engine\.playCard\(room,p\.id,/);
assert.match(server,/socket\.on\('burnMatch',[\s\S]*?Engine\.burnMatch\(room,p\.id,/);
console.log('✓ V40.69.8.50: ultima carta por clique/botao, torneio e sala normal, 2/3/4 jogadores, Mau-Mau, sem compra e sem regressao na Queima.');

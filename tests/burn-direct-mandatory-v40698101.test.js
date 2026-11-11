'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../game-engine');

function card(rank,suit,id){return {id,rank,suit,copy:1};}
function setup(n=3, top=card('6','hearts','top')){
  const r=E.createRoom('BURN-CLICK',{name:'P1',socketId:'s1',token:'t1'});
  for(let i=2;i<=n;i++) E.addPlayer(r,{name:`P${i}`,socketId:`s${i}`,token:`t${i}`});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;
  r.discard=[top];r.deck=[card('J','spades','bought')];
  r.players.forEach(p=>{
    p.connected=true;p.finishedRound=false;p.hand=[];p.declaration=null;
    p.justDrawnCardId=null;p.roundHistory=[];p.score=0;
  });
  return r;
}
function badHand(rank='6',suit='hearts'){
  return [card(rank,suit,'identical'),card('2','clubs','bad-1'),card('3','diamonds','bad-2')];
}
function snapshot(r){
  return JSON.stringify({turn:r.currentPlayer,deck:r.deck,discard:r.discard,
    hands:r.players.map(p=>p.hand),continuation:r.continuationPlayerId ? r.players.findIndex(p=>p.id===r.continuationPlayerId) : null,
    drawIds:r.players.map(p=>p.justDrawnCardId)});
}

// 1. Exatamente o caso 6♥: clique direto = botão; compra só antes de PASSAR.
{
  const direct=setup(),button=setup();
  const a=direct.players[0],b=button.players[0];
  a.hand=badHand();b.hand=badHand();
  assert.deepEqual(E.canBurnMatch(direct,a).map(c=>c.id),['identical']);
  E.playCard(direct,a.id,'identical');
  E.burnMatch(button,b.id,'identical');
  assert.equal(direct.continuationPlayerId,a.id,'o clique direto deve iniciar a continuação da Queima');
  assert.equal(direct.currentPlayer,0,'a vez não pode avançar após a Queima');
  assert.equal(direct.discard.length,2,'o descarte ocorre exatamente uma vez');
  assert.equal(a.hand.length,2,'somente a carta idêntica deve sair da mão');
  assert.equal(direct.deck.length,1,'compra não é automática no descarte: só antes de passar');
  assert.equal(snapshot(direct),snapshot(button),'clique direto e botão devem ter estado idêntico');
  assert.throws(()=>E.passTurn(direct,a.id),/obrigat[oó]rio comprar|Compre 1 carta/i);
  const state=E.roomPublicState(direct,a.id);
  assert.equal(state.me.burnContinuationActive,true);
  assert.equal(state.me.burnMustDraw,true);
  assert.equal(state.currentPlayerId,a.id);
  const other=E.roomPublicState(direct,direct.players[1].id);
  assert.equal(other.currentPlayerId,a.id,'todos os clientes enxergam a mesma vez');
  assert.equal(other.me.burnMustDraw,false,'a obrigação é privada do jogador que queimou');
  E.drawAction(direct,a.id);
  assert.equal(a.hand.length,3,'uma carta obrigatória foi comprada');
  assert.equal(a.justDrawnCardId,'bought');
  assert.equal(direct.deck.length,0);
  assert.equal(E.roomPublicState(direct,a.id).me.burnMustDraw,false);
  assert.throws(()=>E.drawAction(direct,a.id),/j[aá] cumpriu a compra/i,'não pode comprar duas vezes');
  E.passTurn(direct,a.id);
  assert.equal(direct.continuationPlayerId,null);
  assert.notEqual(direct.currentPlayer,0);
  assert.equal(a.hand.length,3,'a carta comprada deve permanecer na mão ao passar');
  assert.equal(direct.discard.length,2);
  E.drawAction(button,b.id);
  E.passTurn(button,b.id);
  assert.equal(snapshot(direct),snapshot(button),'após comprar e passar, botão e clique devem permanecer idênticos');
  assert.throws(()=>E.playCard(direct,a.id,'identical'),/N[aã]o [eé] a sua vez/i,'repetição não causa nova jogada');
}

// 2. Queima opcional com outra carta válida: o clique comum preserva sua ação.
for(const extra of [card('9','hearts','legal-suit'),card('6','clubs','legal-rank'),card('J','spades','legal-jack'),card('6','hearts','legal-copy')]){
  const direct=setup(),button=setup();
  direct.players[0].hand=[card('6','hearts','identical'),extra,card('2','clubs','invalid')];
  button.players[0].hand=[card('6','hearts','identical'),extra,card('2','clubs','invalid')];
  E.playCard(direct,direct.players[0].id,'identical');
  assert.equal(direct.continuationPlayerId,null,`Queima deve continuar opcional com ${extra.id}`);
  assert.equal(direct.currentPlayer,2,'clique normal passa ao seguinte em sentido anti-horário');
  E.burnMatch(button,button.players[0].id,'identical');
  assert.equal(button.continuationPlayerId,button.players[0].id,'botão sempre inicia Queima opcional');
}

// 3. Todos os naipes e valores normais: sem outra opção, desvio proibido.
const ranks=['2','3','4','5','6','9','10'];
const suits=['hearts','diamonds','clubs','spades'];
let matrix=0;
for(const rank of ranks) for(const suit of suits) for(const players of [2,3,4,5]){
  const r=setup(players,card(rank,suit,'top'));
  const p=r.players[0];
  const badSuit=suits.find(s=>s!==suit),badRank=ranks.find(v=>v!==rank);
  const badRank2=ranks.find(v=>v!==rank&&v!==badRank);
  p.hand=[card(rank,suit,'identical'),card(badRank,badSuit,'bad-1'),card(badRank2,badSuit,'bad-2')];
  E.playCard(r,p.id,'identical');
  assert.equal(r.continuationPlayerId,p.id,`${rank}/${suit}/${players}`);
  assert.equal(r.discard.length,2);
  assert.throws(()=>E.passTurn(r,p.id),/obrigat[oó]rio comprar|Compre 1 carta/i);
  matrix++;
}

// 4. Mau-Mau com duas cartas continua necessário; falhas são atômicas.
{
  const r=setup();const p=r.players[0];p.hand=[card('6','hearts','identical'),card('2','clubs','bad')];
  const before=snapshot(r);
  assert.throws(()=>E.playCard(r,p.id,'identical'),/anuncie.*Mau-Mau/i);
  assert.equal(snapshot(r),before,'erro de anúncio não pode mudar cartas, turno ou baralho');
  E.declare(r,p.id,'mau-mau');
  E.playCard(r,p.id,'identical');
  assert.equal(r.continuationPlayerId,p.id);
  assert.equal(p.hand.length,1);
  assert.throws(()=>E.passTurn(r,p.id),/obrigat[oó]rio comprar|Compre 1 carta/i);
}

// 5. Regra desativada, penalidade de 7, continuação e efeitos especiais preservados.
{
  const r=setup();r.rules.burnEnabled=false;const p=r.players[0];p.hand=badHand();
  E.playCard(r,p.id,'identical');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(r.currentPlayer,2);
}
{
  const r=setup();const p=r.players[0];
  r.discard=[card('7','hearts','seven')];r.pendingSeven=2;
  p.hand=[card('7','clubs','seven-reply'),card('2','clubs','other')];
  E.playCard(r,p.id,'seven-reply');assert.equal(r.pendingSeven,4);
  assert.equal(r.continuationPlayerId,null);
}
{
  const r=setup();const p=r.players[0];p.hand=[card('6','hearts','identical'),card('9','hearts','follow'),card('2','clubs','bad')];
  E.burnMatch(r,p.id,'identical');
  E.playCard(r,p.id,'follow');
  assert.equal(r.continuationPlayerId,null,'segunda carta encerra a Queima sem compra');
  assert.equal(r.currentPlayer,2);
}
{
  const r=setup();const p=r.players[0];p.hand=[card('6','hearts','identical'),card('6','hearts','pair'),card('2','clubs','bad')];
  E.declare(r,p.id,'mau-mau');
  E.playDoubleCard(r,p.id,'identical','pair');
  assert.equal(r.continuationPlayerId,null,'×2 Dupla não pode virar Queima');
  assert.equal(r.discard.length,3);
}
{
  const r=setup();const p=r.players[0];p.hand=[card('6','hearts','identical'),card('2','clubs','bad')];
  E.declare(r,p.id,'mau-mau');
  E.drawAction(r,p.id);
  const drawn=p.hand.find(c=>c.id==='bought');
  assert(drawn);
  E.playDrawnCard(r,p.id,'identical');
  assert.equal(r.continuationPlayerId,null,'quando há Valete comprado na mão, Queima é opcional');
}
{
  const r=setup(3); const p=r.players[0];
  p.hand=[card('9','hearts','normal'),card('2','clubs','other')];
  r.discard=[card('6','hearts','top')];
  E.playCard(r,p.id,'normal');
  const outsider=r.players[1];outsider.hand=[card('9','hearts','quick'),card('2','clubs','bad'),card('4','diamonds','other')];
  assert.equal(E.canQuickAction(r,outsider).length,1);
  E.quickAction(r,outsider.id,'quick');
  assert.equal(r.continuationPlayerId,null,'Jogada Rápida não cria continuação da Queima');
}
// 6. Contrato dos dois eventos no servidor: somente o motor toma decisões.
{
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  assert.match(server,/socket\.on\('playCard',[\s\S]*?Engine\.playCard\(room,p\.id,/);
  assert.match(server,/socket\.on\('burnMatch',[\s\S]*?Engine\.burnMatch\(room,p\.id,/);
  assert.match(client,/socket\.emit\('playCard',\{cardId:card\.id\}\)/);
  assert.match(client,/socket\.emit\('burnMatch',\{cardId:card\.id\}\)/);
}
console.log(`✓ V40.69.8.10.1: Queima obrigatória pelo motor, clique/botão equivalentes, ${matrix} combinações, Mau-Mau, opções válidas, Dupla, Rápida, 7 e estado multiplayer.`);

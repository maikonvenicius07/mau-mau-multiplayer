'use strict';
const assert = require('assert');
const E = require('../game-engine');

function card(rank, suit, id) { return { rank, suit, id, copy: 1 }; }
function baseRoom(n=3, dir=-1) {
  const r = E.createRoom('FREEZE',{name:'P1',avatar:'1',socketId:'s1',token:'t1'});
  for (let i=2;i<=n;i++) E.addPlayer(r,{name:`P${i}`,avatar:String(i),socketId:`s${i}`,token:`t${i}`});
  r.status='playing'; r.round=1; r.direction=dir; r.currentPlayer=0; r.deck=E.createDeck();
  r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{
    p.hand=[]; p.score=0; p.roundScore=0; p.roundHistory=[]; p.connected=true;
    p.finishedRound=false; p.declaration=null; p.justDrawnCardId=null;
  });
  return r;
}

// Estrutura congelada.
assert.equal(E.createDeck().length,104,'baralho deve continuar com 104 cartas');
assert.equal(E.DEFAULT_RULES.rounds,5,'partida deve continuar com 5 rodadas');
assert.equal(E.DEFAULT_RULES.cardsPerPlayer,6,'cada jogador deve continuar recebendo 6 cartas');
assert.equal(E.DEFAULT_RULES.mauMauPenalty,2,'penalidade do Mau-Mau deve continuar +2');
assert.equal(E.createRoom('DIR',{name:'A',socketId:'x',token:'x'}).direction,-1,'sentido inicial deve continuar anti-horário');
assert.deepEqual([...E.SPECIAL_RANKS].sort(),['7','8','A','J','K','Q'].sort(),'cartas especiais devem permanecer A,7,8,J,Q,K');

// Pontuação das figuras.
assert.equal(E.cardPoints(card('A','hearts','a')),1);
assert.equal(E.cardPoints(card('J','hearts','j')),11);
assert.equal(E.cardPoints(card('Q','hearts','q')),12);
assert.equal(E.cardPoints(card('K','hearts','k')),13);

// Ás: pula exatamente o próximo jogador.
{
  const r=baseRoom(4,1), p=r.players[0];
  p.hand=[card('A','hearts','ace'),card('2','clubs','left')];
  E.playCard(r,p.id,'ace');
  assert.equal(r.currentPlayer,2,'Ás deve pular P2 e entregar a vez a P3');
  assert.equal(r.direction,1,'Ás não pode inverter o sentido');
}

// Dama: inverte; com 2 jogadores, quem jogou joga novamente.
{
  const r=baseRoom(2,-1), p=r.players[0];
  p.hand=[card('Q','hearts','queen2'),card('2','clubs','left')];
  E.playCard(r,p.id,'queen2');
  assert.equal(r.direction,1,'Dama deve inverter o sentido');
  assert.equal(r.currentPlayer,0,'com 2 jogadores, Dama deve devolver a vez a quem jogou');
}
{
  const r=baseRoom(4,1), p=r.players[0];
  p.hand=[card('Q','hearts','queen4'),card('2','clubs','left')];
  E.playCard(r,p.id,'queen4');
  assert.equal(r.direction,-1,'Dama deve inverter 1 -> -1');
  assert.equal(r.currentPlayer,3,'com 4 jogadores, deve seguir ao adjacente no novo sentido');
}

// 7: +2 e rebote acumula.
{
  const r=baseRoom(2,1), a=r.players[0], b=r.players[1];
  a.hand=[card('7','hearts','a7'),card('2','clubs','a2')];
  b.hand=[card('7','clubs','b7'),card('3','spades','b3')];
  E.playCard(r,a.id,'a7');
  assert.equal(r.pendingSeven,2);
  E.playCard(r,b.id,'b7');
  assert.equal(r.pendingSeven,4,'dois 7 devem acumular +4');
}

// 8 e K: penalizam o jogador anterior no sentido atual.
{
  const r=baseRoom(4,1), p=r.players[1];
  r.currentPlayer=1; r.discard=[card('5','clubs','t8')];
  p.hand=[card('8','clubs','eight'),card('2','hearts','left')];
  r.players[0].hand=[card('3','hearts','x')];
  const before=r.players[0].hand.length;
  E.playCard(r,p.id,'eight');
  assert.equal(r.players[0].hand.length,before+2,'8 deve dar +2 ao jogador anterior');
}
{
  const r=baseRoom(4,1), p=r.players[1];
  r.currentPlayer=1; r.discard=[card('5','clubs','tk')];
  p.hand=[card('K','clubs','king'),card('2','hearts','left')];
  r.players[0].hand=[card('3','hearts','x')];
  const before=r.players[0].hand.length;
  E.playCard(r,p.id,'king');
  assert.equal(r.players[0].hand.length,before+1,'K deve dar +1 ao jogador anterior');
}

// Valete: coringa e escolha de naipe.
{
  const r=baseRoom(3,1), p=r.players[0];
  r.discard=[card('5','hearts','tj')];
  p.hand=[card('J','spades','jack'),card('2','clubs','left')];
  E.playCard(r,p.id,'jack','clubs');
  assert.equal(r.requestedSuit,'clubs','Valete deve permitir escolher o naipe');
}

// Mau-Mau esquecido: ao cair de 2 para 1 carta, compra +2.
{
  const r=baseRoom(2,1), p=r.players[0];
  p.hand=[card('5','clubs','play5'),card('2','spades','last')];
  r.discard=[card('5','hearts','tm')];
  const before=p.hand.length;
  E.playCard(r,p.id,'play5');
  assert.equal(before,2);
  assert.equal(p.hand.length,3,'sem anunciar Mau-Mau, deve restar 1 + comprar 2 = 3 cartas');
}

// Carta Dupla: normal pode; especial não pode.
{
  const r=baseRoom(2,1), p=r.players[0];
  r.discard=[card('5','hearts','td')];
  p.hand=[card('5','hearts','d1'),card('5','hearts','d2'),card('2','clubs','left')];
  assert.equal(E.canPlayDouble(r,p).length,1,'carta normal idêntica deve permitir Carta Dupla');
}
{
  const r=baseRoom(2,1), p=r.players[0];
  r.discard=[card('Q','hearts','tq')];
  p.hand=[card('Q','hearts','q1'),card('Q','hearts','q2'),card('2','clubs','left')];
  assert.equal(E.canPlayDouble(r,p).length,0,'carta especial não pode entrar em Carta Dupla');
}

// Queima: especial não inicia; carta normal idêntica pode iniciar na própria vez.
{
  const r=baseRoom(2,1), p=r.players[0];
  r.currentPlayer=0; r.discard=[card('5','hearts','burn-top')];
  r.lastPlayedById=r.players[1].id; r.burnTopCardId='burn-top'; r.reactionTopCardId='burn-top';
  r.reactionSourcePlayerId=r.players[1].id; r.reactionNextPlayerId=p.id;
  p.hand=[card('5','hearts','burn-ok'),card('9','hearts','follow')];
  assert.equal(E.canBurnMatch(r,p).length,1,'carta normal exatamente igual deve poder iniciar Queima na própria vez');
}
{
  const r=baseRoom(2,1), p=r.players[0];
  r.currentPlayer=0; r.discard=[card('Q','hearts','burn-q-top')];
  r.lastPlayedById=r.players[1].id; r.burnTopCardId='burn-q-top'; r.reactionTopCardId='burn-q-top';
  r.reactionSourcePlayerId=r.players[1].id; r.reactionNextPlayerId=p.id;
  p.hand=[card('Q','hearts','burn-q'),card('9','hearts','follow')];
  assert.equal(E.canBurnMatch(r,p).length,0,'carta especial não pode iniciar Queima');
}

// Ação Rápida: somente carta normal exatamente igual, fora da vez, sem tomar o turno.
{
  const r=baseRoom(4,1), source=r.players[0], next=r.players[1], reactor=r.players[2];
  const top=card('5','hearts','quick-top');
  r.discard=[top]; r.currentPlayer=1; r.lastPlayedById=source.id;
  r.reactionTopCardId=top.id; r.reactionSourcePlayerId=source.id; r.reactionNextPlayerId=next.id; r.burnTopCardId=top.id;
  reactor.hand=[card('5','hearts','quick-match'),card('2','clubs','left')];
  assert.equal(E.canQuickAction(r,reactor).length,1,'Ação Rápida deve aceitar carta normal exatamente igual');
  E.quickAction(r,reactor.id,'quick-match');
  assert.equal(r.currentPlayer,1,'Ação Rápida não pode roubar a vez do próximo jogador');
}

console.log('✓ Pré-APK: base de regras V40.69.2 congelada e protegida contra regressão acidental.');

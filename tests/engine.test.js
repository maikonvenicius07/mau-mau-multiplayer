'use strict';
const assert = require('assert');
const E = require('../game-engine');

function card(rank,suit,id){return {rank,suit,id:id||`${rank}${suit}${Math.random()}`,copy:1};}
function room2(){
  const r=E.createRoom('ABC123',{name:'Ana',avatar:'👩',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Bruno',avatar:'🧑',socketId:'s2',token:'t2'});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;r.deck=E.createDeck();r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.roundHistory=[];p.score=0;p.connected=true;p.finishedRound=false;});
  return r;
}

assert.equal(E.createDeck().length,104,'dois baralhos sem curingas = 104 cartas');
assert.equal(E.cardPoints(card('A','hearts')),1);
assert.equal(E.cardPoints(card('J','hearts')),11);
assert.equal(E.cardPoints(card('Q','hearts')),12);
assert.equal(E.cardPoints(card('K','hearts')),13);
assert.equal(E.cardPoints(card('10','hearts')),10);

{
  const r=room2(),p=r.players[0];
  p.hand=[card('5','clubs','a'),card('9','hearts','b'),card('J','spades','c'),card('3','clubs','d')];
  assert(E.legalCard(r,p.hand[0],p)); // mesmo valor
  assert(E.legalCard(r,p.hand[1],p)); // mesmo naipe
  assert(E.legalCard(r,p.hand[2],p)); // J livre
  assert(!E.legalCard(r,p.hand[3],p));
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('7','hearts','a7'),card('2','clubs','a2')];
  b.hand=[card('7','clubs','b7'),card('4','spades','b4')];
  E.playCard(r,a.id,'a7');
  assert.equal(r.pendingSeven,2);
  assert.equal(r.currentPlayer,1);
  E.playCard(r,b.id,'b7');
  assert.equal(r.pendingSeven,4);
  assert.equal(r.currentPlayer,0);
  // Ana não tem mais 7 e deve comprar 4.
  const before=a.hand.length;
  E.drawAction(r,a.id);
  assert.equal(a.hand.length,before+4);
  assert.equal(r.pendingSeven,0);
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  // queimando duas cartas iguais + continuação
  a.hand=[card('5','hearts','x1'),card('5','hearts','x2'),card('5','clubs','x3'),card('2','spades','x4')];
  b.hand=[card('4','clubs','b1')];
  E.burnPair(r,a.id,'x1');
  assert.equal(a.hand.length,2);
  assert.equal(r.continuationPlayerId,a.id);
  E.playCard(r,a.id,'x3');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(r.currentPlayer,1);
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('9','hearts','m1'),card('2','spades','m2')];
  // precisa anunciar ao ficar com uma; sem anúncio compra +2
  E.playCard(r,a.id,'m1');
  assert.equal(a.hand.length,3);
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('J','spades','j1')];
  b.hand=[card('K','clubs','k1'),card('10','hearts','t1')];
  E.playCard(r,a.id,'j1');
  assert.equal(r.status,'between-rounds');
  assert.equal(b.roundScore,(13+10)*2,'Valete final dobra pontos dos demais');
}

{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('4','clubs','q1'),card('4','clubs','q2')];
  b.hand=[card('2','hearts','b')];
  // top 5♥ -> 4♣ não é jogável, então muda topo para 4♥ para validar por valor.
  r.discard=[card('4','hearts','top4')];
  assert.throws(()=>E.burnPair(r,a.id,'q1'),/Mau-Mau batendo/);
  E.declare(r,a.id,'batendo');
  E.burnPair(r,a.id,'q1');
  assert.equal(r.status,'between-rounds');
  assert.equal(r.winnerId,a.id);
}

console.log('✓ Todos os testes do motor do Mau-Mau passaram.');

// Penalidade do 7 ainda é resolvida depois da batida.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('7','hearts','last7')];
  b.hand=[card('3','clubs','b3')];
  E.playCard(r,a.id,'last7');
  assert.equal(r.winnerId,a.id);
  assert.equal(r.pendingSeven,2);
  assert.equal(r.status,'playing');
  const before=b.hand.length;
  E.drawAction(r,b.id);
  assert.equal(b.hand.length,before+2);
  assert.equal(r.status,'between-rounds');
}


// A sala não pode travar por causa de jogador fantasma desconectado antes da 1ª rodada.
{
  const r=E.createRoom('GHOST1',{name:'Host',avatar:'🧑',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Conectado',avatar:'👩',socketId:'s2',token:'t2'});
  const ghost=E.addPlayer(r,{name:'Fantasma',avatar:'😴',socketId:null,token:'t3'});
  ghost.connected=false;
  E.startRound(r);
  assert.equal(r.status,'playing');
  assert.equal(r.players.length,2,'jogador desconectado no lobby deve ser removido antes de iniciar');
  assert(r.players.every(p=>p.connected));
}

console.log('✓ Correção de jogadores fantasmas/reconexão validada.');

// V7: jogador automático.
{
  const Bot = require('../bot-player');
  const r=room2(), human=r.players[0], bot=r.players[1];
  bot.isBot=true; bot.name='Máquina'; bot.avatar='🤖';
  r.currentPlayer=1;
  bot.hand=[card('5','clubs','bot5'),card('2','spades','bot2')];
  human.hand=[card('3','hearts','h3'),card('4','clubs','h4')];
  const result=Bot.takeTurn(r,bot,E);
  assert.equal(result.action,'play');
  assert.equal(bot.hand.length,1);
  assert.equal(r.discard.at(-1).rank,'5');
}

{
  const Bot = require('../bot-player');
  const r=room2(), human=r.players[0], bot=r.players[1];
  bot.isBot=true; r.currentPlayer=1; r.pendingSeven=2;
  bot.hand=[card('7','clubs','b7'),card('9','spades','b9')];
  human.hand=[card('3','hearts','h3')];
  const result=Bot.takeTurn(r,bot,E);
  assert.equal(result.action,'counter-seven');
  assert.equal(r.pendingSeven,4);
}

{
  const Bot = require('../bot-player');
  const r=room2(), bot=r.players[1];
  bot.isBot=true; r.currentPlayer=1; r.discard=[card('4','hearts','top4')];
  bot.hand=[card('4','clubs','x1'),card('4','clubs','x2')];
  const result=Bot.takeTurn(r,bot,E);
  assert.equal(result.action,'burn');
  assert.equal(r.winnerId,bot.id);
  assert.equal(r.status,'between-rounds');
}

console.log('✓ Jogador automático validado.');

{
  const Bot = require('../bot-player');
  const r=room2(), bot=r.players[1];
  bot.isBot=true; r.currentPlayer=1; r.discard=[card('9','hearts','top9')];
  bot.hand=[card('2','clubs','b2')];
  // Simula uma carta recém-comprada que é jogável.
  const drawn=card('9','spades','drawn9');
  bot.hand.push(drawn); bot.justDrawnCardId=drawn.id;
  const result=Bot.takeTurn(r,bot,E);
  assert.equal(result.action,'play-drawn');
  assert.equal(bot.justDrawnCardId,null,'o marcador de carta recém-comprada deve ser limpo');
}

console.log('✓ Compra e jogada automática do bot validada.');

{
  const r=room2(),a=r.players[0];
  r.discard=[card('4','hearts','top4b')];
  a.hand=[card('4','clubs','z1'),card('4','clubs','z2'),card('9','spades','z3')];
  E.declare(r,a.id,'mau-mau');
  E.burnPair(r,a.id,'z1');
  assert.equal(a.hand.length,1,'queima de 3 para 1 deve aceitar anúncio Mau-Mau');
}

console.log('✓ Mau-Mau antes de queima de 3 para 1 validado.');


// V8: Dama com 2 jogadores inverte o sentido e devolve a vez ao mesmo jogador.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.direction=-1;
  r.currentPlayer=0;
  r.discard=[card('5','hearts','topQ2')];
  a.hand=[card('Q','hearts','q2'),card('3','clubs','a3')];
  b.hand=[card('4','spades','b4')];
  E.playCard(r,a.id,'q2');
  assert.equal(r.direction,1,'a Dama deve inverter o sentido');
  assert.equal(r.currentPlayer,0,'com 2 jogadores, quem joga a Dama deve jogar novamente');
}

// V8: com 3 jogadores a Dama inverte o sentido e passa ao próximo no novo sentido.
{
  const r=room2();
  r.status='lobby';
  E.addPlayer(r,{name:'Carla',avatar:'👩',socketId:'s3',token:'t3'});
  const a=r.players[0],c=r.players[2];
  r.status='playing'; r.round=1; r.direction=-1; r.currentPlayer=0;
  r.players.forEach(p=>{p.finishedRound=false;p.connected=true;p.hand=[];});
  r.discard=[card('5','hearts','topQ3')];
  a.hand=[card('Q','hearts','q3'),card('3','clubs','a3b')];
  r.players[1].hand=[card('4','clubs','b4c')];
  c.hand=[card('6','spades','c6')];
  E.playCard(r,a.id,'q3');
  assert.equal(r.direction,1);
  assert.equal(r.currentPlayer,1,'com 3 jogadores, deve seguir para o próximo no sentido invertido');
}

console.log('✓ Regra da Dama (Q) para 2 jogadores validada.');


// V10: jogador pode passar a vez depois de comprar uma carta jogável.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;
  r.discard=[card('5','hearts','topV10')];
  a.hand=[card('2','clubs','v10nao')];
  r.deck=[card('5','spades','v10draw')];
  E.drawAction(r,a.id);
  assert.equal(a.justDrawnCardId,'v10draw','carta comprada jogável deve oferecer escolha');
  assert.equal(r.currentPlayer,0,'a vez deve permanecer enquanto o jogador decide');
  assert.equal(a.hand.length,2);
  E.passAfterDraw(r,a.id);
  assert.equal(a.justDrawnCardId,null);
  assert.equal(r.currentPlayer,1,'ao clicar em Passar a vez, deve avançar para o outro jogador');
  assert.equal(a.hand.length,2,'a carta comprada deve permanecer na mão');
}

console.log('✓ V10: passar a vez após comprar carta jogável validado.');

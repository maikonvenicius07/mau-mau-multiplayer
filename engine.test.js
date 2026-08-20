'use strict';
const assert = require('assert');
const E = require('../game-engine');
const Bot = require('../bot-player');

function card(rank,suit,id){return {rank,suit,id:id||`${rank}${suit}${Math.random()}`,copy:1};}
function room2(){
  const r=E.createRoom('ABC123',{name:'Ana',avatar:'👩',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Bruno',avatar:'🧑',socketId:'s2',token:'t2'});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;r.deck=E.createDeck();
  r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.roundHistory=[];p.score=0;p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;});
  return r;
}
function openBurn(r,sourcePlayer,top){
  r.discard=[top];
  r.lastPlayedById=sourcePlayer.id;
  r.burnTopCardId=top.id;
}

assert.equal(E.createDeck().length,104,'dois baralhos sem curingas = 104 cartas');
assert.equal(E.cardPoints(card('A','hearts')),1);
assert.equal(E.cardPoints(card('J','hearts')),11);
assert.equal(E.cardPoints(card('Q','hearts')),12);
assert.equal(E.cardPoints(card('K','hearts')),13);
assert.equal(E.cardPoints(card('10','hearts')),10);

// Jogada normal: mesmo valor, mesmo naipe ou Valete.
{
  const r=room2(),p=r.players[0];
  p.hand=[card('5','clubs','a'),card('9','hearts','b'),card('J','spades','c'),card('3','clubs','d')];
  assert(E.legalCard(r,p.hand[0],p));
  assert(E.legalCard(r,p.hand[1],p));
  assert(E.legalCard(r,p.hand[2],p));
  assert(!E.legalCard(r,p.hand[3],p));
}

// Cadeia do 7.
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
  const before=a.hand.length;
  E.drawAction(r,a.id);
  assert.equal(a.hand.length,before+4);
  assert.equal(r.pendingSeven,0);
}

// V11: outro jogador baixa 5♥; Bruno tem 5♥ e 9♥. Mesmo fora da vez,
// ele pode queimar 5♥ e depois é obrigado a completar com 9♥.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  const top=card('5','hearts','burn-top');
  openBurn(r,a,top);
  r.currentPlayer=0; // ainda seria a vez de Ana/ordem normal; Bruno vai atravessar.
  a.hand=[card('3','clubs','a3')];
  b.hand=[card('5','hearts','b5h'),card('9','hearts','b9h'),card('2','clubs','b2'),card('3','spades','b3')];
  const burnable=E.canBurnMatch(r,b);
  assert.equal(burnable.length,1);
  assert.equal(burnable[0].id,'b5h');
  E.burnMatch(r,b.id,'b5h');
  assert.equal(r.currentPlayer,1,'quem queima deve assumir a jogada');
  assert.equal(r.continuationPlayerId,b.id,'segunda carta deve ser obrigatória');
  assert.equal(b.hand.length,3);
  E.playCard(r,b.id,'b9h');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(b.hand.length,2);
  assert.equal(r.currentPlayer,0,'após completar, segue a ordem a partir de quem queimou');
}

// A primeira carta da queima precisa ser exatamente igual ao topo.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  openBurn(r,a,card('5','hearts','top-exact'));
  b.hand=[card('5','diamonds','wrong-suit'),card('9','diamonds','follow')];
  assert.equal(E.canBurnMatch(r,b).length,0);
}

// Não pode iniciar queima sem a segunda carta compatível.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  openBurn(r,a,card('5','hearts','top-no-follow'));
  b.hand=[card('5','hearts','same'),card('2','clubs','no-follow')];
  assert.equal(E.canBurnMatch(r,b).length,0);
  assert.throws(()=>E.burnMatch(r,b.id,'same'),/segunda carta/);
}

// Não pode queimar a própria carta recém-jogada.
{
  const r=room2(),a=r.players[0];
  const top=card('5','hearts','own-top');
  openBurn(r,a,top);
  a.hand=[card('5','hearts','own-match'),card('9','hearts','own-follow')];
  assert.equal(E.canBurnMatch(r,a).length,0);
  assert.throws(()=>E.burnMatch(r,a.id,'own-match'),/própria|acabou de jogar/);
}

// Cartas especiais continuam proibidas como primeira carta de queima.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  openBurn(r,a,card('Q','hearts','qtop'));
  b.hand=[card('Q','hearts','qmatch'),card('9','hearts','qfollow')];
  assert.equal(E.canBurnMatch(r,b).length,0);
}

// Mau-Mau: se a queima de 3 cartas + segunda jogada deixa 1, precisa anunciar.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  openBurn(r,a,card('4','clubs','mau-top'));
  b.hand=[card('4','clubs','mau-burn'),card('9','clubs','mau-second'),card('2','spades','mau-last')];
  E.burnMatch(r,b.id,'mau-burn');
  E.playCard(r,b.id,'mau-second');
  assert.equal(b.hand.length,3,'sem Mau-Mau, fica com 1 e compra +2');
}
{
  const r=room2(),a=r.players[0],b=r.players[1];
  openBurn(r,a,card('4','clubs','mau-top-ok'));
  b.hand=[card('4','clubs','mau-burn-ok'),card('9','clubs','mau-second-ok'),card('2','spades','mau-last-ok')];
  E.declare(r,b.id,'mau-mau'); // permitido fora da vez por haver queima válida
  E.burnMatch(r,b.id,'mau-burn-ok');
  E.playCard(r,b.id,'mau-second-ok');
  assert.equal(b.hand.length,1,'com Mau-Mau, não recebe penalidade');
}

// Mau-Mau batendo/queimando: duas cartas não precisam ser iguais entre si.
// A primeira deve ser igual à mesa e a segunda compatível.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  openBurn(r,a,card('6','diamonds','bat-top'));
  b.hand=[card('6','diamonds','bat-first'),card('10','diamonds','bat-second')];
  assert.throws(()=>E.burnMatch(r,b.id,'bat-first'),/Mau-Mau batendo/);
  E.declare(r,b.id,'batendo');
  E.burnMatch(r,b.id,'bat-first');
  E.playCard(r,b.id,'bat-second');
  assert.equal(r.winnerId,b.id);
  assert.equal(r.status,'between-rounds');
}

// Valete final dobra pontos dos demais.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  a.hand=[card('J','spades','j1')];
  b.hand=[card('K','clubs','k1'),card('10','hearts','t1')];
  E.playCard(r,a.id,'j1');
  assert.equal(r.status,'between-rounds');
  assert.equal(b.roundScore,(13+10)*2);
}

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

// Jogador fantasma removido antes da 1ª rodada.
{
  const r=E.createRoom('GHOST1',{name:'Host',avatar:'🧑',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Conectado',avatar:'👩',socketId:'s2',token:'t2'});
  const ghost=E.addPlayer(r,{name:'Fantasma',avatar:'😴',socketId:null,token:'t3'});
  ghost.connected=false;
  E.startRound(r);
  assert.equal(r.status,'playing');
  assert.equal(r.players.length,2);
  assert(r.players.every(p=>p.connected));
}

// Bot normal.
{
  const r=room2(),human=r.players[0],bot=r.players[1];
  bot.isBot=true;bot.name='Máquina';bot.avatar='🤖';r.currentPlayer=1;
  bot.hand=[card('5','clubs','bot5'),card('2','spades','bot2')];
  human.hand=[card('3','hearts','h3'),card('4','clubs','h4')];
  const result=Bot.takeTurn(r,bot,E);
  assert.equal(result.action,'play');
  assert.equal(bot.hand.length,1);
}

// V11: bot também pode queimar fora da vez.
{
  const r=room2(),human=r.players[0],bot=r.players[1];
  bot.isBot=true;bot.name='Máquina';r.currentPlayer=0;
  openBurn(r,human,card('5','hearts','bot-burn-top'));
  bot.hand=[card('5','hearts','bot-burn'),card('10','hearts','bot-second'),card('2','clubs','bot-left')];
  const burn=Bot.takeBurnOpportunity(r,bot,E);
  assert.equal(burn.action,'burn-match');
  assert.equal(r.currentPlayer,1);
  assert.equal(r.continuationPlayerId,bot.id);
  const second=Bot.takeTurn(r,bot,E);
  assert.equal(second.action,'burn-second-card');
  assert.equal(bot.hand.length,1);
}

// V8: Dama com 2 jogadores devolve a vez a quem jogou.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.direction=-1;r.currentPlayer=0;r.discard=[card('5','hearts','topQ2')];
  a.hand=[card('Q','hearts','q2'),card('3','clubs','a3')];
  b.hand=[card('4','spades','b4')];
  E.playCard(r,a.id,'q2');
  assert.equal(r.direction,1);
  assert.equal(r.currentPlayer,0);
}

// V10: pode passar depois de comprar carta jogável.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('5','hearts','topV10')];
  a.hand=[card('2','clubs','v10nao')];
  r.deck=[card('5','spades','v10draw')];
  E.drawAction(r,a.id);
  assert.equal(a.justDrawnCardId,'v10draw');
  assert.equal(r.currentPlayer,0);
  E.passAfterDraw(r,a.id);
  assert.equal(a.justDrawnCardId,null);
  assert.equal(r.currentPlayer,1);
  assert.equal(a.hand.length,2);
}


// V13: não pode passar antes de comprar uma carta.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('5','hearts','topV13')];
  a.hand=[card('5','clubs','v13legal'),card('9','hearts','v13legal2')];
  assert.throws(()=>E.passTurn(r,a.id),/primeiro compre 1 carta/);
  assert.equal(r.currentPlayer,0);
}

// V13: pode comprar mesmo tendo carta válida e depois passar.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('5','hearts','topV13b')];
  a.hand=[card('5','clubs','v13legal')];
  r.deck=[card('2','spades','v13draw')];
  E.drawAction(r,a.id);
  assert.equal(a.justDrawnCardId,'v13draw');
  assert.equal(r.currentPlayer,0);
  E.passTurn(r,a.id);
  assert.equal(r.currentPlayer,1);
  assert.equal(a.hand.length,2);
}

// V13: não pode comprar duas cartas na mesma jogada normal.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('5','hearts','topV13c')];
  a.hand=[card('2','clubs','v13none')];
  r.deck=[card('3','diamonds','v13draw2'),card('4','spades','v13draw1')];
  E.drawAction(r,a.id);
  assert.throws(()=>E.drawAction(r,a.id),/já comprou uma carta/);
  assert.equal(r.currentPlayer,0);
}

// V13: carta comprada não jogável mantém a vez até o jogador passar.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('5','hearts','topV13d')];
  a.hand=[card('2','clubs','v13none2')];
  r.deck=[card('3','diamonds','v13bad')];
  E.drawAction(r,a.id);
  assert.equal(a.justDrawnCardId,'v13bad');
  assert.equal(r.currentPlayer,0);
  E.passTurn(r,a.id);
  assert.equal(r.currentPlayer,1);
}

// V13: não pode usar Passar para escapar de uma cadeia de 7.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.pendingSeven=4;
  a.hand=[card('2','clubs','v13seven')];
  assert.throws(()=>E.passTurn(r,a.id),/cadeia de 7/);
  assert.equal(r.currentPlayer,0);
}

// V13: a segunda carta da queima continua obrigatória.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.continuationPlayerId=a.id;
  a.hand=[card('9','hearts','v13burn')];
  assert.throws(()=>E.passTurn(r,a.id),/continuação de uma queima/);
  assert.equal(r.currentPlayer,0);
}

// V14: depois de passar, o jogador não pode jogar mais nenhuma carta até a próxima vez.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=0;r.discard=[card('5','hearts','topV14')];
  a.hand=[card('5','clubs','v14old')];
  r.deck=[card('5','spades','v14draw')];
  E.drawAction(r,a.id);
  E.passTurn(r,a.id);
  assert.equal(r.currentPlayer,1);
  assert.equal(a.justDrawnCardId,null);
  assert.equal(a.hand.length,2);
  assert.throws(()=>E.playCard(r,a.id,'v14old'),/Não é a sua vez/);
  assert.throws(()=>E.playCard(r,a.id,'v14draw'),/Não é a sua vez/);
}

// V14: a carta comprada permanece na mão depois do passe.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('9','clubs','topV14b')];
  a.hand=[card('2','hearts','v14b-old')];
  r.deck=[card('9','diamonds','v14b-draw')];
  E.drawAction(r,a.id);
  E.passTurn(r,a.id);
  assert(a.hand.some(c=>c.id==='v14b-draw'));
  assert.equal(r.lastPass?.playerId,a.id);
  assert.equal(r.lastPass?.nextPlayerId,r.players[1].id);
}


// V15: Carta Dupla permite jogar duas cartas idênticas na própria vez.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=0;r.discard=[card('5','hearts','top-double')];
  a.hand=[card('5','clubs','d1'),card('5','clubs','d2'),card('9','spades','d3'),card('2','diamonds','d4')];
  b.hand=[card('3','hearts','bd1')];
  const pairs=E.canPlayDouble(r,a);
  assert.equal(pairs.length,1);
  assert.deepEqual(pairs[0].cardIds,['d1','d2']);
  E.playDoubleCard(r,a.id,'d1','d2');
  assert.equal(a.hand.length,2);
  assert.equal(r.discard.at(-1).rank,'5');
  assert.equal(r.discard.at(-1).suit,'clubs');
  assert.equal(r.currentPlayer,1);
}

// V15: as duas últimas cartas idênticas exigem Mau-Mau batendo e encerram a rodada.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=0;r.discard=[card('9','clubs','top-double-win')];
  a.hand=[card('9','hearts','dw1'),card('9','hearts','dw2')];
  b.hand=[card('K','clubs','bdw1')];
  assert.throws(()=>E.playDoubleCard(r,a.id,'dw1','dw2'),/Mau-Mau batendo/);
  E.declare(r,a.id,'batendo');
  E.playDoubleCard(r,a.id,'dw1','dw2');
  assert.equal(r.winnerId,a.id);
  assert.equal(r.status,'between-rounds');
}

// V15: Carta Dupla de 3 para 1 exige Mau-Mau; sem anúncio recebe +2.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('4','spades','top-double-mau')];
  a.hand=[card('4','hearts','dm1'),card('4','hearts','dm2'),card('2','clubs','dm3')];
  const before=a.hand.length;
  E.playDoubleCard(r,a.id,'dm1','dm2');
  assert.equal(before,3);
  assert.equal(a.hand.length,3,'ficaria com 1, mas sem Mau-Mau compra +2');
}
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('4','spades','top-double-mau-ok')];
  a.hand=[card('4','hearts','dmo1'),card('4','hearts','dmo2'),card('2','clubs','dmo3')];
  E.declare(r,a.id,'mau-mau');
  E.playDoubleCard(r,a.id,'dmo1','dmo2');
  assert.equal(a.hand.length,1);
}

// V16: Carta Dupla NÃO funciona com cartas especiais A, 7, 8, J, Q e K.
{
  const specials=['A','7','8','J','Q','K'];
  for (const rank of specials) {
    const r=room2(),a=r.players[0];
    r.currentPlayer=0;r.discard=[card(rank,'hearts',`top-special-${rank}`)];
    a.hand=[card(rank,'clubs',`s1-${rank}`),card(rank,'clubs',`s2-${rank}`),card('3','spades',`x-${rank}`)];
    assert.equal(E.canPlayDouble(r,a).length,0,`não deve oferecer Carta Dupla para ${rank}`);
    assert.throws(()=>E.playDoubleCard(r,a.id,`s1-${rank}`,`s2-${rank}`),/não pode ser usada com cartas especiais/);
  }
}

// V15: bot utiliza Carta Dupla quando disponível.
{
  const r=room2(),human=r.players[0],bot=r.players[1];
  bot.isBot=true;bot.name='Máquina';r.currentPlayer=1;
  r.discard=[card('6','hearts','top-bot-double')];
  bot.hand=[card('6','clubs','botd1'),card('6','clubs','botd2'),card('2','spades','botd3'),card('3','diamonds','botd4')];
  human.hand=[card('9','hearts','human-d')];
  const result=Bot.takeTurn(r,bot,E);
  assert.equal(result.action,'double');
  assert.equal(bot.hand.length,2);
}


// V17: Carta Dupla também aparece quando a carta recém-comprada completa a dupla.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('5','hearts','top-v17-draw')];
  a.hand=[card('5','clubs','v17-old'),card('9','spades','v17-other')];
  r.deck=[card('5','clubs','v17-drawn')];
  E.drawAction(r,a.id);
  const pairs=E.canPlayDouble(r,a);
  assert.equal(pairs.length,1);
  assert(pairs[0].cardIds.includes('v17-drawn'));
  E.declare(r,a.id,'mau-mau');
  E.playDoubleCard(r,a.id,pairs[0].cardIds[0],pairs[0].cardIds[1]);
  assert.equal(a.hand.length,1);
}

// V17: após comprar, uma dupla antiga que NÃO contém a carta comprada continua proibida.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('6','hearts','top-v17-oldpair')];
  a.hand=[card('6','clubs','v17-p1'),card('6','clubs','v17-p2'),card('2','spades','v17-x')];
  r.deck=[card('3','diamonds','v17-draw-x')];
  E.drawAction(r,a.id);
  assert.equal(E.canPlayDouble(r,a).length,0);
  assert.throws(()=>E.playDoubleCard(r,a.id,'v17-p1','v17-p2'),/recém-comprada/);
}

console.log('✓ V17: todos os testes do motor do Mau-Mau passaram.');

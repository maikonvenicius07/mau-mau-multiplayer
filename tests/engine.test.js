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
  r.reactionTopCardId=top.id;
  r.reactionSourcePlayerId=sourcePlayer.id;
  r.reactionNextPlayerId=r.players[r.currentPlayer]?.id||null;
}
function room4(){
  const r=E.createRoom('R4',{name:'Ana',avatar:'A',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Bruno',avatar:'B',socketId:'s2',token:'t2'});
  E.addPlayer(r,{name:'Carla',avatar:'C',socketId:'s3',token:'t3'});
  E.addPlayer(r,{name:'Diego',avatar:'D',socketId:'s4',token:'t4'});
  r.status='playing';r.round=1;r.direction=-1;r.currentPlayer=0;r.deck=E.createDeck();
  r.discard=[card('5','hearts','top4')];
  r.players.forEach(p=>{p.hand=[];p.roundHistory=[];p.score=0;p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;});
  return r;
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

// V36: quando chega a vez de Bruno, se ele tem uma carta normal exatamente igual
// à mesa, pode QUEIMAR e então jogar uma segunda carta compatível.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  const top=card('5','hearts','burn-top');
  r.currentPlayer=1;
  openBurn(r,a,top);
  a.hand=[card('3','clubs','a3')];
  b.hand=[card('5','hearts','b5h'),card('9','hearts','b9h'),card('2','clubs','b2'),card('3','spades','b3')];
  const burnable=E.canBurnMatch(r,b);
  assert.equal(burnable.length,1);
  assert.equal(burnable[0].id,'b5h');
  E.burnMatch(r,b.id,'b5h');
  assert.equal(r.currentPlayer,1,'quem queima deve assumir a jogada');
  assert.equal(r.continuationPlayerId,b.id,'Queima na própria vez abre direito à segunda carta');
  assert.equal(b.hand.length,3);
  E.playCard(r,b.id,'b9h');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(b.hand.length,2);
  assert.equal(r.currentPlayer,0,'após completar, segue a ordem a partir de quem queimou');
}

// A primeira carta da queima precisa ser exatamente igual ao topo.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=1; openBurn(r,a,card('5','hearts','top-exact'));
  b.hand=[card('5','diamonds','wrong-suit'),card('9','diamonds','follow')];
  assert.equal(E.canBurnMatch(r,b).length,0);
}

// V18: pode iniciar a queima mesmo sem possuir previamente uma segunda carta compatível.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=1; openBurn(r,a,card('5','hearts','top-no-follow'));
  b.hand=[card('5','hearts','same'),card('2','clubs','no-follow'),card('3','spades','no-follow-2')];
  assert.equal(E.canBurnMatch(r,b).length,1);
  E.burnMatch(r,b.id,'same');
  assert.equal(r.continuationPlayerId,b.id);
  assert.equal(r.currentPlayer,1);
  assert.equal(b.hand.length,2);
}

// V36: fora da própria vez não existe Queima com segunda carta.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  const top=card('5','hearts','own-top');
  r.currentPlayer=1;
  openBurn(r,a,top);
  a.hand=[card('5','hearts','own-match'),card('9','hearts','own-follow')];
  assert.equal(E.canBurnMatch(r,a).length,0);
  assert.throws(()=>E.burnMatch(r,a.id,'own-match'),/sua vez normal|Ação Rápida/i);
}

// Cartas especiais continuam proibidas como primeira carta de queima.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=1; openBurn(r,a,card('Q','hearts','qtop'));
  b.hand=[card('Q','hearts','qmatch'),card('9','hearts','qfollow')];
  assert.equal(E.canBurnMatch(r,b).length,0);
}

// Mau-Mau: se a queima de 3 cartas + segunda jogada deixa 1, precisa anunciar.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=1; openBurn(r,a,card('4','clubs','mau-top'));
  b.hand=[card('4','clubs','mau-burn'),card('9','clubs','mau-second'),card('2','spades','mau-last')];
  E.burnMatch(r,b.id,'mau-burn');
  E.playCard(r,b.id,'mau-second');
  assert.equal(b.hand.length,3,'sem Mau-Mau, fica com 1 e compra +2');
}
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=1; openBurn(r,a,card('4','clubs','mau-top-ok'));
  b.hand=[card('4','clubs','mau-burn-ok'),card('9','clubs','mau-second-ok'),card('2','spades','mau-last-ok')];
  E.declare(r,b.id,'mau-mau'); // permitido porque é a vez de Bruno e há Queima válida
  E.burnMatch(r,b.id,'mau-burn-ok');
  E.playCard(r,b.id,'mau-second-ok');
  assert.equal(b.hand.length,1,'com Mau-Mau, não recebe penalidade');
}

// Mau-Mau batendo/queimando: duas cartas não precisam ser iguais entre si.
// A primeira deve ser igual à mesa e a segunda compatível.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.currentPlayer=1; openBurn(r,a,card('6','diamonds','bat-top'));
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

// V36: bot só pode Queimar quando é a vez normal dele.
{
  const r=room2(),human=r.players[0],bot=r.players[1];
  bot.isBot=true;bot.name='Máquina';r.currentPlayer=1;
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

// V18: após a queima, se houver carta compatível, o jogador pode passar sem jogá-la.
{
  const r=room2(),a=r.players[0];
  r.currentPlayer=0;r.continuationPlayerId=a.id;
  r.discard=[card('9','hearts','v18-burn-top')];
  a.hand=[card('9','clubs','v18-burn-legal'),card('2','spades','v18-burn-other')];
  E.passTurn(r,a.id);
  assert.equal(r.currentPlayer,1);
  assert.equal(r.continuationPlayerId,null);
  assert.equal(a.hand.length,2);
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

// V16: Carta Dupla NÃO funciona com cartas especiais.
{
  const especiais=['A','7','8','J','Q','K'];
  for (const rank of especiais) {
    const r=room2(),a=r.players[0];
    r.currentPlayer=0;r.discard=[card(rank,'hearts',`top-special-${rank}`)];
    a.hand=[card(rank,'clubs',`s1-${rank}`),card(rank,'clubs',`s2-${rank}`),card('3','spades',`s3-${rank}`)];
    assert.equal(E.canPlayDouble(r,a).length,0,`${rank} não deve aparecer como Carta Dupla`);
    assert.throws(
      ()=>E.playDoubleCard(r,a.id,`s1-${rank}`,`s2-${rank}`),
      /não pode ser usada com cartas especiais/,
      `${rank} deve ser recusada pelo servidor`
    );
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


// V17: Ação Rápida — jogador que NÃO seria o próximo pode descartar a carta idêntica
// e a ordem normal continua com o próximo original.
{
  const r=room4(),a=r.players[0],b=r.players[1],c=r.players[2],d=r.players[3];
  r.currentPlayer=0;r.discard=[card('5','clubs','before-quick')];
  a.hand=[card('5','hearts','a5'),card('2','clubs','a2'),card('10','diamonds','a10')];
  b.hand=[card('5','hearts','b5'),card('4','clubs','b4'),card('8','spades','b8')];
  c.hand=[card('3','spades','c3')];
  d.hand=[card('7','diamonds','d7')];
  E.playCard(r,a.id,'a5');
  assert.equal(r.currentPlayer,3,'com sentido anti-horário, Diego seria o próximo');
  assert.equal(E.canQuickAction(r,b).map(x=>x.id).join(','),'b5');
  assert.equal(E.canQuickAction(r,d).length,0,'quem já seria o próximo não pode usar Ação Rápida');
  E.quickAction(r,b.id,'b5');
  assert.equal(b.hand.length,2);
  assert.equal(r.currentPlayer,3,'Ação Rápida não toma a vez');
  assert.equal(r.discard.at(-1).id,'b5');
}

// V36: Ação Rápida é a única reação fora da vez e não abre Queima para terceiros.
{
  const r=room4(),a=r.players[0],b=r.players[1],c=r.players[2];
  r.currentPlayer=0;r.discard=[card('5','clubs','race-base')];
  a.hand=[card('5','hearts','race-a'),card('2','clubs','race-a2'),card('10','diamonds','race-a3')];
  b.hand=[card('5','hearts','race-b'),card('9','hearts','race-follow')];
  c.hand=[card('5','hearts','race-c'),card('10','hearts','race-cfollow')];
  E.playCard(r,a.id,'race-a');
  assert(E.canQuickAction(r,b).length>0);
  assert.equal(E.canBurnMatch(r,b).length,0,'fora da vez não existe Queima');
  E.quickAction(r,b.id,'race-b');
  assert.equal(E.canBurnMatch(r,c).length,0);
  assert.throws(()=>E.burnMatch(r,c.id,'race-c'),/sua vez normal|Ação Rápida|queima/i);
}

// V36: fora da vez Bruno só pode Ação Rápida; para Queimar e jogar segunda carta,
// ele precisa ser o jogador da vez normal.
{
  const r=room4(),a=r.players[0],b=r.players[1];
  r.currentPlayer=0;r.discard=[card('5','clubs','burn-base17')];
  a.hand=[card('5','hearts','burn-source17'),card('2','clubs','a-left17'),card('10','diamonds','a-left17b')];
  b.hand=[card('5','hearts','burn-first17'),card('9','hearts','burn-second17'),card('4','clubs','b-left17')];
  E.playCard(r,a.id,'burn-source17');
  assert.equal(r.currentPlayer,3,'ordem normal vai para Diego');
  assert.equal(E.canBurnMatch(r,b).length,0,'Bruno está fora da vez e não pode Queimar');
  assert(E.canQuickAction(r,b).some(c=>c.id==='burn-first17'),'fora da vez, Bruno pode apenas Ação Rápida');
  assert.throws(()=>E.burnMatch(r,b.id,'burn-first17'),/sua vez normal|Ação Rápida/i);
}
{
  const r=room4(),a=r.players[0],b=r.players[1];
  r.direction=1;r.currentPlayer=0;r.discard=[card('5','clubs','burn-own-base36')];
  a.hand=[card('5','hearts','burn-own-source36'),card('2','clubs','a-own-left36'),card('10','diamonds','a-own-left36b')];
  b.hand=[card('5','hearts','burn-own-first36'),card('9','hearts','burn-own-second36'),card('4','clubs','b-own-left36')];
  E.playCard(r,a.id,'burn-own-source36');
  assert.equal(r.currentPlayer,1,'Bruno é o próximo e está na própria vez');
  assert.equal(E.canBurnMatch(r,b).length,1);
  E.burnMatch(r,b.id,'burn-own-first36');
  assert.equal(r.continuationPlayerId,b.id);
  E.playCard(r,b.id,'burn-own-second36');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(r.currentPlayer,2,'após a segunda carta, a ordem segue normalmente');
}

// V31: carta especial PODE ser a segunda carta após uma Queima normal e aplica o efeito.
{
  const r=room4(),a=r.players[0],b=r.players[1];
  r.direction=1;r.currentPlayer=0;r.discard=[card('5','clubs','burn-q-base')];
  a.hand=[card('5','hearts','burn-q-source'),card('2','clubs','a-q-left'),card('10','diamonds','a-q-left2')];
  b.hand=[card('5','hearts','burn-q-first'),card('Q','hearts','burn-q-second'),card('4','clubs','b-q-left')];
  E.playCard(r,a.id,'burn-q-source');
  E.burnMatch(r,b.id,'burn-q-first');
  const beforeDir=r.direction;
  E.playCard(r,b.id,'burn-q-second');
  assert.equal(r.direction,beforeDir*-1,'Dama usada após Queima deve inverter o sentido');
  assert.equal(r.continuationPlayerId,null);
}

// V31: Ação Rápida continua sem aceitar cartas especiais.
{
  const r=room4(),a=r.players[0],b=r.players[1],c=r.players[2];
  r.direction=-1;r.currentPlayer=0;r.discard=[card('5','hearts','quick-q-base')];
  a.hand=[card('Q','hearts','quick-q-source'),card('2','clubs','aqq'),card('10','diamonds','aqq2')];
  c.hand=[card('Q','hearts','quick-q-copy'),card('3','clubs','cqq')];
  E.playCard(r,a.id,'quick-q-source');
  assert.equal(r.direction,1);
  assert.equal(r.currentPlayer,1,'após Q de Ana, Bruno é o próximo no novo sentido');
  assert.equal(E.canQuickAction(r,c).length,0);
  assert.throws(()=>E.quickAction(r,c.id,'quick-q-copy'),/especiais|vez normal/i);
  assert.equal(r.direction,1);
  assert.equal(r.currentPlayer,1);
}

// V17: a janela de reação fecha quando o próximo jogador começa sua ação normal.
{
  const r=room4(),a=r.players[0],b=r.players[1],d=r.players[3];
  r.currentPlayer=0;r.discard=[card('5','clubs','close-base')];
  a.hand=[card('5','hearts','close-source'),card('2','clubs','aclose'),card('10','diamonds','aclose2')];
  b.hand=[card('5','hearts','close-b'),card('4','clubs','bclose')];
  d.hand=[card('2','spades','dclose')];
  r.deck=[card('3','diamonds','draw-close')];
  E.playCard(r,a.id,'close-source');
  assert(E.canQuickAction(r,b).length>0);
  E.drawAction(r,d.id);
  assert.equal(E.canQuickAction(r,b).length,0);
}

// V17: Mau-Mau também funciona antes de Ação Rápida que deixa apenas 1 carta.
{
  const r=room4(),a=r.players[0],b=r.players[1];
  r.currentPlayer=0;r.discard=[card('5','clubs','qm-base')];
  a.hand=[card('5','hearts','qm-source'),card('2','clubs','aqm'),card('10','diamonds','aqm2')];
  b.hand=[card('5','hearts','qm-copy'),card('4','clubs','qm-last')];
  E.playCard(r,a.id,'qm-source');
  E.declare(r,b.id,'mau-mau');
  E.quickAction(r,b.id,'qm-copy');
  assert.equal(b.hand.length,1);
}

// V17: sem anunciar Mau-Mau antes da Ação Rápida de 2 para 1, recebe +2.
{
  const r=room4(),a=r.players[0],b=r.players[1];
  r.currentPlayer=0;r.discard=[card('5','clubs','qmp-base')];
  a.hand=[card('5','hearts','qmp-source'),card('2','clubs','aqmp'),card('10','diamonds','aqmp2')];
  b.hand=[card('5','hearts','qmp-copy'),card('4','clubs','qmp-last')];
  r.deck=[card('2','diamonds','pen1'),card('3','diamonds','pen2')];
  E.playCard(r,a.id,'qmp-source');
  E.quickAction(r,b.id,'qmp-copy');
  assert.equal(b.hand.length,3,'ficaria com 1, mas compra +2 sem Mau-Mau');
}

// V17: Carta Dupla continua na própria vez, somente com cartas normais.
{
  const r=room4(),a=r.players[0];
  r.currentPlayer=0;r.discard=[card('6','hearts','double17-top')];
  a.hand=[card('6','clubs','double17-1'),card('6','clubs','double17-2'),card('3','spades','double17-left'),card('4','diamonds','double17-left2')];
  const pairs=E.canPlayDouble(r,a);
  assert.equal(pairs.length,1);
  E.playDoubleCard(r,a.id,'double17-1','double17-2');
  assert.equal(a.hand.length,2);
}

// V17: Carta Dupla não pode ser usada fora da vez.
{
  const r=room4(),b=r.players[1];
  r.currentPlayer=0;r.discard=[card('6','hearts','double-out-top')];
  b.hand=[card('6','clubs','double-out-1'),card('6','clubs','double-out-2'),card('3','spades','double-out-left')];
  assert.equal(E.canPlayDouble(r,b).length,0);
  assert.throws(()=>E.playDoubleCard(r,b.id,'double-out-1','double-out-2'),/Não é a sua vez/);
}

// V17: bot consegue usar Ação Rápida quando não seria o próximo.
{
  const r=room4(),a=r.players[0],b=r.players[1];
  b.isBot=true;b.name='Máquina';
  r.currentPlayer=0;r.discard=[card('5','clubs','botq-base')];
  a.hand=[card('5','hearts','botq-source'),card('2','clubs','abotq'),card('10','diamonds','abotq2')];
  b.hand=[card('5','hearts','botq-copy'),card('4','clubs','botq-last'),card('6','spades','botq-extra')];
  E.playCard(r,a.id,'botq-source');
  const result=Bot.takeQuickActionOpportunity(r,b,E);
  assert.equal(result.action,'quick-action');
  assert.equal(r.currentPlayer,3);
}


// V18 — CASO DO USUÁRIO 1:
// Carla joga 5♥. Paulo queima 5♥, não tem continuação, compra J e decide guardar o J passando.
{
  const r=room2(),carla=r.players[0],paulo=r.players[1];
  carla.name='Carla';paulo.name='Paulo';
  r.currentPlayer=0;r.discard=[card('2','hearts','v18-c1-base')];
  carla.hand=[card('5','hearts','v18-c1-carla'),card('3','clubs','v18-c1-c-left'),card('4','diamonds','v18-c1-c-left2')];
  paulo.hand=[card('5','hearts','v18-c1-paulo'),card('2','clubs','v18-c1-p-left'),card('3','diamonds','v18-c1-p-left2')];
  r.deck=[card('J','spades','v18-c1-j')];

  E.playCard(r,carla.id,'v18-c1-carla');
  assert.equal(r.currentPlayer,1);
  assert(E.canBurnMatch(r,paulo).some(c=>c.id==='v18-c1-paulo'));

  E.burnMatch(r,paulo.id,'v18-c1-paulo');
  assert.equal(r.continuationPlayerId,paulo.id);
  assert.equal(paulo.hand.length,2);
  assert(paulo.hand.some(c=>c.id==='v18-c1-p-left'));
  assert.equal(paulo.hand.filter(c=>E.legalCard(r,c,paulo)).length,0);

  E.drawAction(r,paulo.id);
  assert.equal(paulo.justDrawnCardId,'v18-c1-j');
  assert(E.legalCard(r,paulo.hand.find(c=>c.id==='v18-c1-j'),paulo),'J comprado é jogável');

  E.passTurn(r,paulo.id);
  assert.equal(r.currentPlayer,0,'Paulo passa e a vez vai para Carla');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(paulo.justDrawnCardId,null);
  assert(paulo.hand.some(c=>c.id==='v18-c1-j'),'Paulo guarda o Valete na mão');
}

// V18 — CASO DO USUÁRIO 2:
// Após queimar 5♥ sem possuir continuação, compra 5♣ e pode guardar essa carta passando.
{
  const r=room2(),carla=r.players[0],paulo=r.players[1];
  carla.name='Carla';paulo.name='Paulo';
  r.currentPlayer=0;r.discard=[card('2','hearts','v18-c2-base')];
  carla.hand=[card('5','hearts','v18-c2-carla'),card('3','clubs','v18-c2-c-left'),card('4','diamonds','v18-c2-c-left2')];
  paulo.hand=[card('5','hearts','v18-c2-paulo'),card('2','clubs','v18-c2-p-left'),card('3','diamonds','v18-c2-p-left2')];
  r.deck=[card('5','clubs','v18-c2-draw')];

  E.playCard(r,carla.id,'v18-c2-carla');
  E.burnMatch(r,paulo.id,'v18-c2-paulo');
  assert.throws(()=>E.passTurn(r,paulo.id),/Compre 1 carta/i,'sem continuação, precisa comprar antes de passar');

  E.drawAction(r,paulo.id);
  assert.equal(paulo.justDrawnCardId,'v18-c2-draw');
  assert(E.legalCard(r,paulo.hand.find(c=>c.id==='v18-c2-draw'),paulo),'5♣ comprado é jogável');
  E.passTurn(r,paulo.id);
  assert.equal(r.currentPlayer,0);
  assert(paulo.hand.some(c=>c.id==='v18-c2-draw'),'5♣ comprado permanece na mão');
}

// V18: se após queimar já houver carta compatível, pode passar sem comprar.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.direction=1;r.currentPlayer=0;r.discard=[card('2','hearts','v18-pass-base')];
  a.hand=[card('5','hearts','v18-pass-source'),card('4','clubs','v18-pass-a')];
  b.hand=[card('5','hearts','v18-pass-burn'),card('9','hearts','v18-pass-legal'),card('2','clubs','v18-pass-other')];

  E.playCard(r,a.id,'v18-pass-source');
  E.burnMatch(r,b.id,'v18-pass-burn');
  assert(E.legalCard(r,b.hand.find(c=>c.id==='v18-pass-legal'),b));
  E.passTurn(r,b.id);
  assert.equal(r.currentPlayer,0);
  assert(b.hand.some(c=>c.id==='v18-pass-legal'));
}

// V18: se existe carta compatível após a queima, não é permitido comprar; deve jogar ou passar.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.direction=1;r.currentPlayer=0;r.discard=[card('2','hearts','v18-no-draw-base')];
  a.hand=[card('5','hearts','v18-no-draw-source'),card('4','clubs','v18-no-draw-a')];
  b.hand=[card('5','hearts','v18-no-draw-burn'),card('9','hearts','v18-no-draw-legal'),card('2','clubs','v18-no-draw-other')];

  E.playCard(r,a.id,'v18-no-draw-source');
  E.burnMatch(r,b.id,'v18-no-draw-burn');
  assert.throws(()=>E.drawAction(r,b.id),/já possui carta compatível/i);
}

// V18: ainda pode continuar a queima normalmente e jogar uma segunda carta.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.direction=1;r.currentPlayer=0;r.discard=[card('2','hearts','v18-continue-base')];
  a.hand=[card('5','hearts','v18-continue-source'),card('4','clubs','v18-continue-a')];
  b.hand=[card('5','hearts','v18-continue-burn'),card('9','hearts','v18-continue-second'),card('2','clubs','v18-continue-left')];

  E.playCard(r,a.id,'v18-continue-source');
  E.burnMatch(r,b.id,'v18-continue-burn');
  E.declare(r,b.id,'mau-mau');
  E.playCard(r,b.id,'v18-continue-second');
  assert.equal(r.continuationPlayerId,null);
  assert.equal(r.currentPlayer,0);
  assert.equal(b.hand.length,1);
}

// V18: com duas cartas, Mau-Mau comum permite queimar uma e passar com uma;
// batendo continua reservado para quem pretende descartar as duas.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.direction=1;r.currentPlayer=0;r.discard=[card('2','hearts','v18-mau-base')];
  a.hand=[card('5','hearts','v18-mau-source'),card('4','clubs','v18-mau-a')];
  b.hand=[card('5','hearts','v18-mau-burn'),card('9','hearts','v18-mau-last')];

  E.playCard(r,a.id,'v18-mau-source');
  assert.throws(()=>E.burnMatch(r,b.id,'v18-mau-burn'),/anuncie “Mau-Mau”/);
  E.declare(r,b.id,'mau-mau');
  E.burnMatch(r,b.id,'v18-mau-burn');
  assert.equal(b.hand.length,1);
  E.passTurn(r,b.id);
  assert.equal(b.hand.length,1);
}

// V18: para encerrar com a segunda carta da queima, continua obrigatório anunciar batendo.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.direction=1;r.currentPlayer=0;r.discard=[card('2','hearts','v18-bat-base')];
  a.hand=[card('5','hearts','v18-bat-source'),card('4','clubs','v18-bat-a')];
  b.hand=[card('5','hearts','v18-bat-burn'),card('9','hearts','v18-bat-last')];

  E.playCard(r,a.id,'v18-bat-source');
  E.declare(r,b.id,'mau-mau');
  E.burnMatch(r,b.id,'v18-bat-burn');
  assert.throws(()=>E.playCard(r,b.id,'v18-bat-last'),/batendo\/queimando/);
}

console.log('✓ V18: queima flexível, compra e passe após a queima passaram.');



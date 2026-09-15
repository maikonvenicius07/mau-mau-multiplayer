'use strict';
const assert = require('assert');
const E = require('../game-engine');

function card(rank,suit,id){return {rank,suit,id:id||`${rank}-${suit}-${Math.random()}`,copy:1};}
function roomN(n){
  const r=E.createRoom('V32',{name:'P1',avatar:'1',socketId:'s1',token:'t1'});
  for(let i=2;i<=n;i++) E.addPlayer(r,{name:`P${i}`,avatar:String(i),socketId:`s${i}`,token:`t${i}`});
  r.status='playing';r.round=1;r.direction=1;r.currentPlayer=0;r.deck=E.createDeck();
  r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.roundHistory=[];p.score=0;p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;});
  return r;
}

// V32: bater com 8 aplica +2 ao jogador anterior antes da pontuação.
{
  const r=roomN(3), [a,b,c]=r.players;
  a.hand=[card('8','hearts','win8')];
  b.hand=[card('2','clubs','b2')];
  c.hand=[card('3','clubs','c3')];
  const before=c.hand.length;
  E.playCard(r,a.id,'win8');
  assert.equal(r.winnerId,a.id);
  assert.equal(r.status,'between-rounds');
  assert.equal(c.hand.length,before+2,'8 final deve fazer o jogador anterior comprar 2');
}

// V32: bater com K aplica +1 ao jogador anterior antes da pontuação.
{
  const r=roomN(3), [a,b,c]=r.players;
  a.hand=[card('K','hearts','winK')];
  b.hand=[card('2','clubs','b2')];
  c.hand=[card('3','clubs','c3')];
  const before=c.hand.length;
  E.playCard(r,a.id,'winK');
  assert.equal(r.winnerId,a.id);
  assert.equal(c.hand.length,before+1,'K final deve fazer o jogador anterior comprar 1');
}

// V32: bater com J mantém a regra de dobrar os pontos dos adversários.
{
  const r=roomN(3), [a,b,c]=r.players;
  a.hand=[card('J','spades','winJ')];
  b.hand=[card('10','clubs','b10')];
  c.hand=[card('2','clubs','c2')];
  E.playCard(r,a.id,'winJ');
  assert.equal(b.roundScore,20);
  assert.equal(c.roundScore,4);
}

// V32: Q e A também registram seu efeito normal antes do encerramento.
{
  const r=roomN(3), [a]=r.players;
  a.hand=[card('Q','hearts','winQ')];
  E.playCard(r,a.id,'winQ');
  assert.equal(r.direction,-1,'Q final deve inverter o sentido antes de finalizar');
}
{
  const r=roomN(3), [a]=r.players;
  a.hand=[card('A','hearts','winA')];
  E.playCard(r,a.id,'winA');
  assert(r.log.some(x=>/perdeu a vez por causa do Ás usado na batida/.test(x.message)),'A final deve registrar perda da vez');
}

// V32: batida com 7 mantém a cadeia. Se todos os demais rebaterem uma vez,
// a cadeia completa a volta até o vencedor e termina sem qualquer compra.
{
  const r=roomN(4), [p1,p2,p3,p4]=r.players;
  p1.hand=[card('7','hearts','p1-7')];
  p2.hand=[card('7','clubs','p2-7'),card('2','clubs','p2-2'),card('3','clubs','p2-3')];
  p3.hand=[card('7','spades','p3-7'),card('4','clubs','p3-4'),card('5','clubs','p3-5')];
  p4.hand=[card('7','diamonds','p4-7'),card('6','clubs','p4-6'),card('9','clubs','p4-9')];

  E.playCard(r,p1.id,'p1-7');
  assert.equal(r.finishPendingSeven,true);
  assert.equal(r.currentPlayer,1);
  E.playCard(r,p2.id,'p2-7');
  assert.equal(r.currentPlayer,2);
  E.playCard(r,p3.id,'p3-7');
  assert.equal(r.currentPlayer,3);
  E.playCard(r,p4.id,'p4-7');

  assert.equal(r.status,'between-rounds','após todos rebaterem, a rodada deve terminar');
  assert.equal(r.pendingSeven,0,'a penalidade final deve ser zerada sem compra');
  assert.equal(p2.hand.length,2);
  assert.equal(p3.hand.length,2);
  assert.equal(p4.hand.length,2);
  assert(r.log.some(x=>/todos rebateram e ninguém compra/.test(x.message)),'deve registrar encerramento sem compra');
}

// Se alguém não tiver 7, compra o acumulado e só então a rodada termina.
{
  const r=roomN(4), [p1,p2,p3,p4]=r.players;
  p1.hand=[card('7','hearts','f1-7')];
  p2.hand=[card('7','clubs','f2-7'),card('2','clubs','f2-2'),card('3','clubs','f2-3')];
  p3.hand=[card('4','clubs','f3-4'),card('5','clubs','f3-5')];
  p4.hand=[card('6','clubs','f4-6')];

  E.playCard(r,p1.id,'f1-7');
  E.playCard(r,p2.id,'f2-7');
  assert.equal(r.pendingSeven,4);
  assert.equal(r.currentPlayer,2);
  const before=p3.hand.length;
  E.drawAction(r,p3.id);
  assert.equal(p3.hand.length,before+4,'quem não rebate deve comprar o acumulado');
  assert.equal(r.status,'between-rounds');
}

console.log('✓ V32: efeitos especiais na batida e cadeia final de 7 conferidos.');

'use strict';
const assert=require('assert');
const E=require('../game-engine');
const Bot=require('../bot-player');
function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room2(){
  const r=E.createRoom('V29',{name:'Paulo',avatar:'macaco',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Carla',avatar:'mulher',socketId:'s2',token:'t2'});
  r.status='playing';r.round=1;r.direction=1;r.currentPlayer=0;
  r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;p.score=0;p.roundHistory=[];});
  return r;
}

// Compra voluntária mesmo tendo carta válida; J comprado pode ser guardado e uma carta antiga pode ser jogada.
{
  const r=room2(),p=r.players[0];
  p.hand=[card('5','clubs','old5'),card('2','spades','other')];
  r.deck=[card('J','spades','drawJ')];
  E.drawAction(r,p.id);
  assert.equal(p.justDrawnCardId,'drawJ');
  const st=E.roomPublicState(r,p.id);
  assert(st.me.legalCardIds.includes('old5'),'carta válida antiga deve continuar jogável após a compra');
  assert(st.me.legalCardIds.includes('drawJ'),'carta comprada válida também deve continuar jogável');
  E.playCard(r,p.id,'old5');
  assert(p.hand.some(c=>c.id==='drawJ'),'Valete comprado deve permanecer na mão ao jogar outra carta');
  assert.equal(p.justDrawnCardId,null,'estado pós-compra deve encerrar depois de jogar');
  assert.equal(r.currentPlayer,1,'vez deve seguir normalmente');
}

// Pode simplesmente passar e guardar o J comprado.
{
  const r=room2(),p=r.players[0];
  p.hand=[card('5','clubs','old5b')];
  r.deck=[card('J','diamonds','drawJ2')];
  E.drawAction(r,p.id);
  E.passTurn(r,p.id);
  assert(p.hand.some(c=>c.id==='drawJ2'),'J comprado deve ficar na mão ao passar');
  assert.equal(r.currentPlayer,1);
}

// Carta Dupla também pode ser usada após comprar, se houver dupla válida.
{
  const r=room2(),p=r.players[0];
  p.hand=[card('5','clubs','d1'),card('5','clubs','d2'),card('2','spades','x')];
  r.deck=[card('J','spades','drawJ3')];
  E.drawAction(r,p.id);
  const pairs=E.canPlayDouble(r,p);
  assert(pairs.some(x=>(x.cardIds||[]).includes('d1')&&(x.cardIds||[]).includes('d2')),'Carta Dupla deve continuar disponível após compra');
  E.playDoubleCard(r,p.id,'d1','d2');
  assert(p.hand.some(c=>c.id==='drawJ3'),'J comprado deve ficar guardado após Carta Dupla');
}

// Bot compra J, preserva o J e joga uma alternativa válida quando houver.
{
  const r=room2(),bot=r.players[0];bot.isBot=true;
  bot.hand=[card('5','clubs','botOld')];
  r.deck=[card('J','spades','botJ')];
  E.drawAction(r,bot.id);
  const out=Bot.takeTurn(r,bot,E);
  assert.equal(out.action,'play-other-after-draw');
  assert(bot.hand.some(c=>c.id==='botJ'),'bot deve preservar o J comprado quando puder jogar outra carta');
}

console.log('✓ V29: compra livre — qualquer carta válida pode ser jogada após comprar, ou o jogador pode passar e guardar a carta comprada.');

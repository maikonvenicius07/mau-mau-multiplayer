'use strict';
// Contrato permanente V40.69.8.29: a penalidade da Queima pertence ao
// descarte idêntico, nunca à escolha do botão no navegador.
const assert = require('node:assert/strict');
const E = require('../game-engine');
const fs = require('node:fs');
const path = require('node:path');
const C = (rank,suit,id) => ({rank,suit,id,copy:1});
function make(top=C('6','hearts','top')) {
  const r=E.createRoom('BURN-29',{name:'Ana',socketId:'sa',token:'ta'});
  E.addPlayer(r,{name:'Beto',socketId:'sb',token:'tb'});
  r.status='playing';r.round=1;r.currentPlayer=0;r.direction=1;
  r.players.forEach(p=>{p.connected=true;p.finishedRound=false;p.declaration=null;
    p.hand=[];p.roundHistory=[];p.score=0;p.justDrawnCardId=null;});
  r.discard=[top];r.deck=[C('4','diamonds','penalty')];
  return r;
}
function state(r) {
  const p=r.players[0];
  return {hand:p.hand.map(x=>x.id),discard:r.discard.map(x=>x.id),
    deck:r.deck.map(x=>x.id),turn:r.currentPlayer,continuation:r.continuationPlayerId===p.id,
    bought:p.justDrawnCardId,passed:r.lastPass?.afterBurn||false};
}
const check=(text,fn)=>{fn();console.log('✓',text);};
check('1/2 - clique direto e botão geram Queima + uma compra idêntica',()=>{
  const direct=make(),button=make();
  for(const r of [direct,button])r.players[0].hand=[C('6','hearts','same'),C('9','hearts','other-valid'),C('3','clubs','bad')];
  E.playCard(direct,direct.players[0].id,'same');
  E.burnMatch(button,button.players[0].id,'same');
  assert.deepEqual(state(direct),state(button));
  const a=direct.players[0];
  assert.equal(a.hand.length,3);
  assert.equal(a.justDrawnCardId,'penalty');
  assert.equal(direct.deck.length,0);
  assert.equal(direct.discard.at(-1).id,'same');
  assert.equal(direct.currentPlayer,0);
  assert.equal(direct.continuationPlayerId,a.id);
  assert.throws(()=>E.drawAction(direct,a.id),/j[aá] foi aplicada|j[aá] cumpriu/i);
  E.passTurn(direct,a.id);
  assert.equal(direct.currentPlayer,1);
  assert.equal(a.hand.length,3);
});
check('3 - mesmo valor, naipe diferente: jogada normal',()=>{
  const r=make();const p=r.players[0];p.hand=[C('6','spades','other-suit'),C('9','diamonds','filler'),C('2','clubs','filler2')];
  E.playCard(r,p.id,'other-suit');assert.equal(r.continuationPlayerId,null);
  assert.equal(r.deck.length,1);assert.equal(r.currentPlayer,1);
});
check('4 - 8 de Copas sobre 6 de Copas: especial normal, não Queima',()=>{
  const r=make();const p=r.players[0];p.hand=[C('8','hearts','eight'),C('2','clubs','filler'),C('3','spades','filler2')];
  r.deck.push(C('2','hearts','extra1'),C('3','hearts','extra2'),C('4','hearts','extra3'));
  E.playCard(r,p.id,'eight');assert.equal(r.continuationPlayerId,null);
  assert.equal(r.discard.at(-1).id,'eight');
});
check('5 - número e naipe diferentes são inválidos',()=>{
  const r=make();const p=r.players[0];p.hand=[C('9','clubs','wrong'),C('2','clubs','filler'),C('3','spades','filler2')];
  const old=state(r);assert.throws(()=>E.playCard(r,p.id,'wrong'),/n[aã]o pode ser jogada/i);assert.deepEqual(state(r),old);
});
check('6/15 - compra válida pode ser jogada ou guardada ao passar',()=>{
  for(const doPlay of [true,false]){
    const r=make();const p=r.players[0];p.hand=[C('2','clubs','filler'),C('3','spades','filler2')];
    r.deck=[C('9','hearts','bought')];E.drawAction(r,p.id);assert.equal(p.justDrawnCardId,'bought');
    if(doPlay){E.playCard(r,p.id,'bought');assert.equal(r.discard.at(-1).id,'bought');}
    else {E.passTurn(r,p.id);assert(p.hand.some(c=>c.id==='bought'));}
  }
});
check('7/16 - compra inválida fica na mão ao passar',()=>{
  const r=make();const p=r.players[0];p.hand=[C('2','clubs','filler'),C('3','spades','filler2')];
  r.deck=[C('9','clubs','bought')];E.drawAction(r,p.id);
  assert.throws(()=>E.playCard(r,p.id,'bought'),/n[aã]o pode ser jogada/i);
  E.passTurn(r,p.id);assert(p.hand.some(c=>c.id==='bought'));
});
check('8 - carta idêntica comprada também sofre penalidade de Queima',()=>{
  const r=make();const p=r.players[0];p.hand=[C('9','hearts','legal'),C('2','clubs','filler'),C('3','spades','filler2')];
  r.deck=[C('4','diamonds','second-penalty'),C('6','hearts','bought')];
  E.drawAction(r,p.id);E.playCard(r,p.id,'bought');
  assert.equal(r.continuationPlayerId,p.id);assert.equal(p.justDrawnCardId,'second-penalty');
  assert(p.hand.some(c=>c.id==='second-penalty'));
});
check('9 - pode comprar normalmente mesmo tendo carta de Queima',()=>{
  const r=make();const p=r.players[0];p.hand=[C('6','hearts','same'),C('2','clubs','filler'),C('3','spades','filler2')];
  E.drawAction(r,p.id);assert(p.hand.some(c=>c.id==='same'));
  assert.equal(r.discard.at(-1).id,'top');assert.equal(r.continuationPlayerId,null);
});
check('10/11 - evento normal não ignora Queima e evento repetido não duplica penalidade',()=>{
  const r=make();const p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','valid'),C('2','clubs','bad')];
  E.playCard(r,p.id,'same');const after=state(r);
  assert.throws(()=>E.playCard(r,p.id,'same'),/Carta n[aã]o encontrada/i);
  assert.throws(()=>E.burnMatch(r,p.id,'same'),/Aguarde a queima/i);
  assert.deepEqual(state(r),after);
});
check('12 - estado público preserva a carta da penalidade para reconexão',()=>{
  const r=make();const p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','valid'),C('2','clubs','bad')];
  E.playCard(r,p.id,'same');
  const before=E.roomPublicState(r,p.id);
  const restored=JSON.parse(JSON.stringify(r));
  const after=E.roomPublicState(restored,p.id);
  assert.deepEqual(after.me.hand,before.me.hand);
  assert.equal(after.me.justDrawnCardId,'penalty');
  assert.equal(after.me.burnContinuationActive,true);
  assert.equal(after.me.burnMustDraw,false);
});
check('13/14 - mesma regra no motor de torneios e partidas normais',()=>{
  for(const tournament of [true,false]){
    const r=make();r.tournament=tournament?{id:'test-tournament'}:null;
    const p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','valid'),C('2','clubs','bad')];
    E.playCard(r,p.id,'same');assert.equal(p.justDrawnCardId,'penalty');
  }
});
check('Mau-Mau e sequência de cartas continuam válidos sem anular a penalidade',()=>{
  const r=make();const p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','follow')];
  E.declare(r,p.id,'mau-mau');E.playCard(r,p.id,'same');
  assert.equal(p.hand.length,2);E.playCard(r,p.id,'follow');
  assert.equal(r.winnerId,null);assert(p.hand.some(c=>c.id==='penalty'));
});
check('integração: ambos eventos de descarte passam pelo motor do servidor',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(server,/socket\.on\('playCard',[\s\S]*?Engine\.playCard\(room,p\.id,/);
  assert.match(server,/socket\.on\('burnMatch',[\s\S]*?Engine\.burnMatch\(room,p\.id,/);
});
console.log('✓ V40.69.8.29: 16 cenários funcionais e contrato de eventos protegidos.');

'use strict';
// Regression V40.69.8.29 preserved with the corrected V40.69.8.30 contract:
// equal ordinary card ALWAYS starts burn, but never draws until player clicks.
const assert=require('node:assert/strict');
const E=require('../game-engine');
const fs=require('node:fs');
const path=require('node:path');
const C=(rank,suit,id)=>({rank,suit,id,copy:1});
function make(top=C('6','hearts','top')){
  const r=E.createRoom('BURN-30',{name:'Ana',socketId:'sa',token:'ta'});
  E.addPlayer(r,{name:'Beto',socketId:'sb',token:'tb'});
  r.status='playing';r.round=1;r.currentPlayer=0;r.direction=1;
  r.players.forEach(p=>{p.connected=true;p.finishedRound=false;p.declaration=null;
    p.hand=[];p.roundHistory=[];p.score=0;p.justDrawnCardId=null;});
  r.discard=[top];r.deck=[C('4','diamonds','buy')];return r;
}
function state(r){const p=r.players[0];return {hand:p.hand.map(c=>c.id),deck:r.deck.map(c=>c.id),
  discard:r.discard.map(c=>c.id),current:r.currentPlayer,pending:r.continuationPlayerId===p.id,
  bought:p.justDrawnCardId};}
const check=(label,fn)=>{fn();console.log('✓',label)};
check('1/2: clicar na carta e usar QUEIMA geram mesma obrigação pendente, sem compra',()=>{
  const a=make(),b=make();for(const r of [a,b])r.players[0].hand=[C('6','hearts','same'),C('9','hearts','legal'),C('3','clubs','invalid')];
  E.playCard(a,a.players[0].id,'same');E.burnMatch(b,b.players[0].id,'same');
  assert.deepEqual(state(a),state(b));assert.equal(a.players[0].hand.length,2);
  assert.equal(a.deck.length,1);assert.equal(a.players[0].justDrawnCardId,null);
  assert.equal(a.continuationPlayerId,a.players[0].id);assert.equal(a.currentPlayer,0);
  assert.equal(E.roomPublicState(a,a.players[0].id).me.burnMustDraw,true);
});
check('3: comprar apenas ao clicar, uma única carta, e poder passar',()=>{
  const r=make(),p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','legal'),C('3','clubs','invalid')];
  E.playCard(r,p.id,'same');
  assert.throws(()=>E.passTurn(r,p.id),/jogue outra carta|COMPRAR/i);
  E.drawAction(r,p.id);assert.equal(p.justDrawnCardId,'buy');assert.equal(p.hand.length,3);
  assert.equal(r.deck.length,0);assert.equal(E.roomPublicState(r,p.id).me.burnMustDraw,false);
  assert.throws(()=>E.drawAction(r,p.id),/j[aá] comprou/i);E.passTurn(r,p.id);
  assert.equal(r.continuationPlayerId,null);assert.equal(r.currentPlayer,1);
});
check('4: jogar outra carta legal encerra Queima sem compra',()=>{
  const r=make(),p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','follow'),C('3','clubs','invalid')];
  E.declare(r,p.id,'mau-mau');E.playCard(r,p.id,'same');E.playCard(r,p.id,'follow');
  assert.equal(r.continuationPlayerId,null);assert.equal(r.deck.length,1);
  assert(!p.hand.some(c=>c.id==='buy'));
});
check('5/6: só valor ou só naipe => jogada normal',()=>{
  for(const c of [C('6','spades','rank'),C('9','hearts','suit')]){
    const r=make(),p=r.players[0];p.hand=[c,C('2','clubs','other'),C('3','clubs','other2')];
    E.playCard(r,p.id,c.id);assert.equal(r.continuationPlayerId,null);assert.equal(r.deck.length,1);
  }
});
check('7: carta comum com outro valor e outro naipe é inválida',()=>{
  const r=make(),p=r.players[0];p.hand=[C('9','clubs','invalid'),C('2','spades','other')];
  const before=state(r);assert.throws(()=>E.playCard(r,p.id,'invalid'),/n[aã]o pode ser jogada/i);
  assert.deepEqual(state(r),before);
});
check('8: carta idêntica adquirida em compra normal ainda inicia Queima pendente',()=>{
  const r=make(),p=r.players[0];r.deck=[C('4','diamonds','next'),C('6','hearts','normal-buy')];
  p.hand=[C('2','clubs','other'),C('3','spades','other2')];
  E.drawAction(r,p.id);assert.equal(p.justDrawnCardId,'normal-buy');
  E.playCard(r,p.id,'normal-buy');assert.equal(p.justDrawnCardId,null);
  assert.equal(r.deck.length,1);assert.equal(r.continuationPlayerId,p.id);
  E.drawAction(r,p.id);assert.equal(p.justDrawnCardId,'next');
});
check('9: pode comprar normalmente tendo Queima disponível',()=>{
  const r=make(),p=r.players[0];p.hand=[C('6','hearts','same'),C('2','clubs','other')];
  E.drawAction(r,p.id);assert.equal(r.continuationPlayerId,null);
  assert(p.hand.some(c=>c.id==='same'));assert.equal(r.discard.length,1);
});
check('10/11: evento repetido não duplica descarte nem compra',()=>{
  const r=make(),p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','legal')];
  E.declare(r,p.id,'mau-mau');E.playCard(r,p.id,'same');const prior=state(r);
  assert.throws(()=>E.playCard(r,p.id,'same'),/Carta n[aã]o encontrada/i);
  assert.throws(()=>E.burnMatch(r,p.id,'same'),/Aguarde a queima/i);
  assert.deepEqual(state(r),prior);assert.equal(r.deck.length,1);
});
check('12: reconexão preserva estado de obrigação sem carta inserida',()=>{
  const r=make(),p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','legal'),C('2','clubs','other')];
  E.playCard(r,p.id,'same');const before=E.roomPublicState(r,p.id);
  const restored=JSON.parse(JSON.stringify(r));const after=E.roomPublicState(restored,p.id);
  assert.deepEqual(after.me.hand,before.me.hand);assert.equal(after.me.burnMustDraw,true);
  assert.equal(after.me.justDrawnCardId,null);assert.equal(restored.deck.length,1);
});
check('13/14: comportamento uniforme em torneio e partida normal',()=>{
  for(const t of [false,true]){
    const r=make(),p=r.players[0];r.tournament=t?{id:'t'}:null;
    p.hand=[C('6','hearts','same'),C('9','hearts','legal'),C('2','clubs','other')];
    E.playCard(r,p.id,'same');assert.equal(p.justDrawnCardId,null);
    assert.equal(r.continuationPlayerId,p.id);assert.equal(r.deck.length,1);
  }
});
check('15: Mau-Mau batendo com duas cartas pode vencer sem compra',()=>{
  const r=make(),p=r.players[0];p.hand=[C('6','hearts','same'),C('9','hearts','last')];
  E.declare(r,p.id,'batendo');E.playCard(r,p.id,'same');E.playCard(r,p.id,'last');
  assert.equal(r.winnerId,p.id);assert.equal(r.deck.length,1);
});
check('16: queimar com baralho vazio é permitido para jogar outra carta',()=>{
  const r=make(),p=r.players[0];r.deck=[];
  p.hand=[C('6','hearts','same'),C('9','hearts','follow'),C('3','clubs','other')];
  E.playCard(r,p.id,'same');assert.equal(r.continuationPlayerId,p.id);
  E.playCard(r,p.id,'follow');assert.equal(r.continuationPlayerId,null);
});
check('motor, servidor e cliente: ações distintas (sem compra silenciosa)',()=>{
  const engine=fs.readFileSync(path.join(__dirname,'../game-engine.js'),'utf8');
  const burn=engine.slice(engine.indexOf('function burnMatch('),engine.indexOf('function burnPair('));
  assert(!/drawCards\(|drawOne\(/.test(burn),'burnMatch não pode retirar cartas');
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  assert.match(server,/socket\.on\('playCard',[\s\S]*?Engine\.playCard\(room,p\.id,/);
  assert.match(server,/socket\.on\('burnMatch',[\s\S]*?Engine\.burnMatch\(room,p\.id,/);
  assert.match(server,/socket\.on\('draw',[\s\S]*?Engine\.drawAction\(room,p\.id\)/);
  const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  assert(app.includes('QUEIMA: jogue outra carta válida OU clique em COMPRAR'));
});
console.log('✓ V40.69.8.30: contrato de Queima sem compra automática, escolha explícita e reconexão.');

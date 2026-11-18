'use strict';
// Proteção permanente V40.69.8.30: Queima de carta comum idêntica
// nunca compra sozinha; exige segunda carta legal ou clique de COMPRAR.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Engine=require('../game-engine');
const c=(rank,suit,id)=>({rank,suit,id,copy:1});
function room(){
  const r=Engine.createRoom('BURN-MANUAL',{name:'Ana',socketId:'ana',token:'t-ana'});
  Engine.addPlayer(r,{name:'Beto',socketId:'beto',token:'t-beto'});
  r.status='playing';r.round=1;r.currentPlayer=0;r.direction=1;
  r.players.forEach(p=>{p.connected=true;p.finishedRound=false;p.hand=[];p.justDrawnCardId=null;p.declaration=null;});
  r.discard=[c('6','hearts','top')];r.deck=[c('4','diamonds','monte')];
  return r;
}
// Clique direto e botão devem deixar a mesmíssima obrigação pendente.
for(const method of ['click','button']){
  const r=room(),p=r.players[0];p.hand=[c('6','hearts','igual'),c('9','hearts','continua'),c('2','clubs','resto')];
  if(method==='click')Engine.playCard(r,p.id,'igual');else Engine.burnMatch(r,p.id,'igual');
  assert.equal(r.deck.length,1);
  assert.equal(p.hand.length,2);
  assert.equal(p.justDrawnCardId,null);
  assert.equal(r.currentPlayer,0);
  assert.equal(r.continuationPlayerId,p.id);
  assert.equal(Engine.roomPublicState(r,p.id).me.burnMustDraw,true);
  assert.throws(()=>Engine.passTurn(r,p.id),/jogue outra carta|COMPRAR/i);
  if(method==='click'){
    Engine.playCard(r,p.id,'continua');
    assert.equal(r.continuationPlayerId,null);
    assert.equal(r.deck.length,1,'a segunda jogada válida não pode retirar carta do monte');
  }else{
    Engine.drawAction(r,p.id);assert.equal(r.deck.length,0);
    assert.equal(p.justDrawnCardId,'monte');
    assert.throws(()=>Engine.drawAction(r,p.id),/j[aá] comprou/i);
    Engine.passTurn(r,p.id);assert.equal(r.currentPlayer,1);
  }
}
// Após uma compra NORMAL, ainda é necessário clicar novamente se depois Queimar.
{
  const r=room(),p=r.players[0];p.hand=[c('6','hearts','igual'),c('9','hearts','continua'),c('2','clubs','resto')];
  r.deck=[c('3','diamonds','monte-queima'),c('5','clubs','monte-normal')];
  Engine.drawAction(r,p.id);assert.equal(p.justDrawnCardId,'monte-normal');
  Engine.playCard(r,p.id,'igual');assert.equal(r.deck.length,1);
  assert.equal(p.justDrawnCardId,null);
  assert.throws(()=>Engine.passTurn(r,p.id),/jogue outra carta|COMPRAR/i);
  Engine.drawAction(r,p.id);assert.equal(p.justDrawnCardId,'monte-queima');
}
// Sem carta no monte, uma segunda carta legal resolve a Queima sem compra.
{
  const r=room(),p=r.players[0];r.deck=[];
  p.hand=[c('6','hearts','igual'),c('9','hearts','continua'),c('2','clubs','resto')];
  Engine.declare(r,p.id,'mau-mau');
  Engine.playCard(r,p.id,'igual');Engine.playCard(r,p.id,'continua');
  assert.equal(r.deck.length,0);
  assert.equal(r.continuationPlayerId,null);
}
// Snapshot persiste obrigação sem alterar mão/baralho do jogador.
{
  const r=room(),p=r.players[0];p.hand=[c('6','hearts','igual'),c('9','hearts','continua'),c('2','clubs','resto')];
  Engine.playCard(r,p.id,'igual');const copy=JSON.parse(JSON.stringify(r));
  assert.equal(Engine.roomPublicState(copy,p.id).me.burnMustDraw,true);
  assert.equal(copy.deck.length,1);assert.equal(copy.players[0].justDrawnCardId,null);
}
const base=path.resolve(__dirname,'..');
const engine=fs.readFileSync(path.join(base,'game-engine.js'),'utf8');
const start=engine.indexOf('function burnMatch('),end=engine.indexOf('function burnPair(',start);
assert(start!==-1&&end>start);
assert(!/\b(?:drawOne|drawCards|requireDrawCapacity)\(/.test(engine.slice(start,end)),
  'burnMatch não pode retirar cartas em nenhum caminho');
const ui=fs.readFileSync(path.join(base,'public','app.js'),'utf8');
assert(ui.includes('QUEIMA: jogue outra carta válida OU clique em COMPRAR'));
assert(ui.includes('const canPassBurn=!!(inBurn&&boughtThisTurn)'));
const html=fs.readFileSync(path.join(base,'public','index.html'),'utf8');
assert(html.includes('nenhuma carta é comprada automaticamente'));
console.log('✓ V40.69.8.30: Queima pendente até jogar outra carta válida ou clicar em COMPRAR; sem compra silenciosa.');

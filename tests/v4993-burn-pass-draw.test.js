const fs=require('fs');
const path=require('path');
const assert=require('assert');
const E=require('../game-engine');

function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room2(){
  const r=E.createRoom('V4993',{name:'A',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'B',socketId:'s2',token:'t2'});
  r.status='playing';r.round=1;r.direction=1;r.currentPlayer=0;
  r.players.forEach(p=>{p.hand=[];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;p.roundHistory=[];p.score=0;});
  return r;
}

// Há continuação válida, mas PASSAR continua bloqueado até comprar.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.discard=[card('2','hearts','base')];
  a.hand=[card('5','hearts','source'),card('4','clubs','a-left'),card('6','diamonds','a-extra')];
  b.hand=[card('5','hearts','burn'),card('9','hearts','legal'),card('3','spades','other')];
  r.deck=[card('9','diamonds','draw-valid')];
  E.playCard(r,a.id,'source');
  E.burnMatch(r,b.id,'burn');
  assert(E.legalCard(r,b.hand.find(c=>c.id==='legal'),b));
  assert.throws(()=>E.passTurn(r,b.id),/obrigatório comprar 1 carta|Compre 1 carta/i);
  E.drawAction(r,b.id);
  assert.equal(b.justDrawnCardId,'draw-valid');
  E.passTurn(r,b.id);
  assert.equal(r.continuationPlayerId,null);
  assert(b.hand.some(c=>c.id==='draw-valid'),'carta comprada válida pode ser guardada');
}

// Após Queima, o jogador ainda pode continuar sem comprar.
{
  const r=room2(),a=r.players[0],b=r.players[1];
  r.discard=[card('2','hearts','base2')];
  a.hand=[card('5','hearts','source2'),card('4','clubs','a-left2'),card('6','diamonds','a-extra2')];
  b.hand=[card('5','hearts','burn2'),card('9','hearts','continue'),card('3','spades','other2')];
  E.playCard(r,a.id,'source2');
  E.burnMatch(r,b.id,'burn2');
  E.playCard(r,b.id,'continue');
  assert.equal(r.continuationPlayerId,null);
}

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
assert(html.includes('styles.css?v=40.69.2-v49.9.3-burn-pass-draw'),'cache-busting CSS V49.9.3 ausente');
assert(/app\.js\?v=40\.69\.2-v49\.(9\.3-burn-pass-draw|10-mic-stability|11-mic-stability-phase1)/.test(html),'cache-busting JS compatível V49.9.3/V49.10/V49.11 ausente');
assert(html.includes('não pode passar diretamente'),'regra visual deve informar que QUEIMA → PASSAR é proibido');
assert(app.includes('const canPassBurn=!!(inBurn&&boughtThisTurn)'),'frontend só deve liberar PASSAR após compra na Queima');
assert(!app.includes('const burnDrawBlocked=inBurn'),'frontend não deve bloquear a compra por existir carta válida na mão');
console.log('✓ V49.9.3: QUEIMA → PASSAR bloqueado; QUEIMA → COMPRAR → PASSAR/JOGAR permitido.');

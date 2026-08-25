'use strict';
const assert=require('assert');
const E=require('../game-engine');
function card(rank,suit,id){return {rank,suit,id,copy:1};}
function room4(tag='v31'){
  const r=E.createRoom(`T${tag}`,{name:'João',socketId:'s1',token:'t1'});
  E.addPlayer(r,{name:'Lucas',socketId:'s2',token:'t2'});
  E.addPlayer(r,{name:'Rosa',socketId:'s3',token:'t3'});
  E.addPlayer(r,{name:'Ana',socketId:'s4',token:'t4'});
  r.status='playing';r.round=1;r.direction=1;r.currentPlayer=1;r.deck=E.createDeck();
  r.players.forEach(p=>{p.hand=[];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;p.roundHistory=[];p.score=0;});
  return r;
}
function openReaction(r,source,next,top){
  r.discard=[top];r.reactionTopCardId=top.id;r.reactionSourcePlayerId=source.id;
  r.reactionNextPlayerId=next.id;r.burnTopCardId=top.id;r.lastPlayedById=source.id;
  r.currentPlayer=r.players.findIndex(p=>p.id===next.id);
}
const specials=['A','7','8','J','Q','K'];

// Regra-base: cartas especiais não podem iniciar Queima nem Ação Rápida fora da vez.
for(const rank of specials){
  const r=room4(`react-${rank}`),joao=r.players[0],lucas=r.players[1],rosa=r.players[2];
  const top=card(rank,'clubs',`top-${rank}`);
  openReaction(r,joao,lucas,top);
  rosa.hand=[card(rank,'clubs',`rosa-${rank}`),card('5','hearts',`x-${rank}`)];
  assert.equal(E.canBurnMatch(r,rosa).length,0,`${rank} não pode iniciar Queima`);
  assert.equal(E.canQuickAction(r,rosa).length,0,`${rank} não pode fazer Ação Rápida`);
  assert.throws(()=>E.quickAction(r,rosa.id,`rosa-${rank}`),/especiais|vez normal/i);
}

// Regra-base: cartas especiais não podem ser jogadas em Carta Dupla.
for(const rank of specials){
  const r=room4(`double-${rank}`),lucas=r.players[1];
  r.currentPlayer=1;r.discard=[card(rank,'hearts',`dtop-${rank}`)];
  lucas.hand=[card(rank,'hearts',`d1-${rank}`),card(rank,'hearts',`d2-${rank}`),card('4','clubs',`left-${rank}`)];
  assert.equal(E.canPlayDouble(r,lucas).length,0,`${rank} não pode Carta Dupla`);
  assert.throws(()=>E.playDoubleCard(r,lucas.id,`d1-${rank}`,`d2-${rank}`),/especiais/i);
}

// V31: após uma Queima iniciada por carta NORMAL, o Valete pode ser continuação
// e funciona como coringa, permitindo escolher o novo naipe.
{
  const r=room4('burn-j'),joao=r.players[0],lucas=r.players[1],rosa=r.players[2];
  openReaction(r,joao,lucas,card('5','diamonds','top5d-j'));
  rosa.hand=[card('5','diamonds','burn5d-j'),card('J','spades','jsp'),card('2','clubs','left-j')];
  E.burnMatch(r,rosa.id,'burn5d-j');
  let st=E.roomPublicState(r,rosa.id);
  assert.equal(st.me.burnMustDraw,false,'Valete deve contar como continuação válida após Queima');
  assert(st.me.legalCardIds.includes('jsp'),'Valete deve ficar jogável após Queima');
  E.playCard(r,rosa.id,'jsp','clubs');
  assert.equal(r.requestedSuit,'clubs','Valete após Queima deve permitir escolher naipe');
  assert.equal(r.continuationPlayerId,null);
}

// V31: 8 do mesmo naipe como segunda carta da Queima aplica +2 ao jogador anterior.
{
  const r=room4('burn-8'),joao=r.players[0],lucas=r.players[1],rosa=r.players[2];
  openReaction(r,joao,lucas,card('5','diamonds','top5d-8'));
  rosa.hand=[card('5','diamonds','burn5d-8'),card('8','diamonds','eightd'),card('2','clubs','left-8')];
  lucas.hand=[card('3','clubs','lucas-base')];
  const before=lucas.hand.length;
  E.burnMatch(r,rosa.id,'burn5d-8');
  E.playCard(r,rosa.id,'eightd');
  assert.equal(lucas.hand.length,before+2,'8 após Queima deve fazer o jogador anterior comprar 2');
}

// V31: Rei do mesmo naipe aplica +1 ao jogador anterior.
{
  const r=room4('burn-k'),joao=r.players[0],lucas=r.players[1],rosa=r.players[2];
  openReaction(r,joao,lucas,card('5','hearts','top5h-k'));
  rosa.hand=[card('5','hearts','burn5h-k'),card('K','hearts','kh'),card('2','clubs','left-k')];
  lucas.hand=[card('3','clubs','lucas-k')];
  const before=lucas.hand.length;
  E.burnMatch(r,rosa.id,'burn5h-k');E.playCard(r,rosa.id,'kh');
  assert.equal(lucas.hand.length,before+1,'Rei após Queima deve fazer o jogador anterior comprar 1');
}

// V31: Dama do mesmo naipe inverte o sentido.
{
  const r=room4('burn-q'),joao=r.players[0],lucas=r.players[1],rosa=r.players[2];
  openReaction(r,joao,lucas,card('5','clubs','top5c-q'));
  rosa.hand=[card('5','clubs','burn5c-q'),card('Q','clubs','qc'),card('2','diamonds','left-q')];
  const before=r.direction;
  E.burnMatch(r,rosa.id,'burn5c-q');E.playCard(r,rosa.id,'qc');
  assert.equal(r.direction,-before,'Dama após Queima deve inverter o sentido');
}

// V31: Ás do mesmo naipe pula o próximo jogador.
{
  const r=room4('burn-a'),joao=r.players[0],lucas=r.players[1],rosa=r.players[2],ana=r.players[3];
  openReaction(r,joao,lucas,card('5','spades','top5s-a'));
  rosa.hand=[card('5','spades','burn5s-a'),card('A','spades','as'),card('2','diamonds','left-a')];
  E.burnMatch(r,rosa.id,'burn5s-a');E.playCard(r,rosa.id,'as');
  assert.equal(r.players[r.currentPlayer].id,joao.id,'Ás após Queima deve pular Ana e entregar a vez a João');
}

// V31: 7 do mesmo naipe inicia normalmente a penalidade +2.
{
  const r=room4('burn-7'),joao=r.players[0],lucas=r.players[1],rosa=r.players[2],ana=r.players[3];
  openReaction(r,joao,lucas,card('5','hearts','top5h-7'));
  rosa.hand=[card('5','hearts','burn5h-7'),card('7','hearts','sevenh'),card('2','diamonds','left-7')];
  E.burnMatch(r,rosa.id,'burn5h-7');E.playCard(r,rosa.id,'sevenh');
  assert.equal(r.pendingSeven,2,'7 após Queima deve iniciar +2');
  assert.equal(r.players[r.currentPlayer].id,ana.id,'7 deve passar a penalidade ao próximo jogador');
}

console.log('✓ V31: especiais não iniciam Queima/Ação Rápida/Carta Dupla, mas funcionam como segunda carta após Queima normal.');

'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const E=require('../game-engine');
const Bot=require('../bot-player');

function card(rank,suit,id){return {rank,suit,id,copy:1};}
function makeRoom(n,dir=-1){
  const r=E.createRoom(`AUD${n}`,{name:'P0',avatar:'0',socketId:'s0',token:'t0'});
  for(let i=1;i<n;i++)E.addPlayer(r,{name:`P${i}`,avatar:String(i),socketId:`s${i}`,token:`t${i}`});
  r.status='playing';r.round=1;r.direction=dir;r.currentPlayer=0;r.deck=E.createDeck();r.discard=[card('5','hearts','top')];
  r.players.forEach(p=>{p.hand=[];p.connected=true;p.autoControlled=false;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;p.roundHistory=[];p.score=0;});
  return r;
}
const next=(idx,n,dir,steps=1)=>((idx+dir*steps)%n+n)%n;

for(const n of [2,3,4,5]){
  // Início de todas as 5 rodadas em anti-horário; ordem física não muda.
  {
    const r=E.createRoom(`START${n}`,{name:'P0',avatar:'0',socketId:'s0',token:'t0'});
    for(let i=1;i<n;i++)E.addPlayer(r,{name:`P${i}`,avatar:String(i),socketId:`s${i}`,token:`t${i}`});
    const fixed=r.players.map(p=>p.id);
    for(let round=1;round<=5;round++){
      E.startRound(r);
      assert.equal(r.direction,-1,`rodada ${round}, ${n} jogadores deve iniciar anti-horário`);
      assert.deepEqual(r.players.map(p=>p.id),fixed,'ordem física dos jogadores não pode mudar');
      const flipper=r.players.findIndex(p=>p.id===r.roundRoles.flipperId);
      assert.equal(r.currentPlayer,next(flipper,n,-1),'primeiro jogador deve ser o seguinte ao virador no sentido anti-horário');
      if(round<5){r.status='between-rounds';r.currentPlayer=-1;}
    }
  }

  // 100 jogadas normais: exatamente um avanço, nunca dois.
  {
    const r=makeRoom(n,-1);let idx=0;
    for(let i=0;i<100;i++){
      const p=r.players[idx],c=card('5','hearts',`normal-${n}-${i}`);
      p.hand=[c,card('2','clubs',`keep-a-${i}`),card('3','diamonds',`keep-b-${i}`)];
      r.currentPlayer=idx;r.discard=[card('5','hearts',`top-${i}`)];r.pendingSeven=0;r.requestedSuit=null;r.continuationPlayerId=null;r.openingReaction=false;r.reactionTopCardId=null;r.reactionSourcePlayerId=null;r.reactionNextPlayerId=null;
      E.playCard(r,p.id,c.id);
      idx=next(idx,n,-1);
      assert.equal(r.currentPlayer,idx,`jogada normal ${i} pulou jogador com ${n} participantes`);
    }
  }

  // Ás pula exatamente um, respeitando o sentido atual.
  for(const dir of [-1,1]){
    const r=makeRoom(n,dir),p=r.players[0];
    p.hand=[card('A','hearts',`ace-${n}-${dir}`),card('2','clubs','keep')];
    E.playCard(r,p.id,`ace-${n}-${dir}`);
    assert.equal(r.direction,dir,'Ás não pode mudar o sentido');
    assert.equal(r.currentPlayer,next(0,n,dir,2),'Ás deve pular exatamente o próximo jogador');
  }

  // Dama: com 2 jogadores preserva a regra validada de repetir; com 3–5 anda um lugar no novo sentido.
  for(const dir of [-1,1]){
    const r=makeRoom(n,dir),p=r.players[0];
    p.hand=[card('Q','hearts',`queen-${n}-${dir}`),card('2','clubs','keep')];
    E.playCard(r,p.id,`queen-${n}-${dir}`);
    assert.equal(r.direction,-dir,'Dama deve inverter uma única vez');
    if(n===2) assert.equal(r.currentPlayer,0,'com 2 jogadores, Q deve preservar a regra validada e devolver a vez a quem jogou');
    else assert.equal(r.currentPlayer,next(0,n,-dir,1),'com 3–5 jogadores, Q deve seguir um lugar no novo sentido');
  }

  // Q -> normal -> Q -> normal -> Q.
  {
    const r=makeRoom(n,-1);let idx=0,dir=-1;
    for(const [i,rank] of ['Q','5','Q','5','Q'].entries()){
      const p=r.players[idx],id=`seq-${n}-${i}`;
      p.hand=[card(rank,'hearts',id),card('2','clubs',`keep-${i}`),card('3','diamonds',`keep2-${i}`)];
      r.currentPlayer=idx;r.discard=[card('5','hearts',`seqtop-${i}`)];r.pendingSeven=0;r.requestedSuit=null;r.continuationPlayerId=null;r.openingReaction=false;r.reactionTopCardId=null;r.reactionSourcePlayerId=null;r.reactionNextPlayerId=null;
      E.playCard(r,p.id,id);
      if(rank==='Q'){
        dir*=-1;
        if(n!==2) idx=next(idx,n,dir,1);
      } else idx=next(idx,n,dir,1);
      assert.equal(r.direction,dir);
      assert.equal(r.currentPlayer,idx,`sequência de Damas incorreta com ${n} jogadores`);
    }
  }

  // Q e depois A: o Ás usa o novo sentido.
  {
    const r=makeRoom(n,-1);let idx=0,p=r.players[idx];
    p.hand=[card('Q','hearts','qa-q'),card('2','clubs','keepq')];E.playCard(r,p.id,'qa-q');
    if(n!==2) idx=next(idx,n,1);
    assert.equal(r.currentPlayer,idx);p=r.players[idx];
    p.hand=[card('A','hearts','qa-a'),card('2','clubs','keepa')];r.discard=[card('5','hearts','qa-top')];
    E.playCard(r,p.id,'qa-a');assert.equal(r.currentPlayer,next(idx,n,1,2));
  }

  // ×2 normal avança uma única vez.
  {
    const r=makeRoom(n,-1),p=r.players[0];
    p.hand=[card('5','clubs','d1'),card('5','clubs','d2'),card('2','spades','k'),card('3','diamonds','k2')];
    E.playDoubleCard(r,p.id,'d1','d2');
    assert.equal(r.currentPlayer,next(0,n,-1));
  }

  // Comprar não avança; passar avança uma única vez.
  {
    const r=makeRoom(n,-1),p=r.players[0];p.hand=[card('2','clubs','hold')];r.deck=[card('3','diamonds','draw')];
    E.drawAction(r,p.id);assert.equal(r.currentPlayer,0);E.passTurn(r,p.id);assert.equal(r.currentPlayer,next(0,n,-1));
  }

  // Queima na própria vez mantém a cadeira durante a continuação e só avança ao terminar.
  {
    const r=makeRoom(n,-1),p=r.players[0];r.discard=[card('5','hearts','burn-top')];
    p.hand=[card('5','hearts','burn'),card('9','hearts','follow'),card('2','clubs','keep')];
    r.reactionTopCardId='burn-top';r.reactionSourcePlayerId='x';r.reactionNextPlayerId=p.id;
    E.burnMatch(r,p.id,'burn');assert.equal(r.currentPlayer,0);assert.equal(r.continuationPlayerId,p.id);
    E.playCard(r,p.id,'follow');assert.equal(r.currentPlayer,next(0,n,-1));
  }

  // Reconexão não toca turno nem direção.
  {
    const r=makeRoom(n,-1),p=r.players[0];r.currentPlayer=Math.min(1,n-1);const cp=r.currentPlayer,d=r.direction;
    p.connected=false;p.autoControlled=true;E.reconnectPlayer(r,p.token,'new-socket');
    assert.equal(r.currentPlayer,cp);assert.equal(r.direction,d);
  }
}

// Ação Rápida preserva rigorosamente o próximo original.
for(const n of [3,4,5]){
  const r=makeRoom(n,-1),a=r.players[0],reactor=r.players[1];
  a.hand=[card('5','hearts','src'),card('2','clubs','keep'),card('3','diamonds','keep2')];
  reactor.hand=[card('5','hearts','copy'),card('4','clubs','left')];
  E.playCard(r,a.id,'src');const expected=next(0,n,-1);assert.notEqual(r.players[expected].id,reactor.id);
  E.quickAction(r,reactor.id,'copy');assert.equal(r.currentPlayer,expected,'Ação Rápida não pode roubar/pular a vez');
}

// Queima da PRIMEIRA carta continua sendo a exceção intencional já existente:
// ela transfere a jogada a quem queimou, mas não executa dois avanços.
{
  const r=makeRoom(4,-1),burner=r.players[1];r.currentPlayer=3;
  const top=card('5','hearts','opening-top');r.discard=[top];r.openingReaction=true;r.reactionTopCardId=top.id;r.reactionSourcePlayerId=null;r.reactionNextPlayerId=r.players[3].id;
  burner.hand=[card('5','hearts','opening-copy'),card('9','hearts','opening-follow'),card('2','clubs','left')];
  E.burnMatch(r,burner.id,'opening-copy');assert.equal(r.currentPlayer,1);assert.equal(r.continuationPlayerId,burner.id);
  E.playCard(r,burner.id,'opening-follow');assert.equal(r.currentPlayer,0,'após a continuação, anda uma vez a partir de quem queimou');
}

// Frontend não é autoridade do turno.
{
  const root=path.join(__dirname,'..');
  const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert(!/currentPlayer\s*=/.test(app),'frontend não deve escrever currentPlayer');
  assert(!/currentPlayerIndex\s*=/.test(app),'frontend não deve escrever currentPlayerIndex');
  const spectatorBlock=server.slice(server.indexOf("socket.on('joinAsSpectator'"),server.indexOf("socket.on('startRound'"));
  assert(!/currentPlayer\s*=/.test(spectatorBlock),'observador não pode alterar currentPlayer');
  assert(!/direction\s*=/.test(spectatorBlock),'observador não pode alterar direction');
  assert(!/catch \(e\)[\s\S]{0,1800}?liveRoom\.currentPlayer\s*=\s*cursor/.test(server),'falha de bot não pode pular cadeira por atribuição direta');
  assert(server.includes('recoverAutomatedTurn'),'recuperação segura do bot/AUTO ausente');
}

// Partidas completas com 2, 3, 4 e 5 bots, cinco rodadas cada.
let total=0;
for(const n of [2,3,4,5]){
  for(let g=0;g<6;g++){
    const r=E.createRoom(`BOT${n}-${g}`,{name:'Bot 1',socketId:'b1',token:`b1-${g}`,isBot:true});r.players[0].isBot=true;
    for(let i=2;i<=n;i++)E.addPlayer(r,{name:`Bot ${i}`,socketId:`b${i}`,token:`b${i}-${g}`,isBot:true});
    let steps=0;
    while(r.status!=='finished'&&steps<25000){
      if(r.status==='lobby'||r.status==='between-rounds'){E.startRound(r);steps++;continue;}
      const burn=r.players.find(p=>p.isBot&&!p.finishedRound&&E.canBurnMatch(r,p).length>0);
      if(burn){Bot.takeBurnOpportunity(r,burn,E);steps++;continue;}
      const quick=r.players.find(p=>p.isBot&&!p.finishedRound&&E.canQuickAction(r,p).length>0);
      if(quick){Bot.takeQuickActionOpportunity(r,quick,E);steps++;continue;}
      const turn=r.players[r.currentPlayer];assert(turn,'jogador atual deve existir');Bot.takeTurn(r,turn,E);steps++;
    }
    assert.equal(r.status,'finished',`partida bot ${n} jogadores #${g} travou`);assert(steps<25000);total+=steps;
  }
}

console.log(`✓ V40.43: integridade de turnos aprovada; Q2 preservada, Q inverte em 3–5, A pula um, sem duplo avanço (${total} ações em partidas completas).`);

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Engine=require('../game-engine');
const Replay=require('../replay-session');

const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const start=server.indexOf('function maybeStartReplay(room)');
const end=server.indexOf('function nextBotInfo(room)',start);
assert(start>=0&&end>start,'controlador original da revanche não localizado');
const sandbox={Engine,ReplaySession:Replay,ensureHost(room){
  const humans=room.players.filter(p=>!p.isBot);
  if(humans.length&& !humans.some(p=>p.host)){room.players.forEach(p=>p.host=false);humans[0].host=true;}
}};
vm.runInNewContext(server.slice(start,end)+'\nthis.maybeStartReplay=maybeStartReplay;',sandbox);

function fixture(count=2,bots=0){
  const room=Engine.createRoom('SALA12',{socketId:'s1',token:'tk1',name:'Ana',avatar:'macaco',playerKey:'ana'});
  for(let n=1;n<count;n++)Engine.addPlayer(room,{socketId:'s'+(n+1),token:'tk'+(n+1),name:'Jogador'+n,avatar:'preta',playerKey:'p'+n});
  for(let n=0;n<bots;n++)Engine.addPlayer(room,{isBot:true,name:'Máquina '+n,avatar:'macaco'});
  room.status='finished';room.round=5;room.finishedAt=Date.now();room.matchSerial=3;
  room.players.forEach((p,i)=>{p.score=10+i*5;p.roundHistory=[2,2,2,2,2+i]});
  room.roundReview={id:'ultimo-resultado',players:[]};
  room.chat=[{id:'chat1',text:'Continuamos aqui'}];
  room.isPublic=true;
  return room;
}

// A falha anterior: um clique antes do commit do ranking era rejeitado; a
// confirmação deve ficar guardada e produzir uma única nova partida após o commit.
{
  const room=fixture();
  const [ana,bruno]=room.players;
  assert.equal(Replay.confirmReplay(room,ana),true);
  assert.equal(Replay.confirmReplay(room,ana),false,'duplo clique não duplica confirmação');
  assert.equal(Replay.confirmReplay(room,bruno),true);
  assert.equal(Replay.replayInfo(room,ana.id).readyCount,2);
  assert.equal(Replay.replayInfo(room,ana.id).waitingForRanking,true);
  assert.equal(sandbox.maybeStartReplay(room),false,'não iniciar antes de gravar resultado');
  assert.equal(room.status,'finished');
  const originalCode=room.code;
  const identities=room.players.map(p=>[p.id,p.token,p.socketId,p.playerKey]);
  room.rankingRecorded=true;
  assert.equal(sandbox.maybeStartReplay(room),true);
  assert.equal(sandbox.maybeStartReplay(room),false,'não iniciar duas vezes');
  assert.equal(room.status,'playing');assert.equal(room.round,1);
  assert.equal(room.matchSerial,4);assert.equal(room.code,originalCode);
  assert.equal(room.rankingRecorded,false,'novo resultado ainda não foi registrado');
  assert.equal(room.rankingModeAtStart,'official');
  assert.equal(room.direction,-1,'mantém sentido anti-horário');
  assert.deepEqual(room.players.map(p=>[p.id,p.token,p.socketId,p.playerKey]),identities);
  assert(room.players.every(p=>p.score===0&&p.hand.length===6&&p.roundHistory.length===0));
  assert.equal(room.chat[0].text,'Continuamos aqui');
  assert.equal(room.isPublic,true);assert.deepEqual(room.replayReadyPlayerIds,[]);
}

// Queda temporária preserva a cadeira e a confirmação até o retorno.
{
  const room=fixture(3);
  room.rankingRecorded=true;
  room.players.forEach(p=>Replay.confirmReplay(room,p));
  room.players[1].connected=false;
  room.players[1].reconnectEligible=true;
  room.players[1].reconnectDeadlineAt=Date.now()+60000;
  assert.equal(Replay.replayInfo(room).waitingForReconnect,1);
  assert.equal(sandbox.maybeStartReplay(room),false,'não excluir imediatamente jogador em reconexão');
  room.players[1].connected=true;
  assert.equal(sandbox.maybeStartReplay(room),true,'retorno completa o quórum');
}

// Saída voluntária libera o voto sem tornar a partida impossível para os restantes.
{
  const room=fixture(3);room.rankingRecorded=true;
  Replay.confirmReplay(room,room.players[0]);Replay.confirmReplay(room,room.players[1]);
  const leaving=room.players.pop();
  room.replayReadyPlayerIds=room.replayReadyPlayerIds.filter(id=>id!==leaving.id);
  assert.equal(Replay.replayInfo(room).requiredCount,2);
  assert.equal(sandbox.maybeStartReplay(room),true);
}

// Mesas de treino com bot também recomeçam; somente humanos confirmam.
{
  const room=fixture(1,1);room.rankingRecorded=true;
  assert.equal(Replay.replayInfo(room).eligible,true);
  assert.equal(Replay.confirmReplay(room,room.players[0]),true);
  assert.throws(()=>Replay.confirmReplay(room,room.players[1]),/Somente jogadores humanos/);
  assert.equal(sandbox.maybeStartReplay(room),true);
  assert.equal(room.rankingModeAtStart,'training');
  assert.equal(room.players.length,2);
}

// Torneios e espectadores nunca votam.
{
  const room=fixture();room.tournament={id:'torneio'};
  assert.equal(Replay.replayInfo(room).eligible,false);
  assert.throws(()=>Replay.confirmReplay(room,room.players[0]),/só está disponível/);
  const spectator=Engine.roomSpectatorState(room,{id:'observador',name:'Observador'});
  assert.equal(spectator.replay.eligible,false);
}
{
  const room=fixture();room.rankingRecorded=true;
  assert.equal(Replay.replayInfo(room).eligible,true);
  assert.equal(Engine.roomPublicState(room,room.players[0].id).replay.waitingForRanking,false);
  assert.equal(Engine.roomSpectatorState(room,{id:'o'}).replay.eligible,false);
}

// Contratos de integração — o commit assíncrono notifica a sala, há um único
// código público e a rede deve respeitar o prazo de reconexão após o fim.
assert(server.includes('if(rooms.get(room.code)===room){\n        roomSnapshotStore.saveNow(room)'));
assert(server.includes('if(room.status===\'finished\'&&room.rankingRecorded)maybeStartReplay(room)'));
assert(server.includes("['lobby','between-rounds','finished'].includes(currentRoom.status)"));
assert(server.includes("if(ReplaySession.confirmReplay(room,p))"));
assert(app.includes('🔁 JOGAR NOVAMENTE'));
assert(app.includes("state?.viewerRole==='PLAYER'"),'observador não deve poder ver confirmação de revanche');
assert(html.includes('id="roundReviewReplay"'));
assert(server.includes("socket.on('playAgain'"));
console.log('✓ V40.69.8.5.1: revanche na mesma sala, commit de ranking, votos, bot, reconexão, saída, sem duplicação e sem participação de torneio/observador.');

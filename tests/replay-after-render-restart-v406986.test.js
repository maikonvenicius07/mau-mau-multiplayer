'use strict';

// V40.69.8.6 — teste reproduzível de recuperação de uma sala FINALIZADA
// entre dois processos, sem PostgreSQL real e sem conexões Socket.IO.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const Engine=require('../game-engine');
const Replay=require('../replay-session');
const {RankingStore,buildMatchRecord}=require('../ranking-store');
const {RoomSnapshotStore,restoreRoomSnapshot}=require('../room-snapshot-store');

const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const replayStart=server.indexOf('function maybeStartReplay(room)');
const replayEnd=server.indexOf('function nextBotInfo(room)',replayStart);
const graceStart=server.indexOf('function scheduleRestoredPlayerGrace(room,player)');
const graceEnd=server.indexOf('async function restorePersistedRooms()',graceStart);
assert(replayStart>=0&&replayEnd>replayStart);
assert(graceStart>=0&&graceEnd>graceStart);
const replayController={Engine,ReplaySession:Replay,ensureHost(room){
  if(!room.players.some(p=>!p.isBot&&p.host))room.players.find(p=>!p.isBot).host=true;
}};
vm.runInNewContext(server.slice(replayStart,replayEnd)+'\nthis.startReplay=maybeStartReplay;',replayController);

function completedRoom(code='RESTART'){
  const room=Engine.createRoom(code,{socketId:'a',token:'tokA',playerKey:'account-A',name:'Alice',avatar:'macaco'});
  Engine.addPlayer(room,{socketId:'b',token:'tokB',playerKey:'account-B',name:'Bruno',avatar:'preta'});
  room.status='finished';room.round=5;room.finishedAt=Date.now();room.matchSerial=4;
  room.players[0].score=10;room.players[1].score=35;
  room.players.forEach(p=>p.roundHistory=[1,2,3,4,5]);
  room.chat=[{id:'hello',text:'Outra partida?',name:'Alice'}];
  room.rankingModeAtStart='official';room.rankingRecorded=true;
  Replay.confirmReplay(room,room.players[0]);
  return room;
}

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-restart-replay-'));
  const filePath=path.join(dir,'rooms.json');
  const rankingPath=path.join(dir,'ranking.json');
  try {
    const first=completedRoom();
    const original={code:first.code,serial:first.matchSerial,chat:first.chat[0].text,players:first.players.map(p=>[p.id,p.token,p.playerKey])};
    const rankings=new RankingStore({databaseUrl:'',filePath:rankingPath});await rankings.init();
    const recorded=buildMatchRecord(first);
    assert.equal(await rankings.recordMatch(recorded),true,'primeiro resultado entra uma vez no ranking');
    assert.equal(await rankings.recordMatch(recorded),false,'mesmo resultado não pode duplicar');

    const writer=new RoomSnapshotStore({databaseUrl:'',filePath,ttlMs:3600000,debounceMs:30000});
    await writer.init();
    assert.equal(await writer.saveNow(first),true);
    // SIGTERM: a última confirmação deve persistir, inclusive após finalização.
    Replay.confirmReplay(first,first.players[1]);
    await writer.flushAll(new Map([[first.code,first]]));
    await writer.close();

    // Novo processo: carrega sala FINALIZADA e permite o grupo reconectar.
    const reader=new RoomSnapshotStore({databaseUrl:'',filePath,ttlMs:3600000,debounceMs:30000});
    await reader.init();
    const saved=await reader.loadActive();
    assert.equal(saved.length,1);
    const restored=restoreRoomSnapshot(saved[0],{now:Date.now(),reconnectGraceMs:60000});
    assert(restored,'resultado gravado não pode descartar a sala comum antes da revanche');
    assert.equal(restored.status,'finished');
    assert.equal(restored.rankingRecorded,true);
    assert.equal(restored.code,original.code);
    assert.equal(restored.matchSerial,original.serial);
    assert.equal(restored.chat[0].text,original.chat);
    assert.deepEqual(restored.players.map(p=>[p.id,p.token,p.playerKey]),original.players);
    assert.equal(Replay.replayInfo(restored).readyCount,2,'votos anteriores ao restart foram persistidos por flushAll');
    assert.equal(Replay.replayInfo(restored).waitingForReconnect,2);
    assert.equal(replayController.startReplay(restored),false,'não começar sem que reconectem');
    for(const [i,player] of restored.players.entries()){
      const connected=Engine.reconnectPlayer(restored,player.token,`socket-after-restart-${i}`);
      assert.equal(connected.id,player.id);
    }
    assert.equal(replayController.startReplay(restored),true,'retorno completo inicia uma revanche');
    assert.equal(replayController.startReplay(restored),false,'não duplicar revanche');
    assert.equal(restored.status,'playing');assert.equal(restored.round,1);
    assert.equal(restored.matchSerial,original.serial+1);
    assert.equal(restored.code,original.code);
    assert.equal(restored.chat[0].text,original.chat);
    assert(restored.players.every(p=>p.score===0));
    assert.equal(await reader.saveNow(restored),true);
    await reader.close();
    const readerAgain=new RoomSnapshotStore({databaseUrl:'',filePath,ttlMs:3600000});
    await readerAgain.init();
    const reloaded=await readerAgain.loadActive();
    assert.equal(reloaded.length,1);
    assert.equal(reloaded[0].matchSerial,original.serial+1);
    await readerAgain.close();
    const scored=await rankings.getLeaderboard({period:'season',mode:'official'});
    assert.equal(scored.find(p=>p.playerKey==='account-A')?.wins,1,'rank não pode se duplicar no restart');
    // A REVANCHE corresponde a outra partida, mas deve gerar só UMA nova vitória.
    restored.status='finished';restored.round=5;restored.finishedAt=Date.now()+1000;
    restored.players[0].score=7;restored.players[1].score=23;
    const secondRecord=buildMatchRecord(restored);
    assert.notEqual(secondRecord.matchId,recorded.matchId,'nova partida necessita ID próprio');
    assert.equal(await rankings.recordMatch(secondRecord),true);
    assert.equal(await rankings.recordMatch(secondRecord),false,'retry da revanche não pode duplicar');
    const twoWins=await rankings.getLeaderboard({period:'season',mode:'official'});
    assert.equal(twoWins.find(p=>p.playerKey==='account-A')?.wins,2,
      'duas partidas completas na mesma sala devem contabilizar duas vitórias');

    // O fim do torneio continua fora da recuperação para revanche.
    const tournament=completedRoom('TRNMNT');tournament.tournament={id:'t1'};
    assert.equal(restoreRoomSnapshot(require('../room-snapshot-store').plainRoomSnapshot(tournament)),null);

    // Um resultado ainda pendente pode ser restaurado para retry idempotente.
    const pending=completedRoom('PENDING');pending.rankingRecorded=false;
    assert(restoreRoomSnapshot(require('../room-snapshot-store').plainRoomSnapshot(pending)));

    // A retomada automática por identidade deve encontrar a sala finalizada
    // mesmo quando o navegador não manteve o código/token local.
    const recoverStart=server.indexOf('function recoverablePlayerSeatForKey(playerKey)');
    const recoverEnd=server.indexOf('async function resumeReservedPlayerSeat(',recoverStart);
    assert(recoverStart>=0&&recoverEnd>recoverStart);
    const recoverRoom=restoreRoomSnapshot(require('../room-snapshot-store').plainRoomSnapshot(completedRoom('RECOV1')));
    const recoverContext={rooms:new Map([[recoverRoom.code,recoverRoom]]),
      RoomLifecycle:require('../room-lifecycle'),
      io:{sockets:{sockets:new Map()}},
      runtimeReconnectGraceMs:()=>60000,
      Date,
    };
    vm.runInNewContext(server.slice(recoverStart,recoverEnd)+'\nthis.recoverablePlayerSeatForKey=recoverablePlayerSeatForKey;',recoverContext);
    const seat=recoverContext.recoverablePlayerSeatForKey('account-A');
    assert(seat&&seat.room===recoverRoom&&seat.player.playerKey==='account-A',
      'Conta autenticada deve recuperar cadeira de revanche sem token após restart');
    const tournamentRecover=completedRoom('TOURN-PENDING');
    tournamentRecover.tournament={id:'torneio'};tournamentRecover.rankingRecorded=false;
    const pendingTournament=restoreRoomSnapshot(require('../room-snapshot-store').plainRoomSnapshot(tournamentRecover));
    assert(pendingTournament,'resultado pendente de torneio precisa sobreviver para gravar o placar');
    recoverContext.rooms=new Map([[pendingTournament.code,pendingTournament]]);
    assert.equal(recoverContext.recoverablePlayerSeatForKey('account-A'),null,
      'sala de torneio finalizada não deve ser recuperada como revanche');
    assert.equal(recoverContext.recoverablePlayerSeatForKey('other-account'),null,
      'Identidade que não pertence à sala não ganha cadeira');

    // Timer de expiração após restart: mesmo finalizada, a vaga que não voltou
    // tem o prazo de reconexão, sem bloquear a revanche dos demais para sempre.
    const callbacks=[];
    const rooms=new Map([[restored.code,restored]]);
    const reconnectTimers=new Map();
    const scheduler={
      reconnectTimers,rooms,Engine,
      cancelReconnectTimer(){},reconnectTimerKey:(code,id)=>`${code}:${id}`,
      scheduleReconnectTakeover(){throw Error('finalizada não usa bot AUTO');},
      setTimeout(fn,delay){callbacks.push({fn,delay});return {unref(){}};},
      clearTimeout(){},
      ensureHost(){},
      emitRoom(){},broadcastPresence(){},
      clearReconnectTimersForRoom(){},closeSpectatorsForRoom(){},clearSpectatorReconnectTimersForRoom(){},
      invalidateInvitesForRoom(){},
      removeRoomDurably:async code=>{rooms.delete(code);},
      console,
    };
    vm.runInNewContext(server.slice(graceStart,graceEnd)+'\nthis.scheduleRestoredPlayerGrace=scheduleRestoredPlayerGrace;',scheduler);
    // Criar outro estado final, com dois humanos; apenas um volta.
    const finished=completedRoom('GRACE1');finished.players[0].connected=true;
    finished.players[1].connected=false;finished.players[1].reconnectDeadlineAt=Date.now()+60000;
    rooms.set(finished.code,finished);
    scheduler.scheduleRestoredPlayerGrace(finished,finished.players[1]);
    assert.equal(callbacks.length,1);
    assert(callbacks[0].delay<=60000&&callbacks[0].delay>=0);
    await callbacks[0].fn();
    assert.equal(finished.players.length,1,'jogador ausente removido após prazo da revanche restaurada');
    assert.equal(finished.players[0].name,'Alice');
    assert(rooms.has(finished.code),'sala deve permanecer para a pessoa conectada');

    // Se NINGUÉM voltar, remover a sala vazia depois de expirar ambas as vagas.
    const abandoned=completedRoom('EXPIRE1');
    for(const p of abandoned.players){
      p.connected=false;p.reconnectDeadlineAt=Date.now()+60000;
    }
    rooms.set(abandoned.code,abandoned);
    const from=callbacks.length;
    for(const player of abandoned.players)scheduler.scheduleRestoredPlayerGrace(abandoned,player);
    assert.equal(callbacks.length-from,2);
    await callbacks[from].fn();
    assert.equal(abandoned.players.length,1);
    assert(rooms.has(abandoned.code),'uma vaga humana ainda está reservada');
    await callbacks[from+1].fn();
    assert.equal(rooms.has(abandoned.code),false,'sala sem humanos deve ser excluída após o prazo');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  console.log('✓ V40.69.8.6: reinício, resultado/ranking, votos, F5, expiração, revanche e isolamento de torneio.');
})().catch(e=>{console.error(e);process.exitCode=1;});

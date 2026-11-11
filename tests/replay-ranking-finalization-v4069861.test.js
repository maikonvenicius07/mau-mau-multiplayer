'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Engine=require('../game-engine');
const ReplaySession=require('../replay-session');
const RankingFinalization=require('../ranking-finalization');
const {buildMatchRecord}=require('../ranking-store');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const functionStart=server.indexOf('function maybeRecordFinished(room)');
const functionEnd=server.indexOf('// V40.69.8.1',functionStart);
const replayStart=server.indexOf('function maybeStartReplay(room)');
const replayEnd=server.indexOf('function nextBotInfo(room)',replayStart);
assert(functionStart>=0&&functionEnd>functionStart&&replayEnd>replayStart);

function fixture(count=3,code='RETRY1'){
  const room=Engine.createRoom(code,{socketId:'s1',token:'t1',name:'Joel',playerKey:'p1',avatar:'macaco'});
  for(let i=2;i<=count;i++)Engine.addPlayer(room,{socketId:`s${i}`,token:`t${i}`,name:`Pessoa${i}`,playerKey:`p${i}`,avatar:'preta'});
  room.status='finished';room.round=5;room.finishedAt=Date.now();room.matchSerial=6;
  room.players.forEach((p,i)=>{p.score=i===1?10:30;p.roundHistory=[1,2,3,4,5];});
  room.players.forEach(p=>ReplaySession.confirmReplay(room,p));
  return room;
}
function controller(room,{saveNow=()=>Promise.resolve(true),recordMatch=()=>Promise.resolve(true),ready=()=>Promise.resolve(true),timeout=25,retry=10}={}){
  const rooms=new Map([[room.code,room]]);
  const events=[];
  const calls=[];
  const rank={recordMatch(record){calls.push(record.matchId);return recordMatch(record);}};
  const snapshot={saveNow};
  const ctx={Engine,ReplaySession,RankingFinalization:{...RankingFinalization,finalizationTimeoutMs:()=>timeout,retryDelayMs:()=>retry},
    buildMatchRecord,rooms,roomSnapshotStore:snapshot,rankingStore:rank,ensureRankingReady:ready,
    console:{error(){}},setTimeout,clearTimeout,Date,ensureHost() {},
    emitRoom(room){events.push({...ReplaySession.replayInfo(room),status:room.status,serial:room.matchSerial});
      if(room.status==='finished'&&room.rankingRecorded)ctx.maybeStartReplay(room);
    },
  };
  vm.runInNewContext(server.slice(functionStart,functionEnd)+'\nthis.maybeRecordFinished=maybeRecordFinished;'+
    server.slice(replayStart,replayEnd)+'\nthis.maybeStartReplay=maybeStartReplay;',ctx);
  return {ctx,events,calls};
}
(async()=>{
  // O defeito original: a Promise do PostgreSQL fica pendente e rankingRecording
  // continua true, impedindo todos os retries. O prazo controla esse estado.
  {const room=fixture(3,'HANG3');let release;
    const hanging=new Promise(resolve=>release=resolve);
    const {ctx,events}=controller(room,{recordMatch:()=>hanging});
    ctx.maybeRecordFinished(room);
    await delay(55);
    assert.equal(room.rankingRecorded,false);
    assert.equal(room.rankingRecording,false,'nenhuma Promise pendente deve bloquear a sala indefinidamente');
    assert(room.rankingRetryAt>Date.now()-1000);
    assert.equal(ReplaySession.replayInfo(room).readyCount,3);
    assert.equal(ReplaySession.replayInfo(room).rankingRetrying,true);
    assert(events.some(e=>e.rankingRetrying),'interface recebe aviso de tentativa futura');
    release(true);
    await delay(3);
    assert.equal(room.rankingRecorded,false,'commit atrasado não deve reiniciar a sala por callback obsoleto');
  }
  // Após o erro o servidor tenta novamente. MatchId permanece idempotente e
  // os votos não precisam ser reenviados pelos jogadores.
  {const room=fixture(3,'RECOV3');let attempts=0;const saved=new Set();
    const {ctx,calls}=controller(room,{recordMatch:async record=>{
      attempts++;if(attempts===1)throw new Error('PostgreSQL indisponível');
      if(saved.has(record.matchId))return false;saved.add(record.matchId);return true;
    }});
    const identities=room.players.map(p=>[p.id,p.token,p.playerKey,p.socketId]);
    ctx.maybeRecordFinished(room);await delay(5);
    assert.equal(room.status,'finished');assert.equal(room.rankingRecording,false);
    assert.equal(room.rankingRecorded,false);
    assert.equal(ReplaySession.replayInfo(room).rankingRetrying,true);
    await delay(12);ctx.maybeRecordFinished(room);await delay(10);
    assert.equal(room.status,'playing','3/3 deve iniciar automaticamente quando o resultado for confirmado');
    assert.equal(room.round,1);assert.equal(room.matchSerial,7);
    assert.deepEqual(room.players.map(p=>[p.id,p.token,p.playerKey,p.socketId]),identities);
    assert.equal(saved.size,1);assert.equal(new Set(calls).size,1);
    assert.equal(room.rankingFailureCount,0);
    assert.equal(ctx.maybeStartReplay(room),false,'não permitir revancha duplicada');
  }
  // Confirmações de dois e cinco jogadores; ranking termina antes do último voto.
  for(const count of [2,4,5]){
    const room=fixture(count,`COUNT${count}`);const last=room.players[count-1];
    room.replayReadyPlayerIds=room.replayReadyPlayerIds.filter(id=>id!==last.id);
    const {ctx}=controller(room);
    ctx.maybeRecordFinished(room);await delay(8);
    assert.equal(room.status,'finished');
    ReplaySession.confirmReplay(room,last);
    assert.equal(ctx.maybeStartReplay(room),true);
    assert.equal(room.status,'playing');
  }
  // O commit pode chegar depois da última confirmação, sem cliques adicionais.
  {const room=fixture(3,'WAIT3');let settle;
    const waiting=new Promise(resolve=>settle=resolve);
    const {ctx}=controller(room,{recordMatch:()=>waiting,timeout:120});
    ctx.maybeRecordFinished(room);await delay(3);
    assert.equal(room.status,'finished');assert.equal(ReplaySession.replayInfo(room).readyCount,3);
    settle(true);await delay(5);
    assert.equal(room.status,'playing');assert.equal(room.matchSerial,7);
  }
  // Falha no snapshot: não tocar ranking nem autorizar revanche prematura.
  {const room=fixture(2,'SNAPHANG');let rankingCalls=0;
    const {ctx}=controller(room,{saveNow:()=>new Promise(()=>{}),recordMatch:()=>{rankingCalls++;return true;}});
    ctx.maybeRecordFinished(room);await delay(45);
    assert.equal(room.rankingRecording,false);assert.equal(room.rankingRecorded,false);
    assert.equal(room.status,'finished');assert.equal(rankingCalls,0);
  }
  // Falha temporária e reconexão: preservar votos mesmo enquanto um usuário sai.
  {const room=fixture(3,'RECNCT');const {ctx}=controller(room);
    room.players[2].connected=false;room.players[2].reconnectEligible=true;
    ctx.maybeRecordFinished(room);await delay(8);
    assert.equal(room.status,'finished');
    room.players[2].connected=true;
    assert.equal(ctx.maybeStartReplay(room),true);
  }
  // Empate final é registro legítimo; uma revanche cria identificador diferente.
  {const room=fixture(3,'TIE3');room.players[0].score=10;room.players[1].score=10;
    const initial=buildMatchRecord(room);assert.equal(initial.results.filter(r=>r.won).length,2);
    const {ctx}=controller(room);ctx.maybeRecordFinished(room);await delay(10);
    assert.equal(room.status,'playing');
    assert.notEqual(buildMatchRecord(room).matchId,initial.matchId);
  }
  assert.equal(RankingFinalization.retryDelayMs(1),15000);
  assert.equal(RankingFinalization.retryDelayMs(5),60000);
  assert.equal(RankingFinalization.finalizationTimeoutMs({}),30000);
  assert.equal(RankingFinalization.finalizationTimeoutMs({RANKING_FINALIZATION_TIMEOUT_MS:'5000'}),30000);
  console.log('✓ V40.69.8.6.1: 3/3, Promise travada, recuperação, idem-potência, 2–5 jogadores, empate e reconexão.');
})().catch(e=>{console.error(e);process.exitCode=1;});

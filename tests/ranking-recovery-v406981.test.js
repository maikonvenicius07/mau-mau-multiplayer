'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const Engine=require('../game-engine');
const {RankingStore,buildMatchRecord}=require('../ranking-store');
const {RoomSnapshotStore}=require('../room-snapshot-store');
const {createRetryableInitialization}=require('../ranking-init-retry');

(async()=>{
  let now=1000,attempts=0;
  const manager=createRetryableInitialization({
    clock:()=>now,cooldownMs:10000,
    initialize:async()=>{attempts++;if(attempts===1)throw new Error('database unavailable');},
  });
  assert.equal(await manager.ensureReady(),false,'primeira falha deve retornar false');
  assert.equal(await manager.ensureReady(),false,'não deve gerar tentativas em loop durante cooldown');
  assert.equal(attempts,1);
  now+=10001;
  const checks=await Promise.all(Array.from({length:20},()=>manager.ensureReady()));
  assert(checks.every(Boolean),'todos devem compartilhar retry recuperado');
  assert.equal(attempts,2,'retry concorrente deve ser coalescido');
  assert.equal(await manager.ensureReady(),true);
  assert.equal(attempts,2,'não deve refazer init após sucesso');

  let release,started=0;
  const waiting=new Promise(resolve=>release=resolve);
  const concurrent=createRetryableInitialization({initialize:async()=>{started++;await waiting;}});
  const p1=concurrent.ensureReady(),p2=concurrent.ensureReady();
  release();assert.equal(await p1,true);assert.equal(await p2,true);assert.equal(started,1);

  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert(server.includes('rankingReady:ensureRankingReady()'),'readiness deve consultar a conexão recuperada');
  assert(server.includes('return ensureRankingReady()'),'gravação deve tentar recuperar inicialização');
  assert(server.includes('rankingRecoveryTimer=setInterval'),'partidas pendentes devem ter retry sem evento de socket');
  assert(server.includes("room.status==='finished'&&!room.rankingRecorded&&!room.rankingRecording"),'retry não deve duplicar gravação ativa');
  assert(server.includes('if(!ReplaySession.canStartReplay(room))return false;'),'revanche não deve iniciar antes do ranking registrar o resultado');
  assert(server.includes('roomSnapshotStore.saveNow(room).catch(e=>console.error(\'[ranking] falha ao confirmar snapshot final\''),'após ranking, snapshots devem permanecer reutilizáveis para revanche');
  assert(!server.includes("roomSnapshotStore.delete(room.code).catch(e=>console.error('[ranking] falha ao limpar snapshot final'"));
  // Confirma que, depois de contabilizar a primeira vitória, a mesma sala
  // continua permitindo snapshots da revanche (sem delete/tombstone).
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-rank-recovery-'));
  try{
    const ranking=new RankingStore({databaseUrl:'',filePath:path.join(dir,'ranking.json')});
    const snapshots=new RoomSnapshotStore({databaseUrl:'',filePath:path.join(dir,'rooms.json'),ttlMs:3600000});
    await ranking.init();await snapshots.init();
    const room=Engine.createRoom('RANK81',{socketId:'a',token:'ta',playerKey:'conta-a',name:'Jogador A',avatar:'macaco'});
    Engine.addPlayer(room,{socketId:'b',token:'tb',playerKey:'conta-b',name:'Jogador B',avatar:'preta'});
    room.status='finished';room.round=5;room.finishedAt=Date.now();
    room.players[0].score=5;room.players[1].score=22;
    const first=buildMatchRecord(room);room.pendingRankingRecord=first;
    assert.equal(await snapshots.saveNow(room),true);
    assert.equal(await ranking.recordMatch(first),true);
    assert.equal(await ranking.recordMatch(first),false,'retry não pode duplicar a vitória');
    // A saída de um jogador não altera o resultado já congelado.
    room.players.pop();assert.equal(room.pendingRankingRecord.results.length,2);
    // Estado encerrado permanece salvo e marcado como confirmado.
    room.rankingRecorded=true;assert.equal(await snapshots.saveNow(room),true);
    room.players.push({id:'p2',token:'tb',playerKey:'conta-b',socketId:'b',connected:true,isBot:false,host:false,name:'Jogador B',avatar:'preta',score:22,hand:[]});
    Engine.resetMatch(room);assert.equal(room.pendingRankingRecord,null);
    room.status='playing';room.round=1;
    assert.equal(await snapshots.saveNow(room),true,'revanche precisa continuar persistindo na mesma sala');
    const active=await snapshots.loadActive();
    assert.equal(active.length,1);assert.equal(active[0].matchSerial,2);assert.equal(active[0].round,1);
    const scored=await ranking.getLeaderboard({period:'season',mode:'official'});
    assert.equal(scored.find(p=>p.playerKey==='conta-a')?.wins,1);
    await snapshots.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  console.log('✓ V40.69.8.1: inicialização recupera, retry é serializado, não perde janela de ranking ao terminar e preserva snapshots de revanches.');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
// V40.69.8.17 — resultados de torneio nao confirmados nao podem sumir
// pela auditoria de salas, pela expiração normal dos snapshots ou por retry.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const Retention=require('../tournament-room-retention');
const Governance=require('../room-governance');
const {RoomSnapshotStore,restoreRoomSnapshot}=require('../room-snapshot-store');
const Engine=require('../game-engine');

const pending={code:'PEND17',status:'finished',rankingRecorded:false,
  tournament:{id:'cup-pend17',phase:'qualifier',tableNumber:1,rosterKeys:['key0','key1'],forfeits:[]},
  players:[{id:'p0',playerKey:'key0',isBot:false,connected:false}]};
const confirmed={...pending,rankingRecorded:true};
assert.equal(Retention.hasPendingTournamentResult(pending),true);
assert.equal(Retention.mayRemoveRoom(pending),false);
assert.equal(Retention.hasPendingTournamentResult(confirmed),false);
assert.equal(Retention.mayRemoveRoom(confirmed),true);
assert.equal(Retention.hasPendingTournamentResult({...pending,tournament:null}),false);
assert.equal(Retention.hasPendingTournamentResult({...pending,status:'lobby',pendingRankingRecord:null}),false);
assert.equal(Retention.hasPendingTournamentResult({...pending,status:'playing',pendingRankingRecord:{matchId:'m17'}}),true);
assert.equal(Governance.shouldCleanupRoom({...pending,players:[]}),false,
  'auditoria nao pode apagar resultado pendente ainda que a lista de jogadores esteja vazia');
assert.equal(Governance.shouldCleanupRoom({...confirmed,players:[]}),true,
  'resultado ja confirmado nao deve impedir a limpeza normal');
const ttl=8*60*60*1000;
assert.equal(Retention.snapshotTtlMs(pending,ttl),30*24*60*60*1000);
assert.equal(Retention.snapshotTtlMs(confirmed,ttl),ttl);
assert.equal(Retention.snapshotTtlMs({...pending,tournament:null},ttl),ttl);

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-tournament-pend17-'));
  try{
    const filePath=path.join(dir,'snapshots.json');
    const store=new RoomSnapshotStore({databaseUrl:'',filePath,ttlMs:ttl,debounceMs:1});
    await store.init();
    const room=Engine.createRoom('PEND17',{name:'A',avatar:'macaco',playerKey:'key0',token:'t0'});
    Engine.addPlayer(room,{name:'B',avatar:'macaco',playerKey:'key1',token:'t1'});
    room.tournament=pending.tournament;room.status='finished';room.rankingRecorded=false;
    room.pendingRankingRecord={matchId:'fixture-17',results:[{playerKey:'key0'},{playerKey:'key1'}]};
    await store.saveNow(room);
    const saved=JSON.parse(fs.readFileSync(filePath,'utf8')).rooms.PEND17;
    assert(saved,'deve existir snapshot da mesa pendente');
    assert(saved.expiresAt>Date.now()+14*24*60*60*1000,'resultado pendente deve sobreviver ao TTL comum de 8 horas');
    const rows=await store.loadActive();
    assert.equal(rows.length,1);
    const restored=restoreRoomSnapshot(rows[0],{now:Date.now()});
    assert(restored,'resultado pendente deve poder ser restaurado após restart');
    assert.equal(restored.pendingRankingRecord.matchId,'fixture-17');
    assert.equal(restored.rankingRecorded,false);
    room.rankingRecorded=true;
    await store.saveNow(room);
    const updated=JSON.parse(fs.readFileSync(filePath,'utf8')).rooms.PEND17;
    assert(updated.expiresAt<Date.now()+24*60*60*1000,'apos confirmacao vale o prazo comum de retenção');
    await store.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  // Protecao central mesmo quando nenhum socket gera eventos adicionais.
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert(server.includes('const pendingTournamentRetryTimer=setInterval('));
  assert(server.includes('RankingFinalization.withTimeout(operation,{'));
  assert(server.includes('if(room && !TournamentRoomRetention.mayRemoveRoom(room))return false;'));
  assert(server.includes('if(currentRoom.tournament && TournamentRoomRetention.hasPendingTournamentResult(currentRoom))return;'));

  // Extrai a função real de exclusão e comprova que nenhum tombstone e emitido
  // enquanto o resultado nao foi confirmado, mesmo se houver pedido explicito.
  const from=server.indexOf('async function removeRoomDurably(');
  const to=server.indexOf('function removeRoom(',from);
  assert(from>=0&&to>from);
  const locked={...pending,code:'LOCK17',players:[{id:'p1',playerKey:'key0',isBot:false}]};
  const rooms=new Map([[locked.code,locked]]);
  const calls=[];
  const context={rooms,Date,TournamentRoomRetention:Retention,
    requireRoomPersistenceReady:async()=>calls.push('ready'),
    roomSnapshotStore:{markRoomDeleted:async()=>calls.push('tombstone')},
    cleanupRoomResources:()=>calls.push('cleanup'),
  };
  vm.runInNewContext(server.slice(from,to)+'\nthis.remove=removeRoomDurably;',context);
  assert.equal(await context.remove(locked.code),false);
  assert.deepEqual(calls,[],'resultado pendente nao deve sequer emitir tombstone de exclusao');
  assert(rooms.has(locked.code),'mesa pendente permanece em memoria');
  locked.rankingRecorded=true;
  assert.equal(await context.remove(locked.code),true);
  assert.deepEqual(calls,['ready','tombstone','cleanup']);
  assert(!rooms.has(locked.code));

  // O prazo antigo de cinco minutos também precisa respeitar uma mesa
  // cujo resultado aguarda confirmação, mesmo sem jogadores conectados.
  const expireStart=server.indexOf('function cancelOfflineRoomExpiry(');
  const expireEnd=server.indexOf('function roomWaitingForReconnect(',expireStart);
  assert(expireStart>=0&&expireEnd>expireStart);
  const offline={...pending,status:'playing',pendingRankingRecord:{matchId:'unfinished17'},
    code:'OFF17',players:[{id:'p0',playerKey:'key0',connected:false,isBot:false,
      disconnectedAt:Date.now()-360000}],createdAt:Date.now()-360000};
  const timers=[];let deleted=0,retried=0;
  const offlineCtx={Date,Math,Number,Map,rooms:new Map([[offline.code,offline]]),
    RoomLifecycle:{allHumansDisconnected:()=>true},
    TournamentRoomRetention:Retention,
    ALL_HUMANS_OFFLINE_EXPIRY_MS:300000,
    offlineRoomExpiryTimers:new Map(),
    setTimeout:fn=>{timers.push(fn);return {unref(){}};},
    clearTimeout(){},maybeRecordFinished:()=>{retried++;},
    clearReconnectTimersForRoom(){},closeSpectatorsForRoom(){},
    clearSpectatorReconnectTimersForRoom(){},invalidateInvitesForRoom(){},
    removeRoomDurably:async()=>{deleted++;return true;},
    broadcastPresence(){},console,
  };
  vm.runInNewContext(server.slice(expireStart,expireEnd)+'\nthis.refresh=refreshOfflineRoomExpiry;',offlineCtx);
  offlineCtx.refresh(offline);
  assert.equal(timers.length,1);
  await timers.shift()();
  assert.equal(deleted,0,'limpeza offline nao pode apagar resultado pendente');
  assert.equal(retried,1,'limpeza offline deve solicitar nova tentativa de gravacao');
  console.log('✓ V40.69.8.17: retenção, expiração, tombstone e recuperação de resultados pendentes.');
})().catch(error=>{console.error(error);process.exitCode=1;});

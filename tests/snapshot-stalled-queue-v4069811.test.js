'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const Engine=require('../game-engine');
const {RoomSnapshotStore}=require('../room-snapshot-store');
const {buildMatchRecord}=require('../ranking-store');
const ReplaySession=require('../replay-session');
const RankingFinalization=require('../ranking-finalization');
const {createDatabasePoolConfig}=require('../database-pool');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeoutMs=1600){
  const start=Date.now();while(Date.now()-start<timeoutMs){if(await check())return;await sleep(10);}
  throw Error('Timeout esperando retomada da persistência');
}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve(value){resolve(value);}};}
function room(code){
  const r=Engine.createRoom(code,{socketId:'S1',token:'T1',playerKey:'K1',name:'Um',avatar:'macaco'});
  Engine.addPlayer(r,{socketId:'S2',token:'T2',playerKey:'K2',name:'Dois',avatar:'macaco'});
  r.status='playing';r.round=2;r.currentPlayer=0;r.players[0].score=10;
  return r;
}
function makeStore(dir,name,options={}){
  return new RoomSnapshotStore({databaseUrl:'',filePath:path.join(dir,`${name}.json`),debounceMs:5,writeTimeoutMs:55,retryDelaysMs:[35,45,55],...options});
}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-811-'));
  try{
    // C01: primeira escrita nunca retorna; segunda gravação deve avançar sem
    // retornar à tela de resultado à espera de um snapshot de forma infinita.
    {
      const s=makeStore(dir,'hang'),r=room('STLL01');await s.init();
      const old=s.backend.save.bind(s.backend),entered=deferred(),release=deferred();
      let writes=0;
      s.backend.save=async(...args)=>{
        if(++writes===1){entered.resolve();await release.promise;}
        return old(...args);
      };
      const first=s.saveNow(r);await entered.promise;
      r.currentPlayer=1;r.players[0].score=77;
      const second=s.saveNow(r);
      await assert.rejects(first,e=>e.code==='ROOM_SNAPSHOT_WRITE_TIMEOUT');
      assert.equal(await second,true,'a segunda gravação não deve aguardar o backend antigo');
      let state=(await s.loadActive())[0];assert.equal(state.currentPlayer,1);assert.equal(state.players[0].score,77);
      release.resolve();await sleep(15); // A primeira escrita termina DEPOIS da segunda.
      state=(await s.loadActive())[0];assert.equal(state.currentPlayer,1,'revisão velha não pode reverter turno');
      assert.equal(state.players[0].score,77,'revisão velha não pode reverter pontos');
      assert.equal(s.snapshotRetries.size,0,'a escrita nova confirmou o snapshot');
      await s.close();
    }
    // Uma escrita abandonada deve permitir retentativa automática sem
    // jogadores gerarem um novo evento; close() não fica pendurado no driver.
    {
      const s=makeStore(dir,'retry'),r=room('STLL02');await s.init();
      const orig=s.backend.save.bind(s.backend);let writes=0;
      s.backend.save=async(...args)=>{if(++writes===1)return new Promise(()=>{});return orig(...args)};
      await assert.rejects(s.saveNow(r),e=>e.code==='ROOM_SNAPSHOT_WRITE_TIMEOUT');
      await until(async()=>{const rows=await s.loadActive();return rows.length===1&&s.snapshotRetries.size===0;});
      assert.equal(writes,2);
      await s.close();
    }
    // A exclusão da sala deve liberar sua fila mesmo se o snapshot antigo
    // nunca retornar. Tombstone impede que a escrita atrasada a ressuscite.
    {
      const s=makeStore(dir,'delete'),r=room('STLL03');await s.init();
      const orig=s.backend.save.bind(s.backend),entered=deferred(),release=deferred();
      let count=0;s.backend.save=async(...args)=>{if(++count===1){entered.resolve();await release.promise;}return orig(...args)};
      const first=s.saveNow(r);await entered.promise;
      const deletion=s.markRoomDeleted(r.code);
      assert.equal(s.isRoomDeleted(r.code),true);
      await assert.rejects(first,e=>e.code==='ROOM_SNAPSHOT_WRITE_TIMEOUT');
      await deletion;
      release.resolve();await sleep(15);
      assert.equal((await s.loadActive()).length,0);
      assert.equal(s.isRoomDeleted(r.code),true);
      assert.equal(await s.saveNow(r),false);
      await s.close();
    }
    // A rotina de débito pode continuar gravando snapshots depois de um hang
    // se houver ação nova; e salas distintas não disputam a fila.
    {
      const s=makeStore(dir,'parallel'),a=room('STLL04'),b=room('STLL05');await s.init();
      const orig=s.backend.save.bind(s.backend),started=deferred();
      s.backend.save=async(...args)=>{if(args[0]===a.code){started.resolve();return new Promise(()=>{});}return orig(...args)};
      const hanging=s.saveNow(a);await started.promise;
      assert.equal(await s.saveNow(b),true);
      await assert.rejects(hanging,e=>e.code==='ROOM_SNAPSHOT_WRITE_TIMEOUT');
      assert.equal((await s.loadActive()).length,1);
      await s.close();
    }
    // Não declarar ranking gravado quando buildMatchRecord não encontra conta elegível.
    {
      const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
      const start=source.indexOf('function maybeRecordFinished(room)');
      const end=source.indexOf('// V40.69.8.1',start);
      assert(start>0&&end>start);
      const r=room('STLL06');r.status='finished';r.round=5;r.finishedAt=Date.now();
      r.players.forEach(p=>{p.playerKey=null;p.score=20;});
      const events=[],ctx={rooms:new Map([[r.code,r]]),buildMatchRecord,Engine,Date,
        console:{error(...args){events.push(args.join(' '));}},emitRoom(){events.push('broadcast')},
      };
      vm.runInNewContext(source.slice(start,end)+'\nthis.maybeRecordFinished=maybeRecordFinished;',ctx);
      ctx.maybeRecordFinished(r);
      assert.equal(r.rankingRecorded,false);
      assert(r.rankingRetryAt>Date.now());
      assert(events.some(e=>e.includes('registro NÃO confirmado')));
      assert(events.includes('broadcast'));
    }
    // Fluxo 3/3 completo: o primeiro snapshot do resultado trava, mas a
    // recuperação posterior registra UMA única vitória e inicia a revanche.
    {
      const s=makeStore(dir,'replay'),r=room('STLL07');await s.init();
      r.status='lobby';
      Engine.addPlayer(r,{socketId:'S3',token:'T3',playerKey:'K3',name:'Três',avatar:'macaco'});
      r.status='finished';r.round=5;r.matchSerial=3;r.finishedAt=Date.now();
      r.players.forEach((p,i)=>{p.score=i===0?12:30;ReplaySession.confirmReplay(r,p);});
      const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
      const start=source.indexOf('function maybeRecordFinished(room)');
      const end=source.indexOf('// V40.69.8.1',start);
      const replayStart=source.indexOf('function maybeStartReplay(room)');
      const replayEnd=source.indexOf('function nextBotInfo(room)',replayStart);
      const orig=s.backend.save.bind(s.backend);let writes=0;
      s.backend.save=async(...args)=>{if(++writes===1)return new Promise(()=>{});return orig(...args);};
      const committed=new Set();const events=[];
      const ctx={Engine,ReplaySession,buildMatchRecord,Date,rooms:new Map([[r.code,r]]),roomSnapshotStore:s,
        RankingFinalization:{...RankingFinalization,finalizationTimeoutMs:()=>250,retryDelayMs:()=>10},
        ensureRankingReady:async()=>true,
        rankingStore:{async recordMatch(record){const dup=committed.has(record.matchId);committed.add(record.matchId);return !dup;}},
        console:{error(){}},ensureHost(){},
        emitRoom(room){events.push([room.status,room.rankingRecorded]);if(room.status==='finished'&&room.rankingRecorded)ctx.maybeStartReplay(room);},
      };
      vm.runInNewContext(source.slice(start,end)+'\nthis.maybeRecordFinished=maybeRecordFinished;'+
        source.slice(replayStart,replayEnd)+'\nthis.maybeStartReplay=maybeStartReplay;',ctx);
      ctx.maybeRecordFinished(r);
      await until(()=>writes>=2&&s.snapshotRetries.size===0);
      await until(()=>r.rankingRecording===false);
      assert.equal(r.status,'finished','revanche só pode começar após confirmar resultado');
      await sleep(12);ctx.maybeRecordFinished(r); // equivale ao timer automático de recuperação do servidor
      await until(()=>r.status==='playing');
      assert.equal(r.round,1);assert.equal(r.matchSerial,4);
      assert.equal(committed.size,1,'vitória não duplicada');
      assert(events.some(([status,recorded])=>status==='finished'&&!recorded));
      assert.equal(ReplaySession.replayInfo(r).readyCount,0,'votos são consumidos após iniciar nova partida');
      await s.close();
    }
    // Se a restauração inicial falhar, o processo não cria nova sala sem
    // antes recuperar as partidas anteriores. A tentativa seguinte recupera.
    {
      const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
      const start=source.indexOf('async function restorePersistedRooms(){');
      const end=source.indexOf('const restoredRoomsRecoveryTimer=',start);
      const beginReady=source.indexOf('async function requireRoomPersistenceReady(){');
      const endReady=source.indexOf('function cleanupRoomResources(',beginReady);
      assert(start>0&&end>start&&beginReady>0&&endReady>beginReady);
      let attempts=0;
      const ctx={
        roomSnapshotStore:{async loadActive(){if(++attempts===1)throw new Error('instabilidade simulada');return [];}},
        ensureRoomSnapshotsInitialized:async()=>true,
        console:{error(){}},rooms:new Map(),
      };
      vm.runInNewContext('let snapshotsRestored=false;let snapshotsRestorePromise=null;'+
        source.slice(start,end)+source.slice(beginReady,endReady)+
        'this.restore=restorePersistedRooms;this.requireReady=requireRoomPersistenceReady;this.isRestored=()=>snapshotsRestored;',ctx);
      await assert.rejects(ctx.requireReady(),/salas anteriores ainda não puderam ser restauradas/);
      assert.equal(ctx.isRestored(),false);
      await ctx.requireReady();assert.equal(ctx.isRestored(),true);
      assert.equal(attempts,2,'restauração só é repetida quando anterior falhou');
      await ctx.requireReady();assert.equal(attempts,2,'restauração bem-sucedida ocorre uma única vez');
    }
    // Contrato: pool não fica esperando conexão para sempre, SQL preserva a
    // revisão monotônica, tombstones e timeout no servidor PostgreSQL.
    {
      const db=createDatabasePoolConfig('postgresql://user:pass@localhost/db',{env:{PGSSLMODE:'disable'}});
      assert.equal(db.connectionTimeoutMillis,8000);
      assert.equal(db.ssl,false);
      const src=fs.readFileSync(path.join(__dirname,'..','room-snapshot-store.js'),'utf8');
      assert(src.includes('SET LOCAL statement_timeout = 12000'));
      assert(src.includes('mm_room_snapshots.revision<EXCLUDED.revision'));
      assert(src.includes("kind='room-deleted' AND expires_at>NOW()"));
      const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
      assert(server.includes('ensureRoomSnapshotsInitialized'));
      assert(server.includes('snapshotsRestored=true'));
    }
    console.log('✓ V40.69.8.11: fila travada, retentativa sem novo evento, tombstone, revisão atrasada, salas paralelas, ranking vazio e pool delimitado.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

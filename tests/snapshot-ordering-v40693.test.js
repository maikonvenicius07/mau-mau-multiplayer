'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Engine=require('../game-engine');
const {RoomSnapshotStore,restoreRoomSnapshot}=require('../room-snapshot-store');

function deferred(){
  let resolve;
  const promise=new Promise(r=>{resolve=r;});
  return {promise,resolve};
}
function makeRoom(code){
  const room=Engine.createRoom(code,{socketId:'host',token:'host-token',name:'Host',avatar:'macaco',playerKey:'host-key'});
  Engine.addPlayer(room,{socketId:'guest',token:'guest-token',name:'Convidado',avatar:'boi',playerKey:'guest-key'});
  room.status='playing';room.round=2;room.currentPlayer=0;
  room.players[0].hand=[{id:'H1',rank:'4',suit:'hearts',copy:1}];
  room.players[1].hand=[{id:'G1',rank:'Q',suit:'spades',copy:1}];
  room.players[0].score=10;room.players[1].score=32;
  room.discard=[{id:'D1',rank:'8',suit:'diamonds',copy:1}];
  return room;
}
function tempStore(file){return new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:60*60*1000,debounceMs:5});}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-snap-order-'));
  try{
    const file=path.join(dir,'active.json');
    const store=tempStore(file);await store.init();
    const room=makeRoom('ORD931');
    const started=deferred(),release=deferred();
    const original=store.backend.save.bind(store.backend);
    const writes=[];
    let attempt=0;
    store.backend.save=async (...args)=>{
      const number=++attempt;
      writes.push({number,code:args[0],revision:args[4],turn:args[1].currentPlayer});
      if(number===1){started.resolve();await release.promise;}
      return original(...args);
    };
    // 1) Estado A entra no banco lentamente; B é solicitado antes da conclusão de A.
    const first=store.saveNow(room);
    await started.promise;
    room.currentPlayer=1;
    room.players[0].hand.push({id:'H2',rank:'A',suit:'clubs',copy:1});
    room.players[0].score=17;
    const second=store.saveNow(room);
    assert.equal(writes.length,1,'gravação B deve esperar gravação A da mesma sala');
    release.resolve();
    await Promise.all([first,second]);
    assert.deepEqual(writes.map(w=>w.revision),[1,2],'revisões precisam crescer na ordem das solicitações');
    assert.deepEqual(writes.map(w=>w.turn),[0,1],'snapshots devem ser imutáveis após captura');
    await store.close();

    // 2) Reinício real em armazenamento JSON: cartas, turno e placar têm de ser os mais novos.
    const restarted=tempStore(file);await restarted.init();
    const [saved]=await restarted.loadActive();
    assert.equal(saved.currentPlayer,1);
    assert.equal(saved.players[0].hand.length,2);
    assert.equal(saved.players[0].score,17);
    assert.equal(saved.players[1].score,32);
    assert.equal(saved.round,2);
    const recovered=restoreRoomSnapshot(saved,{now:1700000000000,reconnectGraceMs:60000});
    assert.equal(recovered.currentPlayer,1);
    assert.equal(recovered.players[0].hand.length,2);
    assert.equal(recovered.players[0].score,17);
    assert.equal(restarted.revisions.get('ORD931'),2,'contador precisa partir da revisão persistida após restart');
    recovered.players[1].score=40;
    await restarted.saveNow(recovered);
    assert.equal(restarted.revisions.get('ORD931'),3);
    await restarted.close();

    // 3) Exclusão DURÁVEL durante uma gravação em andamento.
    const deletionStore=tempStore(file);await deletionStore.init();
    const deletionStarted=deferred(),deletionRelease=deferred();
    const baseSave=deletionStore.backend.save.bind(deletionStore.backend);
    let saveCount=0;
    deletionStore.backend.save=async (...args)=>{
      if(++saveCount===1){deletionStarted.resolve();await deletionRelease.promise;}
      return baseSave(...args);
    };
    const inFlight=deletionStore.saveNow(recovered);
    await deletionStarted.promise;
    const deletion=deletionStore.markRoomDeleted('ORD931',Date.now());
    assert.equal(deletionStore.isRoomDeleted('ORD931'),true,'novas gravações bloqueadas imediatamente');
    await deletionStore.saveNow(recovered);
    deletionStore.queueSave(recovered);
    deletionRelease.resolve();
    await Promise.all([inFlight,deletion]);
    assert.equal(saveCount,1,'não deve existir gravação nova após tombstone');
    await deletionStore.close();
    const afterDelete=tempStore(file);await afterDelete.init();
    assert.equal(afterDelete.isRoomDeleted('ORD931'),true);
    assert.deepEqual(await afterDelete.loadActive(),[],'o reinício não pode ressuscitar sala excluída');
    await afterDelete.close();

    // 4) Exclusão simples também deve aguardar gravações e impedir callbacks atrasados.
    const secondFile=path.join(dir,'delete.json');
    const simple=tempStore(secondFile);await simple.init();
    const begin=deferred(),unblock=deferred();
    const originalSave=simple.backend.save.bind(simple.backend);
    simple.backend.save=async (...args)=>{begin.resolve();await unblock.promise;return originalSave(...args);};
    const s1=simple.saveNow(makeRoom('ORD932'));
    await begin.promise;
    const del=simple.delete('ORD932');
    const late=simple.saveNow(makeRoom('ORD932'));
    unblock.resolve();
    await Promise.all([s1,del,late]);
    assert.deepEqual(await simple.loadActive(),[]);
    await simple.close();

    // 5) Uma operação com erro não deve bloquear para sempre a fila de outras gravações.
    const thirdFile=path.join(dir,'retry.json');
    const retry=tempStore(thirdFile);await retry.init();
    const save=retry.backend.save.bind(retry.backend);
    let failOnce=true;
    retry.backend.save=(...args)=>{
      if(failOnce){failOnce=false;return Promise.reject(new Error('falha simulada do banco'));}
      return save(...args);
    };
    const retryRoom=makeRoom('ORD933');
    await assert.rejects(retry.saveNow(retryRoom),/falha simulada/);
    retryRoom.currentPlayer=1;
    assert.equal(await retry.saveNow(retryRoom),true);
    assert.equal((await retry.loadActive())[0].currentPlayer,1);
    await retry.close();

    // 6) Uma sala lenta não deve bloquear outra sala; close() aguarda writes ativas.
    const parallelFile=path.join(dir,'parallel.json');
    const parallel=tempStore(parallelFile);await parallel.init();
    const slowStarted=deferred(),slowFinish=deferred();
    const backendSave=parallel.backend.save.bind(parallel.backend);
    parallel.backend.save=async(...args)=>{
      if(args[0]==='ORD934'){slowStarted.resolve();await slowFinish.promise;}
      return backendSave(...args);
    };
    const slow=parallel.saveNow(makeRoom('ORD934'));
    await slowStarted.promise;
    const fast=parallel.saveNow(makeRoom('ORD935'));
    const fastResult=await Promise.race([
      fast,new Promise((_,reject)=>setTimeout(()=>reject(new Error('sala independente ficou bloqueada')),1500))
    ]);
    assert.equal(fastResult,true);
    let hasClosed=false;
    const closing=parallel.close().then(()=>{hasClosed=true;});
    await Promise.resolve();
    assert.equal(hasClosed,false,'close() não pode encerrar o armazenamento enquanto salva');
    slowFinish.resolve();
    await Promise.all([slow,closing]);

    // 7) Várias atualizações durante o debounce salvam somente a versão final.
    const debounceFile=path.join(dir,'debounce.json');
    const debounce=tempStore(debounceFile);await debounce.init();
    const debated=makeRoom('ORD936');
    debated.currentPlayer=0;debounce.queueSave(debated);
    debated.currentPlayer=1;debounce.queueSave(debated);
    await new Promise(r=>setTimeout(r,40));
    assert.equal((await debounce.loadActive())[0].currentPlayer,1);
    assert.equal(debounce.revisions.get('ORD936'),1);
    await debounce.close();

    // 8) SQL contém revisão monotônica, lock entre processos e guarda de tombstone.
    const source=fs.readFileSync(path.join(__dirname,'..','room-snapshot-store.js'),'utf8');
    assert(source.includes('ALTER TABLE mm_room_snapshots ADD COLUMN IF NOT EXISTS revision BIGINT'));
    assert(source.includes('mm_room_snapshots.revision<EXCLUDED.revision'));
    assert(source.includes("pg_advisory_xact_lock(hashtext('mm_room_snapshots'),hashtext($1))"));
    assert(source.includes("kind='room-deleted' AND expires_at>NOW()"));
    console.log('✓ V40.69.3: concorrência, revisão após restart, exclusão durável/simples, falha e SQL conferidos.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

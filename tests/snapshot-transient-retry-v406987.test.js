'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Engine=require('../game-engine');
const {RoomSnapshotStore,restoreRoomSnapshot}=require('../room-snapshot-store');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=2500){
  const start=Date.now();
  while(Date.now()-start<timeout){if(await fn())return;await sleep(20);}
  throw new Error('Expirou a espera pelo snapshot persistido');
}
function room(code){
  const r=Engine.createRoom(code,{socketId:'S1',token:'token1',playerKey:'key1',name:'A',avatar:'macaco'});
  Engine.addPlayer(r,{socketId:'S2',token:'token2',playerKey:'key2',name:'B',avatar:'macaco'});
  r.status='playing';r.round=2;r.currentPlayer=0;
  r.players[0].score=10;
  r.players[0].hand=[{id:'T1',rank:'4',suit:'hearts',copy:1}];
  return r;
}
function store(file,debounceMs=5){return new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:3600000,debounceMs});}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-retry-'));
  try{
    // Falha temporária em saveNow: retorno continua sendo erro, mas uma nova tentativa
    // deve persistir a mesma partida mesmo sem novos eventos Socket.IO.
    {
      const file=path.join(dir,'immediate.json'),s=store(file),r=room('RTY001');
      await s.init();const original=s.backend.save.bind(s.backend);let attempts=0;
      s.backend.save=async(...args)=>{if(++attempts===1)throw Error('postgres temporariamente indisponível');return original(...args)};
      await assert.rejects(s.saveNow(r),/temporariamente indisponível/);
      await until(()=>attempts===2&&!s.snapshotRetries.size);
      const restarted=store(file);await restarted.init();
      const rows=await restarted.loadActive();assert.equal(rows.length,1);
      const restored=restoreRoomSnapshot(rows[0]);assert.equal(restored.players[0].score,10);
      assert.equal(restored.players[0].hand[0].id,'T1');
      await restarted.close();await s.close();
    }
    // Uma jogada nova durante uma falha nunca deve ser sobrescrita por snapshot velho.
    {
      const file=path.join(dir,'latest.json'),s=store(file),r=room('RTY002');
      await s.init();const original=s.backend.save.bind(s.backend);let attempts=0;
      s.backend.save=async(...args)=>{if(++attempts===1)throw Error('perda de conexão simulada');return original(...args)};
      s.queueSave(r);
      await until(()=>attempts>=1);
      r.currentPlayer=1;r.players[0].score=25;r.players[0].hand=[{id:'NEW',rank:'K',suit:'spades',copy:1}];
      s.queueSave(r);
      await until(async()=>{
        const rows=await s.loadActive();return rows[0]?.currentPlayer===1&&!s.snapshotRetries.size;
      });
      await sleep(600); // Nenhuma gravação atrasada deve retornar o estado antigo.
      const [restored]=await s.loadActive();
      assert.equal(restored.currentPlayer,1);assert.equal(restored.players[0].score,25);
      assert.equal(restored.players[0].hand[0].id,'NEW');
      await s.close();
    }
    // Encerramento/tombstone desarma a retentativa pendente: sala não ressuscita.
    {
      const file=path.join(dir,'deleted.json'),s=store(file),r=room('RTY003');
      await s.init();const original=s.backend.save.bind(s.backend);let attempts=0;
      s.backend.save=async(...args)=>{attempts++;throw Error('falha de gravação simulada')};
      await assert.rejects(s.saveNow(r),/simulada/);
      assert.equal(s.snapshotRetries.size,1);
      await s.markRoomDeleted(r.code);
      assert.equal(s.snapshotRetries.size,0);
      await sleep(650);assert.equal(attempts,1);
      const restarted=store(file);await restarted.init();
      assert.equal((await restarted.loadActive()).length,0);
      assert.equal(restarted.isRoomDeleted(r.code),true);
      await restarted.close();await s.close();
      void original;
    }
    // A falha de uma sala não impede a persistência de outras salas.
    {
      const file=path.join(dir,'parallel.json'),s=store(file),r1=room('RTY004'),r2=room('RTY005');
      await s.init();const original=s.backend.save.bind(s.backend);
      let failed=false;
      s.backend.save=async(...args)=>{if(args[0]===r1.code&&!failed){failed=true;throw Error('falha da sala A')}return original(...args)};
      const first=s.saveNow(r1),second=s.saveNow(r2);
      assert.equal(await second,true);await assert.rejects(first,/falha da sala A/);
      await until(async()=> (await s.loadActive()).length===2);
      await s.close();
    }
    console.log('✓ V40.69.8.7: retentativa após falha, estado mais recente, exclusão, reconexão simulada e independência entre salas.');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});

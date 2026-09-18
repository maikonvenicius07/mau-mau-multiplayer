'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Engine=require('../game-engine');
const {RoomSnapshotStore}=require('../room-snapshot-store');
const pkg=require('../package.json');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const snapshots=fs.readFileSync(path.join(root,'room-snapshot-store.js'),'utf8');
const engineSource=fs.readFileSync(path.join(root,'game-engine.js'),'utf8');

assert.strictEqual(pkg.version,'40.68','package.json deve identificar V40.61');
assert(engineSource.includes('membershipStartedAt: Date.now()'),'cada nova associação humana deve possuir um marco próprio');
assert(snapshots.includes('mm_room_lifecycle_tombstones'),'PostgreSQL deve possuir ledger/tombstones de ciclo de vida');
assert(snapshots.includes("kind VARCHAR(24) NOT NULL"),'tombstones devem distinguir abandono e exclusão');
assert(snapshots.includes('player_id TEXT'),'tombstone de jogador deve apontar para a associação/cadeira exata');
assert(snapshots.includes('if(this.isRoomDeleted(code))return;'),'gravação atrasada não pode recriar sala tombstonada');
assert(server.includes('await roomSnapshotStore.markPlayerAbandoned(room.code,playerKey,player.id,eventAt);'),'abandono deve persistir tombstone antes de alterar a cadeira');
assert(server.includes("await abandonHumanSeatDurably(room,leaving,{reason:'saiu voluntariamente da sala',socket});"),'botão SAIR deve aguardar persistência forte');
assert(server.includes('await abandonHumanSeatDurably(room,player,{reason,socket});'),'troca de sala deve aguardar persistência forte da vaga anterior');
assert(server.includes('await roomSnapshotStore.markRoomDeleted(room.code,eventAt);'),'exclusão após último humano deve gravar tombstone da sala');
assert(server.includes('rooms.has(code) || roomSnapshotStore.isRoomDeleted(code)'),'código tombstonado não pode ser reutilizado enquanto protege snapshot antigo');

function makeRoom(code='P61'){
  const room=Engine.createRoom(code,{socketId:'a',token:'ta',name:'Orlando',avatar:'macaco',playerKey:'google-orlando'});
  Engine.addPlayer(room,{socketId:'b',token:'tb',name:'Carlos',avatar:'boi',playerKey:'google-carlos'});
  Engine.startRound(room);
  return room;
}

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-v4061-'));
  const file=path.join(dir,'rooms.json');

  // Cenário A: snapshot antigo já estava salvo; a saída é confirmada no ledger,
  // mas o processo morre ANTES de o snapshot novo ser gravado.
  const store1=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:60*60*1000,debounceMs:10});
  await store1.init();
  const room=makeRoom('P6101');
  const old=room.players[0];
  await store1.saveNow(room);
  const eventAt=Date.now();
  await store1.markPlayerAbandoned(room.code,old.playerKey,old.id,eventAt);
  await store1.close();

  const store2=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:60*60*1000,debounceMs:10});
  await store2.init();
  const restored=await store2.loadActive();
  assert.strictEqual(restored.length,1,'a sala com outro humano deve continuar existindo');
  const staleSeat=restored[0].players.find(p=>p.id===old.id);
  assert(staleSeat,'a cadeira da rodada deve continuar existindo para preservar a partida');
  assert.strictEqual(staleSeat.isBot,true,'a associação abandonada deve reaparecer apenas como Máquina');
  assert.strictEqual(staleSeat.playerKey,null,'snapshot antigo não pode devolver a Conta Google à cadeira');
  assert(!restored[0].players.some(p=>!p.isBot&&p.playerKey==='google-orlando'),'reserva humana antiga não pode ressuscitar');

  // Cenário B: depois do abandono, usar o código da sala cria uma NOVA associação.
  // O tombstone antigo aponta para o playerId velho e não deve bloquear o novo.
  const fresh=makeRoom('P6101');
  assert.notStrictEqual(fresh.players[0].id,old.id,'nova entrada precisa de uma nova associação/cadeira');
  await store2.saveNow(fresh);
  await store2.close();

  const store3=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:60*60*1000,debounceMs:10});
  await store3.init();
  const afterRejoin=await store3.loadActive();
  assert.strictEqual(afterRejoin.length,1);
  assert(afterRejoin[0].players.some(p=>!p.isBot&&p.playerKey==='google-orlando'),'entrada posterior por código deve sobreviver ao tombstone da associação anterior');

  // Cenário C: exclusão da sala grava tombstone antes de qualquer possibilidade de
  // restauração. Mesmo uma tentativa de saveNow atrasada não pode recriá-la.
  await store3.markRoomDeleted('P6101',Date.now());
  assert.strictEqual(store3.isRoomDeleted('P6101'),true);
  await store3.saveNow(fresh); // simula callback atrasado de snapshot
  await store3.close();

  const store4=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:60*60*1000,debounceMs:10});
  await store4.init();
  assert.strictEqual(store4.isRoomDeleted('P6101'),true,'tombstone da sala deve sobreviver ao restart');
  const afterDelete=await store4.loadActive();
  assert.strictEqual(afterDelete.length,0,'sala excluída nunca deve reaparecer por snapshot antigo');
  await store4.close();

  fs.rmSync(dir,{recursive:true,force:true});
  console.log('✓ V40.61: tombstones duráveis impedem ressurgimento de vaga/sala após crash e permitem nova entrada explícita por código.');
})().catch(err=>{console.error(err);process.exit(1);});

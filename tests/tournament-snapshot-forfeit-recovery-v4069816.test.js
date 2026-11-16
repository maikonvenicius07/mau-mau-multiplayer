'use strict';
// V40.69.8.16: crash depois de persistir o abandono mas antes do snapshot.
// Nenhuma cadeira de torneio deve reaparecer como Máquina; as salas comuns
// continuam usando a recuperação de Máquina que já existia.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Engine=require('../game-engine');
const Forfeit=require('../tournament-forfeit');
const {buildMatchRecord}=require('../ranking-store');
const {RoomSnapshotStore,restoreRoomSnapshot}=require('../room-snapshot-store');

function roomFor(n=3,{code='TRN016',roundStarted=true}={}){
  const room=Engine.createRoom(code,{name:'Jogador 0',avatar:'macaco',playerKey:'key0',token:'token0'});
  for(let i=1;i<n;i++)Engine.addPlayer(room,{name:`Jogador ${i}`,avatar:'macaco',playerKey:`key${i}`,token:`token${i}`});
  room.tournament={id:'cup-recovery',phase:'qualifier',tableNumber:1,
    rosterKeys:room.players.map(p=>p.playerKey),forfeits:[]};
  if(roundStarted)Engine.startRound(room);
  return room;
}
async function crashAndRestore(room,forfeitIds,verify){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-tournament-tombstone-'));
  const filePath=path.join(dir,'snapshots.json');
  try{
    const store=new RoomSnapshotStore({databaseUrl:'',filePath,ttlMs:3600000,debounceMs:10});
    await store.init();await store.saveNow(room);
    for(const id of forfeitIds){
      const player=room.players.find(p=>p.playerKey===id);
      assert(player,'o teste deve localizar a identidade original');
      await store.markPlayerAbandoned(room.code,player.playerKey,player.id,Date.now());
    }
    await store.close();
    const next=new RoomSnapshotStore({databaseUrl:'',filePath,ttlMs:3600000,debounceMs:10});
    await next.init();
    let loaded=await next.loadActive();
    assert.equal(loaded.length,1,'a sala deve sobreviver ao reinício');
    await verify(loaded[0],next);
    // Reinício após persistir o estado reparado: sem duplicar desistentes.
    await next.saveNow(loaded[0]);await next.close();
    const again=new RoomSnapshotStore({databaseUrl:'',filePath,ttlMs:3600000,debounceMs:10});
    await again.init();loaded=await again.loadActive();
    assert.equal(loaded.length,1);
    assert.equal(new Set(loaded[0].tournament.forfeits.map(p=>p.playerKey)).size,
      loaded[0].tournament.forfeits.length,'desistência não pode duplicar no segundo restart');
    await again.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function noMachines(room){
  assert(room.players.every(p=>!p.isBot&&!p.autoControlled),'torneio não tem Máquina nem AUTO');
}
(async()=>{
  // 2 participantes: o desistente é preservado na classificação, o outro ganha.
  await crashAndRestore(roomFor(2),['key0'],async snapshot=>{
    noMachines(snapshot);
    assert.equal(snapshot.players.length,1);
    assert.equal(snapshot.status,'finished');
    assert.equal(snapshot.players[0].playerKey,'key1');
    assert.equal(snapshot.tournament.forfeits[0].playerKey,'key0');
    assert.equal(snapshot.tournament.forfeits.length,1);
    const restored=restoreRoomSnapshot(snapshot,{now:Date.now()});
    assert(restored&&!restored.players.some(p=>p.isBot));
    const record=Forfeit.tournamentMatchRecord(restored,buildMatchRecord(restored));
    assert.equal(record.results.length,2);
    assert.equal(record.results.find(p=>p.playerKey==='key0').forfeited,true);
    assert.equal(record.results.find(p=>p.playerKey==='key0').won,false);
    assert.equal(record.results.find(p=>p.playerKey==='key1').won,true);
  });

  // 4 participantes: desiste quem está na vez; continuidade sem pular o seguinte.
  const four=roomFor(4,{code:'TRN416'});
  const current=four.players[four.currentPlayer];
  const dir=four.direction===1?1:-1;
  const expected=four.players[(four.currentPlayer+dir+four.players.length)%four.players.length].playerKey;
  await crashAndRestore(four,[current.playerKey],async snapshot=>{
    noMachines(snapshot);assert.equal(snapshot.players.length,3);
    assert.equal(snapshot.status,'playing');
    assert.equal(snapshot.players[snapshot.currentPlayer].playerKey,expected);
    assert.equal(snapshot.tournament.forfeits[0].playerKey,current.playerKey);
  });

  // Mais de uma desistência, recuperadas em ordem, devem manter roster completo.
  await crashAndRestore(roomFor(4,{code:'TRN516'}),['key1','key2'],async snapshot=>{
    noMachines(snapshot);assert.equal(snapshot.players.length,2);
    assert.deepEqual(new Set(snapshot.tournament.forfeits.map(p=>p.playerKey)),new Set(['key1','key2']));
    const record=Forfeit.tournamentMatchRecord(snapshot,buildMatchRecord(snapshot));
    assert.equal(record.results.length,4);
  });

  // Entre rodadas: mantém apenas competidores humanos na próxima distribuição.
  const between=roomFor(3,{code:'TRN616'});
  between.status='between-rounds';between.currentPlayer=-1;
  await crashAndRestore(between,['key1'],async snapshot=>{
    noMachines(snapshot);assert.equal(snapshot.players.length,2);
    Engine.startRound(snapshot);assert.equal(snapshot.round,2);
    assert(snapshot.players.every(p=>!p.isBot));
  });

  // No lobby: nenhuma conversão para Máquina ou perdão de tombstone.
  await crashAndRestore(roomFor(3,{code:'TRN716',roundStarted:false}),['key1'],async snapshot=>{
    noMachines(snapshot);assert.equal(snapshot.status,'lobby');
    assert(!snapshot.players.some(p=>p.playerKey==='key1'));
  });

  // Fim com registro pendente: saída posterior não muda resultado da mesa.
  const finished=roomFor(2,{code:'TRN816'});
  finished.status='finished';finished.winnerId=finished.players[0].id;
  finished.rankingRecorded=false;
  await crashAndRestore(finished,['key1'],async snapshot=>{
    noMachines(snapshot);assert.equal(snapshot.status,'finished');
    assert.equal(snapshot.players.length,2);
    assert.equal(snapshot.tournament.forfeits.length,0);
    const post=restoreRoomSnapshot(snapshot,{now:Date.now()});
    assert(post);const leaving=post.players.find(p=>p.playerKey==='key1');
    assert.equal(leaving.reconnectEligible,false);
    assert(Number(leaving.voluntaryLeftAt)>0);
  });

  // Um snapshot legado que já perdeu identidade e virou robô não pode entrar
  // novamente em torneio. Preserva-se o dado persistido para auditoria.
  const corrupt=roomFor(3,{code:'BAD016'});
  corrupt.players[0].isBot=true;
  corrupt.players[0].playerKey=null;
  corrupt.players[0].name='Máquina';
  const brokenDir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-broken-tournament-'));
  try{
    const file=path.join(brokenDir,'snap.json');
    const first=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:3600000});
    await first.init();await first.saveNow(corrupt);await first.close();
    const second=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:3600000});
    await second.init();
    const savedConsole=console.error;
    let blocked=false;
    try{
      console.error=(...parts)=>{if(String(parts[0]).includes('snapshot contém Máquina/AUTO'))blocked=true;};
      assert.equal((await second.loadActive()).length,0,'snapshot antigo com bot deve ficar em quarentena');
    }finally{console.error=savedConsole;}
    assert(blocked,'a condição de recuperação insegura deve ser registrada');
    await second.close();
    assert(fs.readFileSync(file,'utf8').includes('BAD016'),'snapshot inválido não deve ser apagado');
  }finally{fs.rmSync(brokenDir,{recursive:true,force:true});}

  // Salas comuns preservam a conversão histórica sem alterar o comportamento.
  const ordinary=roomFor(2,{code:'REG916'});delete ordinary.tournament;
  const id=ordinary.players[0].id,key=ordinary.players[0].playerKey;
  const dirOrd=fs.mkdtempSync(path.join(os.tmpdir(),'mm-normal-recovery-'));
  try{
    const file=path.join(dirOrd,'snap.json');
    const original=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:3600000});
    await original.init();await original.saveNow(ordinary);
    await original.markPlayerAbandoned(ordinary.code,key,id);await original.close();
    const restarted=new RoomSnapshotStore({databaseUrl:'',filePath:file,ttlMs:3600000});
    await restarted.init();const [loaded]=await restarted.loadActive();
    assert(loaded.players.find(p=>p.id===id).isBot,'sala comum continua com Máquina');
    await restarted.close();
  }finally{fs.rmSync(dirOrd,{recursive:true,force:true});}

  console.log('✓ V40.69.8.16: tombstones de torneio reconstroem desistentes sem Máquina, preservam resultados e não alteram salas comuns.');
})().catch(e=>{console.error(e);process.exitCode=1;});

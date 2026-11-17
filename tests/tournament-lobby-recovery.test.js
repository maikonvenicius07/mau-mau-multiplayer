'use strict';
// Testes de recuperação de lobby sem partida iniciada: nenhuma Máquina, resultado
// reiniciado, duplicação de fase ou reset de partida em andamento é permitido.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const {canRecoverMissingLobby,MIN_MISSING_LOBBY_AGE_MS}=require('../tournament-lobby-recovery');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

function eligible(row,{deleted=false,activeSnapshot=false,snapshotsReady=true,now=Date.now()}={}){
  return canRecoverMissingLobby(row,{deleted,activeSnapshot,snapshotsReady,now});
}
async function checkQualifier(dir){
  const opts={databaseUrl:'',filePath:path.join(dir,'games.json')};
  const game=new TournamentGames(opts);await game.init();
  assert.equal(await game.get('cup-a',1),null);
  const created=await game.claim('cup-a',1,'ABC123');
  assert.equal(created.roomState,'lobby');
  assert.equal(eligible(created),false,'Lobby recém-criado não deve ser roubado sem tombstone.');
  assert.equal(eligible(created,{deleted:true,snapshotsReady:false}),false);
  assert.equal(eligible(created,{deleted:true,activeSnapshot:true}),false);
  assert.equal(eligible(created,{deleted:true}),true,'Tombstone permite recriar lobby vazio.');
  assert.equal(eligible(created,{now:created.claimedAt+MIN_MISSING_LOBBY_AGE_MS}),true,
    'A recuperação após restart precisa esperar a janela de proteção.');
  const restored=await game.reclaimLobby('cup-a',1,'ABC123','NEW456');
  assert.equal(restored.roomCode,'NEW456');
  assert.equal(restored.roomState,'lobby');
  assert.equal(await game.get('cup-a',1).then(x=>x.roomCode),'NEW456');
  await assert.rejects(()=>game.reclaimLobby('cup-a',1,'ABC123','BAD999'),/mudou de estado/);
  await game.markStarted('cup-a',1,'NEW456');
  await assert.rejects(()=>game.markStarted('cup-a',1,'NEW456'),/Mesa alterada|já encerrada/,
    'A mesma mesa não pode executar a transição de lobby para started duas vezes.');
  const started=await game.get('cup-a',1);
  assert.equal(started.roomState,'started');
  assert.equal(eligible(started,{deleted:true}),false,'Partida iniciada nunca é recriada do zero.');
  await assert.rejects(()=>game.reclaimLobby('cup-a',1,'NEW456','RESET'),/mudou de estado/);
  await assert.rejects(()=>game.markStarted('cup-a',1,'BAD999'),/Mesa alterada/);
  await game.finish({id:'cup-a',number:1,roomCode:'NEW456',expectedPlayers:2,
    result:{matchId:'m1',results:[{name:'Ana',score:0,position:1,won:true},{name:'Bia',score:20,position:2,won:false}]}});
  assert.equal(eligible(await game.get('cup-a',1),{deleted:true}),false,'Mesa com resultado não pode ser recriada.');
  const afterRestart=new TournamentGames(opts);await afterRestart.init();
  assert.equal((await afterRestart.get('cup-a',1)).roomCode,'NEW456');
  assert.equal((await afterRestart.get('cup-a',1)).result.results.length,2);
  // Vínculos legados não têm comprovação de nunca terem começado.
  const legacy=await game.claim('cup-legacy',1,'LEGACY');
  game.reload();game.local['cup-legacy:1'].roomState='legacy';game.save();
  assert.equal(eligible(await game.get('cup-legacy',1),{deleted:true}),false);
}
async function checkLaterStage(dir){
  const opts={databaseUrl:'',filePath:path.join(dir,'bracket.json')};
  const bracket=new TournamentBracket(opts);await bracket.init();
  const cup='cup-b';
  const players=[{playerKey:'k1',name:'Ana',seat:1},{playerKey:'k2',name:'Bia',seat:2}];
  bracket.local[cup]=[{stage:'final',number:1,players,roomCode:null,result:null}];bracket.save();
  const created=await bracket.claim(cup,'final',1,'FIN001');
  assert.equal(created.roomState,'lobby');
  assert.equal(eligible(created,{deleted:true}),true);
  const recovered=await bracket.reclaimLobby(cup,'final',1,'FIN001','FIN002');
  assert.equal(recovered.roomCode,'FIN002');
  assert.deepEqual(recovered.players,players,'O roster da final não pode mudar.');
  await bracket.markStarted(cup,'final',1,'FIN002');
  await assert.rejects(()=>bracket.markStarted(cup,'final',1,'FIN002'),/Mesa alterada|já encerrada/);
  assert.equal(eligible(await bracket.getBinding(cup,'final',1),{deleted:true}),false);
  await assert.rejects(()=>bracket.reclaimLobby(cup,'final',1,'FIN002','FIN003'),/mudou de estado/);
  const reread=new TournamentBracket(opts);await reread.init();
  assert.equal((await reread.getBinding(cup,'final',1)).roomState,'started');
}
function checkServerBoundaries(){
  const enter=source.slice(source.indexOf("socket.on('enterTournamentTable'"),source.indexOf("socket.on('createRoom'"));
  const start=source.slice(source.indexOf("socket.on('startRound'"),source.indexOf("socket.on('declare'"));
  assert(enter.includes('await requireRoomPersistenceReady()'));
  assert(enter.includes('roomSnapshotStore.loadActive()'));
  assert(enter.includes('roomSnapshotStore.isRoomDeleted(binding.roomCode)'));
  assert(enter.includes('TournamentLobbyRecovery.canRecoverMissingLobby'));
  assert(enter.includes('reclaimLobby('));
  assert(start.includes('await startTournamentLobbyOnRequest(room,p,socket.id)'));
  const helper=source.slice(source.indexOf('async function startTournamentLobbyOnRequest('),source.indexOf('// V40.69.8.1 — falhas transitórias'));
  assert(helper.indexOf('await tournamentGames.markStarted(')>0);
  assert(helper.indexOf('await tournamentGames.markStarted(')<helper.lastIndexOf('Engine.startRound(room)'));
  assert(helper.includes('await tournamentBracket.markStarted('));
  assert(helper.includes('tournamentRoundStartLocks'));
}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-lobby-recovery-'));
  try{await checkQualifier(dir);await checkLaterStage(dir);checkServerBoundaries();
    console.log('✓ Recovery: lobby perdido, tombstones, prazo, fases, CAS, partida iniciada, resultado e vínculos legados.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});

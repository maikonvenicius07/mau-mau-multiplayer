'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const client=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const lobby=require('../tournament-reserved-lobby');
const recovery=require('../tournament-lobby-recovery');
const health=require('../tournament-table-health');
const {restoreRoomSnapshot,plainRoomSnapshot}=require('../room-snapshot-store');
const {assertTournamentTable,MAX_TOURNAMENT_PLAYERS}=require('../tournament-table-capacity');
const handler=server.slice(server.indexOf("  socket.on('enterTournamentTable'"),server.indexOf("  socket.on('createRoom'"));
assert(handler.includes("roomSnapshotStore.saveNow(candidate)"));
assert(handler.indexOf('roomSnapshotStore.saveNow(candidate)')<handler.indexOf('await tournamentBracket.claim('));
assert(handler.includes('TournamentReservedLobby.canRestore'));
assert(handler.includes('roomSnapshotStore.markRoomDeleted(code'));
assert(handler.includes('tournamentTableEntryResult'));
assert(client.includes("socket.on('tournamentTableEntryResult'"));
assert(client.includes("entryStatus.classList.add('is-error')"));
const id='cup-v33',stage='final',number=1;
const seat={players:[{playerKey:'a',name:'Ana'},{playerKey:'b',name:'Bia'}]};
function makeRoom(code,playerKey){
  return {code,status:'lobby',round:0,rules:{rounds:5},players:[{id:`seat-${playerKey}`,playerKey,isBot:false,connected:true,
    name:playerKey==='a'?'Ana':'Bia',avatar:'macaco',host:true,token:'t'}],chat:[],log:[],deck:[],discard:[],tournament:null};
}
function scenario({previousBinding=null,savedSnapshot=null,snapshotExists=!!savedSnapshot,failSave=false,failClaim=false,failWait=false,rounds=5}={}){
  const rooms=new Map(),locks=new Set(),events=new Map(),order=[],snapshots=new Map(),errors=[];
  let binding=previousBinding;
  if(savedSnapshot)snapshots.set(savedSnapshot.code,savedSnapshot);
  let codeNum=0;
  const store={
    loadActive:async()=>[...snapshots.values()],
    hasStoredSnapshot:async code=>snapshots.has(code)||snapshotExists&&code===previousBinding?.roomCode,
    isRoomDeleted:()=>false,
    saveNow:async room=>{
      order.push('snapshot');
      if(failSave)return false;
      snapshots.set(room.code,plainRoomSnapshot(room));return true;
    },
    markRoomDeleted:async code=>{order.push('delete');snapshots.delete(code);},
  };
  const context={socket:null,crypto:{randomUUID:()=> 'uuid'},Number,String,Error,Set,Map,Promise,Date,console:{warn:(...v)=>errors.push(v),info:()=>{},error:()=>{}},
    tournamentTableJoinLocks:locks,tournamentTestDeleteLocks:new Set(),
    assertTournamentTable,MAX_TOURNAMENT_PLAYERS,
    ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',
    ensureTournamentBracketReady:async()=>true,requireRoomPersistenceReady:async()=>{},
    tournamentDraw:{get:async()=>[{number:1}],seatFor:async()=>seat},
    tournamentBracket:{
      summary:async()=>({currentStage:stage,champion:null}),seatFor:async()=>seat,
      getBinding:async()=>binding,
      claim:async(_id,_phase,_number,code)=>{order.push('claim');if(failClaim)throw Error('Falha no banco');if(!binding)binding={roomCode:code,roomState:'lobby',claimedAt:Date.now(),result:null};return binding;},
      reclaimLobby:async(_id,_phase,_number,oldCode,code)=>{order.push('reclaim');if(binding?.roomCode!==oldCode)throw Error('Concorrência');binding={...binding,roomCode:code,claimedAt:Date.now()};return binding;}
    },
    tournamentCatalog:{get:async()=>({status:'closed',startAt:Date.now(),name:'Copa',rounds})},
    rooms,
    activePlayerRoomForKey:()=>null,TournamentSeatHandoff:{canAutoSwitchFrom:()=>false},
    awaitTournamentTableJoinLock:async key=>{const until=Date.now()+1500;for(;;){if(!locks.has(key)){locks.add(key);return;}if(Date.now()>until)throw Error('lock timeout');await new Promise(resolve=>setTimeout(resolve,5));}},
    roomSnapshotStore:store,TournamentLobbyRecovery:recovery,TournamentTableHealth:health,TournamentReservedLobby:lobby,
    snapshotsRestored:true,
    roomCode:()=>`RM${String(++codeNum).padStart(4,'0')}`,
    enforceActionRate:()=>{},reserveRoomCreationSlot:()=>()=>{},
    Engine:{createRoom:(code,profile)=>makeRoom(code,profile.playerKey)},
    tournamentWaitDeadline:async()=>Date.now()+5*60000,
    cleanPresenceName:x=>x,cleanAvatar:x=>x,
    ensureSocial:()=>{},prepareForRoomSwitch:async()=>{},
    restoreRoomSnapshot,runtimeReconnectGraceMs:()=>60000,
    scheduleRestoredPlayerGrace:()=>{},refreshOfflineRoomExpiry:()=>{},
    removeFromMatchmaking:()=>{},updatePresenceFromSocket:()=>{},
    StateDelivery:{invalidate:()=>{}},emitChatHistory:()=>{},emitRoom:()=>{},broadcastPresence:()=>{},
    joinSocketIntoRoom:async(socket,room)=>{
      order.push('join-existing');
      if(!room.players.some(p=>p.playerKey===socket.data.auth.playerKey))room.players.push({id:'seat-b',playerKey:'b',connected:true,isBot:false});
      socket.emit('joined',{source:'tournament',code:room.code});
    },
    TournamentSeatRecovery:{memberForResume:()=>null},resumeReservedPlayerSeat:async()=>{},
    tournamentRoundStartLocks:new Set(),
    err:(socket,e)=>socket.emit('gameError',{message:e.message}),
  };
  function connect(playerKey){
    const msgs=[];const socket={data:{auth:{playerKey,name:playerKey==='a'?'Ana':'Bia'},role:null},id:`id-${playerKey}`,
      on:(name,fn)=>events.set(`${playerKey}:${name}`,fn),emit:(name,body)=>msgs.push({name,body}),join:()=>{}};
    vm.runInNewContext(handler,{...context,socket});
    return {run:()=>events.get(`${playerKey}:enterTournamentTable`)({tournamentId:id,stage,tableNumber:number,automatic:false}),msgs,socket};
  }
  return {connect,rooms,snapshots,order,getBinding:()=>binding,errors};
}
(async()=>{
  for(const total of [5,10,15]){
    const s=scenario({rounds:total}),a=s.connect('a');await a.run();
    const room=[...s.rooms.values()][0];
    assert(room,`mesa de ${total} rodadas criada no servidor`);
    assert.equal(room.rules.rounds,total,`regras aplicadas ao lobby ${total}`);
    assert.equal(room.tournament.rounds,total,'metadado competitivo preservado');
    assert.equal(s.snapshots.get(room.code).rules.rounds,total,'snapshot preserva duração em reinício');
  }
  {
    const s=scenario(),a=s.connect('a');await a.run();
    assert.deepEqual(s.order.slice(0,2),['snapshot','claim'],'Persistência ANTES do registro da sala');
    assert.equal(s.rooms.size,1);
    assert.equal(a.msgs.filter(m=>m.name==='joined').length,1);
    const b=s.connect('b');await b.run();
    assert.equal(s.rooms.size,1,'Os dois finalistas dividem a MESMA sala');
    assert.equal(b.msgs.filter(m=>m.name==='joined').length,1);
  }
  {
    const s=scenario(),a=s.connect('a'),b=s.connect('b');
    await Promise.all([a.run(),b.run()]);
    assert.equal(s.rooms.size,1,'Dois primeiros acessos simultâneos precisam convergir para a mesma sala');
    assert.equal(s.order.filter(x=>x==='claim').length,1,'Sem duplicar a criação da final');
    assert.equal(a.msgs.filter(m=>m.name==='joined').length,1);
    assert.equal(b.msgs.filter(m=>m.name==='joined').length,1);
  }
  {
    const s=scenario({failSave:true}),a=s.connect('a');await a.run();
    assert.equal(s.order.includes('claim'),false,'Sem snapshot salvo, não vincular mesa');
    assert.equal(s.order.includes('delete'),true,'Descartar lobby provisório');
    assert.equal(s.rooms.size,0);
    assert.equal(a.msgs.some(m=>m.name==='tournamentTableEntryResult'&&m.body.ok===false),true);
  }
  {
    const s=scenario({failClaim:true}),a=s.connect('a');await a.run();
    assert.equal(s.order.includes('delete'),true,'Falha do DB não pode deixar snapshot órfão');
    assert.equal(s.snapshots.size,0);
    assert.equal(s.rooms.size,0);
  }
  {
    const old=makeRoom('OLD999','a');old.tournament={id,phase:stage,tableNumber:1,rosterKeys:['a','b'],forfeits:[]};
    const snapshot=plainRoomSnapshot(old);
    const binding={roomCode:old.code,roomState:'lobby',claimedAt:Date.now()-3*60000,result:null};
    assert(lobby.canRestore(snapshot,binding,seat,{id,phase:stage,number}));
    const s=scenario({previousBinding:binding,savedSnapshot:snapshot});
    const a=s.connect('a');await a.run();
    assert.equal(s.rooms.size,1,'Lobby íntegro deve ser restaurado');
    assert.equal(s.rooms.get(old.code).code,old.code,'Restaurar código original, sem nova mesa');
    assert.equal(s.order.includes('claim'),false);
    assert.equal(a.msgs.filter(m=>m.name==='joined').length,1);
    for(const bad of [
      {...snapshot,status:'playing',round:1},
      {...snapshot,tournament:{...snapshot.tournament,rosterKeys:['a','c']}},
      {...snapshot,players:[{id:'p',playerKey:'a',isBot:true}]},
      {...snapshot,tournament:{...snapshot.tournament,forfeits:[{playerKey:'a'}]}},
    ])assert.equal(lobby.canRestore(bad,binding,seat,{id,phase:stage,number}),false);
  }
  {
    const old=makeRoom('OLD999','a');old.status='playing';old.round=1;old.tournament={id,phase:stage,tableNumber:1,rosterKeys:['a','b']};
    const snapshot=plainRoomSnapshot(old);
    const binding={roomCode:'OLD999',roomState:'started',claimedAt:Date.now()-120000,result:null};
    const s=scenario({previousBinding:binding,savedSnapshot:snapshot});
    const a=s.connect('a');await a.run();
    assert.equal(s.rooms.size,0,'Não recriar partida iniciada');
    assert.equal(s.order.includes('claim'),false);
    assert.match(a.msgs.find(m=>m.name==='tournamentTableEntryResult').body.message,/dados salvos/);
  }
  {
    const binding={roomCode:'OLD999',roomState:'lobby',claimedAt:Date.now()-120000,result:null};
    const s=scenario({previousBinding:binding,snapshotExists:false}),a=s.connect('a');
    await a.run();
    assert.equal(s.order.includes('reclaim'),true,'Recuperar vínculo sem snapshot de lobby não iniciado');
    assert.equal(s.rooms.size,1);
  }
  console.log('✓ V40.69.8.33: dois finalistas, gravação anterior ao vínculo, falhas de DB/snapshot, lobby recuperável, proteção de partida iniciada, erro visível.');
})().catch(e=>{console.error(e);process.exitCode=1});

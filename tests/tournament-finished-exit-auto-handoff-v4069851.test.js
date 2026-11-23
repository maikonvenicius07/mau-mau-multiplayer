'use strict';
// Executa trechos reais do servidor e cliente em VM isolada, sem Postgres/rede.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Engine=require('../game-engine');
const Lifecycle=require('../room-lifecycle');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const client=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function extract(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,`Trecho não encontrado: ${start}`);return source.slice(a,b);
}
const leaveFunction=extract(server,'async function leaveTournamentSeatTemporarily(', '\nfunction withRoom(');
const leaveHandler=extract(server,"  // V40.69.8.48: ações separadas", "\n  socket.on('playAgain',");
function serverExit(finished){
  const room=Engine.createRoom('ABC234',{name:'Ana',avatar:'macaco',playerKey:'ana',token:'ana-token',socketId:'ana-sock'});
  for(const key of ['bia','cai','dan'])Engine.addPlayer(room,{name:key,avatar:'macaco',playerKey:key,token:key+'-token',socketId:key+'-sock'});
  room.tournament={id:'cup-123',phase:'qualifier',tableNumber:1,rosterKeys:room.players.map(p=>p.playerKey),forfeits:[]};
  if(finished){room.status='finished';room.rankingRecorded=true;}else Engine.startRound(room);
  const emitted=[],listener=new Map(),snapshots=[];
  const socket={id:'ana-sock',data:{roomCode:room.code,playerId:room.players[0].id,role:'PLAYER',auth:{playerKey:'ana'}},
    on:(event,fn)=>listener.set(event,fn),emit:(event,data)=>emitted.push({event,data}),leave:()=>{}};
  const sandbox={socket,rooms:new Map([[room.code,room]]),tournamentExitInProgress:new Set(),
    ROLE_PLAYER:'PLAYER',ROLE_SPECTATOR:'SPECTATOR',RoomLifecycle:Lifecycle,Engine,
    requireRoomPersistenceReady:async()=>{},runtimeReconnectGraceMs:()=>60000,
    roomSnapshotStore:{saveNow:async()=>{snapshots.push(true);return true;}},
    cancelDisconnectDebounce:()=>{},cancelReconnectTimer:()=>{},scheduleReconnectTakeover:()=>{},
    emitRoom:()=>{},broadcastPresence:()=>{},
    forgetCameraSocket:()=>{},notifyLiveVoicePeerUnavailable:()=>{},clearLiveVoiceSender:()=>{},
    spectatorForSocket:()=>null,removeSpectator:()=>{},err:(_s,e)=>{throw e;},
    abandonHumanSeatDurably:async()=>{throw Error('Não deveria ocorrer abandono definitivo');},
    reconnectTimers:new Map(),reconnectTimerKey:(code,id)=>`${code}:${id}`,
    clearReconnectTimersForRoom:()=>{},clearSpectatorReconnectTimersForRoom:()=>{},
    closeSpectatorsForRoom:()=>{},removeRoomDurably:async()=>{},invalidateInvitesForRoom:()=>{},ensureHost:()=>{},
    setTimeout:()=>({unref(){}}),console};
  vm.runInNewContext(leaveFunction+'\n'+leaveHandler,sandbox);
  return {room,socket,emitted,snapshots,leave:()=>new Promise(resolve=>{
    listener.get('leaveRoom')({mode:'temporary'},resolve);
  })};
}
function clientExit(data,initial){
  let session={...initial},state={status:data?.completedTournamentTable?'finished':'playing'};
  const calls=[],handlers=new Map();
  const clientCode=extract(client,"socket.on('leftRoom',data=>{", "socket.on('reconnectionEvent',");
  const sandbox={socket:{connected:true,on:(event,fn)=>handlers.set(event,fn)},
    window:{MauMediaSession:{clear:()=>calls.push('clear-media')},MauCamera:{stop:()=>{}}},
    tournamentWatchMode:false,leaveRoomPending:true,
    $:()=>({disabled:false}),saved:()=>session,
    saveSession:s=>{session=s;calls.push('save-session')},clearSession:()=>{session=null;calls.push('clear-session')},
    returnToLanding:()=>{state=null;calls.push('landing')},syncTemporarySeatReturnBanner:()=>{},
    syncPresenceProfile:()=>{},requestTournamentSeatLocation:()=>calls.push('locate-seat'),
    setTimeout:(fn,ms)=>{calls.push('fallback-'+ms);return 1;},console};
  vm.runInNewContext(clientCode,sandbox);
  handlers.get('leftRoom')(data);
  return {session,calls,state};
}
(async()=>{
  const done=serverExit(true);const beforeKeys=done.room.players.map(p=>p.playerKey);
  const resp=await done.leave();
  assert.equal(resp.ok,true);assert.equal(resp.completedTournamentTable,true);
  assert.equal(resp.keepSeat,true);assert.equal(done.room.players.length,4);
  assert.deepEqual(done.room.players.map(p=>p.playerKey),beforeKeys);
  assert.equal(done.room.tournament.forfeits.length,0);
  assert.equal(done.room.status,'finished');assert.equal(done.room.players[0].connected,false);
  assert.equal(done.room.rankingRecorded,true);
  assert.equal(done.snapshots.length,1);
  const msg=done.emitted.find(e=>e.event==='leftRoom')?.data;
  assert.equal(msg.completedTournamentTable,true);
  const ui=clientExit(msg,{code:'ABC234',token:'ana-token',temporaryExit:true,role:'PLAYER'});
  assert.equal(ui.session,null,'a sessão encerrada não retém temporaryExit');
  assert(ui.calls.includes('locate-seat'),'deve procurar fase seguinte imediatamente');
  assert(ui.calls.includes('fallback-2500'),'deve tolerar limite de consultas do servidor');
  assert(ui.calls.indexOf('landing')<ui.calls.indexOf('locate-seat'));
  const live=serverExit(false),liveResp=await live.leave();
  assert.equal(liveResp.completedTournamentTable,false);
  const liveUi=clientExit(live.emitted.find(e=>e.event==='leftRoom')?.data,{code:'ABC234',role:'PLAYER'});
  assert.equal(liveUi.session.temporaryExit,true,'partida em andamento preserva saída temporária');
  assert(!liveUi.calls.includes('locate-seat'),'não deve autoentrar depois de sair de jogo ativo');
  assert(client.includes("if(sess?.temporaryExit)return;"),'o bloqueio existente continua válido para saída ativa');
  assert(client.includes("if(sess?.temporaryExit)return;"));
  assert(client.includes('requestAccountSeatResume(0);'),'reconexão de conta permanece ativa');
  assert(client.includes('if(!state&&socket.connected)requestTournamentSeatLocation();'),'sem cadeira ativa, localiza próxima fase após reconexão');
  assert(server.includes("socket.on('locateTournamentSeat',async()=>"));
  assert(server.includes("socket.emit('tournamentSeatAssigned'"));
  assert(server.includes("if(binding?.roomCode&&!room)"),'não regredir recuperação da V40.69.8.36');
  console.log('✓ V40.69.8.51: saída de mesa encerrada retoma convocação automática; saída ativa, classificação e segurança preservadas.');
})().catch(e=>{console.error(e);process.exitCode=1});

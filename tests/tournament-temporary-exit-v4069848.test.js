'use strict';
// Executa as funções reais de saída do servidor em ambiente Socket.IO isolado;
// não usa PostgreSQL, rede, câmera física nem altera as regras do motor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Engine=require('../game-engine');
const RoomLifecycle=require('../room-lifecycle');
const Forfeit=require('../tournament-forfeit');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
function extract(a,b){const start=server.indexOf(a);const stop=server.indexOf(b,start+a.length);
  assert(start>=0&&stop>start,`trecho real indisponível: ${a}`);return server.slice(start,stop);}
const temporaryCode=extract('async function leaveTournamentSeatTemporarily(', '\nfunction withRoom(');
const handlersCode=extract('  // V40.69.8.48: ações separadas', "\n  socket.on('playAgain',");
function roomOf({lobby=false,normal=false}={}){
  const room=Engine.createRoom('ABCD23',{name:'Alice',avatar:'macaco',playerKey:'alice',token:'alice-token',socketId:'alice-sock'});
  for(const key of ['bob','carla','davi'])Engine.addPlayer(room,{name:key,avatar:'macaco',playerKey:key,token:key+'-token',socketId:`${key}-sock`});
  if(!normal)room.tournament={id:'cup-123',phase:'qualifier',tableNumber:1,rosterKeys:room.players.map(p=>p.playerKey),forfeits:[]};
  if(!lobby)Engine.startRound(room);
  return room;
}
function setup(room,{savedError=false}={}){
  const captured={listeners:new Map(),sent:[],acks:[],errors:[],disconnects:[],snapshots:[],calls:[],timers:[]};
  const socket={id:'alice-sock',data:{roomCode:room.code,playerId:room.players[0].id,spectatorId:null,role:'PLAYER',auth:{playerKey:'alice'}},
    on(k,fn){captured.listeners.set(k,fn)},emit(k,v){captured.sent.push({k,v})},leave(code){captured.calls.push('leave:'+code)}};
  const sandbox={socket,tournamentExitInProgress:new Set(),rooms:new Map([[room.code,room]]),ROLE_PLAYER:'PLAYER',ROLE_SPECTATOR:'SPECTATOR',
    RoomLifecycle,Engine,requireRoomPersistenceReady:async()=>{},runtimeReconnectGraceMs:()=>60000,
    roomSnapshotStore:{saveNow:async r=>{captured.snapshots.push({connected:r.players[0]?.connected,forfeits:r.tournament?.forfeits.length||0});if(savedError)throw Error('falha simulado');}},
    cancelDisconnectDebounce:()=>{},cancelReconnectTimer:()=>{},scheduleReconnectTakeover:()=>{captured.calls.push('takeover');},
    emitRoom:()=>captured.calls.push('emitRoom'),broadcastPresence:()=>captured.calls.push('presence'),
    Engine,forgetCameraSocket:()=>captured.calls.push('camera-stop'),notifyLiveVoicePeerUnavailable:()=>captured.calls.push('voice-peers-stop'),clearLiveVoiceSender:()=>captured.calls.push('mic-stop'),
    spectatorForSocket:()=>null,removeSpectator:()=>{},err:(_s,error)=>captured.errors.push(error.message),
    abandonHumanSeatDurably:async(r,p)=>{captured.calls.push('abandon');if(r.tournament)Forfeit.forfeitActiveSeat(r,p);
      else r.players=r.players.filter(x=>x!==p);},
    cancelDisconnectDebounce:()=>{},reconnectTimers:new Map(),reconnectTimerKey:(code,id)=>`${code}:${id}`,
    clearReconnectTimersForRoom:()=>{},clearSpectatorReconnectTimersForRoom:()=>{},
    closeSpectatorsForRoom:()=>{},removeRoomDurably:async()=>{},invalidateInvitesForRoom:()=>{},ensureHost:()=>{},
    setTimeout:(fn,delay)=>{const t={fn,delay,unref(){}};captured.timers.push(t);return t;},
    crypto:require('node:crypto'),console};
  vm.runInNewContext(temporaryCode+'\n'+handlersCode,sandbox);
  return {room,socket,ctx:sandbox,...captured,leave:(payload)=>new Promise(resolve=>{
    const callback=ack=>{captured.acks.push(ack);resolve(ack)};
    if(payload===undefined)captured.listeners.get('leaveRoom')(callback);
    else captured.listeners.get('leaveRoom')(payload,callback);
  })};
}
(async()=>{
  // A saída temporária conserva vaga, identidade, mão, pontos e classificação.
  const temp=setup(roomOf());const player=temp.room.players[0];
  const handBefore=JSON.stringify(player.hand),scoreBefore=player.score;
  let response=await temp.leave({mode:'temporary'});
  assert.equal(response.ok,true);assert.equal(response.keepSeat,true);
  assert.equal(temp.room.players.length,4);assert.equal(temp.room.tournament.forfeits.length,0);
  assert.equal(player.connected,false);assert.equal(player.reconnectEligible,true);
  assert(player.reconnectDeadlineAt>Date.now()&&player.reconnectDeadlineAt<=Date.now()+60000);
  assert.equal(player.playerKey,'alice');assert.equal(JSON.stringify(player.hand),handBefore);assert.equal(player.score,scoreBefore);
  assert.equal(RoomLifecycle.canAutoReconnect(player),true);
  assert(temp.calls.includes('takeover'));assert.equal(temp.snapshots[0].connected,false);
  assert.equal(temp.socket.data.playerId,null);assert.equal(temp.socket.data.roomCode,null);
  assert.equal(temp.sent.find(e=>e.k==='leftRoom')?.v.kind,'temporary');
  assert.equal(temp.calls.filter(x=>x==='mic-stop').length,1);
  // Mensagens repetidas da sessão antiga não podem alterar vaga desconectada.
  response=await temp.leave({mode:'abandon'});assert.equal(response.ok,true);assert.equal(temp.room.tournament.forfeits.length,0);
  // Nenhuma escolha / sessão substituída / identidade indevida não devem desistir.
  for(const kind of ['missing','stale','forged']){
    const caseRoom=setup(roomOf());
    if(kind==='stale')caseRoom.socket.id='old-socket';
    if(kind==='forged')caseRoom.socket.data.auth.playerKey='mallory';
    const answer=await caseRoom.leave(kind==='missing'?undefined:{mode:'abandon'});
    assert.equal(answer.ok,false,`${kind}: bloqueio por sessão/autorização`);
    assert.equal(caseRoom.room.tournament.forfeits.length,0);assert.equal(caseRoom.room.players.length,4);
    assert.equal(caseRoom.socket.data.roomCode,caseRoom.room.code);
  }
  // Abandono confirmado faz a desistência existente UMA vez e libera observação.
  const abandoned=setup(roomOf());response=await abandoned.leave({mode:'abandon'});
  assert.equal(response.ok,true);assert.equal(response.keepSeat,false);
  assert.equal(abandoned.room.players.some(p=>p.playerKey==='alice'),false);
  assert.equal(abandoned.room.tournament.forfeits.filter(p=>p.playerKey==='alice').length,1);
  assert.equal(abandoned.calls.filter(x=>x==='abandon').length,1);
  assert.equal(abandoned.sent.find(x=>x.k==='leftRoom')?.v.kind,'abandon');
  response=await abandoned.leave({mode:'abandon'});assert.equal(response.ok,true);
  assert.equal(abandoned.room.tournament.forfeits.length,1);
  // Cliques simultâneos na MESMA vaga: somente a primeira operação entra.
  const racing=setup(roomOf());let resolveFirst;
  const originalAbandon=racing.ctx.abandonHumanSeatDurably;
  racing.ctx.abandonHumanSeatDurably=async (...args)=>{await new Promise(resolve=>{resolveFirst=resolve});return originalAbandon(...args)};
  const first=racing.leave({mode:'abandon'});
  await Promise.resolve();
  const simultaneous=await racing.leave({mode:'abandon'});
  assert.equal(simultaneous.ok,false);
  assert.match(simultaneous.message,/em andamento/);
  resolveFirst();const firstAnswer=await first;assert.equal(firstAnswer.ok,true);
  assert.equal(racing.room.tournament.forfeits.filter(p=>p.playerKey==='alice').length,1);
  // O multiplayer comum continua usando o mesmo fluxo de saída anterior.
  const normal=setup(roomOf({normal:true}));response=await normal.leave();
  assert.equal(response.ok,true);assert.equal(response.keepSeat,false);assert(normal.calls.includes('abandon'));
  // Uma falha de persistência não entrega ao navegador a confirmação de saída.
  const failure=setup(roomOf(),{savedError:true});response=await failure.leave({mode:'temporary'});
  assert.equal(response.ok,false);assert.equal(failure.room.players[0].connected,true);
  assert.equal(failure.room.players[0].socketId,'alice-sock');assert.equal(failure.socket.data.roomCode,failure.room.code);
  // No lobby, a mesma tolerância de ausência é agendada sem novo prazo especial.
  const lobby=setup(roomOf({lobby:true}));response=await lobby.leave({mode:'temporary'});
  assert.equal(response.keepSeat,true);assert(lobby.timers.some(t=>t.delay===60000));
  await lobby.timers.find(t=>t.delay===60000).fn();
  assert(!lobby.room.players.some(p=>p.playerKey==='alice'),'ausência após prazo trata vaga no lobby sem criar forfeit inventado');
  // Abandono confirmado offline: mesmo tendo token, pedidos temporários não
  // podem invocar o forfeit; pedidos explicitamente definitivos conseguem.
  const offlineCode=extract("  socket.on('abandonReservedSeat', async (payload,ack) => {", "  // V40.57 —");
  const offlineRoom=roomOf(),offlineEvents=new Map(),offlineForfeits=[];
  const offlineSocket={id:'recovered-socket',data:{auth:{playerKey:'alice'}},on(k,fn){offlineEvents.set(k,fn)}};
  vm.runInNewContext("socket.on('abandonReservedSeat', async (payload,ack) => {"+offlineCode.split("socket.on('abandonReservedSeat', async (payload,ack) => {")[1],{
    socket:offlineSocket,rooms:new Map([[offlineRoom.code,offlineRoom]]),
    InputSafety:{cleanRoomCode:x=>String(x||''),cleanOpaqueId:x=>String(x||'')},
    abandonHumanSeatDurably:async (room,player)=>{offlineForfeits.push(player.playerKey);Forfeit.forfeitActiveSeat(room,player)},
    broadcastPresence:()=>{},console
  });
  const offlineRequest=action=>new Promise(resolve=>offlineEvents.get('abandonReservedSeat')({code:offlineRoom.code,token:'alice-token',action},resolve));
  const refused=await offlineRequest('temporary');assert.equal(refused.ok,false);assert.equal(offlineForfeits.length,0);
  const accepted=await offlineRequest('abandon');assert.equal(accepted.ok,true);assert.equal(offlineForfeits.length,1);
  assert.equal(offlineRoom.tournament.forfeits.filter(f=>f.playerKey==='alice').length,1);
  // UI: confirmação explícita, acesso temporário e ausência de popup sobre cartas.
  for(const id of ['abandonTournamentDialog','confirmAbandonTournamentBtn','cancelAbandonTournamentBtn','abandonTournamentBtn',
    'temporarySeatReturnBanner','returnTemporarySeatBtn'])assert(html.includes(`id="${id}"`));
  assert(app.includes("socket.timeout(5000).emit('leaveRoom',tournament?{mode}:null"));
  assert(app.includes("if(sess?.temporaryExit)return;"),'voltar após saída temporária é ação intencional');
  assert(app.includes("if(!temporary||finishedWait)window.MauMediaSession?.clear()"),'preferências de mídia preservadas na saída temporária');
  assert(css.includes('.tournament-exit-bar'));
  assert(server.includes("if(room.tournament&&payload?.action!=='abandon')"),'abandono offline depende de intenção explícita');
  console.log('✓ V40.69.8.48: ações reais temporária/definitiva, autorização, repetição, reconexão, lobby, mídia e compatibilidade.');
})().catch(e=>{console.error(e);process.exitCode=1});

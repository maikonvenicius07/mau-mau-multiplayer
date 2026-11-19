'use strict';
// V40.69.8.36 — integração local: módulos reais de sorteio, classificação,
// persistência JSON, criação de lobbies e entrada manual via handler real.
// O placar de fim da partida é simulado: NÃO testa jogadas completas, PostgreSQL
// nem conexões Socket.IO de navegador/Render.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentStore}=require('../tournament-store');
const {TournamentDraw}=require('../tournament-draw');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const {recordTournamentResult}=require('../tournament-result-commit');
const {RoomSnapshotStore,restoreRoomSnapshot}=require('../room-snapshot-store');
const Engine=require('../game-engine');
const Recovery=require('../tournament-lobby-recovery');
const ReservedLobby=require('../tournament-reserved-lobby');
const TableHealth=require('../tournament-table-health');
const SeatRecovery=require('../tournament-seat-recovery');
const {canAutoSwitchFrom}=require('../tournament-seat-handoff');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const begin=server.indexOf("  socket.on('enterTournamentTable'");
const end=server.indexOf("  socket.on('createRoom'",begin);
assert(begin>=0&&end>begin,'handler real de entrada existe');
const src=server.slice(begin,end);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-final-nine-'));

(async()=>{
 const file=name=>path.join(dir,name);
 const opts={databaseUrl:'',filePath:file('tournaments.json'),signupsFilePath:file('signups.json')};
 const catalog=new TournamentCatalog(opts),signup=new TournamentStore({databaseUrl:'',filePath:opts.signupsFilePath});
 const draw=new TournamentDraw({databaseUrl:'',filePath:file('draw.json'),signupsFilePath:opts.signupsFilePath});
 const games=new TournamentGames({databaseUrl:'',filePath:file('games.json')});
 const bracket=new TournamentBracket({databaseUrl:'',filePath:file('bracket.json'),draw});
 const snapshots=new RoomSnapshotStore({databaseUrl:'',filePath:file('snapshots.json')});
 const ready=Promise.all([catalog.init(),signup.init(),draw.init(),games.init(),bracket.init(),snapshots.init()]);
 await ready;
 let event=await catalog.create({data:{name:'Copa 9 jogadores',capacity:9,startAt:null},actor:'owner'});
 event=await catalog.update({id:event.id,data:{status:'open'}});
 const players=Array.from({length:9},(_,i)=>({playerKey:`player-${i}`,name:`Participante ${i}`}));
 for(const p of players)await signup.change({action:'join',playerKey:p.playerKey,name:p.name,config:event});
 event=await catalog.update({id:event.id,data:{status:'closed'}});
 const initial=await draw.draw(event.id);
 assert.deepEqual(initial.map(t=>t.players.length),[5,4],'9 inscritos formam 5+4; ninguém desaparece');
 const locks=new Set(),rooms=new Map(),events=new Map(),errors=[];
 const sockets=new Map();let counter=0;
 const ctx={
  Number,String,Error,Set,Map,Promise,Date,crypto,console,
  ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',
  tournamentTableJoinLocks:locks,tournamentTestDeleteLocks:new Set(),tournamentRoundStartLocks:new Set(),
  ensureTournamentBracketReady:async()=>true,requireRoomPersistenceReady:async()=>{},
  tournamentDraw:draw,tournamentGames:games,tournamentBracket:bracket,tournamentCatalog:catalog,
  rooms,activePlayerRoomForKey:key=>[...rooms.values()].find(r=>r.status!=='finished'&&r.players.some(p=>p.playerKey===key))||null,
  TournamentSeatHandoff:{canAutoSwitchFrom},
  awaitTournamentTableJoinLock:async key=>{for(let n=0;n<200;n++){if(!locks.has(key)){locks.add(key);return;}await new Promise(r=>setTimeout(r,5));}throw Error('timeout lock');},
  roomSnapshotStore:snapshots,TournamentLobbyRecovery:Recovery,TournamentReservedLobby:ReservedLobby,TournamentTableHealth:TableHealth,
  snapshotsRestored:true,roomCode:()=>`C${String(++counter).padStart(5,'0')}`,
  enforceActionRate:()=>{},reserveRoomCreationSlot:()=>()=>{},Engine,
  tournamentWaitDeadline:async()=>Date.now()+5*60000,
  cleanPresenceName:x=>x,cleanAvatar:x=>x,ensureSocial:()=>{},
  prepareForRoomSwitch:async()=>{},restoreRoomSnapshot,runtimeReconnectGraceMs:()=>60000,
  scheduleRestoredPlayerGrace:()=>{},refreshOfflineRoomExpiry:()=>{},
  removeFromMatchmaking:()=>{},updatePresenceFromSocket:()=>{},
  StateDelivery:{invalidate:()=>{}},emitChatHistory:()=>{},emitRoom:()=>{},broadcastPresence:()=>{},
  TournamentSeatRecovery:SeatRecovery,resumeReservedPlayerSeat:async(socket,room,p)=>{
    const restored=Engine.reconnectPlayer(room,p.token,socket.id);
    socket.emit('joined',{source:'tournament-resume',code:room.code,playerId:restored.id});
  },
  joinSocketIntoRoom:async(socket,room)=>{
    const key=socket.data.auth.playerKey;
    assert(room.tournament.rosterKeys.includes(key));
    let p=room.players.find(p=>p.playerKey===key);
    if(p)p=Engine.reconnectPlayer(room,p.token,socket.id);
    else p=Engine.addPlayer(room,{socketId:socket.id,playerKey:key,name:socket.data.auth.name,token:crypto.randomUUID(),avatar:'macaco'});
    socket.data.roomCode=room.code;socket.data.playerId=p.id;
    await snapshots.saveNow(room);
    socket.emit('joined',{source:'tournament',code:room.code,playerId:p.id});
  },
  err:(socket,e)=>socket.emit('gameError',{message:e.message}),
 };
 function socketFor(p){
   if(sockets.has(p.playerKey))return sockets.get(p.playerKey);
   const messages=[];
   const sock={id:`socket-${p.playerKey}`,data:{auth:{playerKey:p.playerKey,name:p.name},role:null},
     on:(name,fn)=>events.set(`${p.playerKey}:${name}`,fn),
     emit:(name,body)=>messages.push({name,body}),join:()=>{}};
   vm.runInNewContext(src,{...ctx,socket:sock});
   const instance={socket:sock,messages,enter:async(stage,tableNumber,automatic=false)=>{
     const before=messages.length;
     await events.get(`${p.playerKey}:enterTournamentTable`)({tournamentId:event.id,stage,tableNumber,automatic});
     const response=messages.slice(before);
     assert(!response.some(m=>m.name==='gameError'||(m.name==='tournamentTableEntryResult'&&m.body?.ok===false)),
       `${p.playerKey} ${stage}: ${JSON.stringify(response)}`);
     assert(response.some(m=>m.name==='joined'),`${p.playerKey} não recebeu confirmação de entrada`);
     return response.find(m=>m.name==='joined').body.code;
   }};
   sockets.set(p.playerKey,instance);return instance;
 }
 // Fase 1: as 9 contas entram nas suas duas mesas oficiais.
 for(const t of initial){
   const assignments=(await draw.seatAssignments(event.id)).filter(p=>p.tableNumber===t.number);
   const rosters=await Promise.all(assignments.map(async a=>{
     const p=players.find(x=>x.playerKey===a.playerKey);
     return {p,code:await socketFor(p).enter('qualifier',t.number)};
   }));
   assert.equal(new Set(rosters.map(r=>r.code)).size,1,'todos os sorteados entram na mesma mesa');
   const room=rooms.get(rosters[0].code);
   assert.equal(room.players.length,t.players.length);
   assert.equal(room.status,'lobby','não iniciar pelo cronômetro');
   await games.markStarted(event.id,t.number,room.code);
   Engine.startRound(room);assert.equal(room.status,'playing','motor real iniciou a rodada');
   await snapshots.saveNow(room);
   // O resultado é sintético, mantendo todo o elenco e o vínculo originais.
   const seat=await draw.seatFor(event.id,t.number,assignments[0].playerKey);
   const result={matchId:`qualifier-${t.number}`,results:seat.players.map((p,i)=>({
     playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0
   }))};
   await recordTournamentResult({bracket,games,id:event.id,phase:'qualifier',number:t.number,roomCode:room.code,record:result,roster:seat.players});
   room.status='finished';await snapshots.saveNow(room);
 }
 await bracket.advance(event.id,initial);
 const phase=await bracket.summary(event.id,initial);
 assert.equal(phase.currentStage,'final','as duas classificatórias geram a final');
 const finals=(await bracket.rows(event.id)).filter(r=>r.stage==='final');
 assert.equal(finals.length,1);assert.equal(finals[0].players.length,4);
 const keys=finals[0].players.map(p=>p.playerKey);
 assert.equal(new Set(keys).size,4);
 // Quatro finalistas convocados automaticamente; o primeiro ingresso cria
 // o lobby e os outros três reencontram o MESMO vínculo pela identidade.
 assert.equal(finals[0].roomCode,null,'a fase está preparada mas não começou');
 const finalPlayers=keys.map(key=>players.find(p=>p.playerKey===key));
 // Uma convocação adiantada NÃO retira o classificado de partida que ainda
 // está ativa. No término confirmado, o mesmo sorteado pode entrar.
 const protectedPlayer=finalPlayers[0];
 const earlier=[...rooms.values()].find(r=>r.players.some(p=>p.playerKey===protectedPlayer.playerKey));
 assert(earlier,'classificado mantém referência à mesa da fase anterior');
 earlier.status='playing';
 const premature=socketFor(protectedPlayer),prematureCount=premature.messages.length;
 await events.get(`${protectedPlayer.playerKey}:enterTournamentTable`)({
   tournamentId:event.id,stage:'final',tableNumber:1,automatic:true
 });
 assert(premature.messages.slice(prematureCount).some(m=>m.name==='gameError'),
   'servidor recusa transferência automática de partida ainda ativa');
 earlier.status='finished';
 const finalCodes=await Promise.all(finalPlayers.map(p=>socketFor(p).enter('final',1,true)));
 assert.equal(new Set(finalCodes).size,1,'4 ingressos automáticos concorrentes resultam em 1 sala');
 let finalRoom=rooms.get(finalCodes[0]);
 assert.equal(finalRoom.players.length,4);assert.equal(finalRoom.status,'lobby');
 assert(finalRoom.players.every(p=>!p.isBot));
 assert.equal((await bracket.getBinding(event.id,'final',1)).roomCode,finalRoom.code);
 // Repetir o clique (F5) não duplica cadeiras ou salas.
 await socketFor(finalPlayers[0]).enter('final',1);
 assert.equal(finalRoom.players.length,4);
 assert.equal(rooms.size,3,'2 classificatórias encerradas + 1 final');
 // O vínculo não pode admitir jogadores quando o elenco da sala difere
 // das vagas sorteadas — proteção de integridade, sem alterar cartas.
 finalRoom.tournament.rosterKeys.push('conta-intrusa');
 const corruptBefore=socketFor(finalPlayers[0]).messages.length;
 await events.get(`${finalPlayers[0].playerKey}:enterTournamentTable`)({tournamentId:event.id,stage:'final',tableNumber:1,automatic:false});
 assert(socketFor(finalPlayers[0]).messages.slice(corruptBefore).some(m=>m.name==='tournamentTableEntryResult'&&!m.body.ok));
 finalRoom.tournament.rosterKeys.pop();
 // Um classificado indevido não passa pela validação da vaga.
 const eliminated=players.find(p=>!keys.includes(p.playerKey));
 const bad=[];const other=socketFor(eliminated),old=other.messages.length;
 await events.get(`${eliminated.playerKey}:enterTournamentTable`)({tournamentId:event.id,stage:'final',tableNumber:1,automatic:true});
 bad.push(...other.messages.slice(old));
 assert(bad.some(m=>m.name==='tournamentTableEntryResult'&&m.body.ok===false));
 // Reinício lógico: remover a sala da memória, manter o snapshot.
 const snapshotCode=finalRoom.code;rooms.delete(snapshotCode);
 const reconnection=await socketFor(finalPlayers[0]).enter('final',1);
 assert.equal(reconnection,snapshotCode,'o lobby original é recuperado pelo código antigo');
 finalRoom=rooms.get(snapshotCode);
 assert.equal(finalRoom.players.length,4,'recuperação não remove ou duplica elenco');
 // Após um reinício, todos os sockets antigos ficam offline; os outros
 // três finalistas precisam reivindicar manualmente suas vagas originais.
 for(const p of finalPlayers.slice(1))
   assert.equal(await socketFor(p).enter('final',1),snapshotCode);
 assert.equal(finalRoom.players.filter(p=>p.connected).length,4,'4 presentes após reconexão');
 // A sala de final continua com início MANUAL: não iniciou sozinha.
 assert.equal(finalRoom.status,'lobby');
 await bracket.markStarted(event.id,'final',1,finalRoom.code);
 Engine.startRound(finalRoom);
 assert.equal(finalRoom.status,'playing','início real do motor de jogo, após ato manual simulado');
 await snapshots.saveNow(finalRoom);
 const record={matchId:'final-cup9',results:finals[0].players.map((p,i)=>({
   playerKey:p.playerKey,name:p.name,score:i*6,position:i+1,won:i===0
 }))};
 await recordTournamentResult({bracket,games,id:event.id,phase:'final',number:1,roomCode:finalRoom.code,record,roster:finals[0].players});
 finalRoom.status='finished';
 await snapshots.saveNow(finalRoom);
 const complete=await bracket.advance(event.id,initial);
 assert(complete.champion,'campeão confirmado após resultado final');
 assert.equal(complete.champion.names.length,1);
 console.log('✓ V40.69.8.38: 9 inscritos = 5+4, 2 classificatórias, 4 classificados, 1 final, 4 entradas AUTOMÁTICAS concorrentes, fallback manual, não classificados negados, recuperação, início manual e campeão simulado.');
 await snapshots.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));

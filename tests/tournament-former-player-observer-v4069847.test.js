'use strict';
// Reproduz a desistência real do motor, a consulta de mesa do painel e o
// ingresso por handlers Socket.IO isolados. WebRTC físico requer navegador.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const Engine=require('../game-engine');
const Forfeit=require('../tournament-forfeit');
const {buildMatchRecord}=require('../ranking-store');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function extract(start,end){
  const a=server.indexOf(start),b=server.indexOf(end,a+start.length);
  assert(a>=0&&b>a,`Trecho ausente: ${start}`);
  return server.slice(a,b);
}
function createTournamentRoom(){
  const room=Engine.createRoom('ABCD23',{name:'Alice',avatar:'macaco',playerKey:'alice',token:'alice-token',socketId:'player-1'});
  for(const key of ['bob','carla','davi'])Engine.addPlayer(room,{name:key,avatar:'macaco',playerKey:key,token:key+'-token',socketId:'player-'+key});
  room.tournament={id:'cup-123',phase:'qualifier',tableNumber:1,rosterKeys:room.players.map(p=>p.playerKey),forfeits:[]};
  Engine.startRound(room);
  return room;
}
async function testPanel(room,playerKey='alice',stage='qualifier',claimed=true){
  const selection=extract('    // V40.69.8.47 —', '    res.json({ok:true,serverNow:Date.now()');
  const config={id:room.tournament.id},rooms=new Map([[room.code,room]]);
  const draw={seatFor:async(id,table,key)=>claimed&&id===config.id&&table===1&&key===playerKey};
  const bracket={seatFor:async(id,phase,table,key)=>claimed&&id===config.id&&phase===stage&&table===1&&key===playerKey,
    getBinding:async()=>({roomCode:room.code})};
  const games={get:async()=>({roomCode:room.code})};
  const sandbox={session:{playerKey},displayTables:[{number:1}],currentStage:stage,tournamentDraw:draw,tournamentBracket:bracket,
    tournamentGames:games,rooms,config,forfeitedTablesForViewer:new Set()};
  // Executar o trecho REAL da consulta que reconhece o forfeit no vínculo
  // autenticado da mesa, antes de executar a seleção do botão.
  const collect=extract('      const room=binding?.roomCode?rooms.get(binding.roomCode):null;\n      if(session?.playerKey',
    '      const storedSnapshot=');
  vm.runInNewContext(`(function(){const binding={roomCode:${JSON.stringify(room.code)}};const t={number:1};${collect}})()`,sandbox);
  return vm.runInNewContext(`(async()=>{${selection}\nreturn {myTable,forfeitedTable};})()`,sandbox);
}
async function testWatcher(room){
  const code=extract('  async function joinSpectatorSocket(', '  // Entrada de observadores: pedidos em ordem de chegada, somente em mesas comuns.');
  const errors=[],listeners=new Map(),sent=[];
  const socket={id:'new-socket-alice',data:{auth:{playerKey:'alice',name:'Alice'},roomCode:null,playerId:null,spectatorId:null,role:null},
    on(k,fn){listeners.set(k,fn)},emit(k,v){sent.push({k,v})},join(){}};
  const sandbox={socket,crypto,rooms:new Map([[room.code,room]]),
    InputSafety:{cleanRoomCode:x=>String(x||'').trim().toUpperCase(),cleanOpaqueId:x=>String(x||'').slice(0,160)},
    ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',
    ensureSocial:r=>{r.spectators??=[];r.chat??=[]},ensureSpectators:r=>r.spectators,
    reserveSpectatorJoinSlot:()=>()=>{},enforceActionRate:()=>{},roomSwitchConfirmationState:()=>({required:false}),
    playerHasActiveRoom:()=>false,prepareForRoomSwitch:async()=>{},
    cancelDisconnectDebounce:()=>{},cancelSpectatorReconnectTimer:()=>{},retireReplacedSocket:()=>{},
    cleanPresenceName:s=>s||'Alice',cleanAvatar:s=>s||'macaco',
    SpectatorSeatAdmission:{claimRestoredSeatRequest:()=>{throw Error('Torneio não permite assumir cadeira');}},
    removeFromMatchmaking:()=>{},updatePresenceFromSocket:()=>{},StateDelivery:{invalidate(){}},
    emitChatHistory:()=>{throw Error('Não abrir histórico de chat privado do torneio');},
    appendSystemChat:()=>{},emitRoom:()=>{},broadcastPresence:()=>{},err:(_s,error)=>errors.push(error.message),
    ensureTournamentBracketReady:async()=>true,tournamentCatalog:{get:async()=>({status:'closed'})},
    tournamentDraw:{get:async()=>[{number:1}]},
    tournamentBracket:{summary:async()=>({currentStage:'qualifier',champion:null}),getBinding:async()=>({roomCode:room.code})},
    tournamentGames:{get:async()=>({roomCode:room.code})},setTimeout:()=>{},console};
  vm.runInNewContext(code,sandbox);
  // O acesso por código comum continua proibido em torneios.
  await listeners.get('joinSpectator')({code:room.code});
  assert(errors.some(x=>x.includes('painel do torneio')));
  errors.length=0;
  const params={tournamentId:'cup-123',stage:'qualifier',tableNumber:1};
  await listeners.get('watchTournamentTable')(params);
  assert.equal(errors.length,0,errors.join(';'));
  assert.equal(room.spectators.length,1);
  assert.equal(room.spectators[0].playerKey,'alice');
  const joined=sent.filter(x=>x.k==='joined').at(-1).v;
  assert.equal(joined.role,'SPECTATOR');assert.equal(joined.tournamentWatch,true);
  assert.equal(socket.data.playerId,null);assert.equal(socket.data.role,'SPECTATOR');
  assert.equal(room.players.some(p=>p.playerKey==='alice'),false);
  // F5: a mesma conta recupera a sessão e não cria um segundo observador.
  await listeners.get('watchTournamentTable')({...params,token:joined.token});
  assert.equal(room.spectators.length,1);
  assert.equal(errors.length,0,errors.join(';'));
  // Um participante que ainda possui cadeira NÃO pode usar o modo observador.
  const oldUser=socket.data.auth.playerKey;
  socket.data.auth.playerKey='bob';
  await listeners.get('watchTournamentTable')(params);
  assert(errors.some(x=>x.includes('vaga de jogador')));
  socket.data.auth.playerKey=oldUser;errors.length=0;
  // Mesa encerrada ou fase antiga são indisponíveis.
  room.status='finished';
  await listeners.get('watchTournamentTable')(params);
  assert(errors.some(x=>x.includes('encerra')||x.includes('terminou')));
  room.status='playing';errors.length=0;
  await listeners.get('watchTournamentTable')({...params,stage:'final'});
  assert(errors.length>0);
  return joined;
}
(async()=>{
  const room=createTournamentRoom();
  const before=await testPanel(room);
  assert.equal(before.myTable,1,'antes da saída, é jogador');
  assert.equal(before.forfeitedTable,null);
  // Desistência real: preserva o roster, retira a cadeira e registra a desclassificação.
  const alice=room.players.find(p=>p.playerKey==='alice');
  Forfeit.forfeitActiveSeat(room,alice);
  assert.equal(room.players.length,3);
  assert.equal(room.status,'playing');
  assert(room.tournament.rosterKeys.includes('alice'));
  assert(room.tournament.forfeits.some(x=>x.playerKey==='alice'));
  assert.equal(room.players.some(x=>x.playerKey==='alice'),false);
  const after=await testPanel(room);
  assert.equal(after.myTable,null,'desistente nunca deve receber botão para voltar como jogador');
  assert.equal(after.forfeitedTable,1,'mesa anterior identificada para observar');
  const other=await testPanel(room,'bob');assert.equal(other.myTable,1);assert.equal(other.forfeitedTable,null);
  const outsider=await testPanel(room,'outsider','qualifier',false);
  assert.equal(outsider.myTable,null);assert.equal(outsider.forfeitedTable,null);
  room.tournament.phase='semi';
  const semi=await testPanel(room,'alice','semi');assert.equal(semi.forfeitedTable,1,'funciona em fases posteriores');
  room.tournament.phase='qualifier';
  const originalRoster=room.tournament.rosterKeys.slice();
  await testWatcher(room);
  assert.deepEqual(room.tournament.rosterKeys,originalRoster,'sorteio histórico não deve mudar');
  assert.equal(room.tournament.forfeits.length,1);
  // Resultado oficial exclui desistente de vitória/classificação, mesmo sendo observador.
  const record=Forfeit.tournamentMatchRecord(room,buildMatchRecord(room));
  assert.equal(record.results.find(x=>x.playerKey==='alice').forfeited,true);
  assert.equal(record.results.find(x=>x.playerKey==='alice').won,false);
  assert(ui.includes('forfeitedTable=result.forfeitedTable??null'));
  assert(ui.includes('if(t.number===forfeitedTable)'));
  assert(ui.includes('socket.emit(\'watchTournamentTable\''));
  assert(html.includes('tournament-ui.js?v=')&&html.includes('v4069847'));
  assert.match(server,/const RELEASE_VERSION = 'V40\.69\.8\.47'/);
  assert(server.includes("if(room.tournament?.forfeits?.some(p=>p.playerKey===key))throw new Error('Você já desistiu desta mesa e não pode retornar como jogador.')"));
  assert(server.includes("throw new Error('Modo Observador: esta ação é exclusiva dos jogadores da mesa.')"));
  console.log('✓ V40.69.8.47: desistência real, painel, observação autenticada, F5, sem nova vaga ou classificação.');
})().catch(e=>{console.error(e);process.exitCode=1});

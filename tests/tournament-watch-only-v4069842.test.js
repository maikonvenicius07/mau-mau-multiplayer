'use strict';
// V40.69.8.4.2 — integração isolada dos handlers com dependências simuladas.
// A homologação WebSocket/Render e a navegação móvel continuam necessárias.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const Engine=require('../game-engine');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'server.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const camera=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
const getSegment=(start,end)=>{
  const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
  assert(a>=0&&b>a,`Bloco ${start} não encontrado`);return src.slice(a,b);
};
const listeners=new Map(),errors=[],sent=[],events=[];
const room={code:'ABC123',round:2,status:'playing',players:[],spectators:[],tournament:{id:'tor-123',phase:'semi',tableNumber:2,rosterKeys:['alice','bob']}};
const rooms=new Map([[room.code,room]]);
const socket={id:'sock-watch',data:{auth:{playerKey:'viewer',name:'Visita'},roomCode:null,playerId:null,spectatorId:null,role:null},
  on(k,fn){listeners.set(k,fn)},emit(k,v){sent.push({k,v})},join(code){events.push(`join:${code}`)}};
let requestsClaimed=0, histories=0;
let slots=0;
const sandbox={socket,crypto,rooms,InputSafety:{cleanRoomCode:v=>String(v||'').trim().toUpperCase(),cleanOpaqueId:v=>String(v||'').slice(0,160)},
  ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',
  ensureSocial:r=>{r.spectators??=[];r.chat??=[]},
  ensureSpectators:r=>r.spectators,
  reserveSpectatorJoinSlot:r=>{if(r.spectators.length+slots>=5)throw Error('Limite de observadores');slots++;return()=>slots--},
  enforceActionRate:()=>{},roomSwitchConfirmationState:()=>({required:false}),
  playerHasActiveRoom:()=>false,prepareForRoomSwitch:async()=>{},
  cancelDisconnectDebounce:()=>{},cancelSpectatorReconnectTimer:()=>{},
  retireReplacedSocket:()=>{},cleanPresenceName:s=>String(s||'Visita'),cleanAvatar:s=>s||'macaco',
  SpectatorSeatAdmission:{claimRestoredSeatRequest(){requestsClaimed++}},
  removeFromMatchmaking:()=>{},updatePresenceFromSocket:()=>{},
  StateDelivery:{invalidate(){}},emitChatHistory(){histories++},appendSystemChat:()=>{},
  emitRoom:()=>{},broadcastPresence:()=>{},err:(_sock,error)=>errors.push(error.message),
  tournamentBracketReady:Promise.resolve(true),
  tournamentCatalog:{get:async()=>({id:'tor-123',status:'closed'})},
  tournamentDraw:{get:async()=>[{number:2}]},
  tournamentBracket:{summary:async()=>({currentStage:'semi',champion:null}),getBinding:async()=>({roomCode:'ABC123'})},
  tournamentGames:{get:async()=>({roomCode:'ABC123'})},
  setTimeout:()=>{},console};
vm.runInNewContext(getSegment('  async function joinSpectatorSocket(',"  // Entrada de observadores: pedidos em ordem de chegada, somente em mesas comuns."),sandbox);
async function run(){
  // No normal join-by-code privilege escalation into a tournament.
  await listeners.get('joinSpectator')({code:'ABC123'});
  assert(errors.some(x=>x.includes('painel do torneio')));
  assert.equal(room.spectators.length,0);
  errors.length=0;
  // The board's ID + stage + table must resolve to a live tournament room.
  await listeners.get('watchTournamentTable')({tournamentId:'tor-123',stage:'semi',tableNumber:2});
  assert.equal(errors.length,0,errors.join('; '));
  assert.equal(room.spectators.length,1);
  const joined=sent.filter(x=>x.k==='joined').at(-1)?.v;
  assert.equal(joined?.role,'SPECTATOR');assert.equal(joined?.tournamentWatch,true);
  assert.equal(joined?.tournamentId,'tor-123');assert.equal(joined?.stage,'semi');
  assert.equal(histories,0,'Torneio não envia histórico do chat');
  assert.equal(requestsClaimed,0,'Torneio não recupera pedidos de cadeira');
  assert.equal(socket.data.playerId,null,'Observador não recebe uma cadeira de jogador');
  assert.equal(slots,0,'Reservation released');
  // F5/reconnect with the same authenticated account may reattach, without adding a seat.
  const old=room.spectators[0];
  socket.data.spectatorId=null;
  await listeners.get('watchTournamentTable')({tournamentId:'tor-123',stage:'semi',tableNumber:2,token:old.token});
  assert.equal(room.spectators.length,1);
  // Unauthenticated table/phase attempts must not reveal codes or grant room admission.
  for(const bad of [
    {tournamentId:'tor-123',stage:'final',tableNumber:2},
    {tournamentId:'tor-123',stage:'semi',tableNumber:3},
    {tournamentId:'not-valid',stage:'semi',tableNumber:2},
    {tournamentId:'tor-123',stage:'semi',tableNumber:2.5},
  ]){
    const before=sent.filter(x=>x.k==='joined').length;
    await listeners.get('watchTournamentTable')(bad);
    assert.equal(sent.filter(x=>x.k==='joined').length,before,'Mesa inválida não deve liberar observação');
  }
  // Security contract, server side rather than UI-only:
  for(const expected of [
    "if(room.tournament)throw new Error('Não é possível entrar em torneios como observador.')",
    'if(room.tournament)return null; // Torneio: assistir sem voz',
    "if(room.tournament&&actor.role===ROLE_SPECTATOR)return answer({ok:false",
    'if(room.tournament&&actor.role===ROLE_SPECTATOR)',
    "emitRoomSocial(room,'voiceMessage'",
    "emitRoomSocial(room,'chatMessage'",
    "emitRoomSocial(room,'soundEffect'",
    'spectatorState.roundReview=null',
  ])assert(src.includes(expected),`Restrição ausente: ${expected}`);
  assert(ui.includes("socket.emit('watchTournamentTable'"));
  assert(ui.includes("game?.liveStatus==='playing'"));
  assert(app.includes("sess.role==='SPECTATOR'&&sess.tournamentWatch"));
  assert(app.includes('if(isTournamentWatcher())return;'));
  assert(css.includes('#game.tournament-watch #liveMicBtn'));
  assert(camera.includes('tournamentWatchMode=!!tournamentWatch'));
  const sample=Engine.createRoom('TEST',{socketId:'player',token:'tok',name:'Alice',avatar:'macaco',playerKey:'alice'});
  sample.round=1;sample.status='playing';
  const publicState=Engine.roomSpectatorState(sample,{id:'observer',name:'Observer',avatar:'macaco'});
  assert.equal(publicState.viewerRole,'SPECTATOR');
  assert.deepEqual(publicState.me.hand,[]);
  assert(!('deck' in publicState),'O deck não pode sair do servidor');
  console.log('✓ V40.69.8.4.2: torneio somente assistir, autorização por mesa, reconexão e isolamento de mídia/chat.');
}
run().catch(e=>{console.error(e);process.exitCode=1});

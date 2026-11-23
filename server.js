'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const SpectatorSeatAdmission = require('./spectator-seat-admission');
const express = require('express');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');
const Engine = require('./game-engine');
const BotPlayer = require('./bot-player');
const BotDifficulty = require('./bot-difficulty');
const AvatarWire = require('./avatar-wire');
const StateDelivery = require('./state-delivery');
const {createRuntimeConnectionMonitor}=require('./runtime-connection-monitor');
const LobbySnapshotDelivery = require('./lobby-snapshot-delivery');
const MatchmakingDelivery = require('./matchmaking-delivery');
const StaticAssetVersioning = require('./static-asset-versioning');
const {createAppDatabasePool} = require('./database-pool');
const RoomLifecycle = require('./room-lifecycle');
const TournamentForfeit = require('./tournament-forfeit');
const TournamentSeatRecovery = require('./tournament-seat-recovery');
const TournamentWait = require('./tournament-wait');
const TournamentRoomRetention = require('./tournament-room-retention');
const InputSafety = require('./input-safety');
const { RoomSnapshotStore, restoreRoomSnapshot } = require('./room-snapshot-store');
const TournamentLobbyRecovery = require('./tournament-lobby-recovery');
const TournamentTableHealth = require('./tournament-table-health');
const {assertTournamentTable,MAX_TOURNAMENT_PLAYERS}=require('./tournament-table-capacity');
const ReplaySession = require('./replay-session');
const RankingFinalization = require('./ranking-finalization');
const { RankingStore, buildMatchRecord, normalizePeriod, normalizeMode, CURRENT_SEASON_ID, CURRENT_SEASON_NAME } = require('./ranking-store');
const {performanceSettings}=require('./ranking-performance');
const {skillSettings}=require('./ranking-skill');
const { createRetryableInitialization } = require('./ranking-init-retry');
const { evaluateReadiness, databaseRequired, probeIdentityReadiness } = require('./service-readiness');
const RetentionPolicy = require('./retention-policy');
const RoomGovernance = require('./room-governance');
const AbuseGuard = require('./abuse-guard');
const { AuthIdentityStore, normalizeEmail, normalizeSessionVersion } = require('./auth-identity-store');
const UniversalAuth = require('./universal-auth');
const EmailDelivery = require('./email-delivery');
const { TournamentStore, tournamentConfig } = require('./tournament-store');
const { TournamentCatalog } = require('./tournament-catalog');
const { TournamentDraw } = require('./tournament-draw');
const { TournamentGames } = require('./tournament-games');
const { TournamentBracket, nextStage } = require('./tournament-bracket');
const TournamentQualifiedWait = require('./tournament-qualified-wait');
const TournamentObserverHandoff = require('./tournament-observer-handoff');
const { recordTournamentResult } = require('./tournament-result-commit');
const {TournamentPodiumArchive}=require('./tournament-podium-archive');

const app = express();
const server = http.createServer(app);
const APP_VERSION = require('./package.json').version;
// Identificação funcional; a versão legada do package.json permanece por contrato de regressão.
const RELEASE_VERSION = 'V40.69.8.55';
const RULES_VERSION = APP_VERSION;
const UI_VERSION = '49.11';
// Câmera ao vivo opcional: somente mídia efêmera no LiveKit. Nenhum vídeo/áudio é gravado no servidor.
const LIVEKIT_URL=String(process.env.LIVEKIT_URL||'').trim();
const LIVEKIT_API_KEY=String(process.env.LIVEKIT_API_KEY||'').trim();
const LIVEKIT_API_SECRET=String(process.env.LIVEKIT_API_SECRET||'').trim();
const CAMERA_ENABLED=(()=>{
  try{const u=new URL(LIVEKIT_URL);return u.protocol==='wss:' && !!u.hostname && !!LIVEKIT_API_KEY && LIVEKIT_API_SECRET.length>=16;}catch{return false;}
})();
const cameraPublishers=new Map(); // sala -> Map(socket.id -> participantId); NÃO persistido.
function cameraPresenceFor(code){return [...new Set([...(cameraPublishers.get(code)?.values()||[])])];}
function sendCameraPresence(roomCode,target=null){
  const payload={code:roomCode,playerIds:cameraPresenceFor(roomCode)};
  if(target)target.emit('cameraPresence',payload);else io.to(roomCode).emit('cameraPresence',payload);
}
function forgetCameraSocket(socket){
  for(const [code,active] of cameraPublishers){
    if(active.delete(socket.id)){
      if(active.size===0)cameraPublishers.delete(code);
      sendCameraPresence(code);
    }
  }
  socket.data.cameraTokenAt=0;
}
function cameraTokenJWT({room,identity,allowPublish}){
  const now=Math.floor(Date.now()/1000);
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const video={room,roomJoin:true,canSubscribe:true,canPublish:allowPublish,canPublishData:false};
  if(allowPublish)video.canPublishSources=['camera'];
  const header=encode({alg:'HS256',typ:'JWT'});
  const body=encode({iss:LIVEKIT_API_KEY,sub:identity,iat:now,nbf:now-5,exp:now+600,jti:crypto.randomUUID(),video});
  const content=`${header}.${body}`;
  const signature=crypto.createHmac('sha256',LIVEKIT_API_SECRET).update(content).digest('base64url');
  return `${content}.${signature}`;
}

const SERVICE_STARTED_AT = Date.now();
const MONITOR_HTTP_LOGS = String(process.env.MAUMAU_HTTP_LOGS || '') === '1';
const ALLOWED_CROSS_ORIGINS = String(process.env.MAUMAU_ALLOWED_ORIGINS || '')
  .split(',')
  .map(value=>value.trim())
  .filter(Boolean)
  .map(value=>{try{return new URL(value).origin}catch{return ''}})
  .filter(Boolean);
const ALLOWED_CROSS_ORIGIN_SET = new Set(ALLOWED_CROSS_ORIGINS);
const runtimeConnectionMonitor=createRuntimeConnectionMonitor({sampleEnabled:process.env.MAUMAU_RUNTIME_MONITOR==='1'});
runtimeConnectionMonitor.start();
const monitor = {
  httpRequests:0,
  http5xx:0,
  rejectedHttpOrigins:0,
  socketConnections:0,
  socketDisconnects:0,
  rejectedSocketOrigins:0,
};
function safeRequestHost(req){
  return String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim().toLowerCase();
}
function normalizedOrigin(value){
  try{
    const url=new URL(String(value||''));
    if(!/^https?:$/.test(url.protocol))return '';
    return url.origin;
  }catch{return ''}
}
function requestOriginAllowed(req){
  const rawOrigin=String(req?.headers?.origin || '').trim();
  if(!rawOrigin)return true; // clientes não-browser / mesma política sem Origin
  const origin=normalizedOrigin(rawOrigin);
  if(!origin)return false;
  if(ALLOWED_CROSS_ORIGIN_SET.has(origin))return true;
  try{return new URL(origin).host.toLowerCase()===safeRequestHost(req)}catch{return false}
}
function logMonitor(level,scope,message,details={}){
  const safeDetails={};
  for(const key of ['requestId','method','path','status','durationMs','reason','origin','host']){
    const value=details?.[key];
    if(value!==undefined&&value!==null&&value!=='')safeDetails[key]=String(value).slice(0,240);
  }
  const line={ts:new Date().toISOString(),scope,message,...safeDetails};
  const fn=level==='error'?console.error:level==='warn'?console.warn:console.log;
  fn(JSON.stringify(line));
}
const io = new Server(server, {
  // V40.58 — o navegador normal usa a mesma origem do jogo. Origens externas só
  // recebem CORS quando estiverem explicitamente listadas em MAUMAU_ALLOWED_ORIGINS.
  cors: {
    origin: ALLOWED_CROSS_ORIGINS.length ? ALLOWED_CROSS_ORIGINS : false,
    credentials: true,
    methods: ['GET','POST'],
  },
  // CORS é uma proteção do navegador; allowRequest também bloqueia o handshake
  // no próprio servidor, inclusive clientes que tentem contornar o navegador.
  allowRequest: (req, callback) => {
    const allowed=requestOriginAllowed(req);
    if(!allowed){
      monitor.rejectedSocketOrigins++;
      logMonitor('warn','security','socket-origin-rejected',{origin:req?.headers?.origin,host:safeRequestHost(req)});
    }
    callback(null,allowed);
  },
  maxHttpBufferSize: 400000,
  // V40.55 — Socket.IO mantém por até 60 s o contexto de uma conexão interrompida
  // e pode entregar pacotes perdidos após uma microqueda. Nossa reconexão de cadeira
  // continua sendo a segunda camada de proteção para quedas maiores.
  connectionStateRecovery: {
    maxDisconnectionDuration: RetentionPolicy.RECONNECT_GRACE_MS,
    skipMiddlewares: false,
  },
  // V40.49 — tolerância maior a pequenas oscilações de rede móvel sem deixar
  // uma conexão realmente perdida presa por tempo excessivo.
  pingInterval: 20000,
  pingTimeout: 30000,
  connectTimeout: 20000,
});
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const criticalSnapshotSignatures = new Map();
const MAX_ROOMS = RoomGovernance.maxRooms(process.env);
const MAX_SPECTATORS_PER_ROOM = AbuseGuard.maxSpectatorsPerRoom(process.env);
let pendingRoomCreations = 0;
const pendingSpectatorJoins = new Map();
const abuseLimiter = new AbuseGuard.ActionRateLimiter();
const ROOM_AUDIT_INTERVAL_MS = 60 * 1000;
const ROLE_PLAYER = 'PLAYER';
const ROLE_SPECTATOR = 'SPECTATOR';
// V39.1 — timers de tolerância de reconexão ficam somente na memória do servidor.
const reconnectTimers = new Map();
// Operações de saída concorrentes da mesma cadeira não devem produzir desistência duplicada.
const tournamentExitInProgress = new Set();
const spectatorReconnectTimers = new Map();
// V40.68.1 — se uma partida ativa ficar sem NENHUM humano conectado,
// a sala aguarda no máximo 5 minutos. Robôs/AUTO não jogam sozinhos.
// Saída temporária preserva a reserva sujeita aos prazos; abandono explícito/troca de sala seguem as regras existentes.
const offlineRoomExpiryTimers = new Map();
const ALL_HUMANS_OFFLINE_EXPIRY_MS = RetentionPolicy.ALL_HUMANS_OFFLINE_EXPIRY_MS;
// V40.49 — microquedas de Wi‑Fi/4G de poucos segundos não congelam a mesa.
// Se o mesmo jogador voltar rapidamente, o novo socket substitui o antigo antes
// de a cadeira ser marcada como desconectada.
const disconnectDebounceTimers = new Map();
const DISCONNECT_DEBOUNCE_MS = 3000;
const RECONNECT_GRACE_MS = RetentionPolicy.RECONNECT_GRACE_MS;
// PRE-APK — confirmação explícita antes de trocar uma conta que ainda possui
// uma cadeira humana em outra sala. O token vive somente no socket e expira rápido.
const ROOM_SWITCH_CONFIRM_TTL_MS = 60 * 1000;
// V40.63 — os valores oficiais acima continuam imutáveis em produção.
// A suíte de integração pode acelerar apenas o relógio interno quando NODE_ENV=test,
// permitindo testar Socket.IO real (queda -> AUTO -> retorno) sem esperar 60 s.
function runtimeDisconnectDebounceMs(){
  if(String(process.env.NODE_ENV||'')!=='test')return DISCONNECT_DEBOUNCE_MS;
  const requested=Number(process.env.MAUMAU_TEST_DISCONNECT_DEBOUNCE_MS||0);
  return requested>0?Math.max(10,Math.min(DISCONNECT_DEBOUNCE_MS,requested)):DISCONNECT_DEBOUNCE_MS;
}
function runtimeReconnectGraceMs(){
  if(String(process.env.NODE_ENV||'')!=='test')return RECONNECT_GRACE_MS;
  const requested=Number(process.env.MAUMAU_TEST_RECONNECT_GRACE_MS||0);
  return requested>0?Math.max(80,Math.min(RECONNECT_GRACE_MS,requested)):RECONNECT_GRACE_MS;
}
const CONNECTION_DEBUG = String(process.env.MAUMAU_CONNECTION_DEBUG || '') === '1';
function connectionDebug(...args){ if(CONNECTION_DEBUG) console.log('[connection]', ...args); }
function disconnectDebounceKey(role,roomCode,participantId){return `${role}:${roomCode}:${participantId}`;}
function cancelDisconnectDebounce(role,roomCode,participantId){
  const key=disconnectDebounceKey(role,roomCode,participantId),timer=disconnectDebounceTimers.get(key);
  if(timer)clearTimeout(timer);disconnectDebounceTimers.delete(key);
}
function scheduleDisconnectDebounce(role,roomCode,participantId,fn){
  cancelDisconnectDebounce(role,roomCode,participantId);
  const key=disconnectDebounceKey(role,roomCode,participantId);
  const timer=setTimeout(async ()=>{disconnectDebounceTimers.delete(key);fn();},runtimeDisconnectDebounceMs());
  timer.unref?.();disconnectDebounceTimers.set(key,timer);
}
function clearDisconnectDebouncesForRoom(roomCode){
  const playerPrefix=`${ROLE_PLAYER}:${roomCode}:`;
  const spectatorPrefix=`${ROLE_SPECTATOR}:${roomCode}:`;
  for(const [key,timer] of disconnectDebounceTimers){
    if(key.startsWith(playerPrefix)||key.startsWith(spectatorPrefix)){clearTimeout(timer);disconnectDebounceTimers.delete(key);}
  }
}

// V40.1 — presença online e convites são efêmeros e vivem somente na memória.
// A identidade é a playerKey autenticada (Google, Apple ou e-mail), nunca o socketId.
const onlinePresence = new Map();
const invitations = new Map();
const inviteTimers = new Map();
const INVITE_TTL_MS = 30 * 1000;
const INVITE_RESERVATION_MS = 20 * 60 * 1000;

// V40.2 — fila simples de matchmaking automático.
// A fila é efêmera: se o servidor reiniciar, os jogadores apenas clicam em Buscar novamente.
const matchmakingQueue = new Map();
let matchmakingTimer = null;
let matchmakingDeadlineAt = null;
const MATCHMAKING_WAIT_MS = 15 * 1000;
const MATCHMAKING_MAX_PLAYERS = 5;

// V40.68 — limite preventivo de salas. Partidas existentes nunca são derrubadas
// por capacidade; o limite bloqueia somente a criação de uma NOVA sala.
function reclaimableRoomCodesForSwitch(playerKeys=[], exceptCode=null) {
  const keys=new Set((playerKeys||[]).map(x=>String(x||'')).filter(Boolean));
  const reclaimable=new Set();
  if(!keys.size)return reclaimable;
  for(const room of rooms.values()){
    if(!room||room.code===exceptCode)continue;
    const humans=(room.players||[]).filter(p=>!p.isBot);
    if(humans.length && humans.every(p=>p.playerKey&&keys.has(String(p.playerKey)))) reclaimable.add(room.code);
  }
  return reclaimable;
}
function reserveRoomCreationSlot(playerKeys=[]) {
  const reclaimable=reclaimableRoomCodesForSwitch(playerKeys);
  if(RoomGovernance.atCapacity(rooms.size,MAX_ROOMS,pendingRoomCreations,reclaimable.size)){
    throw new Error(`Servidor com muitas partidas no momento (${rooms.size}/${MAX_ROOMS} salas). Tente novamente em alguns minutos.`);
  }
  pendingRoomCreations++;
  let released=false;
  return ()=>{if(!released){released=true;pendingRoomCreations=Math.max(0,pendingRoomCreations-1);}};
}
function roomDiagnostics(){return RoomGovernance.summarizeRooms(rooms.values(),MAX_ROOMS,pendingRoomCreations);}
function abuseSubject(socket){return String(socket?.data?.auth?.playerKey||socket?.handshake?.address||socket?.id||'anonymous').slice(0,160);}
function enforceActionRate(socket,action,message='Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente novamente.') {
  const result=abuseLimiter.consume(abuseSubject(socket),action);
  if(!result.allowed){
    const seconds=Math.max(1,Math.ceil(result.retryAfterMs/1000));
    throw new Error(`${message} Tente novamente em ${seconds}s.`);
  }
  return result;
}
const abusePruneTimer=setInterval(()=>abuseLimiter.prune(),5*60*1000);
abusePruneTimer.unref?.();
// Fase 6A: autenticação, ranking, snapshots e torneios usam o mesmo pool por processo.
const appDatabasePool=createAppDatabasePool(process.env.DATABASE_URL);
const rankingStore = new RankingStore({pool:appDatabasePool});
// V51.1 — inscrições independentes do ranking e do motor do jogo.
const tournamentStore = new TournamentStore({pool:appDatabasePool});
// Inicialização recuperável: Render/PostgreSQL pode estar indisponível no primeiro acesso.
// Cada módulo inicializa uma única vez com êxito e pode tentar novamente após uma falha transitória.
const {ensureReady:ensureTournamentReady}=createRetryableInitialization({
  initialize:()=>tournamentStore.init(),
  cooldownMs:5000,
  onFailure:e=>console.error('[tournament] inscrições indisponíveis; nova tentativa em 5s:',e),
});
const tournamentCatalog = new TournamentCatalog({pool:tournamentStore.pool||null,databaseUrl:''});
const {ensureReady:ensureTournamentCatalogReady}=createRetryableInitialization({
  initialize:async()=>{if(!await ensureTournamentReady())throw new Error('Inscrições indisponíveis.');await tournamentCatalog.init();},
  cooldownMs:5000,
  onFailure:e=>console.error('[tournament] catálogo indisponível; nova tentativa em 5s:',e),
});
const tournamentDraw = new TournamentDraw({pool:tournamentStore.pool||null,databaseUrl:''});
const {ensureReady:ensureTournamentDrawReady}=createRetryableInitialization({
  initialize:async()=>{if(!await ensureTournamentCatalogReady())throw new Error('Catálogo indisponível.');await tournamentDraw.init();},
  cooldownMs:5000,
  onFailure:e=>console.error('[tournament] sorteios indisponíveis; nova tentativa em 5s:',e),
});
const tournamentGames = new TournamentGames({pool:tournamentStore.pool||null,databaseUrl:''});
const {ensureReady:ensureTournamentGamesReady}=createRetryableInitialization({
  initialize:async()=>{if(!await ensureTournamentDrawReady())throw new Error('Sorteios indisponíveis.');await tournamentGames.init();},
  cooldownMs:5000,
  onFailure:e=>console.error('[tournament] jogos indisponíveis; nova tentativa em 5s:',e),
});
const tournamentBracket=new TournamentBracket({pool:tournamentStore.pool||null,databaseUrl:'',draw:tournamentDraw});
const {ensureReady:ensureTournamentBracketReady}=createRetryableInitialization({
  initialize:async()=>{if(!await ensureTournamentGamesReady())throw new Error('Jogos indisponíveis.');await tournamentBracket.init();},
  cooldownMs:5000,
  onFailure:e=>console.error('[tournament] fases indisponíveis; nova tentativa em 5s:',e),
});
const tournamentPodiumArchive=new TournamentPodiumArchive({pool:tournamentStore.pool||null,databaseUrl:''});
const {ensureReady:ensureTournamentPodiumReady}=createRetryableInitialization({
  initialize:async()=>{if(!await ensureTournamentBracketReady())throw new Error('Fases indisponíveis.');await tournamentPodiumArchive.init();},
  cooldownMs:5000,
  onFailure:e=>console.error('[tournament] arquivo de podios indisponivel:',e),
});
void ensureTournamentPodiumReady();
const tournamentTableJoinLocks=new Set();
async function awaitTournamentTableJoinLock(key,{timeoutMs=30000}={}){
  const until=Date.now()+timeoutMs;
  // Aquisição atômica sem await entre verificar e reservar: duas entradas
  // simultâneas nunca podem ambas assumir a primeira criação da mesa.
  for(;;){
    if(!tournamentTableJoinLocks.has(key)){
      tournamentTableJoinLocks.add(key);
      return;
    }
    if(Date.now()>=until)throw new Error('A mesa está sendo preparada. Aguarde e tente novamente.');
    await new Promise(resolve=>setTimeout(resolve,60));
  }
}
const tournamentTestDeleteLocks=new Set();
const tournamentRoundStartLocks=new Set();
const tournamentLobbyWalkoverLocks=new Set();
const TournamentSeatHandoff=require('./tournament-seat-handoff');
const TournamentReservedLobby=require('./tournament-reserved-lobby');
const TOURNAMENT_ADMIN_EMAILS = new Set(String(process.env.MAUMAU_TOURNAMENT_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
const TOURNAMENT_ADMIN_KEYS = new Set(String(process.env.MAUMAU_TOURNAMENT_ADMIN_KEYS||'').split(',').map(x=>x.trim()).filter(Boolean));
function tournamentIsAdmin(session){return !!(session?.playerKey&&(TOURNAMENT_ADMIN_KEYS.has(session.playerKey)||(session.email&&TOURNAMENT_ADMIN_EMAILS.has(session.email.toLowerCase()))));}
async function tournamentCanManage(session,id){return !!(session?.playerKey&&(tournamentIsAdmin(session)||await tournamentCatalog.isOwner(id,session.playerKey)));}
// A vaga pertence à identidade autenticada, nunca a um nome digitado ou código de sala.
// Notifica somente os sorteados (o cliente solicita a entrada; o servidor revalida tudo).
async function notifyTournamentSeats(id,stage,tables){
  // As mesas da API são públicas e NÃO contêm playerKey por razões de segurança.
  // Buscar as identidades reservadas somente nas tabelas privadas do servidor.
  const allowed=new Set((tables||[]).map(t=>Number(t.number)));
  const assigned=stage==='qualifier'
    ?await tournamentDraw.seatAssignments(id)
    :(await tournamentBracket.rows(id)).filter(t=>t.stage===stage)
      .flatMap(t=>t.players.map(p=>({playerKey:p.playerKey,tableNumber:t.number})));
  for(const player of assigned){
    if(!player.playerKey||!allowed.has(Number(player.tableNumber)))continue;
    emitToPlayerKey(player.playerKey,'tournamentSeatAssigned',{
      tournamentId:id,stage,tableNumber:Number(player.tableNumber)
    });
  }
}

// V40.69.8.21 — prazo do sorteio e de cada fase persistido no PostgreSQL.
// Não recomeça em F5, reconnect, criação tardia da sala ou restart do Render.
async function tournamentWaitDeadline(id,phase,number,binding=null){
  // NULL significa legado: não criar retroativamente um prazo de 2 minutos
  // a partir de um torneio sorteado antes da atualização do Render.
  if(phase==='qualifier')return await tournamentDraw.waitDeadlineAt(id,number);
  const row=binding||await tournamentBracket.getBinding(id,phase,number);
  return TournamentWait.timestamp(row?.waitDeadlineAt)||null;
}

// V40.69.8.22 — somente uma solicitação explícita e autenticada pode iniciar
// a primeira rodada de torneio. O prazo de 2 minutos libera o botão com menos
// participantes; nem entrada na mesa nem reconciliação disparam o início.
async function startTournamentLobbyOnRequest(room,player,socketId){
  if(!room?.tournament||room.status!=='lobby'||Number(room.round||0)!==0||
     rooms.get(room.code)!==room)throw new Error('A mesa não está aguardando o início.');
  if(tournamentRoundStartLocks.has(room.code))throw new Error('Esta mesa já está iniciando.');
  const t=room.tournament;
  const stillAuthorized=()=>rooms.get(room.code)===room&&room.status==='lobby'&&Number(room.round||0)===0&&
    room.players.includes(player)&&player.connected&&!player.isBot&&player.socketId===socketId&&
    t.rosterKeys.includes(player.playerKey)&&player.host;
  if(!stillAuthorized())throw new Error('Somente o anfitrião conectado e inscrito pode iniciar esta mesa.');
  tournamentRoundStartLocks.add(room.code);
  try{
  const binding=t.phase==='qualifier'?await tournamentGames.get(t.id,t.tableNumber):
    await tournamentBracket.getBinding(t.id,t.phase,t.tableNumber);
  if(!binding||binding.roomCode!==room.code||binding.result)throw new Error('A mesa do torneio mudou de estado. Atualize o painel.');
  if(!t.waitDeadlineAt){
    // Legado sem data persistida: não criar um prazo retroativo.
    t.waitDeadlineAt=await tournamentWaitDeadline(t.id,t.phase,t.tableNumber,binding);
  }
  const roster=(t.rosterNames||[]).length===t.rosterKeys.length?t.rosterNames:
    t.rosterKeys.map(playerKey=>({playerKey,name:room.players.find(p=>p.playerKey===playerKey)?.name||'Jogador'}));
  const presence=()=>room.players.filter(p=>!p.isBot&&p.connected&&t.rosterKeys.includes(p.playerKey)).map(p=>p.playerKey);
  const decision=()=>TournamentWait.decide({roster,present:presence(),deadline:t.waitDeadlineAt});
  const validate=()=>{
    if(!stillAuthorized())throw new Error('A mesa ou o anfitrião mudou durante a preparação.');
    if(room.players.some(p=>p.isBot))throw new Error('Mesa de torneio contém máquina. Início bloqueado.');
    assertTournamentTable(roster);
    if(room.players.length>MAX_TOURNAMENT_PLAYERS)
      throw new Error('A mesa do torneio ultrapassou quatro jogadores.');
    const plan=decision();
    if(plan.action!=='ready'){
      if(plan.present<2)throw new Error('São necessários pelo menos dois jogadores conectados para iniciar a partida.');
      throw new Error('Aguarde todos os participantes ou o fim dos cinco minutos para iniciar com menos jogadores.');
    }
    return plan;
  };
  validate();
    await requireRoomPersistenceReady();
    if(!await ensureTournamentBracketReady())throw new Error('Torneios indisponíveis.');
    const latest=t.phase==='qualifier'?await tournamentGames.get(t.id,t.tableNumber):
      await tournamentBracket.getBinding(t.id,t.phase,t.tableNumber);
    if(!latest||latest.roomCode!==room.code||latest.result||latest.roomState==='started')
      throw new Error('O início da mesa já foi registrado ou a fase mudou.');
    const plan=validate();
    // Só há desistência por ausência no instante em que os jogadores optam
    // por iniciar após o prazo. Até então, um atrasado pode chegar e participar.
    if(plan.expired){
      for(const absent of plan.missing){
        if(!t.forfeits?.some(f=>f.playerKey===absent.playerKey))
          TournamentForfeit.recordForfeit(room,{playerKey:absent.playerKey,name:absent.name,score:0});
      }
    }
    if(await roomSnapshotStore.saveNow(room)===false)throw new Error('A preparação da mesa não foi persistida.');
    // Registrar o início antes de distribuir cartas, para recuperação segura.
    if(t.phase==='qualifier')await tournamentGames.markStarted(t.id,t.tableNumber,room.code);
    else await tournamentBracket.markStarted(t.id,t.phase,t.tableNumber,room.code);
    room.players=room.players.filter(p=>!p.isBot&&p.connected&&t.rosterKeys.includes(p.playerKey));
    if(room.players.length<2)throw new Error('Jogadores insuficientes para iniciar.');
    if(plan.missing.length)Engine.appendLog(room,`⏳ Início autorizado: ${plan.missing.length} ausente(s) desclassificado(s), sem máquina.`,'system');
    Engine.startRound(room);
    ensureHost(room);
    try{
      if(await roomSnapshotStore.saveNow(room)===false)
        console.error('[tournament] snapshot do início pendente de retentativa',room.code);
    }catch(e){console.error('[tournament] snapshot do início será novamente tentado',room.code,e?.message||e);}
    broadcastPresence();
    return true;
  }finally{tournamentRoundStartLocks.delete(room.code);}
}

// V40.69.8.1 — falhas transitórias de inicialização não ficam memorizadas para sempre.
const {ensureReady:ensureRankingReady}=createRetryableInitialization({
  initialize:()=>rankingStore.init(),
  cooldownMs:10000,
  onSuccess:()=>console.log(`[ranking] armazenamento: ${rankingStore.kind}`),
  onFailure:e=>console.error('[ranking] inicialização indisponível; nova tentativa em até 10 s:',e),
});
void ensureRankingReady();
// V40.69.1 — identidade universal. O playerKey continua sendo a chave canônica do ranking
// e agora pode ser resolvido por Google, Apple ou e-mail verificado.
const authIdentityStore = new AuthIdentityStore({pool:appDatabasePool});
const authIdentityReady = authIdentityStore.init().then(()=>{console.log(`[auth] identidades: ${authIdentityStore.kind}`);return true}).catch(e=>{console.error('[auth] falha ao iniciar identidades:',e);return false});
// V40.53 — snapshots das salas ativas sobrevivem a deploy/restart quando DATABASE_URL existe.
const roomSnapshotStore = new RoomSnapshotStore({pool:appDatabasePool});
// V40.69.8.11 — uma falha na inicialização dos snapshots não deve exigir
// reiniciar o Render. Novas entradas aguardam também a restauração das salas.
const {ensureReady:ensureRoomSnapshotsInitialized}=createRetryableInitialization({
  initialize:()=>roomSnapshotStore.init(),
  cooldownMs:10000,
  onSuccess:()=>console.log(`[rooms] snapshots: ${roomSnapshotStore.kind}`),
  onFailure:e=>console.error('[rooms] inicialização dos snapshots indisponível; nova tentativa em até 10 s:',e),
});
void ensureRoomSnapshotsInitialized();
let snapshotsRestored=false;
let snapshotsRestorePromise=null;
const DATABASE_REQUIRED = databaseRequired(process.env);
if(DATABASE_REQUIRED && !String(process.env.DATABASE_URL||'').trim()){
  console.error('[ready] CRÍTICO: DATABASE_URL ausente em ambiente de produção. Ranking e snapshots não podem usar JSON local.');
}
async function requireRoomPersistenceReady(){
  const ready=await ensureRoomSnapshotsInitialized();
  if(!ready)throw new Error('Persistência das salas indisponível. Tente novamente em instantes.');
  // Em caso de recuperação tardia do PostgreSQL, primeiro restaurar as salas
  // antigas, depois autorizar novas salas/alterações duráveis.
  if(!snapshotsRestored){
    await restorePersistedRooms();
    if(!snapshotsRestored)throw new Error('As salas anteriores ainda não puderam ser restauradas. Tente novamente em instantes.');
  }
}
function cleanupRoomResources(room,message='A mesa foi encerrada.'){
  if(!room)return false;
  const code=room.code;
  cameraPublishers.delete(code); // Mídia não persiste após encerramento da sala.
  criticalSnapshotSignatures.delete(code);
  cancelOfflineRoomExpiry(code,{clearState:false});
  if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
  clearReconnectTimersForRoom(code);
  clearSpectatorReconnectTimersForRoom(code);
  clearDisconnectDebouncesForRoom(code);
  pendingSpectatorJoins.delete(code);
  closeSpectatorsForRoom(room,message);
  purgeInvitesForRoom(code,message);
  if(room.inviteReservations instanceof Map)room.inviteReservations.clear();
  const humanKeys=(room.players||[]).filter(p=>p&&!p.isBot&&p.playerKey).map(p=>String(p.playerKey));
  for(const key of humanKeys){
    matchmakingQueue.delete(key);
    setSearchingFlag(key,false);
  }
  for(const sock of io.sockets.sockets.values()){
    if(sock.data?.roomCode!==code)continue;
    try{notifyLiveVoicePeerUnavailable(sock);clearLiveVoiceSender(sock);liveVoiceRelayRate.delete(sock.id);}catch{}
    try{sock.leave(code);}catch{}
    sock.data.roomCode=null;sock.data.playerId=null;sock.data.spectatorId=null;sock.data.role=null;sock.data.liveVoiceOn=false;
    try{sock.emit('leftRoom',{message});}catch{}
  }
  // Liberamos referências grandes imediatamente, mesmo se algum closure ainda
  // mantiver o objeto antigo por alguns instantes.
  for(const player of room.players||[]){if(Array.isArray(player?.hand))player.hand.length=0;}
  for(const key of ['players','chat','log','turnAudit','deck','discard','replayReadyPlayerIds']){
    if(Array.isArray(room[key]))room[key].length=0;
  }
  if(Array.isArray(room.spectators))room.spectators.length=0;
  room.roundReview=null;
  return true;
}
async function removeRoomDurably(code,eventAt=Date.now(),message='A mesa foi encerrada.'){
  const room=rooms.get(code);
  // Torneio encerrado sem confirmacao: nunca gravar tombstone de exclusao.
  if(room && !TournamentRoomRetention.mayRemoveRoom(room))return false;
  await requireRoomPersistenceReady();
  // Revalidar depois da espera pelo banco, pois o resultado pode ter mudado.
  if(room && !TournamentRoomRetention.mayRemoveRoom(room))return false;
  await roomSnapshotStore.markRoomDeleted(code,eventAt);
  if(room)cleanupRoomResources(room,message);
  return rooms.delete(code);
}
function removeRoom(code,message='A mesa foi encerrada.'){
  const room=rooms.get(code);
  if(room && !TournamentRoomRetention.mayRemoveRoom(room))return false;
  if(room)cleanupRoomResources(room,message);
  const existed=rooms.delete(code);
  if(existed)roomSnapshotStore.delete(code).catch(e=>console.error('[rooms] falha ao excluir snapshot',code,e?.message||e));
  return existed;
}

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const APPLE_CLIENT_ID = String(process.env.APPLE_CLIENT_ID || '').trim();
const APPLE_REDIRECT_URI = String(process.env.APPLE_REDIRECT_URI || '').trim();
const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || '').trim();
const APPLE_KEY_ID = String(process.env.APPLE_KEY_ID || '').trim();
const APPLE_PRIVATE_KEY = String(process.env.APPLE_PRIVATE_KEY || '').trim();
const AUTH_SESSION_SECRET_CONFIGURED = !!String(process.env.AUTH_SESSION_SECRET || '').trim();
const AUTH_SESSION_SECRET = String(process.env.AUTH_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const AUTH_COOKIE = 'maumau_session';
const LEGACY_AUTH_COOKIE = 'maumau_google_session';
const AUTH_TTL_SECONDS = 7 * 24 * 60 * 60;
const googleAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const emailPinRegisterByIp = new UniversalAuth.SlidingWindowLimiter({limit:8,windowMs:60*60*1000});
const emailPinLoginByAddress = new UniversalAuth.SlidingWindowLimiter({limit:12,windowMs:15*60*1000});
const emailPinLoginByIp = new UniversalAuth.SlidingWindowLimiter({limit:30,windowMs:15*60*1000});
const emailPinRecoveryByIp = new UniversalAuth.SlidingWindowLimiter({limit:8,windowMs:60*60*1000});
const emailPasswordResetRequestByEmail = new UniversalAuth.SlidingWindowLimiter({limit:3,windowMs:15*60*1000});
const emailPasswordResetConfirmByEmail = new UniversalAuth.SlidingWindowLimiter({limit:10,windowMs:15*60*1000});
const EMAIL_RECOVERY_CONFIGURED = EmailDelivery.emailRecoveryConfigured(process.env);

// V40.33 — configuração de conectividade do microfone ao vivo.
// STUN continua funcionando sem configuração extra. TURN é opcional, mas recomendado
// para redes móveis/corporativas em que uma conexão P2P direta não consegue se manter.
const VOICE_STUN_URLS = String(process.env.VOICE_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
  .split(',').map(x=>x.trim()).filter(x=>x.startsWith('stun:'));
const VOICE_TURN_URLS = String(process.env.VOICE_TURN_URLS || process.env.VOICE_TURN_URL || '')
  .split(',').map(x=>x.trim()).filter(x=>/^turns?:/.test(x));
const VOICE_TURN_USERNAME = String(process.env.VOICE_TURN_USERNAME || '').trim();
const VOICE_TURN_CREDENTIAL = String(process.env.VOICE_TURN_CREDENTIAL || '').trim();
// V40.51 — além de credenciais TURN estáticas, aceita o padrão TURN REST do coturn.
// Com VOICE_TURN_SECRET, o navegador recebe credenciais temporárias por sessão,
// evitando deixar uma senha TURN permanente exposta no cliente.
const VOICE_TURN_SECRET = String(process.env.VOICE_TURN_SECRET || '').trim();
const VOICE_TURN_TTL_SECONDS = Math.max(300,Math.min(86400,Number(process.env.VOICE_TURN_TTL_SECONDS)||3600));
function voiceTurnConfigured(){
  return !!(VOICE_TURN_URLS.length && (VOICE_TURN_SECRET || (VOICE_TURN_USERNAME&&VOICE_TURN_CREDENTIAL)));
}
function voiceTurnAuthMode(){
  if(!voiceTurnConfigured())return 'none';
  return VOICE_TURN_SECRET?'ephemeral':'static';
}
function voiceTurnCredentials(session){
  if(VOICE_TURN_SECRET){
    const expires=Math.floor(Date.now()/1000)+VOICE_TURN_TTL_SECONDS;
    const identity=String(session?.playerKey||'player').replace(/[^A-Za-z0-9_-]/g,'').slice(-24)||'player';
    const username=`${expires}:${identity}`;
    const credential=crypto.createHmac('sha1',VOICE_TURN_SECRET).update(username).digest('base64');
    return {username,credential};
  }
  if(VOICE_TURN_USERNAME&&VOICE_TURN_CREDENTIAL)return {username:VOICE_TURN_USERNAME,credential:VOICE_TURN_CREDENTIAL};
  return null;
}
function voiceIceServers(session=null){
  const out=VOICE_STUN_URLS.length?VOICE_STUN_URLS.map(urls=>({urls})):[{urls:'stun:stun.l.google.com:19302'}];
  const auth=voiceTurnCredentials(session);
  if(VOICE_TURN_URLS.length&&auth)out.push({urls:VOICE_TURN_URLS,...auth});
  return out;
}

if (!GOOGLE_CLIENT_ID) console.warn('[auth] GOOGLE_CLIENT_ID não configurado. O login Google ficará indisponível.');
if (!EMAIL_RECOVERY_CONFIGURED) console.warn('[auth] RESEND_API_KEY/EMAIL_FROM não configurados. Login por e-mail funciona, mas recuperação de senha por e-mail ficará indisponível.');
if (!APPLE_CLIENT_ID || !APPLE_REDIRECT_URI || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) console.warn('[auth] configuração Sign in with Apple incompleta. O login Apple ficará indisponível.');
if (!AUTH_SESSION_SECRET_CONFIGURED) console.warn('[auth] AUTH_SESSION_SECRET não configurado. Foi criada uma chave temporária; sessões serão encerradas quando o servidor reiniciar.');
if (DATABASE_REQUIRED && !AUTH_SESSION_SECRET_CONFIGURED) console.error('[ready] CRÍTICO: AUTH_SESSION_SECRET ausente em produção. O serviço ficará not-ready até a variável ser configurada.');

function appleLoginConfigured(){return !!(APPLE_CLIENT_ID&&APPLE_REDIRECT_URI&&APPLE_TEAM_ID&&APPLE_KEY_ID&&APPLE_PRIVATE_KEY);}
function googlePlayerKey(sub) {
  // Compatibilidade: contas Google já existentes mantêm exatamente o mesmo playerKey,
  // preservando ranking, histórico e reservas de reconexão de versões anteriores.
  return `g_${crypto.createHash('sha256').update(`mau-mau-google:${sub}`).digest('hex').slice(0,40)}`;
}
function sessionUser(user,provider=''){
  return {
    playerKey:String(user?.playerKey||'').slice(0,80),
    name:String(user?.name||'Jogador').trim().slice(0,60)||'Jogador',
    email:normalizeEmail(user?.email),
    picture:String(user?.picture||'').trim().slice(0,500),
    provider:String(provider||user?.provider||'').trim().toLowerCase().slice(0,20),
  };
}
function signAuthSession(user) {
  const clean=sessionUser(user,user?.provider);
  const payload = Buffer.from(JSON.stringify({...clean,sv:normalizeSessionVersion(user?.sessionVersion),exp:Date.now() + AUTH_TTL_SECONDS * 1000})).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifyAuthSession(token) {
  try {
    const [payload, signature, extra] = String(token || '').split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', AUTH_SESSION_SECRET).update(payload).digest('base64url');
    const a=Buffer.from(signature), b=Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
    const session = JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if (!session?.playerKey || !session?.exp || Date.now() >= Number(session.exp)) return null;
    return {...sessionUser(session,session.provider),sessionVersion:normalizeSessionVersion(session.sv)};
  } catch { return null; }
}
function parseCookies(header='') {
  const out={};
  for (const part of String(header).split(';')) {
    const i=part.indexOf('='); if(i<0) continue;
    const key=part.slice(0,i).trim(); const value=part.slice(i+1).trim();
    if(!key) continue;
    try { out[key]=decodeURIComponent(value); } catch { out[key]=value; }
  }
  return out;
}
function authFromCookieHeader(header) {
  const cookies=parseCookies(header);
  return verifyAuthSession(cookies[AUTH_COOKIE]) || verifyAuthSession(cookies[LEGACY_AUTH_COOKIE]);
}
async function authFromCookieHeaderVerified(header) {
  const session=authFromCookieHeader(header);if(!session)return null;
  try{
    if(!await authIdentityReady)return null;
    let current=await authIdentityStore.getSessionVersion(session.playerKey);
    if(current===null){
      const ensured=await authIdentityStore.ensureSessionUser(session);
      current=normalizeSessionVersion(ensured?.sessionVersion);
    }
    return normalizeSessionVersion(current)===normalizeSessionVersion(session.sessionVersion)?session:null;
  }catch(e){console.warn('[auth] falha ao validar versão da sessão:',e?.message||e);return null;}
}
function disconnectStaleAuthSockets(playerKey,exceptSocketId=''){
  playerKey=String(playerKey||'').slice(0,80);if(!playerKey)return;
  for(const socket of io.sockets.sockets.values()){
    if(socket.id===exceptSocketId||socket.data?.auth?.playerKey!==playerKey)continue;
    try{socket.emit('authSessionRevoked',{message:'Sua senha foi alterada. Entre novamente para continuar.'});}catch{}
    try{socket.disconnect(true);}catch{}
  }
}
function authCookieLine(req,name,token,maxAge=AUTH_TTL_SECONDS) {
  const forwarded=String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure=req.secure || forwarded==='https';
  const value=token ? encodeURIComponent(token) : '';
  const parts=[`${name}=${value}`,'Path=/','HttpOnly','SameSite=Lax',`Max-Age=${maxAge}`];
  if(secure) parts.push('Secure');
  return parts.join('; ');
}
function setAuthCookie(req,res,token,maxAge=AUTH_TTL_SECONDS) {
  res.setHeader('Set-Cookie',[
    authCookieLine(req,AUTH_COOKIE,token,maxAge),
    authCookieLine(req,LEGACY_AUTH_COOKIE,'',0),
  ]);
}
function authIp(req){return String(req.ip||req.socket?.remoteAddress||'unknown').trim().slice(0,80);}
async function requireAuthIdentityStore(){if(!await authIdentityReady)throw new Error('Serviço de identidade temporariamente indisponível.');}
app.set('trust proxy', 1);

// V40.58 — camada HTTP: origem restrita, cabeçalhos de segurança e telemetria
// mínima. Nunca registra query string, cookies, corpo da requisição, cartas ou tokens.
app.use((req,res,next)=>{
  const requestId=/^[A-Za-z0-9._-]{8,80}$/.test(String(req.headers['x-request-id']||''))
    ? String(req.headers['x-request-id'])
    : crypto.randomUUID();
  const started=process.hrtime.bigint();
  monitor.httpRequests++;
  res.setHeader('X-Request-Id',requestId);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',"camera=(self), geolocation=(), payment=(), usb=(), microphone=(self)");
  res.setHeader('Content-Security-Policy',[
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' https://accounts.google.com https://appleid.cdn-apple.com https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self' ws: wss: https://accounts.google.com https://appleid.apple.com" + (CAMERA_ENABLED ? ` ${new URL(LIVEKIT_URL).origin} ${new URL(LIVEKIT_URL).origin.replace(/^wss:/,'https:')}` : ''),
    "frame-src https://accounts.google.com https://appleid.apple.com",
    "worker-src 'self' blob:",
    "form-action 'self'",
  ].join('; '));

  const origin=String(req.headers.origin||'').trim();
  if(origin && !requestOriginAllowed(req)){
    monitor.rejectedHttpOrigins++;
    logMonitor('warn','security','http-origin-rejected',{requestId,method:req.method,path:req.path,origin,host:safeRequestHost(req)});
    return res.status(403).json({ok:false,message:'Origem não autorizada.'});
  }
  const normalized=normalizedOrigin(origin);
  if(normalized && ALLOWED_CROSS_ORIGIN_SET.has(normalized)){
    res.setHeader('Access-Control-Allow-Origin',normalized);
    res.setHeader('Access-Control-Allow-Credentials','true');
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Request-Id');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  }
  if(req.method==='OPTIONS')return res.sendStatus(204);

  res.on('finish',()=>{
    if(res.statusCode>=500)monitor.http5xx++;
    if(MONITOR_HTTP_LOGS){
      const durationMs=Number(process.hrtime.bigint()-started)/1e6;
      logMonitor(res.statusCode>=500?'error':'info','http','request',{requestId,method:req.method,path:req.path,status:res.statusCode,durationMs:durationMs.toFixed(1)});
    }
  });
  next();
});
app.use(express.json({limit:'16kb'}));

app.get('/api/auth/config', (_,res)=>res.json({
  ok:true,
  // Campos legados preservados para não quebrar clientes ainda em cache.
  configured:!!GOOGLE_CLIENT_ID,
  clientId:GOOGLE_CLIENT_ID || null,
  providers:{
    google:{configured:!!GOOGLE_CLIENT_ID,clientId:GOOGLE_CLIENT_ID||null},
    apple:{configured:appleLoginConfigured(),clientId:APPLE_CLIENT_ID||null,redirectURI:APPLE_REDIRECT_URI||null},
    // Pré-APK — e-mail + senha funciona sem serviço externo. O e-mail é apenas
    // identificador da conta; a caixa postal não é verificada nem recebe código.
    email:{configured:false,mode:'disabled'},
    emailPassword:{configured:true,mode:'password',minLength:6,maxLength:60,recovery:{mode:'email_code',configured:EMAIL_RECOVERY_CONFIGURED}},
    // Compatibilidade de configuração para clientes antigos ainda em cache.
    emailPin:{configured:false,mode:'legacy'},
  }
}));
app.get('/api/auth/me', async (req,res)=>{
  const session=await authFromCookieHeaderVerified(req.headers.cookie);
  if(!session) return res.status(401).json({ok:false,message:'Login necessário.'});
  try{
    if(await authIdentityReady)await authIdentityStore.ensureSessionUser(session);
  }catch(e){console.warn('[auth] não foi possível registrar sessão existente:',e?.message||e);}
  const provider=session.provider || (String(session.playerKey||'').startsWith('g_')?'google':'account');
  res.json({ok:true,user:{...sessionUser(session,provider),provider}});
});
app.get('/api/camera/config', (_req,res)=>res.json({enabled:CAMERA_ENABLED,recording:false}));
app.get('/api/voice/config', async (req,res)=>{
  const session=await authFromCookieHeaderVerified(req.headers.cookie);
  if(!session) return res.status(401).json({ok:false,message:'Login necessário para usar voz.'});
  res.setHeader('Cache-Control','no-store');
  res.json({ok:true,iceServers:voiceIceServers(session),turnConfigured:voiceTurnConfigured(),turnAuthMode:voiceTurnAuthMode(),turnTtlSeconds:VOICE_TURN_SECRET?VOICE_TURN_TTL_SECONDS:null});
});
app.post('/api/auth/google', async (req,res)=>{
  try {
    if(!googleAuthClient || !GOOGLE_CLIENT_ID) return res.status(503).json({ok:false,message:'Login Google ainda não foi configurado no servidor.'});
    await requireAuthIdentityStore();
    const credential=String(req.body?.credential || '').trim();
    if(!credential) return res.status(400).json({ok:false,message:'Credencial Google não informada.'});
    const ticket=await googleAuthClient.verifyIdToken({idToken:credential,audience:GOOGLE_CLIENT_ID});
    const payload=ticket.getPayload();
    if(!payload?.sub) throw new Error('Conta Google sem identificador válido.');
    if(payload.email_verified === false) throw new Error('O e-mail desta Conta Google não está verificado.');
    const user=await authIdentityStore.resolveIdentity({
      provider:'google',subject:payload.sub,legacyPlayerKey:googlePlayerKey(payload.sub),verifiedEmail:payload.email_verified!==false,
      name:String(payload.name || payload.given_name || 'Jogador').trim().slice(0,60),
      email:String(payload.email || '').trim().slice(0,180),picture:String(payload.picture || '').trim().slice(0,500),
    });
    user.provider='google';
    setAuthCookie(req,res,signAuthSession(user));
    res.json({ok:true,user:sessionUser(user,'google')});
  } catch(e) {
    console.error('[auth] falha no login Google:',e?.message || e);
    res.status(401).json({ok:false,message:'Não foi possível validar esta Conta Google. Tente novamente.'});
  }
});
app.get('/api/auth/apple/challenge', (req,res)=>{
  if(!appleLoginConfigured())return res.status(503).json({ok:false,message:'Login Apple ainda não foi configurado no servidor.'});
  res.setHeader('Cache-Control','no-store');
  res.json({ok:true,...UniversalAuth.createAppleChallenge(AUTH_SESSION_SECRET)});
});
app.post('/api/auth/apple', async (req,res)=>{
  try{
    if(!appleLoginConfigured())return res.status(503).json({ok:false,message:'Login Apple ainda não foi configurado no servidor.'});
    await requireAuthIdentityStore();
    const idToken=String(req.body?.idToken||'').trim();
    const authorizationCode=String(req.body?.code||'').trim();
    const state=String(req.body?.state||'').trim();
    if(!idToken||!authorizationCode||!state)return res.status(400).json({ok:false,message:'Resposta da Apple incompleta.'});
    const challenge=UniversalAuth.verifyAppleChallenge(AUTH_SESSION_SECRET,state);
    if(!challenge)return res.status(401).json({ok:false,message:'A tentativa de login Apple expirou. Tente novamente.'});
    const payload=await UniversalAuth.verifyAppleIdentityToken(idToken,{audience:APPLE_CLIENT_ID,nonce:challenge.nonce});
    // Para login web, além de conferir a assinatura do ID token, validamos o código
    // de autorização diretamente no endpoint da Apple usando um client_secret ES256.
    const exchanged=await UniversalAuth.exchangeAppleAuthorizationCode(authorizationCode,{clientId:APPLE_CLIENT_ID,teamId:APPLE_TEAM_ID,keyId:APPLE_KEY_ID,privateKey:APPLE_PRIVATE_KEY,redirectURI:APPLE_REDIRECT_URI});
    const exchangedPayload=await UniversalAuth.verifyAppleIdentityToken(exchanged.id_token,{audience:APPLE_CLIENT_ID});
    if(exchangedPayload.sub!==payload.sub)throw new Error('A validação Apple retornou outra identidade.');
    const suppliedName=req.body?.user?.name||{};
    const appleName=[suppliedName.firstName,suppliedName.lastName].map(x=>String(x||'').trim()).filter(Boolean).join(' ').slice(0,60);
    const verifiedEmail=payload.email_verified===true||String(payload.email_verified||'').toLowerCase()==='true';
    const user=await authIdentityStore.resolveIdentity({
      provider:'apple',subject:payload.sub,verifiedEmail,
      name:appleName||String(payload.email||'').split('@')[0]||'Jogador',email:String(payload.email||''),picture:'',
    });
    user.provider='apple';
    setAuthCookie(req,res,signAuthSession(user));
    res.json({ok:true,user:sessionUser(user,'apple')});
  }catch(e){
    console.error('[auth] falha no login Apple:',e?.message||e);
    res.status(401).json({ok:false,message:'Não foi possível validar esta Conta Apple. Tente novamente.'});
  }
});
function emailPasswordErrorResponse(res,error,fallback='Não foi possível concluir o acesso.'){
  const code=String(error?.code||'');
  const status=code==='EMAIL_EXISTS'?409:code==='NOT_FOUND'?404:code==='LOCKED'?429:['RESET_ATTEMPTS'].includes(code)?429:['EMAIL_NOT_CONFIGURED'].includes(code)?503:['EMAIL_SEND_FAILED'].includes(code)?502:['INVALID_EMAIL','INVALID_PASSWORD','INVALID_CREDENTIALS','INVALID_RECOVERY','INVALID_RESET','RESET_EXPIRED'].includes(code)?400:500;
  if(status>=500)console.error('[auth] falha em e-mail + senha:',error?.message||error);
  return res.status(status).json({ok:false,message:status>=500?fallback:String(error?.message||fallback)});
}
app.post('/api/auth/email-password/register', async (req,res)=>{
  try{
    await requireAuthIdentityStore();
    const rate=emailPinRegisterByIp.consume(authIp(req));
    if(!rate.allowed)return res.status(429).json({ok:false,message:'Muitas criações de conta neste aparelho. Tente novamente mais tarde.'});
    const email=normalizeEmail(req.body?.email),password=String(req.body?.password??''),name=String(req.body?.name||'').trim().slice(0,60);
    const result=await authIdentityStore.registerEmailPassword({email,password,name});
    result.user.provider='email_password';
    setAuthCookie(req,res,signAuthSession(result.user));
    res.status(201).json({ok:true,user:sessionUser(result.user,'email_password'),message:'Conta criada com sucesso.'});
  }catch(e){emailPasswordErrorResponse(res,e,'Não foi possível criar a conta agora.');}
});
app.post('/api/auth/email-password/login', async (req,res)=>{
  try{
    await requireAuthIdentityStore();
    const email=normalizeEmail(req.body?.email),password=String(req.body?.password??'');
    if(!email)return res.status(400).json({ok:false,message:'Informe um e-mail válido.'});
    const byEmail=emailPinLoginByAddress.consume(email),byIp=emailPinLoginByIp.consume(authIp(req));
    if(!byEmail.allowed||!byIp.allowed)return res.status(429).json({ok:false,message:'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.'});
    const user=await authIdentityStore.loginEmailPassword({email,password});user.provider='email_password';
    setAuthCookie(req,res,signAuthSession(user));
    res.json({ok:true,user:sessionUser(user,'email_password')});
  }catch(e){emailPasswordErrorResponse(res,e,'Não foi possível entrar agora.');}
});
app.post('/api/auth/email-password/recovery/request', async (req,res)=>{
  try{
    if(!EMAIL_RECOVERY_CONFIGURED)return res.status(503).json({ok:false,message:'A recuperação por e-mail ainda não está configurada no servidor.'});
    await requireAuthIdentityStore();
    const email=normalizeEmail(req.body?.email);if(!email)return res.status(400).json({ok:false,message:'Informe um e-mail válido.'});
    const byIp=emailPinRecoveryByIp.consume(authIp(req)),byEmail=emailPasswordResetRequestByEmail.consume(email);
    if(!byIp.allowed||!byEmail.allowed)return res.status(429).json({ok:false,message:'Muitas solicitações de recuperação. Aguarde alguns minutos e tente novamente.'});
    const issued=await authIdentityStore.issueEmailPasswordResetCode({email});
    if(issued.exists){
      try{await EmailDelivery.sendPasswordResetCode({to:email,code:issued.code});}
      catch(e){await authIdentityStore.clearEmailPasswordReset({email}).catch(()=>{});throw e;}
    }
    // Resposta deliberadamente igual para e-mail existente ou inexistente.
    res.json({ok:true,message:'Se existir uma conta com este e-mail, o código de recuperação será enviado. Ele vale por 10 minutos.'});
  }catch(e){emailPasswordErrorResponse(res,e,'Não foi possível enviar o código de recuperação agora.');}
});
app.post('/api/auth/email-password/recover', async (req,res)=>{
  try{
    await requireAuthIdentityStore();
    const email=normalizeEmail(req.body?.email);if(!email)return res.status(400).json({ok:false,message:'Informe um e-mail válido.'});
    const byIp=emailPinRecoveryByIp.consume(authIp(req)),byEmail=emailPasswordResetConfirmByEmail.consume(email);
    if(!byIp.allowed||!byEmail.allowed)return res.status(429).json({ok:false,message:'Muitas tentativas de recuperação. Aguarde alguns minutos e tente novamente.'});
    const user=await authIdentityStore.resetEmailPasswordWithCode({email,code:req.body?.code,newPassword:req.body?.newPassword});user.provider='email_password';
    setAuthCookie(req,res,signAuthSession(user));
    res.json({ok:true,user:sessionUser(user,'email_password'),message:'Senha alterada com sucesso.'});
    const revokeTimer=setTimeout(()=>disconnectStaleAuthSockets(user.playerKey),250);revokeTimer.unref?.();
  }catch(e){emailPasswordErrorResponse(res,e,'Não foi possível recuperar a conta agora.');}
});
// Compatibilidade temporária: clientes antigos ainda abertos podem autenticar contas PIN.
// Criação e recuperação pelo fluxo antigo foram encerradas; a tela atual usa senha.
app.post('/api/auth/email-pin/login', async (req,res)=>{
  try{
    await requireAuthIdentityStore();
    const email=normalizeEmail(req.body?.email),pin=String(req.body?.pin||'');
    if(!email)return res.status(400).json({ok:false,message:'Informe um e-mail válido.'});
    const byEmail=emailPinLoginByAddress.consume(email),byIp=emailPinLoginByIp.consume(authIp(req));
    if(!byEmail.allowed||!byIp.allowed)return res.status(429).json({ok:false,message:'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.'});
    const user=await authIdentityStore.loginEmailPin({email,pin});user.provider='email_password';
    setAuthCookie(req,res,signAuthSession(user));
    res.json({ok:true,user:sessionUser(user,'email_password'),legacy:true});
  }catch(e){emailPasswordErrorResponse(res,e,'Não foi possível entrar agora.');}
});
app.post('/api/auth/email-pin/register', (req,res)=>res.status(410).json({ok:false,message:'O cadastro por PIN foi substituído por senha. Atualize a página e crie uma senha de 6 a 60 caracteres.'}));
app.post('/api/auth/email-pin/recover', (req,res)=>res.status(410).json({ok:false,message:'A recuperação por PIN foi substituída por senha. Atualize a página.'}));

app.post('/api/auth/logout', (req,res)=>{
  setAuthCookie(req,res,'',0);
  res.json({ok:true});
});
const emailPinLimiterPruneTimer=setInterval(()=>{const now=Date.now();emailPinRegisterByIp.prune(now);emailPinLoginByAddress.prune(now);emailPinLoginByIp.prune(now);emailPinRecoveryByIp.prune(now);emailPasswordResetRequestByEmail.prune(now);emailPasswordResetConfirmByEmail.prune(now);},5*60*1000);emailPinLimiterPruneTimer.unref?.();

app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, 'public', 'assetlinks.json'));
});

// Fase 5A: HTML sempre revalidado, com URLs locais versionadas pelo conteúdo.
// Permite que uma nova publicação renove CSS/JS mesmo sem edição manual do ?v=.
// Não existe Service Worker próprio: mantemos o jogo online e evitamos cache offline de estado.
const VERSIONED_GAME_HTML = StaticAssetVersioning.versionedIndex(path.join(__dirname, 'public'));
app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(VERSIONED_GAME_HTML);
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res,filePath){
    if(filePath.includes(`${path.sep}assets${path.sep}app${path.sep}`)) res.setHeader('Cache-Control','no-cache, must-revalidate');
    else if(filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control','public, max-age=86400, stale-while-revalidate=604800');
    else if(/\.(?:js|css|webmanifest)$/i.test(filePath)) res.setHeader('Cache-Control','no-cache, must-revalidate');
    else if(/\.html?$/i.test(filePath)) res.setHeader('Cache-Control','no-cache');
  }
}));
app.get('/health', (_, res) => {
  res.setHeader('Cache-Control','no-store');
  const roomStats=roomDiagnostics();
  res.json({
    ok:true,
    status:'live',
    version:APP_VERSION,
    releaseVersion:RELEASE_VERSION,
    rulesVersion:RULES_VERSION,
    uiVersion:UI_VERSION,
    uptimeSeconds:Math.floor((Date.now()-SERVICE_STARTED_AT)/1000),
    rooms:roomStats.total,
    roomCapacity:{limit:roomStats.limit,available:roomStats.availableSlots,atCapacity:roomStats.atCapacity,pendingCreations:roomStats.pendingCreations},
    spectatorCapacity:{perRoom:MAX_SPECTATORS_PER_ROOM},
    roomStats,
    sockets:io.engine?.clientsCount || 0,
    ranking:rankingStore.kind,
    roomSnapshots:roomSnapshotStore.kind,
    authIdentities:authIdentityStore.kind,
    monitor:{
      httpRequests:monitor.httpRequests,
      http5xx:monitor.http5xx,
      socketConnections:monitor.socketConnections,
      socketDisconnects:monitor.socketDisconnects,
      rejectedOrigins:monitor.rejectedHttpOrigins+monitor.rejectedSocketOrigins,
      connectivity:runtimeConnectionMonitor.summary(),
    },
  });
});
app.get('/ready', async (_,res)=>{
  res.setHeader('Cache-Control','no-store');
  const report=await evaluateReadiness({rankingStore,roomSnapshotStore,rankingReady:ensureRankingReady(),roomSnapshotsReady:ensureRoomSnapshotsInitialized(),env:process.env,timeoutMs:2000});
  const identity=await probeIdentityReadiness(authIdentityStore,authIdentityReady,2000);
  const authOk=identity.ok,authReason=identity.reason;
  const sessionSecretOk=!DATABASE_REQUIRED||AUTH_SESSION_SECRET_CONFIGURED;
  const ok=report.ok&&authOk&&sessionSecretOk;
  res.status(ok?200:503).json({
    ok,status:ok?'ready':'not-ready',version:APP_VERSION,releaseVersion:RELEASE_VERSION,rulesVersion:RULES_VERSION,uiVersion:UI_VERSION,databaseRequired:report.databaseRequired,reason:ok?'ok':(!sessionSecretOk?'auth-session-secret-required':(!authOk?authReason:report.reason)),
    authSessionSecret:{configured:AUTH_SESSION_SECRET_CONFIGURED,required:DATABASE_REQUIRED,ok:sessionSecretOk},
    ranking:{kind:report.ranking.kind,ok:report.ranking.ok,reason:report.ranking.reason},
    roomSnapshots:{kind:report.roomSnapshots.kind,ok:report.roomSnapshots.ok,reason:report.roomSnapshots.reason},
    authIdentities:{kind:authIdentityStore.kind,ok:authOk,reason:authReason},
  });
});

// V51.2 — Torneios administrados pela interface, com autorização somente no servidor.
app.get('/api/tournaments', async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    if(!await ensureTournamentCatalogReady())throw new Error('Catálogo indisponível.');
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    res.json({ok:true,serverNow:Date.now(),canCreate:!!session?.playerKey,tournaments:await tournamentCatalog.list({actor:session?.playerKey||'',isAdmin:tournamentIsAdmin(session)})});
  }catch(e){console.error('[tournament] listagem falhou:',e.message);res.status(503).json({ok:false,message:'Torneios indisponíveis.'});}
});
app.get('/api/tournament', async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    if(!await ensureTournamentCatalogReady())throw new Error('Torneios indisponíveis.');
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    const list=await tournamentCatalog.list();
    const id=String(req.query.id||list[0]?.id||'');
    const config=await tournamentCatalog.get(id,{actor:session?.playerKey||'',isAdmin:tournamentIsAdmin(session)});
    if(!config)return res.status(404).json({ok:false,message:'Torneio não encontrado.'});
    const result=await tournamentStore.get({config,playerKey:session?.playerKey||''});
    if(!await ensureTournamentDrawReady())throw new Error('Sorteio indisponível.');
    const tables=await tournamentDraw.get(config.id);
    if(!await ensureTournamentBracketReady())throw new Error('Fases indisponíveis.');
    const bracket=await tournamentBracket.summary(config.id,tables);
    const currentStage=bracket.currentStage;
    const stageData=bracket.stages.find(x=>x.stage===currentStage);
    const displayTables=currentStage==='qualifier'?tables:(stageData?.tables||[]);
    const recordedGames=currentStage==='qualifier'?
      await tournamentGames.statuses(config.id,tables.map(t=>t.number)):
      Object.fromEntries(displayTables.map(t=>[t.number,{created:t.created,finished:t.finished,result:t.result}]));
    // Status in memory, without private cards, room codes, tokens or identifiers.
    // After a Render restart, fall back to the recorded state rather than claiming a live game.
    const liveTableStatus=new Map();
    for(const room of rooms.values()){
      if(room.tournament?.id!==config.id||room.tournament?.phase!==currentStage)continue;
      const n=room.tournament.tableNumber;
      if(!displayTables.some(t=>t.number===n))continue;
      liveTableStatus.set(n,{
        liveStatus:room.status,
        connectedPlayers:room.players.filter(p=>!p.isBot&&p.connected).length,
        expectedPlayers:room.tournament.rosterKeys.length,
        spectatorCount:ensureSpectators(room).filter(s=>s.connected).length,
        spectatorLimit:MAX_SPECTATORS_PER_ROOM
      });
    }
    // V40.69.8.47: aproveitar o vínculo da própria consulta de mesas para
    // reconhecer a desistência, sem acrescentar chamadas ao catálogo/banco.
    const forfeitedTablesForViewer=new Set();
    const games=Object.fromEntries(await Promise.all(displayTables.map(async t=>{
      const binding=currentStage==='qualifier'?(typeof tournamentGames.get==='function'?await tournamentGames.get(config.id,t.number):null):
        (typeof tournamentBracket.getBinding==='function'?await tournamentBracket.getBinding(config.id,currentStage,t.number):null);
      const room=binding?.roomCode?rooms.get(binding.roomCode):null;
      if(session?.playerKey&&room?.tournament?.id===config.id&&room.tournament.phase===currentStage&&
        room.tournament.tableNumber===t.number&&
        room.tournament.forfeits?.some(entry=>entry.playerKey===session.playerKey))
        forfeitedTablesForViewer.add(t.number);
      const storedSnapshot=!!(binding?.roomCode&&!room&&await roomSnapshotStore.hasStoredSnapshot(binding.roomCode));
      const classifiedAvailability=TournamentTableHealth.classify(binding,{room,snapshotsReady:snapshotsRestored,
        activeSnapshot:storedSnapshot,deleted:binding?.roomCode?roomSnapshotStore.isRoomDeleted(binding.roomCode):false});
      const availability=storedSnapshot&&classifiedAvailability==='recovery-required'?'snapshot-review':classifiedAvailability;
      const canRepair=!!(config.canManage&&currentStage==='final'&&availability==='recovery-required'&&
        !storedSnapshot&&snapshotsRestored);
      const deadlineAt=typeof tournamentWaitDeadline==='function'?await tournamentWaitDeadline(config.id,currentStage,t.number,binding):null;
      const expected=t.players.length;
      const present=room?.players.filter(p=>!p.isBot&&p.connected).length||0;
      const elapsed=!!deadlineAt&&Date.now()>=deadlineAt;
      const absent=t.players.filter(p=>!room?.players.some(x=>x.connected&&!x.isBot&&x.name===p.name)).map(p=>p.name);
      return [t.number,{...(recordedGames[t.number]||{}),...(liveTableStatus.get(t.number)||{}),
        availability,availabilityMessage:TournamentTableHealth.message(availability),
        repairAllowed:canRepair,
        wait:deadlineAt&&!recordedGames[t.number]?.finished?{
          deadlineAt,expected,present,absent,
          requiresAttention:elapsed&&present===0&&!binding?.result
        }:null}];
    })));
    // V40.69.8.47 — o sorteio histórico continua contendo o desistente,
    // mas uma desistência registrada NÃO representa uma vaga ativa. A conta
    // deve ver ASSISTIR, e nunca ENTRAR NA MINHA MESA, enquanto a sala existir.
    // Não alterar rosterKeys, sorteio, resultado nem critérios de classificação.
    let myTable=null,forfeitedTable=null;
    if(session?.playerKey)for(const t of displayTables){
      const allowed=currentStage==='qualifier'?await tournamentDraw.seatFor(config.id,t.number,session.playerKey):
        await tournamentBracket.seatFor(config.id,currentStage,t.number,session.playerKey);
      if(!allowed)continue;
      if(forfeitedTablesForViewer.has(t.number))forfeitedTable=t.number;
      else myTable=t.number;
      break;
    }
    res.json({ok:true,serverNow:Date.now(),canCreate:!!session?.playerKey,...result,tables:displayTables,games,myTable,forfeitedTable,bracket});
  }catch(e){console.error('[tournament] consulta falhou:',e.message);res.status(503).json({ok:false,message:'Não foi possível consultar o torneio.'});}
});
app.post('/api/tournament/registration', async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre na sua conta para se inscrever.'});
    if(!(await ensureTournamentCatalogReady()))throw new Error('Inscrições indisponíveis.');
    const id=String(req.body?.tournamentId||'');
    const config=await tournamentCatalog.get(id,{actor:session.playerKey,isAdmin:tournamentIsAdmin(session)});
    if(!config)return res.status(404).json({ok:false,message:'Torneio não encontrado.'});
    const data=await tournamentStore.change({action:req.body?.action,playerKey:session.playerKey,name:session.name,config});
    res.json({ok:true,canCreate:true,...data});
  }catch(e){
    const status=[400,401,404,409].includes(e.status)?e.status:503;
    if(status===503)console.error('[tournament] inscrição falhou:',e.message);
    res.status(status).json({ok:false,message:status===503?'Inscrições temporariamente indisponíveis.':e.message});
  }
});
app.post('/api/tournaments', async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre na sua conta.'});
    if(!await ensureTournamentCatalogReady())throw new Error('Catálogo indisponível.');
    const attempt=abuseLimiter.consume(`tournament:${session.playerKey}`,'createTournament');
    if(!attempt.allowed){
      res.setHeader('Retry-After',String(Math.ceil(attempt.retryAfterMs/1000)));
      return res.status(429).json({ok:false,message:'Muitas tentativas de criação de torneio. Aguarde alguns minutos.'});
    }
    const tournament=await tournamentCatalog.create({data:req.body,actor:session.playerKey});
    res.status(201).json({ok:true,tournament});
  }catch(e){
    const status=[400,403,409,429].includes(e.status)?e.status:503;
    if(status===503)console.error('[tournament] criação falhou:',e.message);
    res.status(status).json({ok:false,message:status===503?'Não foi possível criar o torneio.':e.message});
  }
});
app.patch('/api/tournaments/:id', async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre na sua conta.'});
    if(!await tournamentCanManage(session,req.params.id))return res.status(403).json({ok:false,message:'Somente o criador pode administrar este torneio.'});
    if(!await ensureTournamentCatalogReady()||!await ensureTournamentDrawReady())throw new Error('Catálogo indisponível.');
    if(req.body?.status==='cancelled' && await tournamentGames.hasStarted(req.params.id))
      return res.status(409).json({ok:false,message:'Não cancele o torneio depois que as mesas começaram a jogar.'});
    const tournament=await tournamentCatalog.update({id:req.params.id,data:req.body});
    // V40.69.8.23 — o horário alterado pelo organizador também chega às
    // mesas de espera que já estiverem abertas, sem recomeçar nenhum timer.
    for(const room of rooms.values()){
      if(room.tournament?.id!==tournament.id)continue;
      if(room.tournament.startAt!==tournament.startAt||room.tournament.name!==tournament.name){
        room.tournament.startAt=tournament.startAt;
        room.tournament.name=tournament.name;
        emitRoom(room);
      }
    }
    res.json({ok:true,tournament});
  }catch(e){
    const status=[400,403,404,409].includes(e.status)?e.status:503;
    if(status===503)console.error('[tournament] edição falhou:',e.message);
    res.status(status).json({ok:false,message:status===503?'Não foi possível atualizar o torneio.':e.message});
  }
});

// V51.3.1 — exclusão do torneio e dos dados associados pelo criador.
app.delete('/api/tournaments/:id', async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre na sua conta.'});
    // O historico de jogos e fases deve estar acessivel antes de autorizar exclusao.
    if(!await ensureTournamentBracketReady())throw new Error('Histórico do torneio indisponível.');
    if([...rooms.values()].some(r=>r.tournament?.id===req.params.id&&r.status!=='finished'))
      return res.status(409).json({ok:false,message:'Encerre as partidas ativas antes de excluir este torneio.'});
    const result=await tournamentCatalog.delete({id:req.params.id,actor:session.playerKey,isAdmin:tournamentIsAdmin(session)});
    await tournamentGames.clearLocal(req.params.id);
    await tournamentBracket.clearLocal(req.params.id);
    res.json({ok:true,...result});
  }catch(e){
    const status=[400,401,403,404,409].includes(e.status)?e.status:503;
    if(status===503)console.error('[tournament] exclusão falhou:',e.message);
    res.status(status).json({ok:false,message:status===503?'Não foi possível excluir o torneio.':e.message});
  }
});

// V40.69.8.28 — exclusão excepcional e EXPLÍCITA de torneio de TESTE travado.
// A exclusão normal permanece protegida contra partidas iniciadas sem resultado.
app.post('/api/tournaments/:id/force-delete-test',async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre com a conta que criou o torneio.'});
    const id=String(req.params.id||'');
    if(!await ensureTournamentCatalogReady()||!await ensureTournamentDrawReady()||!await ensureTournamentBracketReady())
      throw new Error('Torneios temporariamente indisponíveis.');
    if(!await tournamentCatalog.isOwner(id,session.playerKey))
      return res.status(403).json({ok:false,message:'Somente o criador pode excluir este torneio de teste.'});
    if(tournamentTestDeleteLocks.has(id)||[...tournamentTableJoinLocks].some(key=>key.startsWith(id+':')))
      return res.status(409).json({ok:false,message:'Existe uma operação em andamento nessa competição. Aguarde e tente novamente.'});
    tournamentTestDeleteLocks.add(id);
    try{
    // Nenhuma sessão ligada a esta competição pode ser descartada por este recurso.
    if([...rooms.values()].some(room=>room.tournament?.id===id))
      return res.status(409).json({ok:false,message:'Ainda existe uma sala deste torneio em memória. Encerre-a antes de excluir o teste.'});
    await requireRoomPersistenceReady();
    const initial=await tournamentDraw.get(id);
    const stages=await tournamentBracket.rows(id);
    const codes=new Set();
    const keys=new Set();
    for(const table of initial){
      for(const player of table.players||[])if(player.playerKey)keys.add(player.playerKey);
      const game=await tournamentGames.get(id,table.number);
      if(game?.roomCode)codes.add(game.roomCode);
    }
    for(const table of stages){
      if(table.roomCode)codes.add(table.roomCode);
      for(const player of table.players||[])if(player.playerKey)keys.add(player.playerKey);
    }
    // O catálogo valida, dentro da transação, o dono, o nome TESTE, o estado
    // e a frase de confirmação. Nenhum torneio real obtém essa exceção.
    await tournamentCatalog.delete({id,actor:session.playerKey,forceTest:true,
      confirmation:req.body?.confirmation});
    await tournamentGames.clearLocal(id);
    await tournamentBracket.clearLocal(id);
    let cleanupErrors=0;
    for(const code of codes){
      try{await roomSnapshotStore.markRoomDeleted(code,Date.now());}
      catch(error){cleanupErrors++;console.error('[tournament] snapshot de teste não eliminado',code,error?.message||error);}
    }
    for(const key of keys)emitToPlayerKey(key,'tournamentSeatRevoked',{tournamentId:id,
      message:'Este torneio de teste foi excluído pelo organizador. A convocação antiga foi encerrada.'});
    console.info('[tournament] teste excluído pelo criador',{id,rooms:codes.size,cleanupErrors});
    res.json({ok:true,id,message:cleanupErrors?
      'Torneio excluído. Alguns estados antigos aguardam limpeza; consulte os logs do Render.':
      'Torneio de teste excluído. As convocações antigas foram encerradas.',cleanupErrors});
    }finally{tournamentTestDeleteLocks.delete(id);}
  }catch(error){
    const status=[400,401,403,404,409].includes(error.status)?error.status:503;
    if(status===503)console.error('[tournament] exclusão excepcional falhou:',error);
    res.status(status).json({ok:false,message:status===503?'Não foi possível excluir o teste. Tente novamente mais tarde.':error.message});
  }
});

// V51.5 — Lista pública de campeões. Resultados nunca afetam o Ranking Oficial.
app.get('/api/tournaments/champions', async(req,res)=>{
  res.setHeader('Cache-Control','public, max-age=30');
  try{
    if(!await ensureTournamentPodiumReady())throw new Error('Historico dos podios indisponivel.');
    const completed=await tournamentPodiumArchive.list();
    const savedIds=new Set(completed.map(cup=>cup.id));
    // Compatibilidade com torneios encerrados antes da migracao. A rotina de
    // reconciliacao os arquivara sem expor fases/intermediarios no ranking.
    for(const cup of await tournamentCatalog.list()){
      if(savedIds.has(cup.id)||cup.status!=='closed')continue;
      const initial=await tournamentDraw.get(cup.id);
      if(!initial.length)continue;
      const bracket=await tournamentBracket.summary(cup.id,initial);
      if(bracket.champion){
        const podium=await tournamentPodiumArchive.record({id:cup.id,name:cup.name,champion:bracket.champion});
        completed.push(podium);savedIds.add(cup.id);
      }
    }
    res.json({ok:true,completed});
  }catch(e){console.error('[tournament] campeões indisponíveis:',e);res.status(503).json({ok:false,message:'Resultados indisponíveis.'});}
});

// V51.3 - sorteio persistente, sem iniciar as salas reais.
app.post('/api/tournaments/:id/draw', async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre na sua conta.'});
    if(!await tournamentCanManage(session,req.params.id))return res.status(403).json({ok:false,message:'Somente o criador pode sortear mesas.'});
    if(!await ensureTournamentDrawReady())throw new Error('Sorteio indisponível.');
    const tables=await tournamentDraw.draw(req.params.id);
    try{await notifyTournamentSeats(req.params.id,'qualifier',tables);}
    catch(e){console.error('[tournament] aviso de vagas falhou; sorteio preservado:',e.message);}
    res.json({ok:true,tables});
  }catch(e){
    const status=[400,403,404,409].includes(e.status)?e.status:503;
    if(status===503)console.error('[tournament] sorteio falhou:',e.message);
    res.status(status).json({ok:false,message:status===503?'Não foi possível sortear as mesas.':e.message});
  }
});

// Títulos competitivos: somente resultados oficiais já registrados, sem novos writes.
app.get('/api/ranking/awards', async (_req,res)=>{
  try{
    if(!(await ensureRankingReady()))throw new Error('Ranking indisponível.');
    const awards=await rankingStore.getSkillAwards();
    res.setHeader('Cache-Control','private, no-store');
    res.json({ok:true,mode:'official',timezone:'America/Porto_Velho',awards});
  }catch(e){
    console.error('[ranking] títulos indisponíveis:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar os títulos agora.'});
  }
});

app.get('/api/ranking', async (req,res)=>{
  try {
    const period=normalizePeriod(req.query.period);
    const mode=normalizeMode(req.query.mode);
    if(!(await ensureRankingReady())) throw new Error('Armazenamento do ranking indisponível.');
    const category=['performance','skill'].includes(req.query.category)?req.query.category:'wins';
    const rows=category==='skill'?await rankingStore.getSkillLeaderboard({period,mode,limit:50})
      :category==='performance'?await rankingStore.getPerformanceLeaderboard({period,mode,limit:50})
      :await rankingStore.getLeaderboard({period,mode,limit:50});
    res.setHeader('Cache-Control','private, no-store');
    res.json({ok:true,period,mode,category,performanceSettings:category==='performance'?performanceSettings(period):null,skillSettings:category==='skill'?skillSettings(period):null,seasonId:CURRENT_SEASON_ID,seasonName:CURRENT_SEASON_NAME,timezone:'America/Porto_Velho',rows});
  } catch(e) {
    console.error('[ranking] consulta falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o ranking agora.'});
  }
});

// V51.0 — perfil individual autenticado, somente agregações dos resultados já existentes.
app.get('/api/me/stats', async (req,res)=>{
  try {
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre na sua conta para ver seu perfil.'});
    const period=normalizePeriod(req.query.period||'season');
    const mode=normalizeMode(req.query.mode);
    if(!(await ensureRankingReady()))throw new Error('Armazenamento do ranking indisponível.');
    const stats=await rankingStore.getDetailedPlayerStats({playerKey:session.playerKey,period,mode});
    res.setHeader('Cache-Control','private, no-store');
    res.json({ok:true,period,mode,seasonName:CURRENT_SEASON_NAME,stats:{...stats,
      name:stats?.name||session.name}});
  }catch(e){
    console.error('[ranking] perfil estatístico falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar suas estatísticas.'});
  }
});

// V51.0.1 — perfil público de resultados de jogador do ranking, apenas para contas autenticadas.
// Nunca retorna mãos, cartas ou outros dados privados de partida.
app.get('/api/players/stats', async (req,res)=>{
  try {
    res.setHeader('Cache-Control','private, no-store');
    const session=await authFromCookieHeaderVerified(req.headers.cookie);
    if(!session)return res.status(401).json({ok:false,message:'Entre na sua conta para consultar perfis.'});
    const playerKey=String(req.query.playerKey||'').trim();
    if(!playerKey||playerKey.length>80)return res.status(400).json({ok:false,message:'Jogador inválido.'});
    const period=normalizePeriod(req.query.period||'season');
    const mode=normalizeMode(req.query.mode);
    if(!(await ensureRankingReady()))throw new Error('Armazenamento do ranking indisponível.');
    const stats=await rankingStore.getDetailedPlayerStats({playerKey,period,mode});
    res.json({ok:true,period,mode,seasonName:CURRENT_SEASON_NAME,stats});
  }catch(e){
    console.error('[ranking] consulta de jogador falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o perfil do jogador.'});
  }
});

app.get('/api/profile', async (req,res)=>{
  try {
    const playerKey=String(req.query.playerKey||'').trim().slice(0,80);
    if(!playerKey) return res.status(400).json({ok:false,message:'Jogador não informado.'});
    const period=normalizePeriod(req.query.period||'season');
    const mode=normalizeMode(req.query.mode);
    if(!(await ensureRankingReady())) throw new Error('Armazenamento do ranking indisponível.');
    const category=['performance','skill'].includes(req.query.category)?req.query.category:'wins';
    const stats=category==='skill'?await rankingStore.getSkillPlayerStats({playerKey,period,mode})
      :category==='performance'?await rankingStore.getPerformancePlayerStats({playerKey,period,mode})
      :await rankingStore.getPlayerStats({playerKey,period,mode});
    res.setHeader('Cache-Control','private, no-store');
    res.json({ok:true,period,mode,category,seasonId:CURRENT_SEASON_ID,seasonName:CURRENT_SEASON_NAME,stats});
  } catch(e) {
    console.error('[ranking] perfil falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o perfil agora.'});
  }
});

function roomCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do {
    code='';
    for(let i=0;i<6;i++)code+=chars[crypto.randomInt(0,chars.length)];
  } while(rooms.has(code) || roomSnapshotStore.isRoomDeleted(code));
  return code;
}

function maybeRecordFinished(room) {
  if (!room || room.status !== 'finished' || room.rankingRecorded || room.rankingRecording) return;
  // Um erro anterior exige nova tentativa controlada, não um loop de broadcasts.
  if(Number(room.rankingRetryAt||0)>Date.now())return;
  const matchSerial=Number(room.matchSerial||1);
  // O resultado final precisa continuar imutável caso um jogador saia
  // da mesa enquanto o PostgreSQL estiver temporariamente indisponível.
  // A identificação da partida evita reutilização na revanche seguinte.
  const freshRecord=room.tournament
    ?TournamentForfeit.tournamentMatchRecord(room,buildMatchRecord(room))
    :buildMatchRecord(room);
  const record=room.pendingRankingRecord?.matchId===freshRecord.matchId
    ?room.pendingRankingRecord
    :freshRecord;
  room.pendingRankingRecord=record;
  if(room.tournament){
    room.rankingRecording=true;
    room.rankingProcessingSince=Date.now();
    room.rankingRetryAt=0;
    let stage='snapshot final do torneio';
    const operation=Promise.resolve(roomSnapshotStore.saveNow(room)).then(saved=>{
      if(saved===false)throw new Error('Snapshot final do torneio não persistido; resultado permanece pendente.');
      stage='inicialização do torneio';
      return ensureTournamentBracketReady();
    }).then(async ok=>{
      if(!ok)throw new Error('Resultados do torneio indisponíveis.');
      stage='gravação e avanço do torneio';
      const phase=room.tournament.phase||'qualifier';
      const roster=room.tournament.rosterKeys.map(playerKey=>{
        const p=room.players.find(x=>x.playerKey===playerKey);
        return {playerKey,name:p?.name||record.results.find(x=>x.playerKey===playerKey)?.name||'Jogador'};
      });
      await recordTournamentResult({bracket:tournamentBracket,games:tournamentGames,
        id:room.tournament.id,phase,number:room.tournament.tableNumber,
        roomCode:room.code,record,roster});
      const initial=await tournamentDraw.get(room.tournament.id);
      const advanced=await tournamentBracket.advance(room.tournament.id,initial);
      // A primeira mesa pode terminar antes das demais. Comunicar somente
      // resultados já persistidos; empates na linha de corte continuam pendentes.
      if(!advanced.champion&&advanced.currentStage===phase){
        const currentRows=(await tournamentBracket.rows(room.tournament.id)).filter(r=>r.stage===phase);
        const quota=nextStage(phase,currentRows)?.quota;
        const currentRow=currentRows.find(r=>Number(r.number)===Number(room.tournament.tableNumber));
        if(quota&&currentRow?.result?.results){
          const remainingTables=currentRows.filter(r=>!r.result).length;
          for(const player of currentRow.result.results){
            const outcome=TournamentQualifiedWait.outcomeForPlayer(currentRow.result.results,quota,player.playerKey);
            if(outcome)emitToPlayerKey(player.playerKey,'tournamentTableOutcome',{
              tournamentId:room.tournament.id,stage:phase,tableNumber:room.tournament.tableNumber,
              status:outcome.status,remainingTables
            });
          }
        }
      }
      if(advanced.champion){
        if(!await ensureTournamentPodiumReady())throw new Error('Nao foi possivel persistir o podio final.');
        const event=await tournamentCatalog.get(room.tournament.id);
        if(!event)throw new Error('Torneio sem cadastro ao tentar registrar o podio.');
        await tournamentPodiumArchive.record({id:event.id,name:event.name,champion:advanced.champion});
      }
      if(!advanced.champion&&advanced.currentStage!==phase){
        const next=advanced.stages.find(stage=>stage.stage===advanced.currentStage);
        try{await notifyTournamentSeats(room.tournament.id,advanced.currentStage,next?.tables||[]);}
        catch(e){console.error('[tournament] aviso da fase seguinte falhou; avanço preservado:',e.message);}
      }
    });
    RankingFinalization.withTimeout(operation,{
      timeoutMs:RankingFinalization.finalizationTimeoutMs(),getStage:()=>stage,
    }).then(()=>{
      if(Number(room.matchSerial||1)===matchSerial){
        room.rankingRecorded=true;room.rankingRecording=false;
        room.rankingProcessingSince=0;room.rankingRetryAt=0;room.rankingFailureCount=0;
        Engine.appendLog(room,'🏆 Resultado da mesa registrado no torneio, sem alterar o Ranking Oficial.','system');
        roomSnapshotStore.delete(room.code).catch(e=>console.error('[tournament] snapshot',e));
      }
    }).catch(e=>{
      console.error('[tournament] gravação de resultado falhou; nova tentativa automática',room.code,e?.message||e);
      if(Number(room.matchSerial||1)!==matchSerial)return;
      room.rankingRecording=false;room.rankingProcessingSince=0;
      room.rankingLastFailureAt=Date.now();
      room.rankingFailureCount=Math.max(0,Number(room.rankingFailureCount)||0)+1;
      room.rankingRetryAt=Date.now()+RankingFinalization.retryDelayMs(room.rankingFailureCount);
    });
    return;
  }
  if (!record.results.length) {
    // Não permitir revanche com uma partida marcada como registrada sem
    // nenhuma linha no histórico! Preserva o resultado pendente e informa a
    // inconsistência para investigação (sem fabricar ou apagar vitórias).
    room.rankingRecorded=false;
    room.rankingRecording=false;
    room.rankingLastFailureAt=Date.now();
    room.rankingFailureCount=Math.max(0,Number(room.rankingFailureCount)||0)+1;
    room.rankingRetryAt=Date.now()+60000;
    console.error('[ranking] resultado sem participantes elegíveis; registro NÃO confirmado',room.code,record.matchId);
    if(rooms.get(room.code)===room){
      Engine.appendLog(room,'⚠️ Resultado pendente: não há participantes identificados para registrar no ranking.','system');
      emitRoom(room);
    }
    return;
  }
  room.rankingRecording=true;
  room.rankingRetryAt=0;
  room.rankingProcessingSince=Date.now();
  let stage='snapshot final';
  // V49.9 — primeiro persiste o resultado final ainda pendente. Se o processo cair
  // antes do COMMIT do ranking, o boot restaura este snapshot e tenta novamente.
  // O timeout cobre TAMBÉM uma Promise que nunca resolve, sem registrar vitória
  // antecipadamente. Repetir o mesmo matchId é idempotente no PostgreSQL/JSON.
  const operation=Promise.resolve(roomSnapshotStore.saveNow(room)).then(saved=>{
    if(saved===false)throw new Error('Snapshot final não persistido; resultado continua pendente.');
    stage='inicialização do ranking';
    return ensureRankingReady();
  }).then(ready=>{
    if(!ready)throw new Error('Armazenamento do ranking indisponível.');
    stage='confirmação do resultado';
    return rankingStore.recordMatch(record);
  });
  RankingFinalization.withTimeout(operation,{
    timeoutMs:RankingFinalization.finalizationTimeoutMs(),getStage:()=>stage,
  }).then(inserted=>{
    if(Number(room.matchSerial||1)===matchSerial){
      room.rankingRecorded=true;
      room.rankingRecording=false;
      room.rankingRetryAt=0;
      room.rankingFailureCount=0;
      room.rankingLastFailureAt=0;
      room.rankingProcessingSince=0;
      if(inserted) Engine.appendLog(room, `🏆 Vitória registrada no ranking ${record.mode==='official'?'OFICIAL':'TREINO'}.`, 'system');
      // Sem mudar a sala ou o código de convite: comunicar aos jogadores que
      // o resultado foi confirmado e iniciar a revanche se todos já votaram.
      // A fila de snapshots ordena a confirmação e o início da nova partida.
      if(rooms.get(room.code)===room){
        roomSnapshotStore.saveNow(room).catch(e=>console.error('[ranking] falha ao confirmar snapshot final',room.code,e?.message||e));
        emitRoom(room);
      }
    }
  }).catch(e=>{
    console.error(`[ranking] resultado ${record.matchId}, etapa ${stage}:`,e);
    if(Number(room.matchSerial||1)!==matchSerial)return;
    room.rankingRecording=false;
    room.rankingProcessingSince=0;
    room.rankingLastFailureAt=Date.now();
    room.rankingFailureCount=Math.max(0,Number(room.rankingFailureCount)||0)+1;
    room.rankingRetryAt=Date.now()+RankingFinalization.retryDelayMs(room.rankingFailureCount);
    // Enviar um estado CLARO sobre o erro. emitRoom respeita rankingRetryAt,
    // portanto não inicia nova gravação em loop; o timer fará o próximo retry.
    if(rooms.get(room.code)===room)emitRoom(room);
  });
}

// V40.69.8.1 — mesmo sem jogadas/eventos Socket.IO depois do término,
// uma vitória pendente é reenviada quando a conexão voltar. O matchId é
// idempotente no PostgreSQL; rankingRecording impede tentativas paralelas.
const rankingRecoveryTimer=setInterval(()=>{
  for(const room of rooms.values()){
    if(room.status==='finished'&&!room.rankingRecorded&&!room.rankingRecording)maybeRecordFinished(room);
  }
},15000);
rankingRecoveryTimer.unref?.();

// V40.52 — imagens personalizadas deixam de viajar dentro de cada estado da sala.
// O estado usa uma referência curta por conteúdo; o arquivo é enviado uma única vez
// por socket e pode ser solicitado novamente pelo cliente se o cache local estiver vazio.
function emitRoomAvatarAssets(socket, room, requestedRefs=null) {
  if (!socket || !room) return;
  const assets=AvatarWire.collectRoomAvatarAssets(room);
  if (!(socket.data.avatarAssetRefsSent instanceof Set)) socket.data.avatarAssetRefsSent=new Set();
  const sent=socket.data.avatarAssetRefsSent;
  const requested=Array.isArray(requestedRefs)
    ? new Set(InputSafety.firstSafeStrings(requestedRefs,{maxItems:16,maxLength:64,filter:AvatarWire.isCustomAvatarRef}))
    : null;
  for (const [ref,dataUrl] of assets) {
    const explicitlyRequested=!!(requested&&requested.has(ref));
    if (requested && !explicitlyRequested) continue;
    if (!requested && sent.has(ref)) continue;
    socket.emit('avatarAsset',{ref,dataUrl});
    sent.add(ref);
  }
}

// Processamento síncrono: a verificação e a ocupação da cadeira são atômicas
// dentro do event loop Node. Uma queda breve não elimina o pedido da fila;
// a vaga só é atribuída a um observador efetivamente conectado.
function processSpectatorSeatRequests(room){
  if(room.status!=='between-rounds'||room.tournament||!Array.isArray(room.spectatorSeatRequests))return;
  SpectatorSeatAdmission.pruneRestoredSeatRequests(room);
  const requests=room.spectatorSeatRequests.splice(0);
  const awaitingReconnect=[];
  const promotedKeys=[];
  for(const request of requests){
    const spectator=ensureSpectators(room).find(s=>s.id===request.spectatorId&&s.playerKey===request.playerKey);
    if(!spectator){
      // Após restart, aguarda o observador provar a posse da mesma conta.
      if(request.spectatorId===null && Number(request.recoveryExpiresAt||0)>Date.now())
        awaitingReconnect.push(request);
      continue;
    }
    if(!spectator.connected||!spectator.socketId){awaitingReconnect.push(request);continue;}
    const target=io.sockets.sockets.get(spectator.socketId);
    if(!target||target.data.role!==ROLE_SPECTATOR||target.data.spectatorId!==spectator.id
        ||target.data.roomCode!==room.code||target.data.auth?.playerKey!==spectator.playerKey){
      awaitingReconnect.push(request);continue;
    }
    if(room.players.some(p=>!p.isBot&&p.playerKey===spectator.playerKey)||!roomHasInviteCapacity(room,spectator.playerKey)){
      target.emit('spectatorSeatStatus',{status:'rejected',message:'A vaga não está mais disponível.'});continue;
    }
    let player;
    try{player=Engine.addPlayer(room,{socketId:target.id,token:crypto.randomUUID(),name:spectator.name,avatar:spectator.avatar,playerKey:spectator.playerKey});}
    catch(e){target.emit('spectatorSeatStatus',{status:'rejected',message:e.message});continue;}
    removeSpectator(room,spectator,{announce:false});
    // A confirmação definitiva e o emitRoom seguinte atualizarão as vagas;
    // evitar emitir uma situação transitória enquanto a fila é processada.
    ensureInviteReservations(room).delete(spectator.playerKey);
    promotedKeys.push(spectator.playerKey);
    target.data.role=ROLE_PLAYER;target.data.playerId=player.id;target.data.spectatorId=null;
    updatePresenceFromSocket(target,{name:player.name,avatar:player.avatar});
    target.emit('joined',{code:room.code,playerId:player.id,token:player.token,role:ROLE_PLAYER,source:'spectator-promotion'});
    target.emit('spectatorSeatStatus',{status:'accepted',message:'Você entrou como jogador na próxima rodada.'});
    Engine.appendLog(room,`👤 ${player.name} passou de observador a jogador.`, 'system');
  }
  // Preserva a ordem original dos pedidos de quem ainda está no prazo de reconexão.
  // Não reserva uma cadeira: observadores conectados continuam podendo disputar
  // vagas livres, com validação efetiva ao entrar.
  room.spectatorSeatRequests.unshift(...awaitingReconnect);
  for(const key of promotedKeys){
    // Convite aceito para a mesma sala não pode permanecer como se ainda
    // houvesse uma cadeira reservada depois da conversão do observador.
    const invite=[...invitations.values()].find(i=>i.toKey===key&&i.targetRoomCode===room.code&&['accepted-waiting','ready'].includes(i.status));
    if(invite)completeInvite(invite,'✅ Você entrou na mesa como jogador.');
  }
}

// A fila é efêmera: quando já não existe próxima rodada, os pedidos
// restantes são cancelados e não ficam presos na interface.
function clearClosedSpectatorSeatRequests(room){
  if(SpectatorSeatAdmission.isEligibleRound(room)||!Array.isArray(room.spectatorSeatRequests)||!room.spectatorSeatRequests.length)return;
  const pending=room.spectatorSeatRequests.splice(0);
  for(const req of pending){
    const spectator=ensureSpectators(room).find(s=>s.id===req.spectatorId&&s.playerKey===req.playerKey);
    const target=spectator?.socketId&&io.sockets.sockets.get(spectator.socketId);
    if(target?.data?.role===ROLE_SPECTATOR&&target.data.spectatorId===spectator.id)
      target.emit('spectatorSeatStatus',{status:'rejected',message:'A partida não tem mais rodadas disponíveis para novas entradas.'});
  }
}

// Envia apenas a situação individual da vaga quando um convite é reservado
// ou liberado; não precisa reenviar o histórico, cartas ou estado inteiro.
function notifySpectatorsSeatAvailability(room){
  if(!room)return;
  ensureInviteReservations(room);
  for(const spectator of ensureSpectators(room)){
    if(!spectator.connected||!spectator.socketId)continue;
    const target=io.sockets.sockets.get(spectator.socketId);
    if(target?.data?.role!==ROLE_SPECTATOR||target.data.spectatorId!==spectator.id)continue;
    target.emit('spectatorSeatAvailability',SpectatorSeatAdmission.seatStatus(room,spectator));
  }
}

function maybeResolveTournamentLobbyWalkover(room,{now=Date.now()}={}){
  if(!room?.tournament||room.status!=='lobby'||Number(room.round||0)!==0)return false;
  if(tournamentLobbyWalkoverLocks.has(room.code))return false;
  const t=room.tournament;
  const rosterKeys=Array.isArray(t.rosterKeys)?t.rosterKeys.filter(Boolean):[];
  const deadline=Number(t.waitDeadlineAt||0);
  if(rosterKeys.length<2||!(deadline>0)||now<deadline)return false;
  const roster=(Array.isArray(t.rosterNames)&&t.rosterNames.length===rosterKeys.length?t.rosterNames:
    rosterKeys.map(playerKey=>({playerKey,name:room.players.find(p=>p.playerKey===playerKey)?.name||'Jogador'})));
  const presentPlayers=room.players.filter(p=>!p.isBot&&p.connected&&rosterKeys.includes(p.playerKey));
  const present=[...new Set(presentPlayers.map(p=>p.playerKey))];
  const plan=TournamentWait.decide({roster,present,deadline,now});
  if(plan.action!=='needs-attention'||plan.present!==1)return false;
  const winner=presentPlayers.find(p=>p.playerKey===present[0]);
  if(!winner)return false;
  tournamentLobbyWalkoverLocks.add(room.code);
  try{
    if(!Array.isArray(t.forfeits))t.forfeits=[];
    for(const absent of plan.missing){
      if(!t.forfeits.some(f=>f.playerKey===absent.playerKey))
        TournamentForfeit.recordForfeit(room,{playerKey:absent.playerKey,name:absent.name,score:0},now);
    }
    room.players=room.players.filter(p=>!p.isBot&&p.playerKey===winner.playerKey);
    if(!room.players.length)return false;
    room.players[0].connected=true;
    room.players[0].host=true;
    room.status='finished';
    room.finishedAt=now;
    room.currentPlayer=-1;
    room.winnerId=room.players[0].id;
    room.pendingSeven=0;
    room.finishPendingSeven=false;
    room.requestedSuit=null;
    room.continuationPlayerId=null;
    room.lastWinnerCard=null;
    room.reactionNextPlayerId=null;
    room.reactionSourcePlayerId=null;
    room.lastPlayedById=null;
    room.burnTopCardId=null;
    room.reactionTopCardId=null;
    room.lastPass=null;
    room.openingReaction=false;
    Engine.appendLog(room,`🏆 ${room.players[0].name} venceu a mesa por ausência dos demais participantes após o prazo de espera da mesa.`,'system');
    return true;
  }catch(e){
    console.error('[tournament] falha ao aplicar vitória por ausência',room.code,e?.message||e);
    return false;
  }finally{tournamentLobbyWalkoverLocks.delete(room.code);}
}

// Fase 4A: cada cliente mantém seu próprio último state; a sala continua
// gerando estados privados separados e preserva todos os efeitos de emitRoom.
function emitRoom(room) {
  maybeResolveTournamentLobbyWalkover(room);
  SpectatorSeatAdmission.pruneRestoredSeatRequests(room);
  clearClosedSpectatorSeatRequests(room);
  if(room.status==='between-rounds'&&Array.isArray(room.spectatorSeatRequests)&&room.spectatorSeatRequests.length)processSpectatorSeatRequests(room);
  maybeRecordFinished(room);
  // O fim da gravação no ranking e as reconexões podem completar as
  // confirmações sem um novo clique. A transição é síncrona e ocorre uma vez.
  if(room.status==='finished'&&room.rankingRecorded)maybeStartReplay(room);
  // V40.68.1 — toda partida ativa sem nenhum humano conectado recebe apenas
  // 5 minutos de reserva. O marco é salvo no snapshot e não reinicia após deploy.
  refreshOfflineRoomExpiry(room);
  for (const p of room.players) {
    if (!p.socketId) continue;
    const target=io.sockets.sockets.get(p.socketId);
    if (!target) continue;
    emitRoomAvatarAssets(target,room);
    StateDelivery.emitState(target,`PLAYER:${room.code}:${Number(room.matchSerial||1)}:${p.id}`,AvatarWire.leanStateAvatars(Engine.roomPublicState(room,p.id)));
  }
  ensureSpectators(room);
  for (const spectator of room.spectators) {
    if (!spectator.connected || !spectator.socketId) continue;
    const target=io.sockets.sockets.get(spectator.socketId);
    if (!target) continue;
    emitRoomAvatarAssets(target,room);
    const spectatorState=Engine.roomSpectatorState(room,spectator);
    ensureInviteReservations(room);
    spectatorState.tournamentSpectator=!!room.tournament;
    if(room.tournament){
      spectatorState.roundReview=null; // Nunca enviar mãos reveladas a espectadores do torneio.
      spectatorState.spectatorSeat={eligible:false,canRequest:false,status:'unavailable'};
    }else spectatorState.spectatorSeat=SpectatorSeatAdmission.seatStatus(room,spectator);
    StateDelivery.emitState(target,`SPECTATOR:${room.code}:${Number(room.matchSerial||1)}:${spectator.id}`,AvatarWire.leanStateAvatars(spectatorState));
  }
  scheduleBotTurn(room);
  refreshInviteReadiness();
  const presenceSignature=`${room.status}:${room.round}:${room.players.map(p=>`${p.id}:${p.isBot?'b':'h'}`).join(',')}`;
  if(room._presenceSignature!==presenceSignature){room._presenceSignature=presenceSignature;setTimeout(broadcastPresence,0);}
  // V49.9 — transições estruturais (início/fim de rodada, replay e fim da partida)
  // são persistidas imediatamente; jogadas comuns continuam usando debounce de 250 ms.
  const criticalSignature=`${room.status}:${Number(room.round||0)}:${Number(room.matchSerial||1)}:${room.rankingRecorded?1:0}`;
  if(criticalSnapshotSignatures.get(room.code)!==criticalSignature){
    criticalSnapshotSignatures.set(room.code,criticalSignature);
    roomSnapshotStore.saveNow(room).catch(e=>console.error('[rooms] falha ao salvar transição crítica',room.code,e?.message||e));
  }else roomSnapshotStore.queueSave(room);
}

function reconnectTimerKey(roomCode, playerId) { return `${roomCode}:${playerId}`; }
function cancelReconnectTimer(roomCode, playerId) {
  const key=reconnectTimerKey(roomCode,playerId);
  const timer=reconnectTimers.get(key);
  if(timer) clearTimeout(timer);
  reconnectTimers.delete(key);
}
function clearReconnectTimersForRoom(roomCode) {
  const prefix=`${roomCode}:`;
  for(const [key,timer] of reconnectTimers){
    if(key.startsWith(prefix)){ clearTimeout(timer); reconnectTimers.delete(key); }
  }
}

function cancelOfflineRoomExpiry(roomCode,{clearState=true}={}) {
  const entry=offlineRoomExpiryTimers.get(roomCode);
  if(entry?.timer)clearTimeout(entry.timer);
  offlineRoomExpiryTimers.delete(roomCode);
  if(clearState){
    const room=rooms.get(roomCode);
    if(room){
      room.allHumansOfflineStartedAt=null;
      // Campo legado V40.61.1: limpo junto para não ressuscitar prazo antigo.
      room.soloDisconnectStartedAt=null;
    }
  }
}

function refreshOfflineRoomExpiry(room) {
  if(!room)return false;
  if(!RoomLifecycle.allHumansDisconnected(room)){
    cancelOfflineRoomExpiry(room.code,{clearState:true});
    return false;
  }

  const humans=(room.players||[]).filter(p=>p&&!p.isBot);
  const legacyStartedAt=Number(room.soloDisconnectStartedAt||0);
  const stored=Number(room.allHumansOfflineStartedAt||0);
  const disconnectedTimes=humans.map(p=>Number(p.disconnectedAt||0)).filter(n=>n>0);
  // A sala fica totalmente offline quando o ÚLTIMO humano desconecta.
  const detectedStartedAt=disconnectedTimes.length?Math.max(...disconnectedTimes):Date.now();
  const startedAt=stored>0?stored:(legacyStartedAt>0?legacyStartedAt:detectedStartedAt);
  room.allHumansOfflineStartedAt=startedAt;
  // Preservamos o campo legado apenas para sala solo, garantindo migração suave.
  room.soloDisconnectStartedAt=humans.length===1?startedAt:null;

  const deadline=startedAt+ALL_HUMANS_OFFLINE_EXPIRY_MS;
  const current=offlineRoomExpiryTimers.get(room.code);
  if(current&&current.deadline===deadline)return true;
  if(current?.timer)clearTimeout(current.timer);

  const timer=setTimeout(async()=>{
    offlineRoomExpiryTimers.delete(room.code);
    const liveRoom=rooms.get(room.code);
    if(!liveRoom)return;
    if(!RoomLifecycle.allHumansDisconnected(liveRoom))return refreshOfflineRoomExpiry(liveRoom);
    const liveStartedAt=Number(liveRoom.allHumansOfflineStartedAt||liveRoom.soloDisconnectStartedAt||0);
    if(liveStartedAt!==startedAt)return refreshOfflineRoomExpiry(liveRoom);
    if(Date.now()<deadline)return refreshOfflineRoomExpiry(liveRoom);
    if(TournamentRoomRetention.hasPendingTournamentResult(liveRoom)){
      maybeRecordFinished(liveRoom);
      return; // A limpeza das salas só é permitida após confirmação da classificação.
    }

    if(liveRoom.botTimer){clearTimeout(liveRoom.botTimer);liveRoom.botTimer=null;}
    clearReconnectTimersForRoom(liveRoom.code);
    closeSpectatorsForRoom(liveRoom,'A sala foi encerrada após 5 minutos sem nenhum jogador humano conectado.');
    clearSpectatorReconnectTimersForRoom(liveRoom.code);
    invalidateInvitesForRoom(liveRoom.code);
    try{
      await removeRoomDurably(liveRoom.code,Date.now(),'A sala foi encerrada após 5 minutos sem nenhum jogador humano conectado.');
      broadcastPresence();
    }catch(e){
      console.error('[rooms] falha ao excluir sala sem humanos conectados após 5 minutos',liveRoom.code,e?.message||e);
      // Persistência indisponível: preservamos o marco original e tentamos novamente
      // em 30 s, sem conceder uma nova janela de 5 minutos.
      const retry=setTimeout(()=>{
        offlineRoomExpiryTimers.delete(liveRoom.code);
        refreshOfflineRoomExpiry(liveRoom);
      },30000);
      retry.unref?.();
      offlineRoomExpiryTimers.set(liveRoom.code,{timer:retry,deadline,startedAt});
    }
  },Math.max(0,deadline-Date.now()));
  timer.unref?.();
  offlineRoomExpiryTimers.set(room.code,{timer,deadline,startedAt});
  return true;
}

function roomWaitingForReconnect(room) {
  return !!(room && room.status==='playing' && room.players.some(p=>!p.isBot&&!p.connected&&!p.autoControlled&&p.reconnectEligible));
}
function requireRoundNotPaused(room) {
  if(roomWaitingForReconnect(room)) throw new Error('Partida pausada: aguardando a reconexão de um jogador.');
}
function isAutomatedPlayer(player) { return !!(player && (player.isBot || player.autoControlled)); }

// V40.42 — recuperação segura de falha do bot/AUTO.
// Nunca altera currentPlayer diretamente. Se a estratégia automática falhar,
// a cadeira realiza uma ação legal de contingência (comprar/passar). Se até a
// contingência falhar, a vez permanece onde está para não pular ninguém.
function recoverAutomatedTurn(room, player) {
  if(!room || room.status!=='playing' || !player) return false;
  if(room.players[room.currentPlayer]?.id!==player.id) return false;
  try {
    player.declaration=null;
    if(room.pendingSeven>0){
      Engine.drawAction(room,player.id);
      return true;
    }
    if(room.continuationPlayerId===player.id){
      if(player.justDrawnCardId){
        Engine.passTurn(room,player.id);
        return true;
      }
      try {
        Engine.passTurn(room,player.id);
        return true;
      } catch {
        Engine.drawAction(room,player.id);
        if(room.status==='playing' && room.players[room.currentPlayer]?.id===player.id) Engine.passTurn(room,player.id);
        return true;
      }
    }
    if(player.justDrawnCardId){
      Engine.passTurn(room,player.id);
      return true;
    }
    Engine.drawAction(room,player.id);
    if(room.status==='playing' && room.players[room.currentPlayer]?.id===player.id) Engine.passTurn(room,player.id);
    return true;
  } catch(recoveryError) {
    Engine.appendLog(room, `A recuperação automática de ${player.name} falhou sem avançar a vez: ${recoveryError.message}`, 'system');
    return false;
  }
}

function scheduleReconnectTakeover(room, player) {
  const matchActive=room && (room.status==='playing' || (room.status==='between-rounds' && room.round>0));
  if(!matchActive || !RoomLifecycle.canAutoReconnect(player)) return;
  if(room.tournament){
    // Não existe AUTO nem Máquina em torneio: após a tolerância de reconexão,
    // quem ainda estiver ausente desiste, desde que haja adversário conectado.
    cancelReconnectTimer(room.code,player.id);
    const key=reconnectTimerKey(room.code,player.id);
    const check=async()=>{
      reconnectTimers.delete(key);
      const liveRoom=rooms.get(room.code);
      const stale=liveRoom?.players.find(p=>p.id===player.id);
      if(!liveRoom||liveRoom!==room||!RoomLifecycle.isActiveMatch(liveRoom)||
         !stale||stale.connected||!stale.reconnectEligible)return;
      if(!liveRoom.players.some(p=>p.id!==stale.id&&p.connected&&!p.isBot)){
        // Não declarar vencedor se todos estiverem sem conexão.
        const retry=setTimeout(()=>void check(),15000);retry.unref?.();
        reconnectTimers.set(key,retry);return;
      }
      try{
        await abandonHumanSeatDurably(liveRoom,stale,{reason:'não retornou no prazo de reconexão e desistiu do torneio'});
        broadcastPresence();
      }catch(e){console.error('[tournament] falha ao registrar desistência após desconexão',e);}
    };
    const timer=setTimeout(()=>void check(),Math.max(0,Number(player.reconnectDeadlineAt||Date.now())-Date.now()));
    timer.unref?.();reconnectTimers.set(key,timer);return;
  }
  cancelReconnectTimer(room.code,player.id);
  const key=reconnectTimerKey(room.code,player.id);
  const delay=Math.max(0,Number(player.reconnectDeadlineAt||Date.now())-Date.now());
  const timer=setTimeout(async ()=>{
    reconnectTimers.delete(key);
    const liveRoom=rooms.get(room.code);
    if(!liveRoom || liveRoom!==room || !(liveRoom.status==='playing' || (liveRoom.status==='between-rounds' && liveRoom.round>0))) return;
    const stale=liveRoom.players.find(p=>p.id===player.id);
    if(!stale || stale.autoControlled || !RoomLifecycle.markAutoTakeover(stale)) return;
    Engine.appendLog(liveRoom, `🤖 ${stale.name} não retornou em 60 segundos. A Máquina assumiu temporariamente suas jogadas.`, 'system');
    io.to(liveRoom.code).emit('reconnectionEvent',{kind:'auto',playerId:stale.id,name:stale.name});
    emitRoom(liveRoom);
    broadcastPresence();
  },delay);
  if(typeof timer.unref==='function') timer.unref();
  reconnectTimers.set(key,timer);
}

function scheduleBotTurn(room) {
  if (!room || room.status !== 'playing' || room.botTimer || room.tournament) return;
  // Durante os 60 s de tolerância, ninguém joga. Depois, a vaga desconectada
  // passa a ser tratada pelo mesmo motor da Máquina, sem virar um jogador-bot.
  if (roomWaitingForReconnect(room)) return;
  // Se todos os humanos estiverem fora, não há motivo para a mesa se jogar sozinha.
  // A automação volta a andar assim que pelo menos uma pessoa reconectar.
  if (!room.players.some(p => !p.isBot && p.connected)) return;

  // Queima pertence somente ao jogador da vez, inclusive na abertura.
  // Robôs fora da vez podem usar exclusivamente Ação Rápida.
  const turnBot = room.players[room.currentPlayer];
  const burnBot = isAutomatedPlayer(turnBot) && !turnBot.finishedRound && Engine.canBurnMatch(room,turnBot).length > 0 ? turnBot : null;
  const quickBot = room.players.find(p => isAutomatedPlayer(p) && !p.finishedRound && p.id !== turnBot?.id && Engine.canQuickAction(room,p).length > 0);
  const actingBot = burnBot || quickBot || (isAutomatedPlayer(turnBot) && !turnBot.finishedRound ? turnBot : null);
  if (!actingBot) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const liveRoom = rooms.get(room.code);
    if (!liveRoom || liveRoom !== room || liveRoom.status !== 'playing') return;
    // V40.68.1 — proteção dupla: mesmo que um timer antigo tenha escapado de uma
    // microqueda, nenhuma Máquina/AUTO executa jogada sem humano conectado.
    if (!liveRoom.players.some(p => !p.isBot && p.connected)) return;
    const liveBot = liveRoom.players.find(p => p.id === actingBot.id);
    if (!isAutomatedPlayer(liveBot) || liveBot.finishedRound) return;

    const isCurrentTurn = liveRoom.players[liveRoom.currentPlayer]?.id === liveBot.id;
    try {
      const burns = Engine.canBurnMatch(liveRoom, liveBot);
      const quicks = burns.length ? [] : Engine.canQuickAction(liveRoom, liveBot);
      if (burns.length) BotPlayer.takeBurnOpportunity(liveRoom, liveBot, Engine);
      else if (quicks.length) BotPlayer.takeQuickActionOpportunity(liveRoom, liveBot, Engine);
      else if (isCurrentTurn) BotPlayer.takeTurn(liveRoom, liveBot, Engine);
      else { emitRoom(liveRoom); return; }
    } catch (e) {
      Engine.appendLog(liveRoom, `${liveBot.name} encontrou uma jogada automática inválida: ${e.message}`, 'system');
      // V40.42: jamais pulamos a cadeira alterando currentPlayer diretamente.
      // Se era a vez normal do bot/AUTO, usamos somente ações válidas da Engine
      // (comprar/passar) como contingência. Se elas também falharem, a vez fica parada.
      if (isCurrentTurn) {
        const recovered=recoverAutomatedTurn(liveRoom,liveBot);
        if(recovered) Engine.appendLog(liveRoom, `${liveBot.name} concluiu a vez pela recuperação automática segura.`, 'system');
      }
    }
    emitRoom(liveRoom);
  }, burnBot ? 750 : quickBot ? 950 : 1250);
  if (typeof room.botTimer.unref === 'function') room.botTimer.unref();
}

function err(socket, e) {
  socket.emit('gameError', {message: e?.message || 'Ocorreu um erro.'});
}

function ensureHost(room) {
  const humans = room.players.filter(p => !p.isBot);
  if (!humans.length) return;
  const hosts = humans.filter(p => p.host);
  if (hosts.length === 1) return;
  room.players.forEach(p => { p.host = false; });
  const nextHost = humans.find(p => p.connected) || humans[0];
  if (nextHost) nextHost.host = true;
}

function maybeStartReplay(room) {
  // Não perder a cadeira de quem está no prazo de reconexão: só jogadores que
  // saíram voluntariamente (e foram removidos) deixam de votar.
  if(!ReplaySession.canStartReplay(room))return false;
  ensureHost(room);
  Engine.resetMatch(room);
  // V40.58.3 — a conversa é da sala. Revanche na mesma sala preserva o
  // histórico; somente uma sala diferente recebe uma conversa diferente.
  Engine.startRound(room);
  Engine.appendLog(room, '🎮 Todos confirmaram. A revanche começou!', 'system');
  return true;
}

function nextBotInfo(room) {
  const bots = room.players.filter(p => p.isBot);
  const avatars = ['preta','costela','perna','homem','mulher','telaazul','caldo','anao','anaocabecao','vesgo','magreloverde'];
  const n = bots.length + 1;
  return {
    socketId: null,
    name: n === 1 ? 'Máquina' : `Máquina ${n}`,
    avatar: avatars[(n-1) % avatars.length],
    isBot: true,
  };
}

function addBotToRoom(room) {
  // Defesa em profundidade: nenhum caminho (evento Socket.IO ou função interna)
  // pode adicionar jogadores automáticos a uma mesa oficial de torneio.
  if(room?.tournament)throw new Error('Máquinas não podem ocupar vagas em torneios.');
  const bot = Engine.addPlayer(room, nextBotInfo(room));
  bot.connected = true;
  bot.socketId = null;
  bot.host = false;
  Engine.appendLog(room, `${bot.name} entrou na mesa como jogador automático.`, 'system');
  return bot;
}

// V40.59 — ciclo de vida explícito da vaga humana.
// Desconexão involuntária preserva a identidade para reconexão; saída voluntária
// ou entrada em outra sala encerra definitivamente essa reserva.
function deleteRoomIfNoHumanMembers(room) {
  if(!room || RoomLifecycle.hasHumanMembers(room)) return false;
  return removeRoom(room.code,'A sala foi encerrada porque não restou nenhum jogador humano.');
}

function convertHumanSeatToPermanentBot(room, player, reason='saiu da sala') {
  if(!room||!player||player.isBot)return false;
  if(room.tournament)throw new Error('Máquinas nunca podem substituir participantes de torneio.');
  const oldName=player.name;
  const botInfo=nextBotInfo(room);
  cancelDisconnectDebounce(ROLE_PLAYER,room.code,player.id);
  cancelReconnectTimer(room.code,player.id);
  invalidateInvitesFromPlayerInRoom(player.playerKey,room.code);
  if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
  RoomLifecycle.convertHumanSeatToPermanentBot(player,botInfo,{now:Date.now(),token:crypto.randomUUID()});
  Engine.appendLog(room,`🤖 ${oldName} ${reason}. ${player.name} assumiu a cadeira como Máquina da mesa.`,'system');
  return true;
}

function abandonHumanSeat(room, player, {reason='saiu voluntariamente da sala',socket=null}={}) {
  if(!room||!player||player.isBot)return {changed:false,deleted:false};
  const oldSocketId=player.socketId;
  const oldName=player.name;
  cancelDisconnectDebounce(ROLE_PLAYER,room.code,player.id);
  cancelReconnectTimer(room.code,player.id);
  invalidateInvitesFromPlayerInRoom(player.playerKey,room.code);
  if(oldSocketId && (!socket || oldSocketId!==socket.id)) retireReplacedSocket(oldSocketId,{roomCode:room.code});

  const activeMatch=RoomLifecycle.isActiveMatch(room);
  if(room.tournament && activeMatch){
    TournamentForfeit.forfeitActiveSeat(room,player);
  }else if(room.tournament && room.status==='finished'){
    // Após o fim, preservar a identidade e a pontuação até a gravação do resultado.
    player.connected=false;player.socketId=null;player.reconnectEligible=false;
    player.autoControlled=false;player.voluntaryLeftAt=Date.now();
    Engine.appendLog(room,`${oldName} saiu após o encerramento da mesa.`,'system');
  }else if(activeMatch){
    convertHumanSeatToPermanentBot(room,player,reason);
  }else{
    RoomLifecycle.removeHumanSeat(room,player.id);
    if(Array.isArray(room.replayReadyPlayerIds))room.replayReadyPlayerIds=room.replayReadyPlayerIds.filter(id=>id!==player.id);
    Engine.appendLog(room,`${oldName} ${reason}.`,'system');
  }

  if(deleteRoomIfNoHumanMembers(room))return {changed:true,deleted:true};
  ensureHost(room);
  emitRoom(room);
  return {changed:true,deleted:false};
}

// V40.61 — persistência forte em duas fases. Primeiro gravamos um tombstone da
// associação humana; só depois alteramos a cadeira em memória. Assim, mesmo que o
// processo morra antes do snapshot atualizado, o snapshot antigo não devolve a vaga.
async function abandonHumanSeatDurably(room,player,{reason='saiu voluntariamente da sala',socket=null}={}){
  if(!room||!player||player.isBot)return {changed:false,deleted:false};
  await requireRoomPersistenceReady();
  // A classificação de uma mesa de torneio concluída já está definida.
  // SAIR depois do fim nunca é desistência: preservar elenco e resultado,
  // sem tombstone que possa apagar a identidade durante a restauração.
  if(room.tournament&&room.status==='finished'){
    const result=abandonHumanSeat(room,player,{reason,socket});
    try{if(!room.rankingRecorded)await roomSnapshotStore.saveNow(room);}
    catch(e){console.error('[tournament] snapshot após saída da mesa concluída falhou',room.code,e?.message||e);}
    return result;
  }
  const eventAt=Date.now();
  const playerKey=String(player.playerKey||'');
  if(playerKey)await roomSnapshotStore.markPlayerAbandoned(room.code,playerKey,player.id,eventAt);
  const result=abandonHumanSeat(room,player,{reason,socket});
  try{
    if(result.deleted)await roomSnapshotStore.markRoomDeleted(room.code,eventAt);
    else await roomSnapshotStore.saveNow(room);
  }catch(e){
    // O tombstone do jogador já foi confirmado antes da mutação. Portanto um
    // snapshot anterior continua incapaz de recriar a associação humana, mesmo
    // se esta gravação complementar falhar durante uma queda abrupta do servidor.
    console.error('[rooms] persistência complementar após abandono falhou',room.code,e?.message||e);
  }
  return result;
}

// V40.69.8.48 — a saída temporária do torneio usa as mesmas regras de
// desconexão/ausência. Nunca registra tombstone, forfeit ou troca de jogador.
// A identidade da vaga só é recuperável pela própria conta autenticada.
async function leaveTournamentSeatTemporarily(room,player,socket){
  if(!room?.tournament||!player||player.isBot)throw new Error('Saída temporária válida somente para jogadores de torneios.');
  if(player.playerKey!==socket.data.auth?.playerKey||player.socketId!==socket.id||!player.connected)
    throw new Error('Esta sessão não possui a vaga de jogador informada.');
  await requireRoomPersistenceReady();
  if(player.socketId!==socket.id||!player.connected)throw new Error('A vaga já foi recuperada em outra conexão.');
  const before={connected:player.connected,socketId:player.socketId,disconnectedAt:player.disconnectedAt,
    reconnectEligible:player.reconnectEligible,reconnectDeadlineAt:player.reconnectDeadlineAt,
    autoControlled:player.autoControlled,voluntaryLeftAt:player.voluntaryLeftAt};
  RoomLifecycle.markInvoluntaryDisconnect(player,{now:Date.now(),graceMs:runtimeReconnectGraceMs()});
  try{await roomSnapshotStore.saveNow(room);}
  catch(e){Object.assign(player,before);throw new Error('Não foi possível salvar a reserva da mesa. Tente novamente.');}
  cancelDisconnectDebounce(ROLE_PLAYER,room.code,player.id);
  cancelReconnectTimer(room.code,player.id);
  // O prazo oficial continua igual ao de uma desconexão. A máquina jamais
  // substitui alguém em torneios; se o prazo vencer, aplicam-se as regras atuais.
  if(RoomLifecycle.isActiveMatch(room))scheduleReconnectTakeover(room,player);
  else if(room.status==='lobby'){
    const code=room.code,id=player.id;
    const timer=setTimeout(async()=>{
      reconnectTimers.delete(reconnectTimerKey(code,id));
      const current=rooms.get(code),stale=current?.players.find(p=>p.id===id);
      if(!current||current!==room||!stale||stale.connected||!stale.reconnectEligible||current.status!=='lobby')return;
      // Como no handler de desconexão existente, a reserva pré-partida expira
      // após a tolerância; o roster, sorteio e regras de ausência não mudam.
      current.players=current.players.filter(p=>p.id!==id);
      if(!current.players.length){
        if(current.botTimer)clearTimeout(current.botTimer);
        clearReconnectTimersForRoom(code);closeSpectatorsForRoom(current);
        clearSpectatorReconnectTimersForRoom(code);
        try{await removeRoomDurably(code);}catch(e){console.error('[tournament] falha ao encerrar sala vazia após ausência',e);return;}
        invalidateInvitesForRoom(code);
      }else{ensureHost(current);emitRoom(current);}
      broadcastPresence();
    },runtimeReconnectGraceMs());
    timer.unref?.();reconnectTimers.set(reconnectTimerKey(code,id),timer);
  }
  Engine.appendLog(room,`🚪 ${player.name} saiu temporariamente da mesa. O prazo normal de reconexão/ausência continua valendo.`,'system');
  emitRoom(room);
  return {keepSeat:true,roomCode:room.code};
}

function withRoom(socket, fn) {
  try {
    const room = rooms.get(socket.data.roomCode);
    if (!room) throw new Error('Sala não encontrada.');
    if (socket.data.role === ROLE_SPECTATOR) throw new Error('Modo Observador: esta ação é exclusiva dos jogadores da mesa.');
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (!player) throw new Error('Jogador não encontrado na sala.');
    if (!player.isBot && player.playerKey && player.playerKey !== socket.data.auth?.playerKey) throw new Error('Esta vaga pertence a outra conta.');
    if (!player.isBot && player.socketId !== socket.id) throw new Error('Esta conexão foi substituída por uma sessão mais recente.');
    if (!player.isBot && !player.connected) throw new Error('Esta vaga não está conectada por esta sessão.');
    const outcome=fn(room, player);
    // Apenas ações que exigem confirmação durável podem retornar Promise.
    // Não anunciar estado novo antes de o armazenamento autorizar a transição.
    if(outcome&&typeof outcome.then==='function'){
      outcome.then(()=>{if(rooms.get(room.code)===room)emitRoom(room);}).catch(e=>err(socket,e));
    }else emitRoom(room);
  } catch(e) { err(socket,e); }
}


const SOCIAL_EFFECTS = new Set(['applause','laugh','angry','horn','drum','victory','wow','jogaBoca','draw2']);
const QUICK_AUDIO_MAX_MS = 15000;
const QUICK_AUDIO_MAX_BYTES = 250 * 1024;
const QUICK_AUDIO_COOLDOWN_MS = 2500;
function ensureSpectators(room) {
  if (!Array.isArray(room.spectators)) room.spectators = [];
  return room.spectators;
}
function reserveSpectatorJoinSlot(room){
  ensureSpectators(room);
  const pending=Math.max(0,Number(pendingSpectatorJoins.get(room.code)||0));
  if(AbuseGuard.spectatorAtCapacity(room,MAX_SPECTATORS_PER_ROOM,pending)){
    throw new Error(`Esta sala atingiu o limite de ${MAX_SPECTATORS_PER_ROOM} observadores.`);
  }
  pendingSpectatorJoins.set(room.code,pending+1);
  let released=false;
  return ()=>{
    if(released)return;released=true;
    const current=Math.max(0,Number(pendingSpectatorJoins.get(room.code)||0)-1);
    if(current)pendingSpectatorJoins.set(room.code,current);else pendingSpectatorJoins.delete(room.code);
  };
}
function spectatorReconnectTimerKey(roomCode,spectatorId){return `${roomCode}:${spectatorId}`;}
function cancelSpectatorReconnectTimer(roomCode,spectatorId){
  const key=spectatorReconnectTimerKey(roomCode,spectatorId),timer=spectatorReconnectTimers.get(key);
  if(timer)clearTimeout(timer);spectatorReconnectTimers.delete(key);
}
function clearSpectatorReconnectTimersForRoom(roomCode){
  const prefix=`${roomCode}:`;
  for(const [key,timer] of spectatorReconnectTimers){if(key.startsWith(prefix)){clearTimeout(timer);spectatorReconnectTimers.delete(key);}}
}
function ensureSocial(room) {
  if (!Array.isArray(room.chat)) room.chat = [];
  ensureSpectators(room);
}
function spectatorForSocket(room,socket){
  ensureSpectators(room);
  return room.spectators.find(s=>s.id===socket.data.spectatorId&&s.playerKey===socket.data.auth?.playerKey)||null;
}
function socialActorForSocket(room,socket){
  if(socket.data.role===ROLE_SPECTATOR){
    const spectator=spectatorForSocket(room,socket);
    return spectator&&spectator.connected&&spectator.socketId===socket.id
      ? {id:spectator.id,name:spectator.name,avatar:spectator.avatar,role:ROLE_SPECTATOR,isBot:false}
      : null;
  }
  const player=room.players.find(p=>p.id===socket.data.playerId);
  return player&&player.connected&&!player.isBot&&player.socketId===socket.id
    ? {id:player.id,name:player.name,avatar:player.avatar,role:ROLE_PLAYER,isBot:false}
    : null;
}

// V40.57.1 — uma sessão antiga não permanece como participante fantasma depois
// que a mesma vaga é retomada por outro socket. Limpamos voz/papel/sala ANTES de
// desconectar para que o handler de disconnect não marque a cadeira nova como offline.
function retireReplacedSocket(socketId,{roomCode=null}={}){
  const oldId=String(socketId||'');
  if(!oldId)return false;
  const stale=io.sockets.sockets.get(oldId);
  if(!stale)return false;
  forgetCameraSocket(stale);
  notifyLiveVoicePeerUnavailable(stale);
  clearLiveVoiceSender(stale);
  liveVoiceRelayRate.delete(stale.id);
  stale.emit('sessionReplaced');
  if(roomCode)stale.leave(roomCode);
  stale.data.roomCode=null;
  stale.data.playerId=null;
  stale.data.spectatorId=null;
  stale.data.role=null;
  stale.data.liveVoiceOn=false;
  setImmediate(()=>{if(stale.connected)stale.disconnect(true);});
  return true;
}
// Os observadores de torneio recebem exclusivamente o estado público da mesa:
// chat, áudios rápidos e efeitos sociais não chegam a esses sockets.
function emitRoomSocial(room,event,payload){
  const excluded=room.tournament?ensureSpectators(room)
    .filter(s=>s.connected&&s.socketId).map(s=>s.socketId):[];
  const channel=io.to(room.code);
  if(excluded.length)channel.except(excluded).emit(event,payload);
  else channel.emit(event,payload);
}
function appendSystemChat(room,text){
  ensureSocial(room);const now=Date.now();
  const message={id:`chat-system-${now}-${Math.random().toString(36).slice(2,8)}`,at:now,playerId:null,name:'Mesa',avatar:'👁️',text:cleanChatText(text),role:'SYSTEM',system:true};
  room.chat.push(message);if(room.chat.length>60)room.chat.splice(0,room.chat.length-60);emitRoomSocial(room,'chatMessage',message);return message;
}
function removeSpectator(room,spectator,{announce=true}={}){
  ensureSpectators(room);cancelSpectatorReconnectTimer(room.code,spectator.id);
  room.spectators=room.spectators.filter(s=>s.id!==spectator.id);
  SpectatorSeatAdmission.removeRequestForSpectator(room,spectator.id);
  if(announce)appendSystemChat(room,`👁️ ${spectator.name} saiu da sala.`);
}
function scheduleSpectatorRemoval(room,spectator){
  cancelSpectatorReconnectTimer(room.code,spectator.id);
  const key=spectatorReconnectTimerKey(room.code,spectator.id);
  const timer=setTimeout(()=>{
    spectatorReconnectTimers.delete(key);const liveRoom=rooms.get(room.code);if(!liveRoom)return;
    ensureSpectators(liveRoom);const stale=liveRoom.spectators.find(s=>s.id===spectator.id);
    if(!stale||stale.connected)return;
    removeSpectator(liveRoom,stale,{announce:!liveRoom.tournament});emitRoom(liveRoom);
  },runtimeReconnectGraceMs());
  if(typeof timer.unref==='function')timer.unref();spectatorReconnectTimers.set(key,timer);
}
function closeSpectatorsForRoom(room,message='A mesa foi encerrada.'){
  if(!room)return;ensureSpectators(room);clearSpectatorReconnectTimersForRoom(room.code);
  for(const s of room.spectators){
    if(!s.socketId)continue;const sock=io.sockets.sockets.get(s.socketId);if(!sock)continue;
    sock.leave(room.code);sock.data.roomCode=null;sock.data.spectatorId=null;sock.data.role=null;sock.emit('leftRoom',{message});
  }
  room.spectators=[];
  room.spectatorSeatRequests=[];
}
function cleanChatText(value) { return InputSafety.cleanChatText(value); }
function emitChatHistory(socket, room) {
  ensureSocial(room);
  socket.emit('chatHistory', room.chat.slice(-60));
}

// ========================= V40.1 — JOGADORES ONLINE + CONVITES =========================
function cleanPresenceName(value) { return InputSafety.cleanPresenceName(value); }
function cleanAvatar(value) { return InputSafety.cleanAvatar(value); }
function presenceFor(playerKey) { return onlinePresence.get(String(playerKey||'')) || null; }
function registerPresenceSocket(socket) {
  const key=socket.data.auth?.playerKey; if(!key)return;
  let rec=onlinePresence.get(key);
  if(!rec){rec={playerKey:key,name:cleanPresenceName(socket.data.auth?.name),avatar:'macaco',picture:String(socket.data.auth?.picture||'').slice(0,500),sockets:new Set(),searching:false,lastSeenAt:Date.now()};onlinePresence.set(key,rec);}
  rec.sockets.add(socket.id);rec.lastSeenAt=Date.now();
  if(!rec.name)rec.name=cleanPresenceName(socket.data.auth?.name);
}
function unregisterPresenceSocket(socket) {
  const key=socket.data.auth?.playerKey,rec=onlinePresence.get(key);if(!rec)return;
  rec.sockets.delete(socket.id);rec.lastSeenAt=Date.now();
  if(!rec.sockets.size)onlinePresence.delete(key);
}
function updatePresenceFromSocket(socket,payload={}) {
  const key=socket.data.auth?.playerKey;if(!key)return;
  registerPresenceSocket(socket);
  const rec=onlinePresence.get(key);if(!rec)return;
  if(payload.name)rec.name=cleanPresenceName(payload.name);
  if(payload.avatar)rec.avatar=cleanAvatar(payload.avatar);
  rec.lastSeenAt=Date.now();
}
function roomSeatForKey(playerKey) {
  let best=null;
  for(const room of rooms.values()){
    const player=room.players.find(p=>!p.isBot&&p.playerKey===playerKey);
    if(!player)continue;
    const score=(player.connected?100:0)+(room.status==='playing'?40:room.status==='between-rounds'?30:room.status==='lobby'?20:10)+(room.round>0?5:0);
    if(!best||score>best.score)best={room,player,score};
  }
  return best;
}
function activeMultiplayerRoomForKey(playerKey, exceptCode=null) {
  for(const room of rooms.values()){
    if(room.code===exceptCode||room.status==='finished'||room.round<=0)continue;
    if(room.players.filter(p=>!p.isBot).length<2)continue;
    if(room.players.some(p=>!p.isBot&&p.playerKey===playerKey))return room;
  }
  return null;
}
function presenceStatusForKey(playerKey) {
  const rec=presenceFor(playerKey);
  const seat=roomSeatForKey(playerKey);
  if(seat?.player&&!seat.player.connected&&!seat.player.autoControlled&&seat.player.reconnectDeadlineAt>Date.now()){
    return {code:'reconnecting',emoji:'🟠',label:'Reconectando'};
  }
  if(rec?.searching)return {code:'searching',emoji:'🔎',label:'Procurando partida'};
  if(rec?.sockets?.size&&seat?.room&&seat.room.status!=='finished'){
    const humans=seat.room.players.filter(p=>!p.isBot).length;
    if(humans>=2)return {code:'multiplayer',emoji:'🎮',label:'Jogando com pessoas'};
    if(seat.room.players.some(p=>p.isBot))return {code:'bot',emoji:'🤖',label:'Jogando contra a máquina'};
  }
  return {code:'available',emoji:'🟢',label:'Disponível'};
}
function buildPresenceSnapshot() {
  const keys=new Set(onlinePresence.keys());
  // Durante os 60 s de reconexão a vaga ainda aparece, marcada como Reconectando.
  for(const room of rooms.values())for(const p of room.players){
    if(!p.isBot&&p.playerKey&&!p.connected&&!p.autoControlled&&p.reconnectDeadlineAt>Date.now())keys.add(p.playerKey);
  }
  const players=[];
  for(const key of keys){
    const rec=presenceFor(key),seat=roomSeatForKey(key),status=presenceStatusForKey(key);
    const connected=!!rec?.sockets?.size;
    players.push({
      playerKey:key,
      name:cleanPresenceName(rec?.name||seat?.player?.name||'Jogador'),
      avatar:cleanAvatar(rec?.avatar||seat?.player?.avatar||'macaco'),
      status:status.code,statusEmoji:status.emoji,statusLabel:status.label,
      connected,inviteable:connected,
    });
  }
  const order={available:0,searching:1,reconnecting:2,bot:3,multiplayer:4};
  players.sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)||a.name.localeCompare(b.name,'pt-BR'));
  return {onlineCount:[...onlinePresence.values()].filter(r=>r.sockets.size).length,players,at:Date.now()};
}
function publicRoomCard(room) {
  ensureSpectators(room);
  const host=room.players.find(p=>p.host&&!p.isBot) || room.players.find(p=>!p.isBot) || room.players[0] || null;
  return {
    code: room.code,
    status: room.status,
    round: Number(room.round||0),
    rounds: Number(room.rules?.rounds||5),
    playerCount: room.players.length,
    connectedPlayerCount: room.players.filter(p=>p.connected||p.isBot||p.autoControlled).length,
    spectatorCount: room.spectators.filter(x=>x.connected).length,
    spectatorLimit: MAX_SPECTATORS_PER_ROOM,
    hostName: cleanPresenceName(host?.name||'Mesa'),
    botCount: room.players.filter(p=>p.isBot).length,
    createdAt: Number(room.createdAt||Date.now()),
  };
}
function buildPublicRoomsSnapshot() {
  const publicRooms=[...rooms.values()].filter(room=>room?.isPublic===true);
  const watchable=publicRooms
    .filter(room=>Number(room.round||0)>0&&room.status!=='lobby'&&room.status!=='finished')
    .map(publicRoomCard)
    .sort((a,b)=>b.spectatorCount-a.spectatorCount||b.playerCount-a.playerCount||b.round-a.round||a.code.localeCompare(b.code));
  return {
    publicRoomCount: publicRooms.length,
    watchableRoomCount: watchable.length,
    activeSpectatorCount: watchable.reduce((sum,room)=>sum+room.spectatorCount,0),
    spectatorLimitPerRoom: MAX_SPECTATORS_PER_ROOM,
    rooms: watchable,
    at: Date.now(),
  };
}
// Fase 4B: atualiza a lista global apenas se houve mudança de conteúdo.
// O campo informativo `at` não altera jogadores online nem salas disponíveis.
// Os snapshots iniciais e os pedidos explícitos seguem sendo enviados integralmente.
const lobbySnapshotDelivery = LobbySnapshotDelivery.createBroadcastGate();
function broadcastPresence() {
  lobbySnapshotDelivery.emitIfChanged(io,'presenceSnapshot',buildPresenceSnapshot());
  lobbySnapshotDelivery.emitIfChanged(io,'publicRoomsSnapshot',buildPublicRoomsSnapshot());
}
function emitToPlayerKey(playerKey,event,payload) {
  const rec=presenceFor(playerKey);if(!rec)return;
  for(const socketId of rec.sockets)io.to(socketId).emit(event,payload);
}
function firstSocketForKey(playerKey) {
  const rec=presenceFor(playerKey);if(!rec)return null;
  for(const id of rec.sockets){const sock=io.sockets.sockets.get(id);if(sock)return sock;}
  return null;
}

function matchmakingSortedEntries() {
  return [...matchmakingQueue.values()].sort((a,b)=>a.joinedAt-b.joinedAt);
}
function clearMatchmakingTimer() {
  if(matchmakingTimer)clearTimeout(matchmakingTimer);
  matchmakingTimer=null;
  matchmakingDeadlineAt=null;
}
function setSearchingFlag(playerKey,value) {
  const rec=presenceFor(playerKey);
  if(rec)rec.searching=!!value;
}
function matchmakingPlayerPublic(playerKey) {
  const rec=presenceFor(playerKey);
  return {
    playerKey,
    name:cleanPresenceName(rec?.name||'Jogador'),
    avatar:cleanAvatar(rec?.avatar||'macaco'),
  };
}
function activePlayerRoomForKey(playerKey, exceptCode=null) {
  const key=String(playerKey||'');
  if(!key)return null;
  for(const room of rooms.values()){
    if(room.code===exceptCode||room.status==='finished')continue;
    if(room.players.some(p=>!p.isBot&&p.playerKey===key))return room;
  }
  return null;
}
function playerHasActiveRoom(playerKey, exceptCode=null) {
  return !!activePlayerRoomForKey(playerKey,exceptCode);
}

// PRE-APK — uma troca voluntária de sala precisa de confirmação explícita.
// O servidor emite o pedido apenas depois de reconhecer a conta autenticada e
// nunca abandona a cadeira anterior antes de a nova entrada estar validada.
function roomSwitchConfirmationState(socket,payload,{action,targetCode='',exceptCode=null,targetRole=ROLE_PLAYER,targetLabel='',context={}}={}) {
  const key=String(socket?.data?.auth?.playerKey||'');
  const other=activePlayerRoomForKey(key,exceptCode);
  if(!other)return {required:false,confirmed:false,other:null};

  const supplied=InputSafety.cleanOpaqueId(payload?.switchConfirmationToken,160);
  const pending=socket.data.pendingRoomSwitch;
  const now=Date.now();
  const expectedTarget=String(targetCode||'');
  if(supplied&&pending&&pending.token===supplied&&pending.expiresAt>now&&pending.action===action&&pending.targetCode===expectedTarget&&pending.fromCode===other.code){
    socket.data.pendingRoomSwitch=null;
    return {required:true,confirmed:true,other};
  }

  const token=crypto.randomUUID();
  socket.data.pendingRoomSwitch={token,action,targetCode:expectedTarget,fromCode:other.code,targetRole,expiresAt:now+ROOM_SWITCH_CONFIRM_TTL_MS};
  socket.emit('roomSwitchRequired',{
    token,action,fromCode:other.code,toCode:expectedTarget,targetRole,targetLabel:String(targetLabel||''),
    context:context&&typeof context==='object'?context:{},
  });
  return {required:true,confirmed:false,other};
}

// V40.60 — entrar NA FILA não equivale a entrar em outra sala.
// Uma cadeira desconectada com reserva involuntária válida pode coexistir
// temporariamente com a busca. Ela só é abandonada quando uma nova mesa
// é realmente formada e o jogador entra nela.
function matchmakingBlockingRoomForKey(playerKey) {
  const key=String(playerKey||'');
  if(!key)return null;
  for(const room of rooms.values()){
    if(!room||room.status==='finished')continue;
    const player=room.players.find(p=>!p.isBot&&p.playerKey===key);
    if(player&&RoomLifecycle.blocksMatchmaking(player))return room;
  }
  return null;
}
function playerHasMatchmakingBlockingRoom(playerKey) {
  return !!matchmakingBlockingRoomForKey(playerKey);
}

// PRE-APK — recuperação pela identidade autenticada, inclusive na microjanela de F5.
// Se o novo socket chega antes de o disconnect antigo ser consolidado, a mesma conta
// pode transferir a própria cadeira para o socket mais novo. Isso NÃO recria cadeira
// abandonada: SAIR/troca definitiva removem playerKey/reconnectEligible da vaga antiga.
function recoverablePlayerSeatForKey(playerKey) {
  const key=String(playerKey||'');
  if(!key)return null;
  let best=null;
  for(const room of rooms.values()){
    // Uma sala comum já encerrada ainda tem uma vaga de revanche reservada
    // após deploy; não recuperar mesas de torneio que já terminaram.
    if(!room||(room.status==='finished'&&room.tournament))continue;
    const player=room.players.find(p=>!p.isBot&&p.playerKey===key);
    if(!player)continue;
    const liveSocket=player.socketId?io.sockets.sockets.get(player.socketId):null;
    const connectedTransfer=!!(player.connected&&liveSocket);

    // Se o socket antigo já morreu antes do debounce, convertemos o estado legado
    // em desconexão involuntária. Se ainda está vivo, tratamos como transferência
    // da MESMA conta (caso típico de refresh que criou o novo socket muito rápido).
    if(!connectedTransfer&&!RoomLifecycle.canAutoReconnect(player)){
      if(player.connected&&!liveSocket){
        RoomLifecycle.markInvoluntaryDisconnect(player,{now:Date.now(),graceMs:runtimeReconnectGraceMs()});
      }else continue;
    }
    const score=(room.status==='playing'?100:room.status==='between-rounds'?80:40)
      +(Number(room.round||0)>0?20:0)+(player.autoControlled?10:0)+(connectedTransfer?5:0);
    if(!best||score>best.score)best={room,player,score,connectedTransfer};
  }
  return best;
}

async function resumeReservedPlayerSeat(socket,room,player,{source='auto-resume'}={}) {
  if(!socket||!room||!player||player.isBot)throw new Error('Vaga de reconexão inválida.');
  const authKey=String(socket.data.auth?.playerKey||'');
  if(!authKey||player.playerKey!==authKey)throw new Error('Esta vaga pertence a outra conta.');
  const liveSocket=player.socketId?io.sockets.sockets.get(player.socketId):null;
  const connectedTransfer=!!(player.connected&&liveSocket&&player.socketId!==socket.id);
  if(!player.reconnectEligible&&!connectedTransfer&&player.socketId!==socket.id){
    throw new Error('Esta vaga não possui uma reserva válida de reconexão automática.');
  }

  // Defesa para dados legados: se versões antigas deixaram a mesma conta autenticada
  // vinculada a mais de uma sala, ao retomar uma reserva válida mantemos somente
  // esta sala. As demais vagas humanas são abandonadas definitivamente.
  await abandonOtherPlayerMembershipsForSwitch(socket,room.code,'teve a reserva substituída pela sala retomada');

  const wasDisconnected=!player.connected;
  const wasAutoControlled=!!player.autoControlled;
  cancelDisconnectDebounce(ROLE_PLAYER,room.code,player.id);
  cancelReconnectTimer(room.code,player.id);

  // Regra de transferência segura: o Node processa cada evento de forma sequencial.
  // Se o timer da Máquina ainda não começou, ele é cancelado aqui. Se já começou,
  // a jogada automática termina primeiro; só depois este evento recupera a vaga e
  // entrega ao humano a mão ATUAL. Um timer antigo que dispare depois também aborta
  // porque scheduleBotTurn verifica isAutomatedPlayer() antes de agir.
  if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
  if(player.socketId&&player.socketId!==socket.id){
    retireReplacedSocket(player.socketId,{roomCode:room.code});
  }

  const resumed=Engine.reconnectPlayer(room,player.token,socket.id);
  if(!resumed)throw new Error('Não foi possível recuperar sua vaga.');
  resumed.voluntaryLeftAt=null;

  removeFromMatchmaking(authKey,{reason:'Busca encerrada porque sua partida foi retomada.',notify:true});
  socket.data.roomCode=room.code;
  socket.data.playerId=resumed.id;
  socket.data.spectatorId=null;
  socket.data.role=ROLE_PLAYER;
  socket.join(room.code);
  updatePresenceFromSocket(socket,{name:resumed.name,avatar:resumed.avatar});

  if(wasDisconnected||wasAutoControlled){
    Engine.appendLog(room,wasAutoControlled
      ? `🟢 ${resumed.name} voltou e retomou seu lugar da Máquina.`
      : `🟢 ${resumed.name} voltou automaticamente para sua vaga.`, 'system');
    socket.emit('reconnectionEvent',{kind:wasAutoControlled?'returned-from-auto':'returned',playerId:resumed.id,name:resumed.name});
    io.to(room.code).except(socket.id).emit('reconnectionEvent',{kind:'returned',playerId:resumed.id,name:resumed.name});
  }

  StateDelivery.invalidate(socket);socket.emit('joined',{code:room.code,playerId:resumed.id,token:resumed.token,role:ROLE_PLAYER,source});
  emitChatHistory(socket,room);
  emitRoom(room);
  broadcastPresence();
  return resumed;
}
function requireNoOtherActivePlayerRoom(socket, exceptCode=null) {
  const other=activePlayerRoomForKey(socket.data.auth?.playerKey,exceptCode);
  if(other)throw new Error(`Você já possui uma vaga ativa na sala ${other.code}. Saia dela antes de entrar em outra mesa.`);
}

// V40.59 — entrar em outra sala é abandono explícito da sala anterior.
// A mesma conta autenticada não pode manter uma vaga/reserva antiga enquanto participa
// de outra mesa. Em rodada já iniciada, a cadeira antiga vira uma Máquina normal,
// sem playerKey/token humano; fora da rodada, a vaga é removida.
async function abandonOtherPlayerMembershipsForSwitch(socket, exceptCode=null, reason='entrou em outra sala') {
  const key=String(socket.data.auth?.playerKey||'');
  if(!key)return false;
  let changed=false;
  const currentCode=String(socket.data.roomCode||'');

  for(const room of [...rooms.values()]){
    if(!room||room.code===exceptCode||room.status==='finished')continue;
    const player=room.players.find(p=>!p.isBot&&p.playerKey===key);
    if(!player)continue;
    await abandonHumanSeatDurably(room,player,{reason,socket});
    changed=true;
  }

  if(currentCode&&currentCode!==exceptCode){
    socket.leave(currentCode);
    socket.data.roomCode=null;
    socket.data.playerId=null;
    socket.data.spectatorId=null;
    socket.data.role=null;
  }
  if(changed)broadcastPresence();
  return changed;
}

async function prepareForRoomSwitch(socket, exceptCode=null) {
  forgetCameraSocket(socket);
  const currentCode=String(socket.data.roomCode||'');
  // V40.69.8.38: ao avançar automaticamente ou recuperar uma fase seguinte, desconectar a
  // sessão da mesa de torneio CONCLUÍDA sem registrar abandono ou eliminar
  // o classificado. Resultados ainda pendentes mantêm o elenco original.
  if(currentCode&&currentCode!==exceptCode&&socket.data.role===ROLE_PLAYER){
    const previous=rooms.get(currentCode);
    if(previous?.tournament&&previous.status==='finished'){
      const member=previous.players.find(p=>!p.isBot&&p.id===socket.data.playerId&&
        p.playerKey===socket.data.auth?.playerKey&&p.socketId===socket.id);
      if(member)await abandonHumanSeatDurably(previous,member,{reason:'concluiu a fase anterior',socket});
    }
  }
  if(socket.data.role===ROLE_SPECTATOR&&currentCode&&currentCode!==exceptCode){
    const currentRoom=rooms.get(currentCode);
    if(currentRoom){
      const spectator=spectatorForSocket(currentRoom,socket);
      if(spectator)removeSpectator(currentRoom,spectator,{announce:true});
      emitRoom(currentRoom);
    }
    socket.leave(currentCode);
    socket.data.roomCode=null;
    socket.data.playerId=null;
    socket.data.spectatorId=null;
    socket.data.role=null;
    socket.data.tournamentWatchId=null;
    socket.data.tournamentWatchStage=null;
  }
  await abandonOtherPlayerMembershipsForSwitch(socket,exceptCode,'entrou em outra sala');
  requireNoOtherActivePlayerRoom(socket,exceptCode);
}

function playerHasAcceptedInvite(playerKey) {
  return [...invitations.values()].some(inv=>inv.toKey===playerKey&&['accepted-waiting','ready'].includes(inv.status)&&inv.expiresAt>Date.now());
}
function matchmakingPayloadFor(playerKey,reason='',sortedEntries=null) {
  const players=(sortedEntries||matchmakingSortedEntries()).slice(0,MATCHMAKING_MAX_PLAYERS).map(e=>matchmakingPlayerPublic(e.playerKey));
  return {
    searching:matchmakingQueue.has(playerKey),
    players,
    foundCount:players.length,
    maxPlayers:MATCHMAKING_MAX_PLAYERS,
    deadlineAt:players.length>=2?matchmakingDeadlineAt:null,
    waitMs:MATCHMAKING_WAIT_MS,
    reason:reason||'',
  };
}
// Fase 4C: cada conexão recebe somente mudanças reais do estado da busca.
// A verificação é individual, inclusive quando uma conta possui vários dispositivos.
function emitMatchmakingToKey(playerKey,payload,{force=false}={}) {
  const rec=presenceFor(playerKey);if(!rec)return;
  for(const socketId of rec.sockets){
    const target=io.sockets.sockets.get(socketId);
    if(target)MatchmakingDelivery.emitIfChanged(target,payload,{force});
  }
}
function emitMatchmakingState(reason='') {
  const entries=matchmakingSortedEntries();
  for(const entry of entries){
    emitMatchmakingToKey(entry.playerKey,matchmakingPayloadFor(entry.playerKey,reason,entries));
  }
}
function emitMatchmakingIdle(playerKey,reason='',force=false) {
  emitMatchmakingToKey(playerKey,{
    searching:false,players:[],foundCount:0,maxPlayers:MATCHMAKING_MAX_PLAYERS,
    deadlineAt:null,waitMs:MATCHMAKING_WAIT_MS,reason:reason||'',
  },{force});
}
function pruneMatchmakingQueue() {
  let changed=false;
  for(const [key] of [...matchmakingQueue]){
    const rec=presenceFor(key);
    if(!rec?.sockets?.size||playerHasMatchmakingBlockingRoom(key)){
      matchmakingQueue.delete(key);setSearchingFlag(key,false);changed=true;
    }
  }
  return changed;
}
function removeFromMatchmaking(playerKey,{reason='',notify=true,reevaluate=true}={}) {
  const key=String(playerKey||'');
  const existed=matchmakingQueue.delete(key);
  setSearchingFlag(key,false);
  if(existed&&notify)emitMatchmakingIdle(key,reason);
  if(reevaluate)evaluateMatchmakingQueue();
  else if(existed)broadcastPresence();
  return existed;
}
function scheduleMatchmakingCountdown() {
  if(matchmakingTimer||matchmakingQueue.size<2)return;
  matchmakingDeadlineAt=Date.now()+MATCHMAKING_WAIT_MS;
  matchmakingTimer=setTimeout(()=>{
    matchmakingTimer=null;matchmakingDeadlineAt=null;
    if(matchmakingQueue.size>=2)void formMatchmakingGroup().catch(e=>console.error('[matchmaking] falha ao formar grupo:',e));
    else evaluateMatchmakingQueue();
  },MATCHMAKING_WAIT_MS);
  if(typeof matchmakingTimer.unref==='function')matchmakingTimer.unref();
}
function evaluateMatchmakingQueue() {
  pruneMatchmakingQueue();
  if(matchmakingQueue.size>=MATCHMAKING_MAX_PLAYERS){
    clearMatchmakingTimer();
    void formMatchmakingGroup().catch(e=>console.error('[matchmaking] falha ao formar grupo:',e));
    return;
  }
  if(matchmakingQueue.size>=2)scheduleMatchmakingCountdown();
  else clearMatchmakingTimer();
  emitMatchmakingState();
  broadcastPresence();
}
async function formMatchmakingGroup() {
  pruneMatchmakingQueue();
  const candidates=matchmakingSortedEntries().slice(0,MATCHMAKING_MAX_PLAYERS);
  if(candidates.length<2){evaluateMatchmakingQueue();return;}
  clearMatchmakingTimer();

  const live=candidates.map(entry=>({
    entry,
    socket:firstSocketForKey(entry.playerKey),
    rec:presenceFor(entry.playerKey),
  })).filter(x=>x.socket&&x.rec?.sockets?.size&&!playerHasMatchmakingBlockingRoom(x.entry.playerKey));

  if(live.length<2){
    for(const x of candidates){
      if(!live.some(y=>y.entry.playerKey===x.playerKey)){matchmakingQueue.delete(x.playerKey);setSearchingFlag(x.playerKey,false);}
    }
    evaluateMatchmakingQueue();
    return;
  }

  const group=live.slice(0,MATCHMAKING_MAX_PLAYERS);
  let releaseRoomSlot=null;
  try{
    releaseRoomSlot=reserveRoomCreationSlot(group.map(x=>x.entry.playerKey));
  }catch(e){
    for(const x of group)emitToPlayerKey(x.entry.playerKey,'matchmakingError',{message:e?.message||'Servidor com muitas partidas no momento.'});
    scheduleMatchmakingCountdown();
    return;
  }
  for(const x of group){matchmakingQueue.delete(x.entry.playerKey);setSearchingFlag(x.entry.playerKey,false);}
  const code=roomCode();
  let room=null;
  try{
    const host=group[0];
    room=Engine.createRoom(code,{
      socketId:host.socket.id,token:crypto.randomUUID(),
      name:cleanPresenceName(host.rec.name),avatar:cleanAvatar(host.rec.avatar),
      playerKey:host.entry.playerKey,
    });
    ensureSocial(room);
    const seatByKey=new Map([[host.entry.playerKey,room.players[0]]]);

    for(const x of group.slice(1)){
      const p=Engine.addPlayer(room,{
        socketId:x.socket.id,token:crypto.randomUUID(),
        name:cleanPresenceName(x.rec.name),avatar:cleanAvatar(x.rec.avatar),
        playerKey:x.entry.playerKey,
      });
      seatByKey.set(x.entry.playerKey,p);
    }

    const matchPlayers=group.map(x=>matchmakingPlayerPublic(x.entry.playerKey));
    const names=matchPlayers.map(x=>x.name);
    Engine.appendLog(room,`🔎 Busca automática encontrou ${group.length} jogadores. Partida iniciada.`, 'system');
    // A rodada também é preparada enquanto a sala ainda é temporária. Se qualquer
    // regra impedir a inicialização, as reservas antigas continuam intocadas.
    Engine.startRound(room);

    // Até aqui a nova sala existiu apenas em memória local desta função.
    // Portanto, qualquer falha na criação NÃO cancela reservas antigas.
    // Confirmamos novamente que nenhum jogador retomou/ocupou uma mesa ativa
    // enquanto aguardava na fila e somente então fazemos a troca definitiva.
    for(const x of group){
      const blocker=matchmakingBlockingRoomForKey(x.entry.playerKey);
      if(blocker)throw new Error(`A conta de ${cleanPresenceName(x.rec.name)} voltou a ficar ativa na sala ${blocker.code}.`);
    }
    for(const x of group){
      await abandonOtherPlayerMembershipsForSwitch(x.socket,code,'entrou em nova sala pelo matchmaking');
    }
    rooms.set(code,room);

    for(const x of group){
      const p=seatByKey.get(x.entry.playerKey);
      x.socket.data.roomCode=code;x.socket.data.playerId=p.id;x.socket.data.spectatorId=null;x.socket.data.role=ROLE_PLAYER;x.socket.join(code);
      updatePresenceFromSocket(x.socket,{name:p.name,avatar:p.avatar});
      emitMatchmakingToKey(x.entry.playerKey,{searching:false,players:[],foundCount:0,maxPlayers:MATCHMAKING_MAX_PLAYERS,deadlineAt:null,waitMs:MATCHMAKING_WAIT_MS,reason:'Partida encontrada.'});
      x.socket.emit('matchmakingMatched',{code,count:group.length,players:matchPlayers});
      StateDelivery.invalidate(x.socket);x.socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source:'matchmaking',matchSize:group.length,matchPlayers:names});
      emitChatHistory(x.socket,room);
    }

    emitRoom(room);
    broadcastPresence();
  }catch(e){
    if(room){
      for(const x of group){try{x.socket.leave(code)}catch{};x.socket.data.roomCode=null;x.socket.data.playerId=null;}
      closeSpectatorsForRoom(room);clearSpectatorReconnectTimersForRoom(code);removeRoom(code);
    }
    for(const x of group){
      if(presenceFor(x.entry.playerKey)?.sockets?.size&&!playerHasMatchmakingBlockingRoom(x.entry.playerKey)){
        matchmakingQueue.set(x.entry.playerKey,{playerKey:x.entry.playerKey,joinedAt:x.entry.joinedAt||Date.now()});
        setSearchingFlag(x.entry.playerKey,true);
        emitToPlayerKey(x.entry.playerKey,'matchmakingError',{message:e?.message||'Não foi possível formar a partida agora.'});
      }
    }
  }finally{
    if(releaseRoomSlot)releaseRoomSlot();
  }
  evaluateMatchmakingQueue();
}
function ensureInviteReservations(room) {
  if(!(room.inviteReservations instanceof Map))room.inviteReservations=new Map();
  const now=Date.now();
  for(const [key,resv] of room.inviteReservations){if(!resv||resv.expiresAt<=now)room.inviteReservations.delete(key);}
  return room.inviteReservations;
}
function releaseReservation(room,playerKey,inviteId=null) {
  if(!room)return;const map=ensureInviteReservations(room),cur=map.get(playerKey);
  if(cur&&(!inviteId||cur.inviteId===inviteId)){
    map.delete(playerKey);
    notifySpectatorsSeatAvailability(room);
  }
}
function roomHasInviteCapacity(room,playerKey=null) {
  if(!room||room.status==='finished')return false;
  if(room.tournament&&(!playerKey||!room.tournament.rosterKeys.includes(playerKey)))return false;
  const existing=playerKey&&room.players.some(p=>!p.isBot&&p.playerKey===playerKey);
  if(existing)return true;
  ensureInviteReservations(room);
  return SpectatorSeatAdmission.countAvailableSeats(room,playerKey)>0;
}
function roomAllowsInviteEventually(room,playerKey=null) {
  if(!room||room.status==='finished'||!roomHasInviteCapacity(room,playerKey))return false;
  if(room.status==='between-rounds'&&room.round>=room.rules.rounds)return false;
  if(room.status==='playing'&&room.round>=room.rules.rounds)return false;
  return true;
}
function roomJoinableNow(room,playerKey=null) {
  if(!roomAllowsInviteEventually(room,playerKey))return false;
  return room.status==='lobby'||room.status==='between-rounds';
}
function purgeInvitesForRoom(code,message='A sala do convite não está mais disponível.') {
  for(const inv of [...invitations.values()]){
    if(inv.targetRoomCode!==code)continue;
    clearInviteTimer(inv.id);
    // Convites terminados ficam no Map até 60 s por compatibilidade com o cliente.
    // Encerrar a sala não deve reenviar "indisponível" após concluído/expirado.
    if(['pending','accepted-waiting','ready'].includes(inv.status)){
      inv.status='unavailable';inv.updatedAt=Date.now();
      emitToPlayerKey(inv.toKey,'inviteStatus',{inviteId:inv.id,status:'unavailable',message});
      emitToPlayerKey(inv.fromKey,'inviteStatus',{inviteId:inv.id,status:'unavailable',message});
    }
    invitations.delete(inv.id);
  }
}
function invalidateInvitesForRoom(code,message='A sala do convite não está mais disponível.') {
  for(const inv of [...invitations.values()]){
    if(inv.targetRoomCode!==code||!['pending','accepted-waiting','ready'].includes(inv.status))continue;
    expireInvite(inv,message,'unavailable');
  }
}
function invalidateInvitesFromPlayerInRoom(playerKey,code) {
  for(const inv of [...invitations.values()]){
    if(inv.fromKey===playerKey&&inv.targetRoomCode===code&&['pending','accepted-waiting','ready'].includes(inv.status)){
      expireInvite(inv,'Quem enviou o convite saiu da sala.','unavailable');
    }
  }
}
function clearInviteTimer(inviteId){const t=inviteTimers.get(inviteId);if(t)clearTimeout(t);inviteTimers.delete(inviteId);}
function scheduleInviteTimer(invite,ms){
  clearInviteTimer(invite.id);
  const timer=setTimeout(()=>{
    inviteTimers.delete(invite.id);
    const live=invitations.get(invite.id);if(!live)return;
    if(live.status==='pending')expireInvite(live,'O convite expirou.','expired');
    else if(['accepted-waiting','ready'].includes(live.status))expireInvite(live,'A reserva do convite expirou.','expired');
  },Math.max(0,ms));
  if(typeof timer.unref==='function')timer.unref();inviteTimers.set(invite.id,timer);
}
function invitePublic(invite){return {id:invite.id,fromKey:invite.fromKey,fromName:invite.fromName,fromAvatar:invite.fromAvatar,status:invite.status,expiresAt:invite.expiresAt,targetRoomCode:invite.targetRoomCode,waitingReason:invite.waitingReason||null};}
function expireInvite(invite,message,status='expired'){
  if(!invite)return;clearInviteTimer(invite.id);
  const room=rooms.get(invite.targetRoomCode);releaseReservation(room,invite.toKey,invite.id);
  invite.status=status;invite.message=message;invite.updatedAt=Date.now();
  emitToPlayerKey(invite.toKey,'inviteStatus',{inviteId:invite.id,status,message});
  emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status,message:`Convite para ${invite.toName||'jogador'}: ${message}`});
  setTimeout(()=>invitations.delete(invite.id),60000).unref?.();
}
function completeInvite(invite,message='Convite concluído.'){
  clearInviteTimer(invite.id);releaseReservation(rooms.get(invite.targetRoomCode),invite.toKey,invite.id);
  invite.status='completed';invite.updatedAt=Date.now();
  emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status:'completed',message:`✅ ${invite.toName||'Jogador'} entrou na sua mesa.`});
  emitToPlayerKey(invite.toKey,'inviteStatus',{inviteId:invite.id,status:'completed',message});
  setTimeout(()=>invitations.delete(invite.id),60000).unref?.();
}
function currentSocketRoom(socket){const room=rooms.get(socket.data.roomCode);if(!room)return null;const player=room.players.find(p=>p.id===socket.data.playerId);return player?{room,player}:null;}
function detachSocketFromRoom(socket,{emitLeft=false,message=''}={}) {
  notifyLiveVoicePeerUnavailable(socket);clearLiveVoiceSender(socket);
  const code=socket.data.roomCode,playerId=socket.data.playerId,room=rooms.get(code);
  if(!room){socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;if(emitLeft)socket.emit('leftRoom',{message});return;}
  if(socket.data.role===ROLE_SPECTATOR){
    const spectator=spectatorForSocket(room,socket);if(spectator)removeSpectator(room,spectator,{announce:!room.tournament});
    socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;emitRoom(room);
    if(emitLeft)socket.emit('leftRoom',{message});broadcastPresence();return;
  }
  const idx=room.players.findIndex(p=>p.id===playerId);
  if(idx<0){socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;if(emitLeft)socket.emit('leftRoom',{message});return;}
  const leaving=room.players[idx];cancelReconnectTimer(code,leaving.id);invalidateInvitesFromPlayerInRoom(leaving.playerKey,code);
  const wasPlaying=room.status==='playing';room.players.splice(idx,1);
  if(!room.players.length||room.players.every(p=>p.isBot)){
    if(room.botTimer)clearTimeout(room.botTimer);clearReconnectTimersForRoom(code);closeSpectatorsForRoom(room);clearSpectatorReconnectTimersForRoom(code);removeRoom(code);invalidateInvitesForRoom(code);
  }else{
    if(wasPlaying)cancelCurrentRoundAfterLeave(room,leaving.name);else Engine.appendLog(room,`${leaving.name} saiu da sala.`,'system');
    if(room.players.length===1&&room.status==='between-rounds'&&room.round===0)room.status='lobby';
    ensureHost(room);emitRoom(room);
  }
  socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;
  if(emitLeft)socket.emit('leftRoom',{message});
  broadcastPresence();
}
async function createRoomForSocket(socket,profileData={}) {
  enforceActionRate(socket,'createRoom','Muitas criações de sala em pouco tempo.');
  const releaseRoomSlot=reserveRoomCreationSlot([socket.data.auth?.playerKey]);
  const code=roomCode();
  let room=null;
  try{
    room=Engine.createRoom(code,{socketId:socket.id,token:crypto.randomUUID(),name:cleanPresenceName(profileData?.name||socket.data.auth.name),avatar:cleanAvatar(profileData?.avatar||'macaco'),playerKey:socket.data.auth.playerKey});
    ensureSocial(room);
    // V40.60: criar/preparar a sala primeiro; somente uma criação bem-sucedida
    // confirma a troca e cancela uma eventual reserva de reconexão anterior.
    await prepareForRoomSwitch(socket,code);
    removeFromMatchmaking(socket.data.auth?.playerKey,{reason:'Busca encerrada porque você iniciou um convite.',notify:true});
    rooms.set(code,room);
  }finally{
    releaseRoomSlot();
  }
  const p=room.players[0];
  socket.data.roomCode=code;socket.data.playerId=p.id;socket.data.spectatorId=null;socket.data.role=ROLE_PLAYER;socket.join(code);
  updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
  StateDelivery.invalidate(socket);socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source:'invite-host'});emitChatHistory(socket,room);emitRoom(room);broadcastPresence();
  return room;
}
async function joinSocketIntoRoom(socket,room,{inviteId=null,source='invite'}={}) {
  const key=socket.data.auth.playerKey;
  if(room.tournament && !room.tournament.rosterKeys.includes(key))throw new Error('Mesa restrita aos sorteados.');
  if(room.tournament?.forfeits?.some(p=>p.playerKey===key))throw new Error('Você já desistiu desta mesa e não pode retornar como jogador.');
  if(!roomJoinableNow(room,key))throw new Error(room.status==='playing'?'Aguarde o intervalo da rodada para entrar.':'A sala não possui vaga disponível para este convite.');
  await prepareForRoomSwitch(socket,room.code);
  // V40.69.8.36: durante a espera pela persistência da troca, o anfitrião
  // pode iniciar a mesa. Revalidar antes de alterar o elenco competitivo:
  // um classificado atrasado NUNCA entra depois de distribuídas as cartas.
  if(room.tournament && (rooms.get(room.code)!==room || room.status!=='lobby' ||
    tournamentRoundStartLocks.has(room.code)))
    throw new Error('A mesa mudou de estado durante sua entrada. Atualize Torneios para retomar sua vaga, se ela já existia.');
  removeFromMatchmaking(key,{reason:'Busca encerrada porque você aceitou um convite.',notify:true});
  let p=room.players.find(x=>!x.isBot&&x.playerKey===key);
  if(p){
    cancelReconnectTimer(room.code,p.id);if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
    if(p.socketId&&p.socketId!==socket.id)retireReplacedSocket(p.socketId,{roomCode:room.code});
    p=Engine.reconnectPlayer(room,p.token,socket.id);
  }else{
    p=Engine.addPlayer(room,{socketId:socket.id,token:crypto.randomUUID(),name:presenceFor(key)?.name||socket.data.auth.name,avatar:presenceFor(key)?.avatar||'macaco',playerKey:key});
  }
  releaseReservation(room,key,inviteId);socket.data.roomCode=room.code;socket.data.playerId=p.id;socket.data.spectatorId=null;socket.data.role=ROLE_PLAYER;socket.join(room.code);
  updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
  StateDelivery.invalidate(socket);socket.emit('joined',{code:room.code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source,inviteId});emitChatHistory(socket,room);emitRoom(room);broadcastPresence();
  return p;
}
function reserveInviteSeat(invite) {
  const room=rooms.get(invite.targetRoomCode);if(!room||!roomAllowsInviteEventually(room,invite.toKey))return false;
  const map=ensureInviteReservations(room);map.set(invite.toKey,{inviteId:invite.id,expiresAt:invite.expiresAt});
  notifySpectatorsSeatAvailability(room);
  return true;
}
function senderStillInDestination(invite,room){return !!room?.players.some(p=>!p.isBot&&p.playerKey===invite.fromKey);}
function setInviteWaiting(invite,reason,message) {
  invite.status='accepted-waiting';invite.waitingReason=reason;invite.expiresAt=Date.now()+INVITE_RESERVATION_MS;invite.updatedAt=Date.now();
  if(!reserveInviteSeat(invite)){expireInvite(invite,'A vaga deixou de estar disponível.','unavailable');return;}
  scheduleInviteTimer(invite,INVITE_RESERVATION_MS);
  emitToPlayerKey(invite.toKey,'inviteWaiting',{...invitePublic(invite),message});
  emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status:'accepted-waiting',message:`✅ ${invite.toName||'Jogador'} aceitou. ${message}`});
}
function refreshInviteReadiness(){
  for(const inv of invitations.values()){
    if(!['accepted-waiting','ready'].includes(inv.status))continue;
    if(inv.expiresAt<=Date.now()){expireInvite(inv,'A reserva do convite expirou.','expired');continue;}
    const dest=rooms.get(inv.targetRoomCode);
    if(!dest||!senderStillInDestination(inv,dest)){expireInvite(inv,'A sala do convite não está mais disponível.','unavailable');continue;}
    if(!roomAllowsInviteEventually(dest,inv.toKey)){expireInvite(inv,'A sala não pode mais receber novos jogadores.','unavailable');continue;}
    if(!roomJoinableNow(dest,inv.toKey)){inv.waitingReason='destination-round';continue;}
    if(inv.status!=='ready'){
      inv.status='ready';inv.waitingReason=null;inv.updatedAt=Date.now();
      emitToPlayerKey(inv.toKey,'inviteReady',{...invitePublic(inv),message:'🎮 Seu convite está pronto. Entre na nova mesa quando quiser.'});
      emitToPlayerKey(inv.fromKey,'inviteStatus',{inviteId:inv.id,status:'ready',message:`🎮 ${inv.toName||'Jogador'} já pode entrar na sua mesa.`});
    }
  }
}
function emitPendingInvitesFor(socket){
  const key=socket.data.auth?.playerKey;if(!key)return;
  for(const inv of invitations.values()){
    if(inv.toKey!==key)continue;
    if(inv.expiresAt<=Date.now())continue;
    if(inv.status==='pending')socket.emit('inviteReceived',invitePublic(inv));
    else if(inv.status==='ready')socket.emit('inviteReady',{...invitePublic(inv),message:'🎮 Seu convite está pronto.'});
    else if(inv.status==='accepted-waiting')socket.emit('inviteWaiting',{...invitePublic(inv),message:inv.waitingReason==='finish-current'?'Termine sua partida atual. A vaga está reservada.':'Aguardando o intervalo da sala convidante. A vaga está reservada.'});
  }
}


// ========================= V40.34 — MICROFONE AO VIVO / WEBRTC =========================
// O caminho principal é WebRTC. Socket.IO transporta a sinalização e pode carregar o relay seletivo de contingência.
// Jogadores humanos E observadores podem conversar. Observadores continuam sem receber cartas
// privadas e sem permissão para executar qualquer ação de jogo.
const liveVoiceSenders = new Map(); // socketId -> {roomCode, participantId, role, name}
// V40.49 — relay de compatibilidade para caminhos com OBSERVADOR.
// O cliente usa voz logarítmica de 8 bits (16 kHz), gate de silêncio e pacotes
// VOLATILE. Isso reduz o tráfego e, sobretudo, evita que áudio atrasado forme uma
// fila que possa competir com os eventos e heartbeats da partida.
const liveVoiceRelayRate = new Map();
function liveVoiceRelayAllowed(socket, bytes){
  const now=Date.now();let rec=liveVoiceRelayRate.get(socket.id);
  if(!rec||now-rec.at>=1000)rec={at:now,packets:0,bytes:0};
  rec.packets++;rec.bytes+=bytes;liveVoiceRelayRate.set(socket.id,rec);
  return rec.packets<=30&&rec.bytes<=100000;
}

function currentVoiceParticipant(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) return null;
  if (socket.data.role === ROLE_SPECTATOR) {
    // Observadores de torneio usam exatamente o mesmo canal de voz dos observadores comuns.
    const spectator = spectatorForSocket(room,socket);
    if (!spectator || !spectator.connected || spectator.socketId !== socket.id) return null;
    return {room, actor:{id:spectator.id,name:spectator.name,avatar:spectator.avatar,role:ROLE_SPECTATOR,isBot:false}, socket};
  }
  const player = room.players.find(p => p.id === socket.data.playerId && !p.isBot && p.connected && p.socketId === socket.id);
  if (!player) return null;
  return {room, actor:{id:player.id,name:player.name,avatar:player.avatar,role:ROLE_PLAYER,isBot:false}, socket};
}
function currentVoiceSocketInRoom(roomCode, socketId) {
  const target = io.sockets.sockets.get(String(socketId || ''));
  if (!target || target.data.roomCode !== roomCode) return null;
  const current = currentVoiceParticipant(target);
  return current && current.room.code === roomCode ? current : null;
}
function liveVoicePeersFor(room, excludeSocketId) {
  const players = room.players
    .filter(p => !p.isBot && p.connected && p.socketId && p.socketId !== excludeSocketId)
    .map(p => ({socketId:p.socketId,participantId:p.id,playerId:p.id,role:ROLE_PLAYER,name:p.name}));
  const spectators = ensureSpectators(room)
    .filter(s => s.connected && s.socketId && s.socketId !== excludeSocketId)
    .map(s => ({socketId:s.socketId,participantId:s.id,playerId:s.id,role:ROLE_SPECTATOR,name:s.name}));
  return [...players,...spectators];
}
function clearLiveVoiceSender(socket, {broadcast=true}={}) {
  const rec = liveVoiceSenders.get(socket.id);
  liveVoiceSenders.delete(socket.id);
  socket.data.liveVoiceOn = false;
  if (!rec || !broadcast) return;
  const room = rooms.get(rec.roomCode);
  if (!room) return;
  io.to(rec.roomCode).emit('liveVoiceStatus', {participantId:rec.participantId,playerId:rec.participantId,role:rec.role,name:rec.name,on:false});
  io.to(rec.roomCode).emit('liveVoiceSenderStopped', {socketId:socket.id,participantId:rec.participantId,playerId:rec.participantId,role:rec.role});
}
function notifyExistingLiveVoiceSendersAbout(socket, {refresh=false}={}) {
  const current = currentVoiceParticipant(socket);
  if (!current) return;
  const {room,actor} = current;
  for (const [senderSocketId, rec] of liveVoiceSenders) {
    if (senderSocketId === socket.id || rec.roomCode !== room.code) continue;
    io.to(senderSocketId).emit('liveVoicePeerAvailable', {
      socketId:socket.id,
      participantId:actor.id,
      playerId:actor.id,
      role:actor.role,
      name:actor.name,
      refresh:!!refresh,
    });
  }
  const active=[...liveVoiceSenders.values()].filter(x=>x.roomCode===room.code);
  socket.emit('liveVoiceStatusSnapshot', {
    participantIds:active.map(x=>x.participantId),
    playerIds:active.filter(x=>x.role===ROLE_PLAYER).map(x=>x.participantId),
  });
}

function liveVoiceTargetRefreshAllowed(socket,targetSocketId){
  const now=Date.now(),map=socket.data.liveVoiceRefreshPairs instanceof Map?socket.data.liveVoiceRefreshPairs:new Map();
  socket.data.liveVoiceRefreshPairs=map;const last=Number(map.get(targetSocketId)||0);
  if(now-last<1500)return false;map.set(targetSocketId,now);
  if(map.size>24)for(const [key,at] of map)if(now-Number(at)>30000)map.delete(key);
  return true;
}
function notifyLiveVoiceSenderToRefresh(receiverSocket,targetSenderSocketId,reason='recovery'){
  const receiver=currentVoiceParticipant(receiverSocket);if(!receiver)return false;
  const senderRec=liveVoiceSenders.get(targetSenderSocketId);if(!senderRec||senderRec.roomCode!==receiver.room.code)return false;
  const sender=currentVoiceSocketInRoom(receiver.room.code,targetSenderSocketId);if(!sender)return false;
  if(!liveVoiceTargetRefreshAllowed(receiverSocket,targetSenderSocketId))return false;
  io.to(targetSenderSocketId).emit('liveVoicePeerAvailable',{
    socketId:receiverSocket.id,participantId:receiver.actor.id,playerId:receiver.actor.id,
    role:receiver.actor.role,name:receiver.actor.name,refresh:true,reason:String(reason||'recovery').slice(0,40),
  });
  return true;
}
function notifyLiveVoicePeerUnavailable(socket){
  const roomCode=String(socket.data.roomCode||'');if(!roomCode)return;
  socket.to(roomCode).emit('liveVoicePeerUnavailable',{socketId:socket.id});
}

io.use((socket,next)=>{
  authFromCookieHeaderVerified(socket.handshake.headers.cookie).then(session=>{
    if(!session)return next(new Error('AUTH_REQUIRED'));
    socket.data.auth=session;
    next();
  }).catch(()=>next(new Error('AUTH_REQUIRED')));
});

io.on('connection', socket => {
  monitor.socketConnections++;
  connectionDebug('connected',{socketId:socket.id,recovered:!!socket.recovered});
  socket.once('disconnect',reason=>{
    monitor.socketDisconnects++;
    runtimeConnectionMonitor.recordDisconnect(reason);
    connectionDebug('disconnected',{socketId:socket.id,reason});
  });
  // V40.55 — quando o próprio Socket.IO recupera a sessão, preservamos os dados
  // restaurados até o join automático do cliente confirmar/revincular a vaga.
  if(!socket.recovered){socket.data.role=null;socket.data.spectatorId=null;}
  else connectionDebug('socket.io recovered', {socketId:socket.id,roomCode:socket.data.roomCode,role:socket.data.role});
  registerPresenceSocket(socket);
  socket.emit('presenceSnapshot',buildPresenceSnapshot());
  socket.emit('publicRoomsSnapshot',buildPublicRoomsSnapshot());
  MatchmakingDelivery.emitIfChanged(socket,matchmakingPayloadFor(socket.data.auth.playerKey),{force:true});
  emitPendingInvitesFor(socket);
  setTimeout(broadcastPresence,0);

  // Câmera: somente usuários autenticados que estejam realmente na sala.
  // Nenhum frame, foto ou gravação trafega pelo Socket.IO.
  socket.on('cameraToken', (_request,ack) => {
    const answer=(obj)=>{if(typeof ack==='function')ack(obj);};
    try{
      if(!CAMERA_ENABLED)return answer({ok:false,message:'Câmera ainda não configurada no Render.'});
      const code=socket.data.roomCode,room=rooms.get(code);
      const actor=room&&socialActorForSocket(room,socket);
      if(!actor || (actor.role!==ROLE_PLAYER && actor.role!==ROLE_SPECTATOR))return answer({ok:false,message:'Entre em uma sala para usar a câmera.'});
      // A autorização de mídia é independente das permissões de participar do torneio.
      const now=Date.now();
      if(now-Number(socket.data.cameraLastTokenRequestAt||0)<2500)return answer({ok:false,message:'Aguarde antes de reconectar a câmera.'});
      socket.data.cameraLastTokenRequestAt=now;
      socket.data.cameraTokenAt=now;
      const allowPublish=actor.role===ROLE_PLAYER || (actor.role===ROLE_SPECTATOR && !!room.tournament);
      const identity=`${actor.role===ROLE_SPECTATOR?'s':'p'}_${actor.id}`;
      return answer({ok:true,url:LIVEKIT_URL,token:cameraTokenJWT({room:`mmc-${code}`,identity,allowPublish}),identity,allowPublish});
    }catch(e){return answer({ok:false,message:'Não foi possível conectar à câmera.'});}
  });
  socket.on('cameraPresenceRequest',()=>{
    const code=socket.data.roomCode,room=rooms.get(code);
    if(room&&socialActorForSocket(room,socket))sendCameraPresence(code,socket);
  });
  socket.on('cameraPublishState', payload=>{
    const code=socket.data.roomCode,room=rooms.get(code);
    const actor=room&&socialActorForSocket(room,socket);
    if(!actor || (actor.role!==ROLE_PLAYER && !(room.tournament && actor.role===ROLE_SPECTATOR)))return;
    const active=!!payload?.active;
    if(active && (!CAMERA_ENABLED || Date.now()-Number(socket.data.cameraTokenAt||0)>600000))return;
    let publishers=cameraPublishers.get(code);
    if(!publishers){publishers=new Map();cameraPublishers.set(code,publishers);}
    if(active)publishers.set(socket.id,actor.id);else publishers.delete(socket.id);
    if(!publishers.size)cameraPublishers.delete(code);
    sendCameraPresence(code);
  });

  socket.on('presenceProfile', payload => {
    updatePresenceFromSocket(socket,payload||{});broadcastPresence();
  });

  // V40.59 — uma saída voluntária clicada enquanto o aparelho estava offline
  // é confirmada antes de qualquer auto-reconexão. O token/código são usados apenas
  // para localizar a cadeira existente; nunca recriam uma sala ou uma vaga apagada.
  socket.on('abandonReservedSeat', async (payload,ack) => {
    const done=(data={})=>{try{if(typeof ack==='function')ack({ok:true,...data})}catch{}};
    try{
      const code=InputSafety.cleanRoomCode(payload?.code);
      const token=InputSafety.cleanOpaqueId(payload?.token,160);
      const room=rooms.get(code);
      if(!room){done({removed:false,reason:'room-missing'});return;}
      const key=String(socket.data.auth?.playerKey||'');
      const player=room.players.find(p=>!p.isBot&&p.playerKey===key&&(!token||p.token===token));
      if(!player){done({removed:false,reason:'seat-missing'});return;}
      // Abandono offline exige intenção explícita nas mesas de torneio.
      // Solicitações de saída temporária, inclusive de clientes antigos, não
      // podem ser convertidas silenciosamente em desistência competitiva.
      if(room.tournament&&payload?.action!=='abandon')
        throw new Error('Para desistir do torneio, confirme ABANDONAR TORNEIO explicitamente.');
      await abandonHumanSeatDurably(room,player,{reason:'confirmou abandono definitivo após recuperar a conexão'});
      done({removed:true,roomCode:code});
      broadcastPresence();
    }catch(e){
      try{if(typeof ack==='function')ack({ok:false,message:e?.message||'Não foi possível confirmar a saída.'})}catch{}
    }
  });

  // V40.57 — se o navegador perdeu o código/token local (ou é outro aparelho),
  // a conta autenticada ainda consegue localizar a vaga humana reservada.
  // O cliente não informa roomCode/playerKey: o servidor descobre a cadeira pela
  // identidade assinada da sessão e só permite recuperar vaga desconectada/AUTO.
  socket.on('resumeActiveSeat', async () => {
    try{
      // Escolher VOLTAR À PARTIDA cancela qualquer intenção pendente de troca.
      socket.data.pendingRoomSwitch=null;
      if(socket.data.role===ROLE_PLAYER&&socket.data.roomCode){
        socket.emit('resumeActiveSeatResult',{ok:true,alreadyJoined:true,code:socket.data.roomCode});
        return;
      }
      if(socket.data.role===ROLE_SPECTATOR&&socket.data.roomCode){
        socket.emit('resumeActiveSeatResult',{ok:false,reason:'spectating'});
        return;
      }
      // V40.69.8.20 — no primeiro connect após F5/redeploy, as salas podem
      // ainda estar sendo carregadas do armazenamento. Não responder 'none'
      // antes de restaurar: a cadeira legítima poderia ficar invisível.
      if(!snapshotsRestored)await requireRoomPersistenceReady();
      const seat=recoverablePlayerSeatForKey(socket.data.auth?.playerKey);
      if(!seat){socket.emit('resumeActiveSeatResult',{ok:false,reason:'none'});return;}
      const fromAuto=!!seat.player.autoControlled;
      const resumed=await resumeReservedPlayerSeat(socket,seat.room,seat.player,{source:'auto-resume'});
      socket.emit('resumeActiveSeatResult',{ok:true,code:seat.room.code,playerId:resumed.id,fromAuto});
    }catch(e){
      socket.emit('resumeActiveSeatResult',{ok:false,reason:'error',message:e?.message||'Não foi possível retomar a partida.'});
    }
  });

  socket.on('requestPublicRooms', () => {
    socket.emit('publicRoomsSnapshot',buildPublicRoomsSnapshot());
  });

  // V40.54 — jogadores recentes vêm do histórico real de partidas concluídas.
  // A lista guarda somente identidade pública da mesa (nome/avatar curto) e data da partida;
  // presença/convite continuam efêmeros e são calculados no momento da consulta.
  socket.on('requestRecentPlayers', async () => {
    try{
      if(!(await ensureRankingReady()))throw new Error('Histórico de partidas indisponível.');
      const rows=await rankingStore.getRecentPlayers({playerKey:socket.data.auth.playerKey,limit:12});
      const players=rows.map(row=>{
        const status=presenceStatusForKey(row.playerKey),rec=presenceFor(row.playerKey);
        const connected=!!rec?.sockets?.size;
        return {
          playerKey:String(row.playerKey||''),
          name:cleanPresenceName(rec?.name||row.name||'Jogador'),
          avatar:cleanAvatar(rec?.avatar||row.avatar||'macaco'),
          lastPlayedAt:row.lastPlayedAt||null,
          gamesTogether:Number(row.gamesTogether||0),
          connected,inviteable:connected,
          status:status.code,statusEmoji:status.emoji,statusLabel:status.label,
        };
      });
      socket.emit('recentPlayersSnapshot',{players,at:Date.now()});
    }catch(e){
      console.error('[recentes] consulta falhou:',e?.message||e);
      socket.emit('recentPlayersSnapshot',{players:[],at:Date.now(),error:'Não foi possível carregar jogadores recentes agora.'});
    }
  });

  // V40.52 — recuperação sob demanda de figurinha personalizada.
  // O cliente só pode pedir referências que pertençam à sala em que está conectado.
  socket.on('requestAvatarAssets', payload => {
    try {
      const roomCode=String(socket.data.roomCode||'');
      const room=rooms.get(roomCode);
      if(!room)return;
      const refs=Array.isArray(payload?.refs)?payload.refs:[];
      emitRoomAvatarAssets(socket,room,refs);
    } catch(e) { err(socket,e); }
  });

  // V40.50 — sonda mínima de RTT. Não transporta estado da partida nem dados pessoais;
  // serve apenas para o diagnóstico local de qualidade da conexão.
  socket.on('networkProbe', (payload, ack) => {
    if(typeof ack==='function') ack({serverAt:Date.now(),clientAt:Number(payload?.clientAt||0)});
  });


  // V49.11 — recuperação dirigida: se B perde apenas A, somente A renegocia com B.
  socket.on('liveVoiceRefreshPeer', payload => {
    try{
      const targetSocketId=String(payload?.targetSocketId||'').slice(0,120);
      if(!targetSocketId||targetSocketId===socket.id)return;
      notifyLiveVoiceSenderToRefresh(socket,targetSocketId,String(payload?.reason||'recovery'));
    }catch(e){err(socket,e);}
  });

  socket.on('liveVoiceReady', payload => {
    try {
      let refresh=!!payload?.refresh;
      if(refresh){
        const now=Date.now(),last=Number(socket.data.lastLiveVoiceRefreshAt||0);
        refresh=now-last>=4000;
        if(refresh)socket.data.lastLiveVoiceRefreshAt=now;
      }
      notifyExistingLiveVoiceSendersAbout(socket,{refresh});
    } catch(e) { err(socket,e); }
  });

  socket.on('liveVoiceJoin', () => {
    try {
      const current = currentVoiceParticipant(socket);
      if (!current) throw new Error('Participante não disponível para usar o microfone.');
      const {room,actor} = current;
      liveVoiceSenders.set(socket.id,{roomCode:room.code,participantId:actor.id,role:actor.role,name:actor.name});
      socket.data.liveVoiceOn=true;
      socket.emit('liveVoicePeers',{peers:liveVoicePeersFor(room,socket.id)});
      io.to(room.code).emit('liveVoiceStatus',{participantId:actor.id,playerId:actor.id,role:actor.role,name:actor.name,on:true});
    } catch(e) { err(socket,e); }
  });

  socket.on('liveVoiceLeave', () => {
    clearLiveVoiceSender(socket);
  });

  socket.on('liveVoiceSignal', payload => {
    try {
      const current=currentVoiceParticipant(socket);
      if(!current) throw new Error('Sala não encontrada para a chamada de voz.');
      // Evita tempestades de ICE/SDP; não interfere na mídia já estabelecida.
      // Vinculado à conta, portanto trocar de socket não zera a quota.
      const signalQuota=abuseLimiter.consume(abuseSubject(socket),'voiceSignal');
      if(!signalQuota.allowed){
        const now=Date.now();
        if(!socket.data.voiceSignalLimitNoticeAt||now-socket.data.voiceSignalLimitNoticeAt>=10000){
          socket.data.voiceSignalLimitNoticeAt=now;
          socket.emit('liveVoiceSignalLimited',{retryAfterMs:signalQuota.retryAfterMs});
        }
        return;
      }
      const kind=String(payload?.kind||'');
      if(!['offer','answer','candidate'].includes(kind)) throw new Error('Sinalização de voz inválida.');
      const targetSocketId=String(payload?.targetSocketId||'').slice(0,120);
      if(!targetSocketId || targetSocketId===socket.id) return;
      const target=currentVoiceSocketInRoom(current.room.code,targetSocketId);
      if(!target) return;
      const sessionId=String(payload?.sessionId||'').slice(0,120);
      if(!sessionId) throw new Error('Sessão de voz inválida.');
      let out={kind,sessionId};
      if(kind==='offer'||kind==='answer'){
        const sdp=payload?.sdp;
        if(!sdp||String(sdp.type||'')!==kind) throw new Error('Descrição de voz inválida.');
        const desc=String(sdp.sdp||'');
        if(desc.length<20||desc.length>24000) throw new Error('Descrição de voz fora do limite.');
        out.sdp={type:String(sdp.type),sdp:desc};
        if(kind==='offer'&&payload?.iceRestart===true)out.iceRestart=true;
      }else{
        const candidate=payload?.candidate;
        if(!candidate) return;
        const serialized=JSON.stringify(candidate);
        if(serialized.length>8000) throw new Error('Candidato de rede inválido.');
        out.candidate=candidate;
      }
      target.socket.emit('liveVoiceSignal',{
        ...out,
        fromSocketId:socket.id,
        fromParticipantId:current.actor.id,
        fromPlayerId:current.actor.id,
        fromRole:current.actor.role,
        fromName:current.actor.name,
      });
    }catch(e){ err(socket,e); }
  });


  socket.on('liveVoiceRelayPcm', payload => {
    try {
      const current=currentVoiceParticipant(socket);
      if(!current||!socket.data.liveVoiceOn)return;
      const codec=String(payload?.codec||'pcm16');
      const sampleRate=Number(payload?.sampleRate||0);
      if(sampleRate!==16000||!['mulaw8','pcm16'].includes(codec))return;
      const raw=payload?.pcm;let pcm=null;
      if(Buffer.isBuffer(raw))pcm=raw;
      else if(raw instanceof ArrayBuffer)pcm=Buffer.from(raw);
      else if(ArrayBuffer.isView(raw))pcm=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength);
      if(!pcm||pcm.length<1||pcm.length>16000)return;
      if(codec==='pcm16'&&pcm.length%2!==0)return;
      if(!liveVoiceRelayAllowed(socket,pcm.length))return;
      const {room,actor}=current,targetSocketIds=[];
      // V40.51 — o relay virou fallback SELETIVO. O remetente informa somente os
      // peers cujo WebRTC/Opus ainda não conectou ou caiu. Cada alvo é validado
      // novamente no servidor para impedir relay para sockets fora da própria sala.
      const requestedTargets=[...new Set(InputSafety.firstSafeStrings(payload?.targetSocketIds,{maxItems:12,maxLength:120}))];
      if(requestedTargets.length){
        for(const targetSocketId of requestedTargets){
          if(targetSocketId===socket.id)continue;
          const target=currentVoiceSocketInRoom(room.code,targetSocketId);
          if(target)targetSocketIds.push(targetSocketId);
        }
      }else if(actor.role===ROLE_SPECTATOR){
        // Compatibilidade com clientes V40.50 ainda abertos durante um deploy.
        for(const p of room.players)if(!p.isBot&&p.connected&&p.socketId&&p.socketId!==socket.id)targetSocketIds.push(p.socketId);
        for(const s of ensureSpectators(room))if(s.connected&&s.socketId&&s.socketId!==socket.id)targetSocketIds.push(s.socketId);
      }else{
        for(const s of ensureSpectators(room))if(s.connected&&s.socketId&&s.socketId!==socket.id)targetSocketIds.push(s.socketId);
      }
      if(!targetSocketIds.length)return;
      const packet={fromSocketId:socket.id,fromParticipantId:actor.id,fromPlayerId:actor.id,fromRole:actor.role,fromName:actor.name,sampleRate,codec,pcm};
      // Voz em tempo real não deve disputar a fila confiável da partida. Se o
      // transporte estiver congestionado, é melhor descartar um quadro velho do
      // que atrasar turnos, heartbeat ou reconexão.
      for(const socketId of targetSocketIds)io.to(socketId).volatile.emit('liveVoiceRelayPcm',packet);
    } catch(e) { err(socket,e); }
  });

  socket.on('startMatchmaking', payload => {
    try{
      if(socket.data.role===ROLE_SPECTATOR)throw new Error('Saia do Modo Observador antes de buscar outra partida.');
      updatePresenceFromSocket(socket,payload?.profile||{});
      const key=socket.data.auth.playerKey;
      const current=currentSocketRoom(socket);
      if(current&&current.room.status!=='finished')throw new Error('Saia da sala atual antes de buscar jogadores.');
      // V40.60: BUSCAR não é abandono. Uma reserva involuntária desconectada
      // continua válida durante a fila e também se a busca for cancelada.
      // A reserva só será encerrada dentro de formMatchmakingGroup(), depois
      // que a nova sala tiver sido criada com sucesso.
      const blocker=matchmakingBlockingRoomForKey(key);
      if(blocker)throw new Error(`Você já possui uma vaga ativa na sala ${blocker.code}. Saia dela antes de buscar jogadores.`);
      if(playerHasAcceptedInvite(key))throw new Error('Você possui um convite aceito com vaga reservada. Entre nele ou cancele a reserva antes de buscar.');
      if(matchmakingQueue.has(key)){
        MatchmakingDelivery.emitIfChanged(socket,matchmakingPayloadFor(key),{force:true});
        return;
      }
      enforceActionRate(socket,'startMatchmaking','Muitas tentativas de busca em pouco tempo.');
      const rec=presenceFor(key);if(!rec?.sockets?.size)throw new Error('Sua conexão ainda não está pronta.');
      rec.searching=true;
      matchmakingQueue.set(key,{playerKey:key,joinedAt:Date.now()});
      evaluateMatchmakingQueue();
    }catch(e){err(socket,e);}
  });

  socket.on('cancelMatchmaking', () => {
    try{
      const key=socket.data.auth.playerKey;
      if(removeFromMatchmaking(key,{reason:'Busca cancelada.'}))socket.emit('matchmakingCancelled',{message:'Busca cancelada.'});
      else emitMatchmakingIdle(key,'Você não está na fila.',true);
    }catch(e){err(socket,e);}
  });

  // V40.69.8.13 — jogador sorteado que chegou depois do sorteio/reiniciou o navegador.
  // Nunca altera a sala atual, nunca entrega códigos privados e ignora desistentes.
  socket.on('locateTournamentSeat',async()=>{
    try{
      const key=socket.data.auth?.playerKey;
      // Apenas espectadores do próprio torneio podem localizar a nova vaga;
      // espectadores comuns ou de outras competições não são promovidos.
      const watcher=socket.data.role===ROLE_SPECTATOR;
      if(!key||(watcher&&!socket.data.tournamentWatchId))return;
      const now=Date.now();
      if(now-Number(socket.data.lastTournamentSeatLookup||0)<2000)return;
      socket.data.lastTournamentSeatLookup=now;
      const playing=activePlayerRoomForKey(key);
      // V40.69.8.24: uma sala comum ainda não iniciada não pode impedir
      // o encaminhamento à final. Nunca mover automaticamente alguém de uma
      // partida em andamento ou de outra mesa de torneio.
      if(playing&&!TournamentSeatHandoff.canAutoSwitchFrom(playing))return;
      if(!await ensureTournamentBracketReady())return;
      const tournaments=await tournamentCatalog.list();
      for(const cup of tournaments){
        if(cup.status!=='closed'||(watcher&&cup.id!==socket.data.tournamentWatchId))continue;
        const original=await tournamentDraw.get(cup.id);
        if(!original.length)continue;
        const bracket=await tournamentBracket.summary(cup.id,original);
        if(bracket.champion)continue;
        const stage=bracket.currentStage;
        // A cadeira da fase atual não pode promover um observador da própria
        // fase nem interromper a observação de outro campeonato.
        if(watcher&&!TournamentObserverHandoff.canHandoffObserver({
          role:socket.data.role,watchTournamentId:socket.data.tournamentWatchId,
          watchStage:socket.data.tournamentWatchStage,tournamentId:cup.id,
          stage,automatic:true}))continue;
        const number=stage==='qualifier'?(await tournamentDraw.assignedTableFor(cup.id,key)):
          (await tournamentBracket.rows(cup.id)).find(row=>row.stage===stage&&row.players.some(p=>p.playerKey===key))?.number;
        if(!Number.isInteger(number)||number<1)continue;
        // Confere que a mesa ainda integra a fase atual, evitando estado obsoleto.
        const tables=stage==='qualifier'?original:(bracket.stages.find(x=>x.stage===stage)?.tables||[]);
        if(!tables.some(table=>table.number===number))continue;
        const binding=stage==='qualifier'?await tournamentGames.get(cup.id,number):
          await tournamentBracket.getBinding(cup.id,stage,number);
        if(binding?.result){
          // Recuperar o aviso após F5 ou saída da mesa encerrada sem fabricar
          // classificação: desempates só são confirmados após o novo sorteio.
          const currentRows=(await tournamentBracket.rows(cup.id)).filter(r=>r.stage===stage);
          const quota=typeof nextStage==='function'?nextStage(stage,currentRows)?.quota:null;
          const result=binding.result.results;
          const outcome=quota&&TournamentQualifiedWait.outcomeForPlayer(result,quota,key);
          if(outcome)socket.emit('tournamentTableOutcome',{
            tournamentId:cup.id,stage,tableNumber:number,status:outcome.status,
            remainingTables:currentRows.filter(r=>!r.result).length
          });
          return;
        }
        const room=binding?.roomCode?rooms.get(binding.roomCode):null;
        if(room?.tournament?.forfeits?.some(p=>p.playerKey===key))continue;
        socket.emit('tournamentSeatAssigned',{tournamentId:cup.id,stage,tableNumber:number});
        return;
      }
    }catch(e){console.error('[tournament] localização automática da mesa falhou:',e.message);}
  });

  // V40.69.8.25 — recuperação excepcional da final sem estado recuperável.
  // Não tenta reconstruir cartas nem reinicia partidas automaticamente.
  socket.on('repairTournamentFinal',async payload=>{
    const id=String(payload?.tournamentId||'').trim(),number=Number(payload?.tableNumber);
    const lockKey=`${id}:final:${number}`;
    try{
      if(payload?.confirm!==true||!/^[-a-z0-9]{3,64}$/i.test(id)||number!==1)
        throw new Error('Confirmação de recuperação inválida.');
      if(!await tournamentCanManage(socket.data.auth,id))throw new Error('Somente o organizador pode recuperar esta mesa.');
      if(!await ensureTournamentBracketReady())throw new Error('Torneios temporariamente indisponíveis.');
      await requireRoomPersistenceReady();
      const original=await tournamentDraw.get(id);
      const bracket=await tournamentBracket.summary(id,original);
      if(bracket.currentStage!=='final'||bracket.champion)throw new Error('Esta final não está pendente.');
      if(tournamentTableJoinLocks.has(lockKey))throw new Error('A final está sendo acessada. Aguarde.');
      tournamentTableJoinLocks.add(lockKey);
      try{
        const binding=await tournamentBracket.getBinding(id,'final',number);
        if(!binding?.roomCode||binding.result||!['started','legacy'].includes(binding.roomState))
          throw new Error('A final mudou de estado. Atualize o painel.');
        if(rooms.has(binding.roomCode))throw new Error('A sala da final está ativa. Não é necessário reiniciá-la.');
        if(await roomSnapshotStore.hasStoredSnapshot(binding.roomCode))
          throw new Error('Existe um estado de partida preservado. A recuperação automática foi bloqueada para não perder pontos ou cartas.');
        // Compare-and-swap no banco: se outra instância mudou o vínculo,
        // não sobrescrever o resultado nem a vaga de ninguém.
        await tournamentBracket.reopenUnrecoverable(id,'final',number,binding.roomCode);
        console.warn('[tournament] final reaberta por organizador após ausência de sala e snapshot',{id,number});
      }finally{tournamentTableJoinLocks.delete(lockKey);}
      const updated=await tournamentBracket.summary(id,original);
      const final=updated.stages.find(stage=>stage.stage==='final');
      if(final)await notifyTournamentSeats(id,'final',final.tables);
      socket.emit('tournamentFinalRepairResult',{ok:true,message:'Final liberada. Os classificados serão encaminhados novamente; a partida continua com início manual.'});
    }catch(e){socket.emit('tournamentFinalRepairResult',{ok:false,message:e?.message||'Não foi possível recuperar a final.'});}
  });

  // V51.4: entrada autenticada na mesa atribuída pelo sorteio, sem aceitar código de terceiros.
  socket.on('enterTournamentTable', async payload=>{
    const id=String(payload?.tournamentId||'').trim();
    const number=Number(payload?.tableNumber);
    const phase=String(payload?.stage||'qualifier');
    const lockKey=`${id}:${phase}:${number}`;
    try{
      // V40.69.8.54: permitir apenas o salto AUTOMÁTICO de um observador
      // autorizado de fase anterior da MESMA competição. A vaga continua sendo
      // validada abaixo pelo sorteio oficial, antes de tocar na sessão atual.
      if(socket.data.role===ROLE_SPECTATOR&&!TournamentObserverHandoff.canHandoffObserver({
        role:socket.data.role,watchTournamentId:socket.data.tournamentWatchId,
        watchStage:socket.data.tournamentWatchStage,tournamentId:id,stage:phase,
        automatic:payload?.automatic}))
        throw new Error('Saia do modo observador antes de entrar na mesa.');
      if(!await ensureTournamentBracketReady())throw new Error('Mesas do torneio temporariamente indisponíveis.');
      if(!/^[-a-z0-9]{3,64}$/i.test(id)||!Number.isInteger(number)||number<1)throw new Error('Mesa inválida.');
      if(tournamentTestDeleteLocks.has(id))throw new Error('Este torneio de teste está sendo encerrado pelo organizador.');
      const initial=await tournamentDraw.get(id);
      const bracket=await tournamentBracket.summary(id,initial);
      if(phase!==bracket.currentStage||bracket.champion)throw new Error('Esta fase já foi concluída ou ainda não começou.');
      const seat=phase==='qualifier'?await tournamentDraw.seatFor(id,number,socket.data.auth?.playerKey):
        await tournamentBracket.seatFor(id,phase,number,socket.data.auth?.playerKey);
      if(!seat)throw new Error('Sua conta não foi sorteada para esta mesa.');
      // Impede criar ou recuperar mesas antigas com cinco cadeiras: a
      // recuperação nunca refaz sorteios e não remove participantes.
      assertTournamentTable(seat.players);
      if(phase!=='qualifier'){
        const other=activePlayerRoomForKey(socket.data.auth.playerKey);
        if(other&&(other.tournament?.id!==id||other.tournament?.phase!==phase||other.tournament?.tableNumber!==number)
          && !TournamentSeatHandoff.canAutoSwitchFrom(other))
          throw new Error('Você ainda está em outra partida. Encerre ou saia dessa mesa antes de entrar na próxima fase pelo painel Torneios.');
      }
      if(payload?.automatic){
        // V40.69.8.38: convocação da etapa seguinte é automática, mas a
        // autorização permanece vinculada à conta e ao sorteio. Nunca tirar
        // alguém de outra partida ativa, observador ou torneio diferente.
        // Uma sala FINALIZADA de outro jogo também não é descartada sem
        // consentimento (pode ter uma revanche pendente).
        const previous=socket.data.roomCode?rooms.get(socket.data.roomCode):null;
        if(phase!=='qualifier'&&previous?.status==='finished'&&
          (!previous.tournament||previous.tournament.id!==id))
          throw new Error('Conclua a sessão anterior antes de avançar automaticamente neste torneio.');
        const other=activePlayerRoomForKey(socket.data.auth.playerKey);
        if(other&&(other.tournament?.id!==id||other.tournament?.phase!==phase||other.tournament?.tableNumber!==number)
          &&!TournamentSeatHandoff.canAutoSwitchFrom(other))
          throw new Error('Você está em outra partida. Aguarde seu término antes de avançar no torneio.');
      }
      // A validação da desistência é repetida no caminho de entrada abaixo,
      // após identificar a sala persistida (evita o retorno entre rodadas).
      const event=await tournamentCatalog.get(id);
      if(!event||event.status!=='closed')throw new Error('O torneio deve estar com as inscrições encerradas.');
      await awaitTournamentTableJoinLock(lockKey);
      try{
        if(tournamentTestDeleteLocks.has(id))throw new Error('Este torneio de teste está sendo encerrado pelo organizador.');
        let binding=phase==='qualifier'?await tournamentGames.get(id,number):await tournamentBracket.getBinding(id,phase,number);
        let room=binding?.roomCode?rooms.get(binding.roomCode):null;
        // V40.69.8.36: um vínculo de fase só pode reutilizar a sala EXATA
        // do torneio, etapa e mesa, com o mesmo elenco sorteado. Uma colisão
        // ou estado legado trocado nunca deve admitir pessoas na sala errada.
        if(room){
          const tournament=room.tournament;
          const expected=new Set(seat.players.map(p=>p.playerKey));
          const actual=tournament?.rosterKeys;
          if(!tournament || tournament.id!==id || tournament.phase!==phase ||
            Number(tournament.tableNumber)!==number || !Array.isArray(actual) ||
            actual.length!==expected.size || actual.length>MAX_TOURNAMENT_PLAYERS ||
            (room.players.length>MAX_TOURNAMENT_PLAYERS ||
              new Set(room.players.map(p=>p.playerKey)).size!==room.players.length) || actual.some(key=>!expected.has(key)) ||
            room.players.some(p=>p.isBot || (p.playerKey&&!expected.has(p.playerKey)))){
            console.error('[tournament] vínculo apontando para sala incompatível, ingresso recusado',
              {id,phase,number,hasTournament:!!tournament});
            throw new Error('A sala vinculada a esta fase possui dados incompatíveis com o sorteio. A entrada foi bloqueada para preservar os resultados.');
          }
        }
        // Uma sala restaurada de snapshot de versão anterior pode ainda não ter
        // os dados públicos da programação. Sincronize-os com o catálogo real.
        if(room?.tournament){room.tournament.startAt=event.startAt;room.tournament.name=event.name;}
        // A sala restaurada mantém suas regras do snapshot; não reinicializar partidas em curso.
        if(binding?.result)throw new Error('Esta mesa já concluiu sua partida.');
        if(room?.tournament?.forfeits?.some(p=>p.playerKey===socket.data.auth?.playerKey))
          throw new Error('Você desistiu desta mesa e não pode retornar ao torneio.');
        let recoveringLobby=false;
        // V40.69.8.36 — a próxima fase já tem uma linha de reserva no banco,
        // mas AINDA NÃO TEM sala. Só recuperar quando há um código anterior:
        // sem roomCode, o primeiro classificado deve criar o lobby normalmente.
        if(binding?.roomCode&&!room){
          // Um vínculo de lobby não é uma partida. Antes de criar outro código,
          // tentar recuperar a sala EXATA do snapshot durável, se ainda for um
          // lobby nunca iniciado com o elenco original. Jamais recriar playing.
          await requireRoomPersistenceReady();
          const activeSnapshots=await roomSnapshotStore.loadActive();
          const stored=activeSnapshots.find(s=>s?.code===binding.roomCode);
          const deleted=roomSnapshotStore.isRoomDeleted(binding.roomCode);
          const hasStoredSnapshot=await roomSnapshotStore.hasStoredSnapshot(binding.roomCode);
          if(stored && !deleted && TournamentReservedLobby.canRestore(stored,binding,seat,{id,phase,number})){
            const restored=restoreRoomSnapshot(stored,{reconnectGraceMs:runtimeReconnectGraceMs()});
            if(!restored || restored.code!==binding.roomCode)
              throw new Error('O lobby anterior não pôde ser restaurado. A partida não será reiniciada.');
            ensureSocial(restored);
            if(!rooms.has(restored.code)){
              rooms.set(restored.code,restored);
              for(const previous of restored.players)scheduleRestoredPlayerGrace(restored,previous);
              refreshOfflineRoomExpiry(restored);
              console.info('[tournament] lobby restaurado para entrada de classificado',{id,phase,number});
            }
            room=rooms.get(restored.code);
          }
          if(!room){
            recoveringLobby=TournamentLobbyRecovery.canRecoverMissingLobby(binding,{
              snapshotsReady:snapshotsRestored,activeSnapshot:hasStoredSnapshot,deleted
            });
            if(!recoveringLobby){
              const state=TournamentTableHealth.classify(binding,{snapshotsReady:snapshotsRestored,
                activeSnapshot:hasStoredSnapshot,deleted});
              console.warn('[tournament] entrada bloqueada por estado anterior',{id,phase,number,state,roomState:binding.roomState,hasStoredSnapshot});
              if(hasStoredSnapshot)
                throw new Error('A mesa anterior possui dados salvos que não puderam ser recuperados com segurança. Avise o organizador; nenhuma partida será apagada.');
              if(state==='recovery-required')
                throw new Error('A mesa do torneio possui um registro de partida anterior sem sala disponível. Solicite análise ao organizador; não recrie uma partida iniciada.');
              throw new Error('A mesa anterior ainda está sendo verificada. Atualize Torneios e tente novamente; se persistir, avise o organizador.');
            }
          }
        }
        if(!room){
          // Gravar o lobby ANTES de vinculá-lo ao sorteio no banco. Assim um
          // reinício entre os dois passos nunca deixa uma fase apontando para
          // sala que não possui snapshot recuperável.
          await requireRoomPersistenceReady();
          enforceActionRate(socket,'createRoom','Aguarde antes de criar outra mesa.');
          const releaseRoomSlot=reserveRoomCreationSlot([socket.data.auth.playerKey]);
          let code=null,claimCommitted=false;
          try{
            // Evitar colisão com snapshot ainda persistido, inclusive um
            // lobby órfão que não está presente no mapa em memória.
            for(let tries=0;tries<8&&!code;tries++){
              const candidateCode=roomCode();
              if(!await roomSnapshotStore.hasStoredSnapshot(candidateCode))code=candidateCode;
            }
            if(!code)throw new Error('Não foi possível reservar um código livre para a mesa. Tente novamente.');
            const candidate=Engine.createRoom(code,{socketId:socket.id,token:crypto.randomUUID(),
              name:cleanPresenceName(socket.data.auth.name),avatar:cleanAvatar(payload?.avatar||'macaco'),playerKey:socket.data.auth.playerKey});
            const deadlineAt=await tournamentWaitDeadline(id,phase,number,binding);
            // Toda fase e toda mesa herdam a mesma regra persistida no catálogo.
            candidate.rules.rounds=event.rounds;
            candidate.tournament={id,phase,tableNumber:number,rosterKeys:seat.players.map(p=>p.playerKey),
              rosterNames:seat.players.map(p=>({playerKey:p.playerKey,name:p.name})),waitDeadlineAt:deadlineAt,
              startAt:event.startAt,name:event.name,rounds:event.rounds,forfeits:[]};
            candidate.isPublic=false;ensureSocial(candidate);
            await prepareForRoomSwitch(socket,code);
            const saved=await roomSnapshotStore.saveNow(candidate);
            if(saved!==true)throw new Error('Não foi possível salvar a nova mesa do torneio. Nenhuma sala vazia foi vinculada. Tente novamente.');
            binding=recoveringLobby?
              (phase==='qualifier'?await tournamentGames.reclaimLobby(id,number,binding.roomCode,code):
                await tournamentBracket.reclaimLobby(id,phase,number,binding.roomCode,code)):
              (phase==='qualifier'?await tournamentGames.claim(id,number,code):await tournamentBracket.claim(id,phase,number,code));
            if(binding?.roomCode!==code)throw new Error('Esta mesa já foi criada em outra conexão. Atualize Torneios e tente entrar novamente.');
            claimCommitted=true;
            rooms.set(code,candidate);room=candidate;
            if(recoveringLobby)console.info('[tournament] lobby não iniciado recuperado',{id,phase,number});
          }catch(error){
            if(code&&!claimCommitted){
              try{await roomSnapshotStore.markRoomDeleted(code,Date.now());}
              catch(cleanup){console.error('[tournament] falha ao descartar preparação incompleta',{id,phase,number,message:cleanup?.message});}
            }
            throw error;
          }finally{releaseRoomSlot();}
          const p=room.players[0];socket.data.roomCode=code;socket.data.playerId=p.id;
          socket.data.spectatorId=null;socket.data.role=ROLE_PLAYER;socket.join(code);
          updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
          StateDelivery.invalidate(socket);socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source:'tournament'});
          emitChatHistory(socket,room);emitRoom(room);broadcastPresence();
          removeFromMatchmaking(socket.data.auth.playerKey,{reason:'Você entrou no torneio.',notify:true});
        }else{
          if(room.status==='finished')throw new Error('A partida desta mesa já terminou.');
          if(room.status!=='lobby'){
            // V40.69.8.20 — a partida iniciada não aceita novas cadeiras.
            // A atribuição autenticada pode apenas retomar uma cadeira humana
            // que já pertença a esta conta (inclusive F5, outra aba e reconexão).
            // Antes havia um evento tournamentTableResume sem receptor no cliente:
            // a interface aguardava até esgotar as tentativas sem retornar à mesa.
            const existing=TournamentSeatRecovery.memberForResume(room,socket.data.auth?.playerKey);
            if(!existing)throw new Error('A partida já começou e sua cadeira não está disponível para retomada. Confira a situação do torneio.');
            await resumeReservedPlayerSeat(socket,room,existing,{source:'tournament-resume'});
            return;
          }
          if(tournamentRoundStartLocks.has(room.code))
            throw new Error('Esta mesa está iniciando. Aguarde a confirmação antes de entrar.');
          await joinSocketIntoRoom(socket,room,{source:'tournament'});
        }
      }finally{tournamentTableJoinLocks.delete(lockKey);}
    }catch(e){
      const reason=e?.message||'Não foi possível acessar a mesa.';
      console.warn('[tournament] ingresso de classificado recusado',{id,phase,number,reason});
      socket.emit('tournamentTableEntryResult',{ok:false,tournamentId:id,stage:phase,tableNumber:number,message:reason});
      err(socket,e);
    }
  });

  socket.on('createRoom', async payload => {
    let releaseRoomSlot=null;
    try {
      if(socket.data.role===ROLE_SPECTATOR)throw new Error('Saia do Modo Observador antes de criar outra sala.');
      const switchState=roomSwitchConfirmationState(socket,payload,{
        action:'create-room',targetCode:'__NEW_ROOM__',exceptCode:null,targetRole:ROLE_PLAYER,targetLabel:'uma nova sala',
        context:{withBot:!!payload?.withBot,publicRoom:payload?.publicRoom!==false},
      });
      if(switchState.required&&!switchState.confirmed)return;
      enforceActionRate(socket,'createRoom','Muitas criações de sala em pouco tempo.');
      releaseRoomSlot=reserveRoomCreationSlot([socket.data.auth?.playerKey]);
      const code = roomCode();
      const room = Engine.createRoom(code, {
        socketId:socket.id,
        token:InputSafety.cleanOpaqueId(payload?.token,160)||undefined,
        name:cleanPresenceName(payload?.name || socket.data.auth.name),
        avatar:cleanAvatar(payload?.avatar),
        playerKey:socket.data.auth.playerKey,
      });
      room.isPublic = payload?.publicRoom !== false;
      ensureSocial(room);
      if (payload?.withBot) addBotToRoom(room);
      // V40.60: toda a nova sala é preparada primeiro. Somente depois que
      // criação/configuração terminam com sucesso a reserva anterior é cancelada.
      await prepareForRoomSwitch(socket,code);
      removeFromMatchmaking(socket.data.auth.playerKey,{reason:'Busca encerrada porque você criou uma sala.',notify:true});
      rooms.set(code,room);
      const p=room.players[0];
      socket.data.roomCode=code; socket.data.playerId=p.id; socket.data.spectatorId=null; socket.data.role=ROLE_PLAYER;
      socket.join(code);
      updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
      StateDelivery.invalidate(socket);socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER});
      emitChatHistory(socket, room);
      emitRoom(room);
      broadcastPresence();
    } catch(e){err(socket,e);}
    finally{if(releaseRoomSlot)releaseRoomSlot();}
  });

  socket.on('setRoomPublic', payload => withRoom(socket,(room,p)=>{
    if(room.tournament)throw new Error('A visibilidade da mesa de torneio não pode ser alterada.');
    if(!p.host) throw new Error('Somente o anfitrião pode alterar a visibilidade da sala.');
    room.isPublic=!!payload?.isPublic;
    Engine.appendLog(room,room.isPublic?'👁️ Sala pública: pode ser encontrada por observadores.':'🔒 Sala privada: removida da Central de Partidas ao Vivo.','system');
    emitRoom(room);broadcastPresence();
  }));

  socket.on('joinRoom', async payload => {
    try {
      const code=InputSafety.cleanRoomCode(payload?.code);
      const room=rooms.get(code);
      const requestedToken=InputSafety.cleanOpaqueId(payload?.token,160);
      const legitimateSavedResume=!!(payload?.resumeIntent==='saved-session'&&room&&requestedToken&&room.players.some(x=>!x.isBot&&x.token===requestedToken&&x.playerKey===socket.data.auth.playerKey));
      if(!legitimateSavedResume)enforceActionRate(socket,'joinRoom','Muitas tentativas de entrada por código em pouco tempo.');
      if(!room) throw new Error('Sala não encontrada.');
      if(room.tournament && !room.tournament.rosterKeys.includes(socket.data.auth?.playerKey))
        throw new Error('Somente os participantes sorteados podem ocupar vagas nesta mesa.');
      if(room.tournament?.forfeits?.some(p=>p.playerKey===socket.data.auth?.playerKey))
        throw new Error('Você foi desclassificado por desistência e não pode retornar à mesa.');
      ensureSocial(room);

      let p=null;
      let switchPrepared=false;
      const prepareSuccessfulEntry=async()=>{
        if(switchPrepared)return;
        await prepareForRoomSwitch(socket,code);
        switchPrepared=true;
      };

      // 1) Token persistente do mesmo navegador: serve para refresh/queda involuntária.
      // Uma saída voluntária troca/remove esse token da cadeira, então um token antigo
      // jamais recria a reserva cancelada.
      if(requestedToken){
        const existing=room.players.find(x=>!x.isBot&&x.token===requestedToken);
        if(existing?.playerKey&&existing.playerKey!==socket.data.auth.playerKey){
          throw new Error('Esta vaga pertence a outra conta.');
        }
        if(existing){
          await prepareSuccessfulEntry();
          if(existing.socketId&&existing.socketId!==socket.id)retireReplacedSocket(existing.socketId,{roomCode:room.code});
          const wasDisconnected=!existing.connected;
          const wasAutoControlled=!!existing.autoControlled;
          cancelDisconnectDebounce(ROLE_PLAYER,room.code,existing.id);
          cancelReconnectTimer(room.code,existing.id);
          if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
          p=Engine.reconnectPlayer(room,existing.token,socket.id);
          if(p){p.voluntaryLeftAt=null;p.reconnectEligible=false;}
          if(p&&wasDisconnected){
            Engine.appendLog(room,wasAutoControlled
              ? `🟢 ${p.name} voltou e retomou seu lugar da Máquina.`
              : `🟢 ${p.name} voltou à mesa dentro do prazo de reconexão.`,'system');
            socket.emit('reconnectionEvent',{kind:wasAutoControlled?'returned-from-auto':'returned',playerId:p.id,name:p.name});
            io.to(room.code).except(socket.id).emit('reconnectionEvent',{kind:'returned',playerId:p.id,name:p.name});
          }
        }
      }

      // 2) Mesma conta autenticada, sem token local: só pode recuperar automaticamente
      // uma cadeira desconectada que ainda possua reserva involuntária válida.
      if(!p){
        const byKey=room.players.find(x=>!x.isBot&&x.playerKey===socket.data.auth.playerKey);
        if(byKey){
          const liveSocket=byKey.socketId?io.sockets.sockets.get(byKey.socketId):null;
          const connectedTransfer=!!(byKey.connected&&liveSocket&&byKey.socketId!==socket.id);
          if(!byKey.reconnectEligible&&!connectedTransfer&&byKey.socketId!==socket.id){
            throw new Error('Sua reserva automática para esta sala não é mais válida. Entre novamente como novo jogador quando a sala permitir.');
          }
          const switchState=roomSwitchConfirmationState(socket,payload,{
            action:'join-room',targetCode:code,exceptCode:code,targetRole:ROLE_PLAYER,targetLabel:`sala ${code}`,
          });
          if(switchState.required&&!switchState.confirmed)return;
          await prepareSuccessfulEntry();
          cancelDisconnectDebounce(ROLE_PLAYER,room.code,byKey.id);
          cancelReconnectTimer(room.code,byKey.id);
          if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}
          if(byKey.socketId&&byKey.socketId!==socket.id)retireReplacedSocket(byKey.socketId,{roomCode:room.code});
          p=Engine.reconnectPlayer(room,byKey.token,socket.id);
          if(p){p.voluntaryLeftAt=null;p.reconnectEligible=false;}
        }
      }

      // Um token salvo no navegador é somente prova de uma tentativa de RETOMADA,
      // não uma autorização para criar uma vaga nova. Se a cadeira já foi liberada
      // por SAIR/troca de sala, o token fica obsoleto e deve ser descartado.
      if(!p&&payload?.resumeIntent==='saved-session'){
        throw new Error('A reserva de reconexão desta sessão não é mais válida.');
      }

      // 3) Entrada normal por código/link depois de saída voluntária ou troca de sala.
      // Durante uma rodada, a pessoa pode apenas observar; entre rodadas, pode entrar
      // como novo jogador enquanto ainda houver uma próxima rodada.
      if(!p){
        if(room.tournament&&room.round>0)throw new Error('Não é permitido entrar na mesa após o início do torneio.');
        const lateJoinClosed=room.status==='between-rounds'&&Number(room.round||0)>=Number(room.rules?.rounds||5);
        if(room.status==='playing'||lateJoinClosed){
          socket.emit('spectatorOffer',{code:room.code,round:room.round,rounds:room.rules.rounds,playerCount:room.players.length,status:room.status});
          return;
        }
        if(room.status==='finished')throw new Error('A partida desta sala já terminou.');
        if(!roomHasInviteCapacity(room,socket.data.auth.playerKey)){
          throw new Error('A sala está completa ou possui vaga reservada por convite.');
        }
        const switchState=roomSwitchConfirmationState(socket,payload,{
          action:'join-room',targetCode:code,exceptCode:code,targetRole:ROLE_PLAYER,targetLabel:`sala ${code}`,
        });
        if(switchState.required&&!switchState.confirmed)return;
        await prepareSuccessfulEntry();
        p=Engine.addPlayer(room,{socketId:socket.id,token:crypto.randomUUID(),name:cleanPresenceName(payload?.name||socket.data.auth.name),avatar:cleanAvatar(payload?.avatar),playerKey:socket.data.auth.playerKey});
      }

      removeFromMatchmaking(socket.data.auth.playerKey,{reason:'Busca encerrada porque você entrou em uma sala.',notify:true});
      const acceptedManualInvite=[...invitations.values()].find(i=>i.toKey===socket.data.auth.playerKey&&i.targetRoomCode===code&&['accepted-waiting','ready'].includes(i.status));
      releaseReservation(room,socket.data.auth.playerKey);
      socket.data.roomCode=code;socket.data.playerId=p.id;socket.data.spectatorId=null;socket.data.role=ROLE_PLAYER;
      socket.join(code);
      updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
      StateDelivery.invalidate(socket);socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER});
      emitChatHistory(socket,room);
      emitRoom(room);
      broadcastPresence();
      if(acceptedManualInvite)completeInvite(acceptedManualInvite,'✅ Você entrou na mesa reservada.');
    } catch(e){err(socket,e);}
  });

  // V40.69.8.4.2: espectadores de torneios compartilham o modo seguro de
  // observação, mas entram exclusivamente pelo ID de torneio/fase/mesa.
  async function joinSpectatorSocket(payload,{tournamentWatch=false}={}) {
    let releaseSpectatorSlot=null;
    try{
      const code=InputSafety.cleanRoomCode(payload?.code);
      const room=rooms.get(code);
      if(!room)throw new Error('Sala não encontrada.');ensureSocial(room);
      if(!!room.tournament!==tournamentWatch)
        throw new Error(room.tournament?'Assista pelo painel do torneio.':'Esta não é uma mesa de torneio.');
      if(tournamentWatch?room.status==='finished':(Number(room.round||0)<=0||room.status==='lobby'))
        throw new Error(tournamentWatch?'Esta mesa já terminou.':'Você poderá assistir quando a mesa estiver em andamento.');
      const key=socket.data.auth.playerKey;
      const playerSeat=room.players.find(p=>!p.isBot&&p.playerKey===key);
      if(playerSeat)throw new Error('Você já possui uma vaga de jogador nesta sala. Reconecte como jogador.');
      // Assistir jamais cancela silenciosamente uma cadeira competitiva ativa.
      if(tournamentWatch&&playerHasActiveRoom(key,code))
        throw new Error('Saia da partida atual antes de assistir a outra mesa.');
      const token=InputSafety.cleanOpaqueId(payload?.token,160)||crypto.randomUUID();
      let spectator=room.spectators.find(s=>s.token===token||s.playerKey===key);
      if(spectator&&spectator.playerKey!==key)throw new Error('Esta vaga de observador pertence a outra conta.');
      if(!spectator){
        enforceActionRate(socket,'joinSpectator','Muitas tentativas de entrada como observador em pouco tempo.');
        releaseSpectatorSlot=reserveSpectatorJoinSlot(room);
      }
      const switchState=roomSwitchConfirmationState(socket,payload,{
        action:'join-spectator',targetCode:code,exceptCode:code,targetRole:ROLE_SPECTATOR,targetLabel:`sala ${code} como observador`,
      });
      if(switchState.required&&!switchState.confirmed)return;
      await prepareForRoomSwitch(socket,code);
      let firstJoin=false;
      if(spectator){
        cancelDisconnectDebounce(ROLE_SPECTATOR,code,spectator.id);
        cancelSpectatorReconnectTimer(code,spectator.id);
        if(spectator.socketId&&spectator.socketId!==socket.id)retireReplacedSocket(spectator.socketId,{roomCode:room.code});
        spectator.socketId=socket.id;spectator.connected=true;spectator.disconnectedAt=null;
        spectator.name=cleanPresenceName(payload?.name||spectator.name||socket.data.auth.name);
        spectator.avatar=cleanAvatar(payload?.avatar||spectator.avatar||'macaco');
      }else{
        firstJoin=true;
        spectator={id:`s_${crypto.randomUUID()}`,token,playerKey:key,name:cleanPresenceName(payload?.name||socket.data.auth.name),avatar:cleanAvatar(payload?.avatar||'macaco'),socketId:socket.id,connected:true,joinedAt:Date.now(),disconnectedAt:null,role:ROLE_SPECTATOR};
        room.spectators.push(spectator);
      }
      // A posse da conta é validada pela autenticação Socket.IO. Apenas então
      // um pedido recuperado do snapshot pode ser associado à nova sessão.
      if(!tournamentWatch)SpectatorSeatAdmission.claimRestoredSeatRequest(room,spectator);
      removeFromMatchmaking(key,{reason:'Busca encerrada porque você entrou como observador.',notify:true});
      socket.data.roomCode=code;socket.data.playerId=null;socket.data.spectatorId=spectator.id;socket.data.role=ROLE_SPECTATOR;
      // Estado de confiança do SERVIDOR, nunca fornecido pelo navegador.
      socket.data.tournamentWatchId=tournamentWatch?room.tournament.id:null;
      socket.data.tournamentWatchStage=tournamentWatch?room.tournament.phase:null;
      socket.join(code);
      updatePresenceFromSocket(socket,{name:spectator.name,avatar:spectator.avatar});
      StateDelivery.invalidate(socket);
      socket.emit('joined',{code,spectatorId:spectator.id,token:spectator.token,role:ROLE_SPECTATOR,
        tournamentWatch,tournamentId:room.tournament?.id||null,
        stage:room.tournament?.phase||null,tableNumber:room.tournament?.tableNumber||null});
      if(!tournamentWatch)emitChatHistory(socket,room);
      if(firstJoin&&!tournamentWatch)appendSystemChat(room,`👁️ ${spectator.name} entrou como observador.`);
      emitRoom(room);broadcastPresence();
    }catch(e){err(socket,e);}
    finally{if(releaseSpectatorSlot)releaseSpectatorSlot();}
  }
  socket.on('joinSpectator',payload=>joinSpectatorSocket(payload));

  socket.on('watchTournamentTable',async payload=>{
    try{
      if(!await ensureTournamentBracketReady())throw new Error('Mesas do torneio temporariamente indisponíveis.');
      const id=String(payload?.tournamentId||'');
      const stage=String(payload?.stage||'');
      const tableNumber=Number(payload?.tableNumber);
      if(!/^[-a-z0-9]{3,64}$/i.test(id)||!['qualifier','quarter','semi','final'].includes(stage)
        ||!Number.isInteger(tableNumber)||tableNumber<1)
        throw new Error('Mesa do torneio inválida.');
      const cup=await tournamentCatalog.get(id);
      if(!cup||cup.status!=='closed')throw new Error('Torneio indisponível para observação.');
      const bracket=await tournamentBracket.summary(id,await tournamentDraw.get(id));
      if(bracket.champion||stage!==bracket.currentStage)
        throw new Error('Esta fase não está mais em andamento.');
      const binding=stage==='qualifier'?await tournamentGames.get(id,tableNumber):
        await tournamentBracket.getBinding(id,stage,tableNumber);
      const room=binding?.roomCode?rooms.get(binding.roomCode):null;
      if(binding?.result||!room||!room.tournament||room.tournament.id!==id
        ||room.tournament.phase!==stage||room.tournament.tableNumber!==tableNumber)
        throw new Error('Esta mesa ainda não começou ou já foi encerrada.');
      await joinSpectatorSocket({...payload,code:room.code},{tournamentWatch:true});
    }catch(e){err(socket,e);}
  });

  // Entrada de observadores: pedidos em ordem de chegada, somente em mesas comuns.
  socket.on('requestSpectatorSeat', () => {
    try {
      const room=rooms.get(socket.data.roomCode);
      if(!room||socket.data.role!==ROLE_SPECTATOR)throw new Error('Entre como observador primeiro.');
      const spectator=spectatorForSocket(room,socket);
      if(!spectator||!spectator.connected||spectator.socketId!==socket.id)throw new Error('Observador não está conectado nesta sala.');
      if(room.tournament)throw new Error('Não é possível entrar em torneios como observador.');
      if(!['playing','between-rounds'].includes(room.status)||room.round<=0||room.round>=room.rules.rounds)
        throw new Error('A entrada de observadores está encerrada nesta partida.');
      if(room.players.some(p=>!p.isBot&&p.playerKey===spectator.playerKey))throw new Error('Você já tem uma cadeira nesta sala.');
      ensureInviteReservations(room);
      if(!Array.isArray(room.spectatorSeatRequests))room.spectatorSeatRequests=[];
      // Solicitações repetidas não alteram a posição nem falham por uma vaga
      // que tenha sido reservada DEPOIS do primeiro pedido legítimo.
      const existing=room.spectatorSeatRequests.some(x=>x.spectatorId===spectator.id||x.playerKey===spectator.playerKey);
      if(existing){
        // ETAPA 3 — cliques/retries duplicados não refazem processamento,
        // persistência de sala nem broadcasts para todos os participantes.
        const seat=SpectatorSeatAdmission.seatStatus(room,spectator);
        socket.emit('spectatorSeatStatus',{status:'queued',position:seat.queuePosition,message:seat.message});
        return;
      }
      if(!roomHasInviteCapacity(room,spectator.playerKey))throw new Error('Não há vagas livres nesta mesa.');
      room.spectatorSeatRequests.push({spectatorId:spectator.id,playerKey:spectator.playerKey,at:Date.now()});
      const seat=SpectatorSeatAdmission.seatStatus(room,spectator);
      socket.emit('spectatorSeatStatus',{status:'queued',position:seat.queuePosition,message:seat.message});
      if(room.status==='between-rounds')processSpectatorSeatRequests(room);
      emitRoom(room);
    }catch(e){err(socket,e);}
  });

  socket.on('addBot', () => withRoom(socket,(room,p)=>{
    if(room.tournament)throw new Error('Máquinas não podem ocupar vagas em torneios.');
    if(!p.host) throw new Error('Somente o anfitrião pode adicionar uma máquina.');
    if(room.status==='playing') throw new Error('Adicione máquinas somente fora de uma rodada.');
    if(!roomHasInviteCapacity(room,null)) throw new Error('Há vaga reservada por convite; não é possível adicionar outra máquina agora.');
    addBotToRoom(room);
    broadcastPresence();
  }));

  // Dificuldade exclusiva dos bots permanentes da sala, nunca do AUTO de
  // reconexão. Apenas anfitrião e somente fora de uma rodada.
  socket.on('setBotDifficulty', payload => withRoom(socket,(room,p)=>{
    if(room.tournament)throw new Error('Torneios não permitem alterar o nível da máquina.');
    if(!p.host)throw new Error('Somente o anfitrião pode escolher o nível da máquina.');
    if(!['lobby','between-rounds'].includes(room.status))throw new Error('Altere o nível somente entre rodadas.');
    if(!room.players.some(x=>x.isBot))throw new Error('Adicione uma máquina antes de escolher seu nível.');
    const level=payload?.level;
    if(!BotDifficulty.LEVELS.includes(level))throw new Error('Nível inválido. Escolha Fácil, Normal ou Difícil.');
    if(room.botDifficulty===level)return;
    room.botDifficulty=level;
    Engine.appendLog(room,`🤖 Nível da Máquina: ${{easy:'Fácil',normal:'Normal',hard:'Difícil'}[level]}.`, 'system');
  }));

  socket.on('removeBot', () => withRoom(socket,(room,p)=>{
    if(room.tournament)throw new Error('Mesas de torneio não permitem manipular máquinas.');
    if(!p.host) throw new Error('Somente o anfitrião pode remover uma máquina.');
    if(room.status==='playing') throw new Error('Remova máquinas somente fora de uma rodada.');
    const bot = [...room.players].reverse().find(x => x.isBot);
    if(!bot) throw new Error('Não há jogador automático para remover.');
    room.players = room.players.filter(x => x.id !== bot.id);
    Engine.appendLog(room, `${bot.name} foi removido da mesa.`, 'system');
    ensureHost(room);
    broadcastPresence();
  }));

  // V40.69.8.48: ações separadas e validadas no servidor.
  // Mensagens legadas sem modo continuam aceitas apenas para salas comuns
  // e observadores; em torneio não podem provocar desistência silenciosa.
  socket.on('leaveRoom', async (payloadOrAck,optionalAck) => {
    const payload=typeof payloadOrAck==='function'?null:payloadOrAck;
    const ack=typeof payloadOrAck==='function'?payloadOrAck:optionalAck;
    const answer=(data={})=>{try{if(typeof ack==='function')ack({ok:true,...data})}catch{}};
    try {
      const code=socket.data.roomCode;
      const playerId=socket.data.playerId;
      const room=rooms.get(code);
      if(!room){
        socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;
        socket.emit('leftRoom');answer({keepSeat:false});return;
      }
      if(socket.data.role===ROLE_SPECTATOR){
        forgetCameraSocket(socket);notifyLiveVoicePeerUnavailable(socket);clearLiveVoiceSender(socket);
        const spectator=spectatorForSocket(room,socket);
        if(spectator)removeSpectator(room,spectator,{announce:!room.tournament});
        socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;
        socket.emit('leftRoom',{message:'Você saiu do Modo Observador.'});answer({keepSeat:false});emitRoom(room);broadcastPresence();return;
      }
      const leaving=room.players.find(p=>p.id===playerId);
      if(!leaving){
        socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;
        socket.emit('leftRoom');answer({keepSeat:false});return;
      }
      if(leaving.isBot||leaving.playerKey!==socket.data.auth?.playerKey||
         leaving.socketId!==socket.id||!leaving.connected)
        throw new Error('Esta conexão não possui autorização para sair por esta vaga.');
      const mode=room.tournament?String(payload?.mode||''):null;
      if(room.tournament&&!['temporary','abandon'].includes(mode))
        throw new Error('Escolha SAIR DA MESA ou confirme ABANDONAR TORNEIO.');
      // Uma mesa concluída já possui resultado/classificação em persistência.
      // Não prometer desistência futura se a regra existente de saída após o
      // resultado NÃO desclassifica ninguém. Essa operação pede tratamento próprio.
      if(room.tournament&&mode==='abandon'&&room.status==='finished')
        throw new Error('Mesa já concluída. Sua classificação foi registrada; a saída desta mesa não cancela a participação futura.');
      const operationKey=`${code}:${leaving.id}`;
      if(tournamentExitInProgress.has(operationKey))throw new Error('Já existe uma solicitação de saída em andamento.');
      if(room.tournament)tournamentExitInProgress.add(operationKey);
      try{
        let result;
        if(room.tournament&&mode==='temporary'){
          result=await leaveTournamentSeatTemporarily(room,leaving,socket);
        }else{
          await abandonHumanSeatDurably(room,leaving,{reason:room.tournament?'abandonou definitivamente o torneio':'saiu voluntariamente da sala',socket});
          result={keepSeat:false,roomCode:code};
        }
        forgetCameraSocket(socket);notifyLiveVoicePeerUnavailable(socket);clearLiveVoiceSender(socket);
        socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;
        const temporary=!!result.keepSeat;
        // V40.69.8.51 — sair de uma mesa JÁ FINALIZADA não é ausência da
        // próxima fase. O servidor informa isso somente após validar a conta,
        // o estado da mesa e concluir a saída. O cliente pode aguardar o novo
        // sorteio na tela principal sem bloquear a convocação automática.
        const completedTournamentTable=!!(temporary&&room.tournament&&room.status==='finished');
        socket.emit('leftRoom',{...result,kind:temporary?'temporary':'abandon',completedTournamentTable,
          message:completedTournamentTable?
            'Mesa encerrada. Seu resultado foi preservado. Se você se classificou, a próxima mesa será acessada automaticamente quando estiver disponível.':
            (temporary?'Você saiu temporariamente. Sua vaga continua sujeita aos prazos oficiais de ausência/reconexão.':
            (room.tournament?'Você abandonou definitivamente o torneio. Pode continuar assistindo como observador.':
            'Você saiu da sala. Para voltar depois, use novamente o código, se ela ainda existir.'))});
        answer({...result,completedTournamentTable});
        broadcastPresence();
      }finally{if(room.tournament)tournamentExitInProgress.delete(operationKey);}
    } catch(e) {
      try{if(typeof ack==='function')ack({ok:false,message:e?.message||'Não foi possível sair da sala.'})}catch{}
      err(socket,e);
    }
  });

  socket.on('playAgain', () => withRoom(socket,(room,p)=>{
    if(room.tournament)throw new Error('Uma mesa de torneio disputa somente uma partida.');
    // O jogador pode confirmar enquanto o ranking grava a vitória. O servidor
    // só reinicia a partida após o registro, sem exigir outro clique.
    if(ReplaySession.confirmReplay(room,p)){
      Engine.appendLog(room, `🔁 ${p.name} confirmou JOGAR NOVAMENTE.`, 'system');
    }
    maybeStartReplay(room);
    broadcastPresence();
  }));

  socket.on('startRound', () => withRoom(socket,async(room,p)=>{
    if(room.status==='playing') throw new Error('A rodada já está em andamento.');

    // Failover do anfitrião: se o anfitrião atual estiver realmente desconectado,
    // qualquer jogador conectado pode assumir a sala e iniciar a próxima rodada.
    const connectedHost = room.players.find(x => x.host && x.connected);
    if(!p.host && connectedHost) throw new Error('Somente o anfitrião pode iniciar a rodada.');
    if(!connectedHost) {
      room.players.forEach(x => { x.host = false; });
      p.host = true;
      Engine.appendLog(room, `${p.name} assumiu como anfitrião da sala.`, 'system');
    }

    if(room.tournament&&room.round===0){
      // Nenhuma contagem regressiva pode disparar o início. Este ramo só é
      // alcançado após o clique de um jogador autenticado em INICIAR PARTIDA.
      await startTournamentLobbyOnRequest(room,p,socket.id);
      return;
    }
    Engine.startRound(room);
    broadcastPresence();
  }));

  socket.on('declare', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.declare(room,p.id,InputSafety.cleanEnumToken(payload?.type,24)); }));
  socket.on('playCard', payload => withRoom(socket,(room,p)=> {
    // V29: após comprar, o jogador pode jogar qualquer carta válida da mão.
    requireRoundNotPaused(room);
    Engine.playCard(room,p.id,InputSafety.cleanCardId(payload?.cardId),InputSafety.cleanEnumToken(payload?.chosenSuit,16)||null);
  }));
  socket.on('playDoubleCard', payload => withRoom(socket,(room,p)=> {
    requireRoundNotPaused(room);
    Engine.playDoubleCard(room,p.id,InputSafety.cleanCardId(payload?.firstCardId),InputSafety.cleanCardId(payload?.secondCardId),InputSafety.cleanEnumToken(payload?.chosenSuit,16)||null);
  }));
  socket.on('burnMatch', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.burnMatch(room,p.id,InputSafety.cleanCardId(payload?.cardId)); }));
  socket.on('quickAction', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.quickAction(room,p.id,InputSafety.cleanCardId(payload?.cardId)); }));
  // Compatibilidade temporária com clientes V10/V9.
  socket.on('burnPair', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.burnMatch(room,p.id,InputSafety.cleanCardId(payload?.cardId)); }));
  socket.on('endBurn', () => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.endBurnContinuation(room,p.id); }));
  socket.on('draw', () => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.drawAction(room,p.id); }));
  socket.on('passTurn', () => withRoom(socket,(room,p)=> {
    requireRoundNotPaused(room);
    const oldPlayerId = p.id;
    Engine.passTurn(room,p.id);
    socket.emit('passConfirmed', {
      playerId: oldPlayerId,
      nextPlayerId: room.players[room.currentPlayer]?.id || null,
    });
  }));
  // Compatibilidade com clientes V10/V11.
  socket.on('passAfterDraw', () => withRoom(socket,(room,p)=> {
    requireRoundNotPaused(room);
    const oldPlayerId = p.id;
    Engine.passAfterDraw(room,p.id);
    socket.emit('passConfirmed', {
      playerId: oldPlayerId,
      nextPlayerId: room.players[room.currentPlayer]?.id || null,
    });
  }));


  socket.on('sendInvite', async payload => {
    try{
      if(socket.data.role===ROLE_SPECTATOR)throw new Error('Saia do Modo Observador antes de convidar jogadores.');
      updatePresenceFromSocket(socket,payload?.profile||{});
      const nowInvite=Date.now();
      if(socket.data.lastInviteAt&&nowInvite-socket.data.lastInviteAt<900)throw new Error('Aguarde um instante antes de enviar outro convite.');
      socket.data.lastInviteAt=nowInvite;
      const fromKey=socket.data.auth.playerKey,toKey=InputSafety.cleanOpaqueId(payload?.targetPlayerKey,160);
      if(!toKey||toKey===fromKey)throw new Error('Escolha outro jogador para convidar.');
      const targetPresence=presenceFor(toKey);
      if(!targetPresence?.sockets?.size)throw new Error('Esse jogador não está disponível online agora.');
      const duplicate=[...invitations.values()].find(i=>i.fromKey===fromKey&&i.toKey===toKey&&['pending','accepted-waiting','ready'].includes(i.status)&&i.expiresAt>Date.now());
      if(duplicate)throw new Error('Já existe um convite ativo para esse jogador.');

      let current=currentSocketRoom(socket),room=current?.room;
      if(room?.players.some(p=>!p.isBot&&p.playerKey===toKey))throw new Error('Esse jogador já está na sua sala.');
      if(room?.status==='finished'){detachSocketFromRoom(socket);room=null;}
      if(!room)room=await createRoomForSocket(socket,payload?.profile||{});
      if(!roomAllowsInviteEventually(room,toKey))throw new Error(room.players.length>=5?'Sua mesa já está completa.':'Esta partida já passou do limite para entrada de novos jogadores.');
      const fromPlayer=room.players.find(p=>!p.isBot&&p.playerKey===fromKey);
      if(!fromPlayer)throw new Error('Não foi possível identificar sua vaga na sala.');
      const targetName=cleanPresenceName(targetPresence.name||'Jogador');
      const now=Date.now(),invite={
        id:`inv-${now}-${crypto.randomBytes(4).toString('hex')}`,fromKey,toKey,
        fromName:cleanPresenceName(fromPlayer.name||presenceFor(fromKey)?.name),fromAvatar:cleanAvatar(fromPlayer.avatar||presenceFor(fromKey)?.avatar),
        toName:targetName,targetRoomCode:room.code,status:'pending',createdAt:now,updatedAt:now,expiresAt:now+INVITE_TTL_MS,waitingReason:null,
      };
      invitations.set(invite.id,invite);scheduleInviteTimer(invite,INVITE_TTL_MS);
      emitToPlayerKey(toKey,'inviteReceived',invitePublic(invite));
      socket.emit('inviteSent',{inviteId:invite.id,targetPlayerKey:toKey,targetName,expiresAt:invite.expiresAt});
    }catch(e){err(socket,e);}
  });

  socket.on('respondInvite', async payload => {
    try{
      if(socket.data.role===ROLE_SPECTATOR&&payload?.accept)throw new Error('Saia do Modo Observador antes de aceitar um convite para jogar.');
      const invite=invitations.get(InputSafety.cleanOpaqueId(payload?.inviteId,96));
      if(!invite||invite.toKey!==socket.data.auth.playerKey)throw new Error('Convite não encontrado.');
      if(invite.status!=='pending'||invite.expiresAt<=Date.now())throw new Error('Este convite já expirou ou foi respondido.');
      if(!payload?.accept){
        clearInviteTimer(invite.id);
        invite.status='refused';invite.updatedAt=Date.now();
        emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status:'refused',message:`❌ ${invite.toName||'Jogador'} recusou o convite.`});
        emitToPlayerKey(invite.toKey,'inviteStatus',{inviteId:invite.id,status:'refused',message:'Convite recusado.'});
        setTimeout(()=>invitations.delete(invite.id),60000).unref?.();return;
      }
      const dest=rooms.get(invite.targetRoomCode);
      if(!dest||!senderStillInDestination(invite,dest))throw new Error('A sala do convite não está mais disponível.');

      // Se o destino já pode receber o jogador, a troca só acontece após a
      // confirmação explícita. Se ainda estiver em rodada, aceitar o convite apenas
      // reserva a vaga; a confirmação será pedida quando ENTRAR AGORA for acionado.
      if(roomJoinableNow(dest,invite.toKey)){
        const switchState=roomSwitchConfirmationState(socket,payload,{
          action:'accept-invite',targetCode:dest.code,exceptCode:dest.code,targetRole:ROLE_PLAYER,targetLabel:`sala ${dest.code}`,context:{inviteId:invite.id},
        });
        if(switchState.required&&!switchState.confirmed)return;
      }

      clearInviteTimer(invite.id);
      invite.expiresAt=Date.now()+INVITE_RESERVATION_MS;
      if(!reserveInviteSeat(invite))throw new Error('A sala ficou sem vagas antes da sua resposta.');
      removeFromMatchmaking(invite.toKey,{reason:'Busca encerrada porque você aceitou um convite.',notify:true});

      if(roomJoinableNow(dest,invite.toKey)){
        await joinSocketIntoRoom(socket,dest,{inviteId:invite.id});
        completeInvite(invite,'✅ Você entrou na nova mesa.');
        return;
      }
      setInviteWaiting(invite,'destination-round','Convite aceito. Aguardando o intervalo da rodada da nova sala.');
    }catch(e){err(socket,e);}
  });

  socket.on('claimInvite', async payload => {
    try{
      if(socket.data.role===ROLE_SPECTATOR)throw new Error('Saia do Modo Observador antes de ocupar uma vaga de jogador.');
      const invite=invitations.get(InputSafety.cleanOpaqueId(payload?.inviteId,96));
      if(!invite||invite.toKey!==socket.data.auth.playerKey||!['accepted-waiting','ready'].includes(invite.status))throw new Error('Convite reservado não encontrado.');
      if(invite.expiresAt<=Date.now())throw new Error('A reserva deste convite expirou.');
      const dest=rooms.get(invite.targetRoomCode);
      if(!dest||!senderStillInDestination(invite,dest))throw new Error('A sala do convite não está mais disponível.');
      if(!roomJoinableNow(dest,invite.toKey))throw new Error('Aguarde o intervalo da rodada da nova sala.');
      const switchState=roomSwitchConfirmationState(socket,payload,{
        action:'claim-invite',targetCode:dest.code,exceptCode:dest.code,targetRole:ROLE_PLAYER,targetLabel:`sala ${dest.code}`,context:{inviteId:invite.id},
      });
      if(switchState.required&&!switchState.confirmed)return;
      await joinSocketIntoRoom(socket,dest,{inviteId:invite.id});completeInvite(invite,'✅ Você entrou na nova mesa.');
    }catch(e){err(socket,e);}
  });

  socket.on('cancelAcceptedInvite', payload => {
    try{
      const invite=invitations.get(InputSafety.cleanOpaqueId(payload?.inviteId,96));
      if(!invite||invite.toKey!==socket.data.auth.playerKey||!['accepted-waiting','ready'].includes(invite.status))return;
      expireInvite(invite,'O jogador cancelou a reserva do convite.','cancelled');
    }catch(e){err(socket,e);}
  });


  socket.on('chatMessage', payload => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      const actor = socialActorForSocket(room,socket);
      if (!actor) throw new Error('Participante não disponível para conversar.');
      if(room.tournament&&actor.role===ROLE_SPECTATOR)
        throw new Error('O modo observador de torneio não possui chat.');
      ensureSocial(room);

      const now = Date.now();
      if (socket.data.lastChatAt && now - socket.data.lastChatAt < 550) {
        throw new Error('Aguarde um instante antes de enviar outra mensagem.');
      }
      const text = cleanChatText(payload?.text);
      if (!text) return;
      socket.data.lastChatAt = now;

      const message = {
        id: `chat-${now}-${Math.random().toString(36).slice(2,8)}`,
        at: now,
        playerId: actor.id,
        name: actor.name,
        avatar: actor.avatar,
        role: actor.role,
        text,
      };
      room.chat.push(message);
      if (room.chat.length > 60) room.chat.splice(0, room.chat.length - 60);
      emitRoomSocial(room,'chatMessage',message);
    } catch(e) { err(socket,e); }
  });


  // Áudio Rápido: repasse efêmero entre os jogadores da sala. Não é salvo no ranking,
  // PostgreSQL nem no histórico de chat. O cliente limita a gravação a 15 s e o servidor
  // também aplica limites de duração declarada, tamanho e frequência de envio.
  socket.on('voiceMessage', payload => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      const player = room.players.find(p => p.id === socket.data.playerId);
      if (!player || !player.connected || player.isBot || player.socketId !== socket.id) throw new Error('Jogador não disponível para enviar áudio.');

      const now = Date.now();
      if (socket.data.lastVoiceAt && now - socket.data.lastVoiceAt < QUICK_AUDIO_COOLDOWN_MS) {
        throw new Error('Aguarde alguns segundos antes de enviar outro áudio.');
      }

      const durationMs = Math.round(Number(payload?.durationMs || 0));
      if (!Number.isFinite(durationMs) || durationMs < 200 || durationMs > QUICK_AUDIO_MAX_MS + 400) {
        throw new Error('O Áudio Rápido deve ter no máximo 15 segundos.');
      }

      const mime = String(payload?.mime || '').toLowerCase().slice(0,80);
      if (!/^audio\/(webm|ogg|mp4|mpeg)(;|$)/.test(mime)) throw new Error('Formato de áudio não suportado.');

      const raw = payload?.audio;
      let audio;
      if (Buffer.isBuffer(raw)) audio = raw;
      else if (raw instanceof ArrayBuffer) audio = Buffer.from(raw);
      else if (ArrayBuffer.isView(raw)) audio = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      else throw new Error('Áudio inválido.');
      if (audio.length < 80 || audio.length > QUICK_AUDIO_MAX_BYTES) throw new Error('O arquivo de áudio ficou grande demais. Grave novamente.');

      socket.data.lastVoiceAt = now;
      emitRoomSocial(room,'voiceMessage',{
        id: `voice-${now}-${Math.random().toString(36).slice(2,8)}`,
        at: now,
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        durationMs: Math.min(durationMs, QUICK_AUDIO_MAX_MS),
        mime,
        audio,
      });
    } catch(e) { err(socket,e); }
  });

  socket.on('sendEffect', payload => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      const actor = socialActorForSocket(room,socket);
      if (!actor) throw new Error('Participante não disponível para enviar efeito.');
      if(room.tournament&&actor.role===ROLE_SPECTATOR)
        throw new Error('O modo observador de torneio não possui reações.');
      const effect = InputSafety.cleanEnumToken(payload?.effect,32);
      if (!SOCIAL_EFFECTS.has(effect)) throw new Error('Efeito sonoro inválido.');

      const now = Date.now();
      if (socket.data.lastEffectAt && now - socket.data.lastEffectAt < 900) return;
      socket.data.lastEffectAt = now;
      emitRoomSocial(room,'soundEffect',{
        id: `fx-${now}-${Math.random().toString(36).slice(2,8)}`,
        at: now,
        playerId: actor.id,
        name: actor.name,
        avatar: actor.avatar,
        role: actor.role,
        effect,
      });
    } catch(e) { err(socket,e); }
  });

  socket.on('updateProfile', payload => withRoom(socket,(room,p)=>{
    if(room.status==='playing') throw new Error('Altere nome/avatar somente fora de uma rodada.');
    if(payload?.name) p.name=cleanPresenceName(payload.name);
    if(payload?.avatar) p.avatar=cleanAvatar(payload.avatar);
    updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
    broadcastPresence();
  }));

  socket.on('disconnect', () => {
    forgetCameraSocket(socket);
    notifyLiveVoicePeerUnavailable(socket);clearLiveVoiceSender(socket);liveVoiceRelayRate.delete(socket.id);
    const presenceKey=socket.data.auth?.playerKey;
    queueMicrotask(()=>{
      unregisterPresenceSocket(socket);
      if(!presenceFor(presenceKey)?.sockets?.size)removeFromMatchmaking(presenceKey,{reason:'Busca encerrada porque a conexão foi perdida.',notify:false});
      else broadcastPresence();
      refreshInviteReadiness();
    });
  });

  socket.on('disconnect', reason => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const role=socket.data.role;
    const room=rooms.get(code);
    if(!room) return;
    connectionDebug('disconnect', {reason,code,role,participantId:role===ROLE_SPECTATOR?socket.data.spectatorId:playerId});

    if(role===ROLE_SPECTATOR){
      const spectatorId=socket.data.spectatorId;
      if(!spectatorId)return;
      scheduleDisconnectDebounce(ROLE_SPECTATOR,code,spectatorId,()=>{
        const liveRoom=rooms.get(code);if(!liveRoom)return;
        const spectator=ensureSpectators(liveRoom).find(s=>s.id===spectatorId);
        // Se outro socket já assumiu esta vaga, a microqueda foi recuperada.
        if(!spectator||spectator.socketId!==socket.id)return;
        spectator.connected=false;spectator.socketId=null;spectator.disconnectedAt=Date.now();
        scheduleSpectatorRemoval(liveRoom,spectator);emitRoom(liveRoom);
      });
      return;
    }

    if(!playerId)return;
    scheduleDisconnectDebounce(ROLE_PLAYER,code,playerId,()=>{
      const liveRoom=rooms.get(code);if(!liveRoom)return;
      const p=liveRoom.players.find(x=>x.id===playerId);
      // Se outra aba/socket já reconectou, não alteramos a vaga.
      if(!p||p.socketId!==socket.id)return;
      RoomLifecycle.markInvoluntaryDisconnect(p,{now:Date.now(),graceMs:runtimeReconnectGraceMs()});

      if(liveRoom.botTimer){ clearTimeout(liveRoom.botTimer); liveRoom.botTimer=null; }
      const matchActive=RoomLifecycle.isActiveMatch(liveRoom);
      if(matchActive){
        Engine.appendLog(liveRoom, `🔴 ${p.name} perdeu a conexão. 60 segundos para retornar.`, 'system');
        io.to(liveRoom.code).emit('reconnectionEvent',{kind:'lost',playerId:p.id,name:p.name,deadlineAt:p.reconnectDeadlineAt});
        scheduleReconnectTakeover(liveRoom,p);
        emitRoom(liveRoom);
        broadcastPresence();
        return;
      }

      emitRoom(liveRoom);
      broadcastPresence();

      const timer=setTimeout(async () => {
        reconnectTimers.delete(reconnectTimerKey(code,playerId));
        const currentRoom = rooms.get(code);
        if (!currentRoom || !['lobby','between-rounds','finished'].includes(currentRoom.status)) return;
        const stale = currentRoom.players.find(x => x.id === playerId);
        if (!stale || stale.connected || stale.autoControlled) return;
        if(currentRoom.tournament && TournamentRoomRetention.hasPendingTournamentResult(currentRoom))return;

        const leavingName = stale.name;
        currentRoom.players = currentRoom.players.filter(x => x.id !== playerId);
        if (!currentRoom.players.length || currentRoom.players.every(p => p.isBot)) {
          if (currentRoom.botTimer) clearTimeout(currentRoom.botTimer);
          clearReconnectTimersForRoom(code);
          closeSpectatorsForRoom(currentRoom);
          clearSpectatorReconnectTimersForRoom(code);
          try{await removeRoomDurably(code);}catch(e){console.error('[rooms] falha ao excluir sala após prazo de reconexão',code,e?.message||e);return;}
          invalidateInvitesForRoom(code);
          broadcastPresence();
          return;
        }

        ensureHost(currentRoom);
        Engine.appendLog(currentRoom, `${leavingName} foi removido após 60 segundos desconectado.`, 'system');
        emitRoom(currentRoom);
        broadcastPresence();
      }, runtimeReconnectGraceMs());
      if(typeof timer.unref==='function') timer.unref();
      reconnectTimers.set(reconnectTimerKey(code,playerId),timer);
    });
  });
});

// V40.69.8.17 — a classificação não pode depender de novo clique/emitRoom.
// Retenta resultados de torneio com jogador ausente e renova a expiração do
// snapshot pendente; não registra vitórias nem altera partidas comuns.
const pendingTournamentRetryTimer=setInterval(()=>{
  for(const room of rooms.values()){
    if(!TournamentRoomRetention.hasPendingTournamentResult(room))continue;
    if(!room.rankingRecording)maybeRecordFinished(room);
    roomSnapshotStore.saveNow(room).catch(e=>console.error('[tournament] falha ao renovar snapshot pendente',room.code,e?.message||e));
  }
},60000);
pendingTournamentRetryTimer.unref?.();

let roomAuditRunning=false;
async function auditRoomLifecycle(){
  if(roomAuditRunning)return 0;
  roomAuditRunning=true;
  let cleaned=0;
  try{
    for(const [code,room] of [...rooms]){
      if(!RoomGovernance.shouldCleanupRoom(room))continue;
      try{
        if(await removeRoomDurably(code,Date.now(),'A sala foi encerrada automaticamente porque não restou nenhum jogador humano.'))cleaned++;
      }catch(e){console.error('[rooms] auditoria não conseguiu excluir sala inconsistente',code,e?.message||e);}
    }
  }finally{roomAuditRunning=false;}
  if(cleaned){console.warn(`[rooms] auditoria V40.68 removeu ${cleaned} sala(s) sem jogadores humanos.`);broadcastPresence();}
  return cleaned;
}
setInterval(()=>{void auditRoomLifecycle();},ROOM_AUDIT_INTERVAL_MS).unref();

setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms){
    const humans=room.players.filter(p=>!p.isBot);
    const allHumansGone=!humans.length || humans.every(p=>!p.connected);
    const activeMatch=room.status==='playing' || (room.status==='between-rounds' && Number(room.round||0)>0);
    // V40.57.1 — uma partida ativa não expira por idade. A cadeira humana segue
    // reservada até o encerramento da partida, mesmo que todos estejam offline/AUTO.
    if(!activeMatch && allHumansGone && now-room.createdAt>6*60*60*1000){
      // Mantem a regra historica e acrescenta a protecao de resultado pendente.
      if(!TournamentRoomRetention.mayRemoveRoom(room))continue;
      if (room.botTimer) clearTimeout(room.botTimer);
      clearReconnectTimersForRoom(code);
      closeSpectatorsForRoom(room);
      clearSpectatorReconnectTimersForRoom(code);
      void removeRoomDurably(code).then(()=>invalidateInvitesForRoom(code)).catch(e=>console.error('[rooms] falha ao excluir sala inativa',code,e?.message||e));
    }
  }
}, 30*60*1000).unref();

// V40.53 — restaura salas ativas antes de aceitar novas conexões. Como os socketIds
// antigos não sobrevivem ao processo, os humanos recebem a mesma janela de 60 s para
// o joinRoom automático do navegador recuperar a vaga pelo token/conta autenticada.
function scheduleRestoredPlayerGrace(room,player){
  if(!room||!player||player.isBot||player.connected)return;
  const matchActive=room.status==='playing'||(room.status==='between-rounds'&&room.round>0);
  if(matchActive){scheduleReconnectTakeover(room,player);return;}
  cancelReconnectTimer(room.code,player.id);
  const key=reconnectTimerKey(room.code,player.id);
  const delay=Math.max(0,Number(player.reconnectDeadlineAt||Date.now())-Date.now());
  const timer=setTimeout(async ()=>{
    reconnectTimers.delete(key);
    // A revanche restaurada mantém a mesma janela de reconexão da sala.
    // Não deixar um jogador ausente bloquear os votos para sempre após deploy.
    const liveRoom=rooms.get(room.code);if(!liveRoom||liveRoom!==room||!['lobby','between-rounds','finished'].includes(liveRoom.status))return;
    const stale=liveRoom.players.find(p=>p.id===player.id);
    if(!stale||stale.connected||stale.isBot)return;
    if(liveRoom.tournament && TournamentRoomRetention.hasPendingTournamentResult(liveRoom))return;
    const leavingName=stale.name;
    liveRoom.players=liveRoom.players.filter(p=>p.id!==stale.id);
    if(!liveRoom.players.length||liveRoom.players.every(p=>p.isBot)){
      clearReconnectTimersForRoom(liveRoom.code);closeSpectatorsForRoom(liveRoom);clearSpectatorReconnectTimersForRoom(liveRoom.code);
      try{await removeRoomDurably(liveRoom.code);}catch(e){console.error('[rooms] falha ao excluir sala restaurada expirada',liveRoom.code,e?.message||e);return;}
      invalidateInvitesForRoom(liveRoom.code);broadcastPresence();return;
    }
    ensureHost(liveRoom);Engine.appendLog(liveRoom,`${leavingName} foi removido após o prazo de reconexão do servidor.`,'system');emitRoom(liveRoom);broadcastPresence();
  },delay);
  timer.unref?.();reconnectTimers.set(key,timer);
}

async function restorePersistedRooms(){
  if(snapshotsRestored)return 0;
  if(snapshotsRestorePromise)return snapshotsRestorePromise;
  snapshotsRestorePromise=(async()=>{
    const ready=await ensureRoomSnapshotsInitialized();if(!ready)return 0;
    let restored=0;
    const snapshots=await roomSnapshotStore.loadActive();
    for(const snapshot of snapshots){
      const room=restoreRoomSnapshot(snapshot,{reconnectGraceMs:runtimeReconnectGraceMs()});
      if(!room){
        if(snapshot?.code && TournamentRoomRetention.hasPendingTournamentResult(snapshot))
          console.error('[tournament] snapshot pendente inválido preservado para auditoria:',snapshot.code);
        else if(snapshot?.code)roomSnapshotStore.delete(snapshot.code).catch(e=>console.error('[rooms] falha ao remover snapshot inválido',snapshot.code,e?.message||e));
        continue;
      }
      if(rooms.has(room.code))continue;
      if(RoomGovernance.shouldCleanupRoom(room)){
        try{await roomSnapshotStore.markRoomDeleted(room.code,Date.now());}
        catch(e){console.error('[rooms] falha ao descartar snapshot sem humanos',room.code,e?.message||e);}
        continue;
      }
      ensureSocial(room);rooms.set(room.code,room);restored++;
      if(room.status==='finished'&&!room.rankingRecorded)maybeRecordFinished(room);
      Engine.appendLog(room,'♻️ A sala foi restaurada após reinício do servidor. Reconecte para retomar seu lugar.','system');
      for(const p of room.players)scheduleRestoredPlayerGrace(room,p);
      // V40.68.1 — se a sala restaurada estiver sem qualquer humano conectado,
      // o prazo de 5 minutos continua do marco salvo; se o restart causou a queda,
      // o relógio começa agora. Robôs permanecem parados enquanto ninguém retornar.
      refreshOfflineRoomExpiry(room);
      roomSnapshotStore.queueSave(room);
    }
    snapshotsRestored=true;
    if(restored)console.log(`[rooms] ${restored} sala(s) restaurada(s) após reinício.`);
    return restored;
  })().catch(e=>{
    // O servidor continua no ar para verificar prontidão e recuperar sem
    // reboot. Nenhuma sala nova será admitida até restaurar com sucesso.
    console.error('[rooms] falha ao restaurar snapshots; recuperação será repetida:',e?.message||e);return 0;
  })
    .finally(()=>{snapshotsRestorePromise=null;});
  return snapshotsRestorePromise;
}

// Se o banco falhou no boot e voltou depois, recuperar salas automaticamente,
// mesmo que nenhum jogador tente criar outra mesa nesse intervalo.
const restoredRoomsRecoveryTimer=setInterval(()=>{
  if(!snapshotsRestored)void restorePersistedRooms();
},15000);
restoredRoomsRecoveryTimer.unref?.();

// V40.69.8.21 — recupera avanço pendente após falhas de notificação,
// transação ou reinício. O avanço no PostgreSQL já usa advisory lock.
let tournamentReconcileRunning=false;
const tournamentSeatNoticeAt=new Map();
const completedTournamentIds=new Set();
async function reconcileTournamentProgress(){
  if(tournamentReconcileRunning||!snapshotsRestored)return;
  tournamentReconcileRunning=true;
  try{
    if(!await ensureTournamentBracketReady())return;
    const events=await tournamentCatalog.list();
    for(const event of events){
      // V40.69.8.55 — uma exceção isolada não interrompe os demais torneios.
      try{
        if(!event||event.status!=='closed'||completedTournamentIds.has(event.id))continue;
        const first=await tournamentDraw.get(event.id);
        if(!first.length)continue;
        // Mesmo sem evento Socket.IO: confirmar todas as fases gravadas e criar
        // a próxima mesa quando o último resultado já tinha sido persistido.
        const bracket=await tournamentBracket.advance(event.id,first);
        if(bracket.champion){
          if(!await ensureTournamentPodiumReady())throw new Error('Arquivo dos podios indisponivel.');
          await tournamentPodiumArchive.record({id:event.id,name:event.name,champion:bracket.champion});
          completedTournamentIds.add(event.id);continue;
        }
        const stage=bracket.currentStage;
        const tables=stage==='qualifier'?first:bracket.stages.find(s=>s.stage===stage)?.tables||[];
        const notify=await Promise.all(tables.map(async table=>{
          const binding=stage==='qualifier'?await tournamentGames.get(event.id,table.number):
            await tournamentBracket.getBinding(event.id,stage,table.number);
          if(binding?.result)return null;
          const code=binding?.roomCode;
          const room=code?rooms.get(code):null;
          if(room&&maybeResolveTournamentLobbyWalkover(room))emitRoom(room);
          if(room&&room.status!=='lobby')return null;
          const key=`${event.id}:${stage}:${table.number}`;
          if(Date.now()-(tournamentSeatNoticeAt.get(key)||0)<20000)return null;
          tournamentSeatNoticeAt.set(key,Date.now());return table;
        }));
        const missing=notify.filter(Boolean);
        if(missing.length)await notifyTournamentSeats(event.id,stage,missing);
      }catch(e){
        console.error('[tournament] falha ao reconciliar torneio:',event?.id||'(sem id)',e?.message||e);
      }
    }
  }catch(e){console.error('[tournament] reconciliação geral de fases:',e?.message||e);}
  finally{tournamentReconcileRunning=false;}
}
const tournamentProgressTimer=setInterval(()=>{void reconcileTournamentProgress();},15000);
tournamentProgressTimer.unref?.();

// V40.69.8.49 — limpeza pos-encerramento: o podio ja foi confirmado em
// armazenamento independente. Nunca retirar usuarios de mesas em uso.
let tournamentPodiumCleanupRunning=false;
async function cleanupCompletedTournamentData(){
  if(tournamentPodiumCleanupRunning||!snapshotsRestored)return;
  tournamentPodiumCleanupRunning=true;
  try{
    if(!await ensureTournamentPodiumReady())return;
    for(const id of await tournamentPodiumArchive.pending()){
      try{
        const active=[...rooms.values()].filter(room=>room.tournament?.id===id);
        if(active.some(room=>room.status!=='finished'||room.rankingRecorded!==true||
          room.rankingRecording||room.pendingRankingRecord&&room.rankingRecorded!==true||
          room.players?.some(p=>!p.isBot&&p.connected)||
          ensureSpectators(room).some(p=>p.connected)))continue;
        // Primeiro tombstones de todas as salas, incluindo snapshots deixados
        // por etapas anteriores. Evita restaurar uma mesa ja arquivada.
        const recordedCodes=new Set(active.map(room=>room.code));
        for(const t of await tournamentBracket.rows(id))if(t.roomCode)recordedCodes.add(t.roomCode);
        for(const t of await tournamentDraw.get(id)){
          const game=await tournamentGames.get(id,t.number);
          if(game?.roomCode)recordedCodes.add(game.roomCode);
        }
        // Nunca reutilizar um codigo historico para apagar uma sala que ja
        // pertence a outro jogo: nesse caso adiar toda a limpeza.
        for(const code of recordedCodes){
          const current=rooms.get(code);
          if(current && current.tournament?.id!==id)
            throw new Error('Codigo historico em uso por outra partida; limpeza adiada.');
        }
        for(const room of active){
          // Confirmar novamente antes de descartar o lobby/snapshot final;
          // um participante pode ter reconectado durante as consultas.
          if(room.status!=='finished'||room.rankingRecorded!==true||
            room.players?.some(p=>!p.isBot&&p.connected)||
            ensureSpectators(room).some(p=>p.connected))
            throw new Error('Participante reconectou; limpeza adiada.');
          if(rooms.get(room.code)===room && !await removeRoomDurably(room.code,Date.now(),'Torneio encerrado; resultado preservado no ranking.'))
            throw new Error('Uma sala ainda nao pode ser removida.');
        }
        for(const code of recordedCodes){
          if(rooms.has(code))throw new Error('Sala historica ocupada; limpeza adiada.');
          await roomSnapshotStore.markRoomDeleted(code);
        }
        const changed=await tournamentPodiumArchive.cleanup(id,{
          catalog:tournamentCatalog,store:tournamentStore,draw:tournamentDraw,games:tournamentGames,bracket:tournamentBracket
        });
        completedTournamentIds.delete(id);
        for(const key of tournamentSeatNoticeAt.keys())if(key.startsWith(id+':'))tournamentSeatNoticeAt.delete(key);
        if(changed)console.info('[tournament] dados operacionais descartados apos salvar o podio:',id);
      }catch(error){console.error('[tournament] limpeza adiada, podio preservado:',id,error?.message||error);}
    }
  }catch(error){console.error('[tournament] consulta da fila de limpeza falhou:',error?.message||error);}
  finally{tournamentPodiumCleanupRunning=false;}
}
const tournamentPodiumCleanupTimer=setInterval(()=>{void cleanupCompletedTournamentData();},30000);
tournamentPodiumCleanupTimer.unref?.();



let shuttingDown=false;
async function gracefulShutdown(signal){
  if(shuttingDown)return;shuttingDown=true;runtimeConnectionMonitor.markShutdown();
  console.log(`[server] ${signal}: salvando ${rooms.size} sala(s) antes de encerrar...`);
  const force=setTimeout(()=>process.exit(1),8000);force.unref?.();
  try{await ensureRoomSnapshotsInitialized();await roomSnapshotStore.flushAll(rooms);console.log('[rooms] snapshots finais salvos.');}
  catch(e){console.error('[rooms] erro no snapshot final:',e?.message||e);}
  try{io.close();}catch{}
  server.close(async()=>{
    try{await roomSnapshotStore.close();}catch(e){console.error('[db] falha ao encerrar snapshots:',e?.message||e);}
    try{await authIdentityStore.close();}catch(e){console.error('[db] falha ao encerrar autenticação:',e?.message||e);}
    // Somente o servidor encerra o pool compartilhado, após os snapshots finais.
    try{if(appDatabasePool)await appDatabasePool.end();}catch(e){console.error('[db] falha ao encerrar pool compartilhado:',e?.message||e);}
    clearTimeout(force);process.exit(0);
  });
}
process.once('SIGTERM',()=>gracefulShutdown('SIGTERM'));
process.once('SIGINT',()=>gracefulShutdown('SIGINT'));

async function startServer(){
  await restorePersistedRooms();
  server.listen(PORT,()=>console.log(`Mau-Mau online em http://localhost:${PORT}`));
}
startServer().catch(e=>{console.error('[server] falha ao iniciar:',e);process.exit(1);});

'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');
const Engine = require('./game-engine');
const BotPlayer = require('./bot-player');
const AvatarWire = require('./avatar-wire');
const RoomLifecycle = require('./room-lifecycle');
const InputSafety = require('./input-safety');
const { RoomSnapshotStore, restoreRoomSnapshot } = require('./room-snapshot-store');
const { RankingStore, buildMatchRecord, normalizePeriod, normalizeMode, CURRENT_SEASON_ID, CURRENT_SEASON_NAME } = require('./ranking-store');
const { evaluateReadiness, databaseRequired } = require('./service-readiness');
const RetentionPolicy = require('./retention-policy');
const RoomGovernance = require('./room-governance');
const AbuseGuard = require('./abuse-guard');
const { AuthIdentityStore, normalizeEmail } = require('./auth-identity-store');
const UniversalAuth = require('./universal-auth');
const EmailDelivery = require('./email-delivery');

const app = express();
const server = http.createServer(app);
const APP_VERSION = require('./package.json').version;
const SERVICE_STARTED_AT = Date.now();
const MONITOR_HTTP_LOGS = String(process.env.MAUMAU_HTTP_LOGS || '') === '1';
const ALLOWED_CROSS_ORIGINS = String(process.env.MAUMAU_ALLOWED_ORIGINS || '')
  .split(',')
  .map(value=>value.trim())
  .filter(Boolean)
  .map(value=>{try{return new URL(value).origin}catch{return ''}})
  .filter(Boolean);
const ALLOWED_CROSS_ORIGIN_SET = new Set(ALLOWED_CROSS_ORIGINS);
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
const spectatorReconnectTimers = new Map();
// V40.68.1 — se uma partida ativa ficar sem NENHUM humano conectado,
// a sala aguarda no máximo 5 minutos. Robôs/AUTO não jogam sozinhos.
// SAIR/troca de sala continuam aplicando as regras de abandono definitivo.
const offlineRoomExpiryTimers = new Map();
const ALL_HUMANS_OFFLINE_EXPIRY_MS = RetentionPolicy.ALL_HUMANS_OFFLINE_EXPIRY_MS;
// V40.49 — microquedas de Wi‑Fi/4G de poucos segundos não congelam a mesa.
// Se o mesmo jogador voltar rapidamente, o novo socket substitui o antigo antes
// de a cadeira ser marcada como desconectada.
const disconnectDebounceTimers = new Map();
const DISCONNECT_DEBOUNCE_MS = 3000;
const RECONNECT_GRACE_MS = RetentionPolicy.RECONNECT_GRACE_MS;
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
const rankingStore = new RankingStore();
const rankingReady = rankingStore.init().then(()=>{console.log(`[ranking] armazenamento: ${rankingStore.kind}`);return true}).catch(e=>{console.error('[ranking] falha ao iniciar:',e);return false});
// V40.69.1 — identidade universal. O playerKey continua sendo a chave canônica do ranking
// e agora pode ser resolvido por Google, Apple ou e-mail verificado.
const authIdentityStore = new AuthIdentityStore();
const authIdentityReady = authIdentityStore.init().then(()=>{console.log(`[auth] identidades: ${authIdentityStore.kind}`);return true}).catch(e=>{console.error('[auth] falha ao iniciar identidades:',e);return false});
// V40.53 — snapshots das salas ativas sobrevivem a deploy/restart quando DATABASE_URL existe.
const roomSnapshotStore = new RoomSnapshotStore();
const roomSnapshotsReady = roomSnapshotStore.init().then(()=>{console.log(`[rooms] snapshots: ${roomSnapshotStore.kind}`);return true}).catch(e=>{console.error('[rooms] falha ao iniciar snapshots:',e);return false});
const DATABASE_REQUIRED = databaseRequired(process.env);
if(DATABASE_REQUIRED && !String(process.env.DATABASE_URL||'').trim()){
  console.error('[ready] CRÍTICO: DATABASE_URL ausente em ambiente de produção. Ranking e snapshots não podem usar JSON local.');
}
async function requireRoomPersistenceReady(){
  const ready=await roomSnapshotsReady;
  if(!ready)throw new Error('Persistência das salas indisponível. Tente novamente em instantes.');
}
function cleanupRoomResources(room,message='A mesa foi encerrada.'){
  if(!room)return false;
  const code=room.code;
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
  await requireRoomPersistenceReady();
  await roomSnapshotStore.markRoomDeleted(code,eventAt);
  if(room)cleanupRoomResources(room,message);
  return rooms.delete(code);
}
function removeRoom(code,message='A mesa foi encerrada.'){
  const room=rooms.get(code);
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
if (!process.env.AUTH_SESSION_SECRET) console.warn('[auth] AUTH_SESSION_SECRET não configurado. Foi criada uma chave temporária; sessões serão encerradas quando o servidor reiniciar.');

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
  const payload = Buffer.from(JSON.stringify({...clean,exp:Date.now() + AUTH_TTL_SECONDS * 1000})).toString('base64url');
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
    return sessionUser(session,session.provider);
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
function authIp(req){return String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,80);}
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
  res.setHeader('Permissions-Policy','camera=(), geolocation=(), payment=(), usb=(), microphone=(self)');
  res.setHeader('Content-Security-Policy',[
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' https://accounts.google.com https://appleid.cdn-apple.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self' ws: wss: https://accounts.google.com https://appleid.apple.com",
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
  const session=authFromCookieHeader(req.headers.cookie);
  if(!session) return res.status(401).json({ok:false,message:'Login necessário.'});
  try{
    if(await authIdentityReady)await authIdentityStore.ensureSessionUser(session);
  }catch(e){console.warn('[auth] não foi possível registrar sessão existente:',e?.message||e);}
  const provider=session.provider || (String(session.playerKey||'').startsWith('g_')?'google':'account');
  res.json({ok:true,user:{...sessionUser(session,provider),provider}});
});
app.get('/api/voice/config', (req,res)=>{
  const session=authFromCookieHeader(req.headers.cookie);
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

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res,filePath){
    if(filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control','public, max-age=86400, stale-while-revalidate=604800');
    else if(/\.(?:js|css)$/i.test(filePath)) res.setHeader('Cache-Control','no-cache, must-revalidate');
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
    },
  });
});
app.get('/ready', async (_,res)=>{
  res.setHeader('Cache-Control','no-store');
  const report=await evaluateReadiness({rankingStore,roomSnapshotStore,rankingReady,roomSnapshotsReady,env:process.env,timeoutMs:2000});
  let authOk=await authIdentityReady,authReason=authOk?'ok':'identity-store-init-failed';
  if(authOk){try{authOk=await Promise.race([authIdentityStore.healthCheck(),new Promise(resolve=>setTimeout(()=>resolve(false),2000))]);authReason=authOk?'ok':'identity-store-health-failed';}catch(e){authOk=false;authReason='identity-store-health-failed';}}
  const ok=report.ok&&authOk;
  res.status(ok?200:503).json({
    ok,status:ok?'ready':'not-ready',version:APP_VERSION,databaseRequired:report.databaseRequired,reason:ok?'ok':(!authOk?authReason:report.reason),
    ranking:{kind:report.ranking.kind,ok:report.ranking.ok,reason:report.ranking.reason},
    roomSnapshots:{kind:report.roomSnapshots.kind,ok:report.roomSnapshots.ok,reason:report.roomSnapshots.reason},
    authIdentities:{kind:authIdentityStore.kind,ok:authOk,reason:authReason},
  });
});

app.get('/api/ranking', async (req,res)=>{
  try {
    const period=normalizePeriod(req.query.period);
    const mode=normalizeMode(req.query.mode);
    if(!(await rankingReady)) throw new Error('Armazenamento do ranking indisponível.');
    const rows=await rankingStore.getLeaderboard({period,mode,limit:50});
    res.json({ok:true,period,mode,seasonId:CURRENT_SEASON_ID,seasonName:CURRENT_SEASON_NAME,timezone:'America/Porto_Velho',rows});
  } catch(e) {
    console.error('[ranking] consulta falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o ranking agora.'});
  }
});

app.get('/api/profile', async (req,res)=>{
  try {
    const playerKey=String(req.query.playerKey||'').trim().slice(0,80);
    if(!playerKey) return res.status(400).json({ok:false,message:'Jogador não informado.'});
    const period=normalizePeriod(req.query.period||'season');
    const mode=normalizeMode(req.query.mode);
    if(!(await rankingReady)) throw new Error('Armazenamento do ranking indisponível.');
    const stats=await rankingStore.getPlayerStats({playerKey,period,mode});
    res.json({ok:true,period,mode,seasonId:CURRENT_SEASON_ID,seasonName:CURRENT_SEASON_NAME,stats});
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
  const record=buildMatchRecord(room);
  const matchSerial=Number(room.matchSerial||1);
  if (!record.results.length) { room.rankingRecorded=true; return; }
  room.rankingRecording=true;
  rankingReady.then(ready=>{ if(!ready) throw new Error('Armazenamento do ranking indisponível.'); return rankingStore.recordMatch(record); }).then(inserted=>{
    // O grupo pode ter iniciado outra partida na mesma sala antes do PostgreSQL
    // concluir a gravação. Nesse caso, o snapshot antigo ainda é salvo, mas não
    // altera as flags da partida nova.
    if(Number(room.matchSerial||1)===matchSerial){
      room.rankingRecorded=true;
      room.rankingRecording=false;
      if(inserted) Engine.appendLog(room, `🏆 Vitória registrada no ranking ${record.mode==='official'?'OFICIAL':'TREINO'}.`, 'system');
    }
  }).catch(e=>{
    console.error('[ranking] gravação falhou:',e);
    if(Number(room.matchSerial||1)===matchSerial) room.rankingRecording=false;
  });
}

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

function emitRoom(room) {
  maybeRecordFinished(room);
  // V40.68.1 — toda partida ativa sem nenhum humano conectado recebe apenas
  // 5 minutos de reserva. O marco é salvo no snapshot e não reinicia após deploy.
  refreshOfflineRoomExpiry(room);
  for (const p of room.players) {
    if (!p.socketId) continue;
    const target=io.sockets.sockets.get(p.socketId);
    if (!target) continue;
    emitRoomAvatarAssets(target,room);
    target.emit('state', AvatarWire.leanStateAvatars(Engine.roomPublicState(room,p.id)));
  }
  ensureSpectators(room);
  for (const spectator of room.spectators) {
    if (!spectator.connected || !spectator.socketId) continue;
    const target=io.sockets.sockets.get(spectator.socketId);
    if (!target) continue;
    emitRoomAvatarAssets(target,room);
    target.emit('state', AvatarWire.leanStateAvatars(Engine.roomSpectatorState(room,spectator)));
  }
  scheduleBotTurn(room);
  refreshInviteReadiness();
  const presenceSignature=`${room.status}:${room.round}:${room.players.map(p=>`${p.id}:${p.isBot?'b':'h'}`).join(',')}`;
  if(room._presenceSignature!==presenceSignature){room._presenceSignature=presenceSignature;setTimeout(broadcastPresence,0);}
  roomSnapshotStore.queueSave(room);
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
  if (!room || room.status !== 'playing' || room.botTimer) return;
  // Durante os 60 s de tolerância, ninguém joga. Depois, a vaga desconectada
  // passa a ser tratada pelo mesmo motor da Máquina, sem virar um jogador-bot.
  if (roomWaitingForReconnect(room)) return;
  // Se todos os humanos estiverem fora, não há motivo para a mesa se jogar sozinha.
  // A automação volta a andar assim que pelo menos uma pessoa reconectar.
  if (!room.players.some(p => !p.isBot && p.connected)) return;

  // Normalmente a Queima pertence ao jogador da vez. Na abertura da rodada, porém,
  // a Engine pode liberar a primeira carta para qualquer participante com cópia
  // exatamente igual; por isso também procuramos uma máquina fora da vez.
  const turnBot = room.players[room.currentPlayer];
  const currentBurnBot = isAutomatedPlayer(turnBot) && !turnBot.finishedRound && Engine.canBurnMatch(room,turnBot).length > 0 ? turnBot : null;
  const openingBurnBot = currentBurnBot ? null : room.players.find(p => isAutomatedPlayer(p) && !p.finishedRound && p.id !== turnBot?.id && Engine.canBurnMatch(room,p).length > 0);
  const burnBot = currentBurnBot || openingBurnBot || null;
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
  }, burnBot ? (room.openingReaction && burnBot.id !== turnBot?.id ? 1200 : 750) : quickBot ? 950 : 1250);
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

function replayEligible(room) {
  return !!(room && room.status==='finished' && room.players.filter(p=>!p.isBot).length>=2 && room.players.every(p=>!p.isBot));
}

function maybeStartReplay(room) {
  if(!replayEligible(room)) return false;
  const connectedHumans=room.players.filter(p=>!p.isBot&&p.connected);
  if(connectedHumans.length<2) return false;
  const ready=new Set(Array.isArray(room.replayReadyPlayerIds)?room.replayReadyPlayerIds:[]);
  if(!connectedHumans.every(p=>ready.has(p.id))) return false;

  // Quem já saiu/desconectou depois do fim da partida não bloqueia o grupo que
  // confirmou continuar. A nova partida começa somente com humanos conectados.
  room.players=room.players.filter(p=>p.isBot||p.connected);
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
  removeRoom(room.code,'A sala foi encerrada porque não restou nenhum jogador humano.');
  return true;
}

function convertHumanSeatToPermanentBot(room, player, reason='saiu da sala') {
  if(!room||!player||player.isBot)return false;
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
  if(activeMatch){
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
    fn(room, player);
    emitRoom(room);
  } catch(e) { err(socket,e); }
}


const SOCIAL_EFFECTS = new Set(['applause','laugh','angry','horn','drum','victory','wow','jogaBoca']);
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
function appendSystemChat(room,text){
  ensureSocial(room);const now=Date.now();
  const message={id:`chat-system-${now}-${Math.random().toString(36).slice(2,8)}`,at:now,playerId:null,name:'Mesa',avatar:'👁️',text:cleanChatText(text),role:'SYSTEM',system:true};
  room.chat.push(message);if(room.chat.length>60)room.chat.splice(0,room.chat.length-60);io.to(room.code).emit('chatMessage',message);return message;
}
function removeSpectator(room,spectator,{announce=true}={}){
  ensureSpectators(room);cancelSpectatorReconnectTimer(room.code,spectator.id);
  room.spectators=room.spectators.filter(s=>s.id!==spectator.id);
  if(announce)appendSystemChat(room,`👁️ ${spectator.name} saiu da sala.`);
}
function scheduleSpectatorRemoval(room,spectator){
  cancelSpectatorReconnectTimer(room.code,spectator.id);
  const key=spectatorReconnectTimerKey(room.code,spectator.id);
  const timer=setTimeout(()=>{
    spectatorReconnectTimers.delete(key);const liveRoom=rooms.get(room.code);if(!liveRoom)return;
    ensureSpectators(liveRoom);const stale=liveRoom.spectators.find(s=>s.id===spectator.id);
    if(!stale||stale.connected)return;
    removeSpectator(liveRoom,stale,{announce:true});emitRoom(liveRoom);
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
function broadcastPresence() {
  io.emit('presenceSnapshot',buildPresenceSnapshot());
  io.emit('publicRoomsSnapshot',buildPublicRoomsSnapshot());
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

// V40.59 — Reconexão automática condicionada a queda involuntária.
// A procura usa SOMENTE a conta autenticada e exige reconnectEligible=true.
// SAIR, entrar em outra sala ou converter a cadeira para Máquina definitiva remove
// essa elegibilidade; nome/avatar/token antigo nunca recriam uma reserva cancelada.
function recoverablePlayerSeatForKey(playerKey) {
  const key=String(playerKey||'');
  if(!key)return null;
  let best=null;
  for(const room of rooms.values()){
    if(!room||room.status==='finished')continue;
    const player=room.players.find(p=>!p.isBot&&p.playerKey===key);
    if(!player)continue;
    const socketAlive=!!(player.socketId&&io.sockets.sockets.get(player.socketId));
    // V40.59: somente uma reserva criada por desconexão involuntária pode gerar
    // retomada automática. A única exceção é a microjanela de refresh: se o socket
    // antigo já morreu antes do debounce registrar a queda, promovemos essa queda
    // observada pelo servidor a uma reserva involuntária válida.
    if(player.connected&&socketAlive)continue;
    if(!RoomLifecycle.canAutoReconnect(player)){
      if(player.connected&&!socketAlive){
        RoomLifecycle.markInvoluntaryDisconnect(player,{now:Date.now(),graceMs:runtimeReconnectGraceMs()});
      }else continue;
    }
    const score=(room.status==='playing'?100:room.status==='between-rounds'?80:40)
      +(Number(room.round||0)>0?20:0)+(player.autoControlled?10:0);
    if(!best||score>best.score)best={room,player,score};
  }
  return best;
}

async function resumeReservedPlayerSeat(socket,room,player,{source='auto-resume'}={}) {
  if(!socket||!room||!player||player.isBot)throw new Error('Vaga de reconexão inválida.');
  const authKey=String(socket.data.auth?.playerKey||'');
  if(!authKey||player.playerKey!==authKey)throw new Error('Esta vaga pertence a outra conta.');
  if(!player.reconnectEligible)throw new Error('Esta vaga não possui uma reserva válida de reconexão automática.');
  const liveSocket=player.socketId?io.sockets.sockets.get(player.socketId):null;
  if(player.connected&&liveSocket&&player.socketId!==socket.id){
    throw new Error('Sua vaga já está conectada em outro dispositivo.');
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

  socket.emit('joined',{code:room.code,playerId:resumed.id,token:resumed.token,role:ROLE_PLAYER,source});
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
  const currentCode=String(socket.data.roomCode||'');
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
  }
  await abandonOtherPlayerMembershipsForSwitch(socket,exceptCode,'entrou em outra sala');
  requireNoOtherActivePlayerRoom(socket,exceptCode);
}

function playerHasAcceptedInvite(playerKey) {
  return [...invitations.values()].some(inv=>inv.toKey===playerKey&&['accepted-waiting','ready'].includes(inv.status)&&inv.expiresAt>Date.now());
}
function matchmakingPayloadFor(playerKey,reason='') {
  const players=matchmakingSortedEntries().slice(0,MATCHMAKING_MAX_PLAYERS).map(e=>matchmakingPlayerPublic(e.playerKey));
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
function emitMatchmakingState(reason='') {
  for(const entry of matchmakingSortedEntries()){
    emitToPlayerKey(entry.playerKey,'matchmakingState',matchmakingPayloadFor(entry.playerKey,reason));
  }
}
function emitMatchmakingIdle(playerKey,reason='') {
  emitToPlayerKey(playerKey,'matchmakingState',{
    searching:false,players:[],foundCount:0,maxPlayers:MATCHMAKING_MAX_PLAYERS,
    deadlineAt:null,waitMs:MATCHMAKING_WAIT_MS,reason:reason||'',
  });
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
      emitToPlayerKey(x.entry.playerKey,'matchmakingState',{searching:false,players:[],foundCount:0,maxPlayers:MATCHMAKING_MAX_PLAYERS,deadlineAt:null,waitMs:MATCHMAKING_WAIT_MS,reason:'Partida encontrada.'});
      x.socket.emit('matchmakingMatched',{code,count:group.length,players:matchPlayers});
      x.socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source:'matchmaking',matchSize:group.length,matchPlayers:names});
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
  if(cur&&(!inviteId||cur.inviteId===inviteId))map.delete(playerKey);
}
function roomHasInviteCapacity(room,playerKey=null) {
  if(!room||room.status==='finished')return false;
  const existing=playerKey&&room.players.some(p=>!p.isBot&&p.playerKey===playerKey);
  if(existing)return true;
  const map=ensureInviteReservations(room);
  let reserved=0;for(const key of map.keys())if(key!==playerKey)reserved++;
  return room.players.length+reserved<5;
}
function roomAllowsInviteEventually(room,playerKey=null) {
  if(!room||room.status==='finished'||!roomHasInviteCapacity(room,playerKey))return false;
  if(room.status==='between-rounds'&&room.round>=room.rules.allowLateJoinUntilRound)return false;
  if(room.status==='playing'&&room.round>=room.rules.allowLateJoinUntilRound)return false;
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
    inv.status='unavailable';inv.updatedAt=Date.now();
    emitToPlayerKey(inv.toKey,'inviteStatus',{inviteId:inv.id,status:'unavailable',message});
    emitToPlayerKey(inv.fromKey,'inviteStatus',{inviteId:inv.id,status:'unavailable',message});
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
    const spectator=spectatorForSocket(room,socket);if(spectator)removeSpectator(room,spectator,{announce:true});
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
  socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source:'invite-host'});emitChatHistory(socket,room);emitRoom(room);broadcastPresence();
  return room;
}
async function joinSocketIntoRoom(socket,room,{inviteId=null}={}) {
  const key=socket.data.auth.playerKey;
  if(!roomJoinableNow(room,key))throw new Error(room.status==='playing'?'Aguarde o intervalo da rodada para entrar.':'A sala não possui vaga disponível para este convite.');
  await prepareForRoomSwitch(socket,room.code);
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
  socket.emit('joined',{code:room.code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source:'invite',inviteId});emitChatHistory(socket,room);emitRoom(room);broadcastPresence();
  return p;
}
function reserveInviteSeat(invite) {
  const room=rooms.get(invite.targetRoomCode);if(!room||!roomAllowsInviteEventually(room,invite.toKey))return false;
  const map=ensureInviteReservations(room);map.set(invite.toKey,{inviteId:invite.id,expiresAt:invite.expiresAt});return true;
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
// O áudio não passa pelo servidor: o Socket.IO transporta apenas a sinalização WebRTC.
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
function notifyExistingLiveVoiceSendersAbout(socket) {
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
    });
  }
  const active=[...liveVoiceSenders.values()].filter(x=>x.roomCode===room.code);
  socket.emit('liveVoiceStatusSnapshot', {
    participantIds:active.map(x=>x.participantId),
    playerIds:active.filter(x=>x.role===ROLE_PLAYER).map(x=>x.participantId),
  });
}
function notifyLiveVoicePeerUnavailable(socket){
  const roomCode=String(socket.data.roomCode||'');if(!roomCode)return;
  socket.to(roomCode).emit('liveVoicePeerUnavailable',{socketId:socket.id});
}

io.use((socket,next)=>{
  const session=authFromCookieHeader(socket.handshake.headers.cookie);
  if(!session) return next(new Error('AUTH_REQUIRED'));
  socket.data.auth=session;
  next();
});

io.on('connection', socket => {
  monitor.socketConnections++;
  connectionDebug('connected',{socketId:socket.id,recovered:!!socket.recovered});
  socket.once('disconnect',reason=>{
    monitor.socketDisconnects++;
    connectionDebug('disconnected',{socketId:socket.id,reason});
  });
  // V40.55 — quando o próprio Socket.IO recupera a sessão, preservamos os dados
  // restaurados até o join automático do cliente confirmar/revincular a vaga.
  if(!socket.recovered){socket.data.role=null;socket.data.spectatorId=null;}
  else connectionDebug('socket.io recovered', {socketId:socket.id,roomCode:socket.data.roomCode,role:socket.data.role});
  registerPresenceSocket(socket);
  socket.emit('presenceSnapshot',buildPresenceSnapshot());
  socket.emit('publicRoomsSnapshot',buildPublicRoomsSnapshot());
  socket.emit('matchmakingState',matchmakingPayloadFor(socket.data.auth.playerKey));
  emitPendingInvitesFor(socket);
  setTimeout(broadcastPresence,0);

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
      await abandonHumanSeatDurably(room,player,{reason:'confirmou a saída voluntária após recuperar a conexão'});
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
      if(socket.data.role===ROLE_PLAYER&&socket.data.roomCode){
        socket.emit('resumeActiveSeatResult',{ok:true,alreadyJoined:true,code:socket.data.roomCode});
        return;
      }
      if(socket.data.role===ROLE_SPECTATOR&&socket.data.roomCode){
        socket.emit('resumeActiveSeatResult',{ok:false,reason:'spectating'});
        return;
      }
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
      if(!(await rankingReady))throw new Error('Histórico de partidas indisponível.');
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


  socket.on('liveVoiceReady', () => {
    try { notifyExistingLiveVoiceSendersAbout(socket); } catch(e) { err(socket,e); }
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
        if(!sdp||!['offer','answer'].includes(String(sdp.type||''))) throw new Error('Descrição de voz inválida.');
        const desc=String(sdp.sdp||'');
        if(desc.length<20||desc.length>24000) throw new Error('Descrição de voz fora do limite.');
        out.sdp={type:String(sdp.type),sdp:desc};
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
        socket.emit('matchmakingState',matchmakingPayloadFor(key));
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
      else emitMatchmakingIdle(key,'Você não está na fila.');
    }catch(e){err(socket,e);}
  });

  socket.on('createRoom', async payload => {
    let releaseRoomSlot=null;
    try {
      if(socket.data.role===ROLE_SPECTATOR)throw new Error('Saia do Modo Observador antes de criar outra sala.');
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
      socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER});
      emitChatHistory(socket, room);
      emitRoom(room);
      broadcastPresence();
    } catch(e){err(socket,e);}
    finally{if(releaseRoomSlot)releaseRoomSlot();}
  });

  socket.on('setRoomPublic', payload => withRoom(socket,(room,p)=>{
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
          if(byKey.connected&&liveSocket&&byKey.socketId!==socket.id){
            throw new Error('Sua vaga nesta sala já está conectada em outro dispositivo.');
          }
          if(!byKey.reconnectEligible&&byKey.socketId!==socket.id){
            throw new Error('Sua reserva automática para esta sala não é mais válida. Entre novamente como novo jogador quando a sala permitir.');
          }
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
      // como novo jogador enquanto a regra de entrada tardia ainda permitir.
      if(!p){
        const lateJoinClosed=room.status==='between-rounds'&&Number(room.round||0)>=Number(room.rules?.allowLateJoinUntilRound||0);
        if(room.status==='playing'||lateJoinClosed){
          socket.emit('spectatorOffer',{code:room.code,round:room.round,rounds:room.rules.rounds,playerCount:room.players.length,status:room.status});
          return;
        }
        if(room.status==='finished')throw new Error('A partida desta sala já terminou.');
        if(!roomHasInviteCapacity(room,socket.data.auth.playerKey)){
          throw new Error('A sala está completa ou possui vaga reservada por convite.');
        }
        await prepareSuccessfulEntry();
        p=Engine.addPlayer(room,{socketId:socket.id,token:crypto.randomUUID(),name:cleanPresenceName(payload?.name||socket.data.auth.name),avatar:cleanAvatar(payload?.avatar),playerKey:socket.data.auth.playerKey});
      }

      removeFromMatchmaking(socket.data.auth.playerKey,{reason:'Busca encerrada porque você entrou em uma sala.',notify:true});
      const acceptedManualInvite=[...invitations.values()].find(i=>i.toKey===socket.data.auth.playerKey&&i.targetRoomCode===code&&['accepted-waiting','ready'].includes(i.status));
      releaseReservation(room,socket.data.auth.playerKey);
      socket.data.roomCode=code;socket.data.playerId=p.id;socket.data.spectatorId=null;socket.data.role=ROLE_PLAYER;
      socket.join(code);
      updatePresenceFromSocket(socket,{name:p.name,avatar:p.avatar});
      socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER});
      emitChatHistory(socket,room);
      emitRoom(room);
      broadcastPresence();
      if(acceptedManualInvite)completeInvite(acceptedManualInvite,'✅ Você entrou na mesa reservada.');
    } catch(e){err(socket,e);}
  });

  socket.on('joinSpectator', async payload => {
    let releaseSpectatorSlot=null;
    try{
      const code=InputSafety.cleanRoomCode(payload?.code);
      const room=rooms.get(code);
      if(!room)throw new Error('Sala não encontrada.');ensureSocial(room);
      if(Number(room.round||0)<=0||room.status==='lobby')throw new Error('O Modo Observador fica disponível depois que a partida começar.');
      const key=socket.data.auth.playerKey;
      const playerSeat=room.players.find(p=>!p.isBot&&p.playerKey===key);
      if(playerSeat)throw new Error('Você já possui uma vaga de jogador nesta sala. Reconecte como jogador.');
      const token=InputSafety.cleanOpaqueId(payload?.token,160)||crypto.randomUUID();
      let spectator=room.spectators.find(s=>s.token===token||s.playerKey===key);
      if(spectator&&spectator.playerKey!==key)throw new Error('Esta vaga de observador pertence a outra conta.');
      if(!spectator){
        enforceActionRate(socket,'joinSpectator','Muitas tentativas de entrada como observador em pouco tempo.');
        releaseSpectatorSlot=reserveSpectatorJoinSlot(room);
      }
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
      removeFromMatchmaking(key,{reason:'Busca encerrada porque você entrou como observador.',notify:true});
      socket.data.roomCode=code;socket.data.playerId=null;socket.data.spectatorId=spectator.id;socket.data.role=ROLE_SPECTATOR;socket.join(code);
      updatePresenceFromSocket(socket,{name:spectator.name,avatar:spectator.avatar});
      socket.emit('joined',{code,spectatorId:spectator.id,token:spectator.token,role:ROLE_SPECTATOR});
      emitChatHistory(socket,room);
      if(firstJoin)appendSystemChat(room,`👁️ ${spectator.name} entrou como observador.`);
      emitRoom(room);broadcastPresence();
    }catch(e){err(socket,e);}
    finally{if(releaseSpectatorSlot)releaseSpectatorSlot();}
  });

  socket.on('addBot', () => withRoom(socket,(room,p)=>{
    if(!p.host) throw new Error('Somente o anfitrião pode adicionar uma máquina.');
    if(room.status==='playing') throw new Error('Adicione máquinas somente fora de uma rodada.');
    if(!roomHasInviteCapacity(room,null)) throw new Error('Há vaga reservada por convite; não é possível adicionar outra máquina agora.');
    addBotToRoom(room);
    broadcastPresence();
  }));

  socket.on('removeBot', () => withRoom(socket,(room,p)=>{
    if(!p.host) throw new Error('Somente o anfitrião pode remover uma máquina.');
    if(room.status==='playing') throw new Error('Remova máquinas somente fora de uma rodada.');
    const bot = [...room.players].reverse().find(x => x.isBot);
    if(!bot) throw new Error('Não há jogador automático para remover.');
    room.players = room.players.filter(x => x.id !== bot.id);
    Engine.appendLog(room, `${bot.name} foi removido da mesa.`, 'system');
    ensureHost(room);
    broadcastPresence();
  }));

  socket.on('leaveRoom', async (ack) => {
    const confirmLeave=(payload={})=>{try{if(typeof ack==='function')ack({ok:true,...payload})}catch{}};
    try {
      notifyLiveVoicePeerUnavailable(socket);clearLiveVoiceSender(socket);
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      const room = rooms.get(code);
      if (!room) {
        socket.data.roomCode = null;
        socket.data.playerId = null;
        socket.data.spectatorId = null;
        socket.data.role = null;
        socket.emit('leftRoom');
        confirmLeave({keepSeat:false});
        return;
      }
      if(socket.data.role===ROLE_SPECTATOR){
        const spectator=spectatorForSocket(room,socket);
        if(spectator)removeSpectator(room,spectator,{announce:true});
        socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;socket.data.spectatorId=null;socket.data.role=null;
        socket.emit('leftRoom',{message:'Você saiu do Modo Observador.'});confirmLeave({keepSeat:false});emitRoom(room);broadcastPresence();return;
      }

      const idx = room.players.findIndex(p => p.id === playerId);
      if (idx < 0) {
        socket.leave(code);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        socket.data.spectatorId = null;
        socket.data.role = null;
        socket.emit('leftRoom');
        confirmLeave({keepSeat:false});
        return;
      }

      const leaving = room.players[idx];
      // V40.59 — SAIR é abandono definitivo, nunca uma reconexão automática.
      // Se a rodada já começou, a cadeira vira uma Máquina comum para não quebrar
      // a mesa dos demais; a identidade/token humano são removidos imediatamente.
      await abandonHumanSeatDurably(room,leaving,{reason:'saiu voluntariamente da sala',socket});

      socket.leave(code);
      socket.data.roomCode = null;
      socket.data.playerId = null;
      socket.data.spectatorId = null;
      socket.data.role = null;
      socket.emit('leftRoom',{keepSeat:false,message:'Você saiu da sala. Para voltar depois, use novamente o código da sala, se ela ainda existir.'});
      confirmLeave({keepSeat:false,roomCode:code});
      broadcastPresence();
    } catch(e) {
      try{if(typeof ack==='function')ack({ok:false,message:e?.message||'Não foi possível sair da sala.'})}catch{}
      err(socket,e);
    }
  });

  socket.on('playAgain', () => withRoom(socket,(room,p)=>{
    if(!replayEligible(room)) throw new Error('Jogar de novo está disponível somente após uma partida entre jogadores humanos.');
    if(p.isBot || !p.connected) throw new Error('Jogador não disponível para continuar.');
    if(!Array.isArray(room.replayReadyPlayerIds)) room.replayReadyPlayerIds=[];
    if(!room.replayReadyPlayerIds.includes(p.id)){
      room.replayReadyPlayerIds.push(p.id);
      Engine.appendLog(room, `🔁 ${p.name} confirmou que quer jogar de novo.`, 'system');
    }
    maybeStartReplay(room);
    broadcastPresence();
  }));

  socket.on('startRound', () => withRoom(socket,(room,p)=>{
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
      clearInviteTimer(invite.id);
      if(!payload?.accept){
        invite.status='refused';invite.updatedAt=Date.now();
        emitToPlayerKey(invite.fromKey,'inviteStatus',{inviteId:invite.id,status:'refused',message:`❌ ${invite.toName||'Jogador'} recusou o convite.`});
        emitToPlayerKey(invite.toKey,'inviteStatus',{inviteId:invite.id,status:'refused',message:'Convite recusado.'});
        setTimeout(()=>invitations.delete(invite.id),60000).unref?.();return;
      }
      const dest=rooms.get(invite.targetRoomCode);
      if(!dest||!senderStillInDestination(invite,dest))throw new Error('A sala do convite não está mais disponível.');
      invite.expiresAt=Date.now()+INVITE_RESERVATION_MS;
      if(!reserveInviteSeat(invite))throw new Error('A sala ficou sem vagas antes da sua resposta.');
      removeFromMatchmaking(invite.toKey,{reason:'Busca encerrada porque você aceitou um convite.',notify:true});

      // V40.59 — aceitar o convite não mantém duas vagas. Se a sala destino já
      // pode receber o jogador, a entrada acontece agora e a sala anterior é
      // abandonada de forma definitiva pelo joinSocketIntoRoom. Se ainda não pode,
      // a reserva do convite aguarda; a sala antiga só é abandonada no ingresso real.
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
      io.to(room.code).emit('chatMessage', message);
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
      io.to(room.code).emit('voiceMessage', {
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
      const effect = InputSafety.cleanEnumToken(payload?.effect,32);
      if (!SOCIAL_EFFECTS.has(effect)) throw new Error('Efeito sonoro inválido.');

      const now = Date.now();
      if (socket.data.lastEffectAt && now - socket.data.lastEffectAt < 900) return;
      socket.data.lastEffectAt = now;
      io.to(room.code).emit('soundEffect', {
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
        if (!currentRoom || !['lobby','between-rounds'].includes(currentRoom.status)) return;
        const stale = currentRoom.players.find(x => x.id === playerId);
        if (!stale || stale.connected || stale.autoControlled) return;

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

let roomAuditRunning=false;
async function auditRoomLifecycle(){
  if(roomAuditRunning)return 0;
  roomAuditRunning=true;
  let cleaned=0;
  try{
    for(const [code,room] of [...rooms]){
      if(!RoomGovernance.shouldCleanupRoom(room))continue;
      try{
        await removeRoomDurably(code,Date.now(),'A sala foi encerrada automaticamente porque não restou nenhum jogador humano.');
        cleaned++;
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
    if(!activeMatch && allHumansGone && now-room.createdAt>6*60*60*1000) {
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
    const liveRoom=rooms.get(room.code);if(!liveRoom||!['lobby','between-rounds'].includes(liveRoom.status))return;
    const stale=liveRoom.players.find(p=>p.id===player.id);
    if(!stale||stale.connected||stale.isBot)return;
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
  const ready=await roomSnapshotsReady;if(!ready)return 0;
  let restored=0;
  try{
    const snapshots=await roomSnapshotStore.loadActive();
    for(const snapshot of snapshots){
      const room=restoreRoomSnapshot(snapshot,{reconnectGraceMs:runtimeReconnectGraceMs()});
      if(!room){
        if(snapshot?.code)roomSnapshotStore.delete(snapshot.code).catch(e=>console.error('[rooms] falha ao remover snapshot inválido',snapshot.code,e?.message||e));
        continue;
      }
      if(rooms.has(room.code))continue;
      if(RoomGovernance.shouldCleanupRoom(room)){
        try{await roomSnapshotStore.markRoomDeleted(room.code,Date.now());}
        catch(e){console.error('[rooms] falha ao descartar snapshot sem humanos',room.code,e?.message||e);}
        continue;
      }
      ensureSocial(room);rooms.set(room.code,room);restored++;
      Engine.appendLog(room,'♻️ A sala foi restaurada após reinício do servidor. Reconecte para retomar seu lugar.','system');
      for(const p of room.players)scheduleRestoredPlayerGrace(room,p);
      // V40.68.1 — se a sala restaurada estiver sem qualquer humano conectado,
      // o prazo de 5 minutos continua do marco salvo; se o restart causou a queda,
      // o relógio começa agora. Robôs permanecem parados enquanto ninguém retornar.
      refreshOfflineRoomExpiry(room);
      roomSnapshotStore.queueSave(room);
    }
  }catch(e){console.error('[rooms] falha ao restaurar snapshots:',e?.message||e);}
  if(restored)console.log(`[rooms] ${restored} sala(s) restaurada(s) após reinício.`);
  return restored;
}

let shuttingDown=false;
async function gracefulShutdown(signal){
  if(shuttingDown)return;shuttingDown=true;
  console.log(`[server] ${signal}: salvando ${rooms.size} sala(s) antes de encerrar...`);
  const force=setTimeout(()=>process.exit(1),8000);force.unref?.();
  try{await roomSnapshotsReady;await roomSnapshotStore.flushAll(rooms);console.log('[rooms] snapshots finais salvos.');}
  catch(e){console.error('[rooms] erro no snapshot final:',e?.message||e);}
  try{io.close();}catch{}
  server.close(async()=>{try{await roomSnapshotStore.close();}catch{};try{await authIdentityStore.close();}catch{};clearTimeout(force);process.exit(0);});
}
process.once('SIGTERM',()=>gracefulShutdown('SIGTERM'));
process.once('SIGINT',()=>gracefulShutdown('SIGINT'));

async function startServer(){
  await restorePersistedRooms();
  server.listen(PORT,()=>console.log(`Mau-Mau online em http://localhost:${PORT}`));
}
startServer().catch(e=>{console.error('[server] falha ao iniciar:',e);process.exit(1);});

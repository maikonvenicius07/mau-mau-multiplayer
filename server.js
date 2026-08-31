'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');
const Engine = require('./game-engine');
const BotPlayer = require('./bot-player');
const { RankingStore, buildMatchRecord, normalizePeriod, normalizeMode } = require('./ranking-store');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 900000 });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
// V39.1 — timers de tolerância de reconexão ficam somente na memória do servidor.
const reconnectTimers = new Map();
const RECONNECT_GRACE_MS = 60 * 1000;
const rankingStore = new RankingStore();
const rankingReady = rankingStore.init().then(()=>{console.log(`[ranking] armazenamento: ${rankingStore.kind}`);return true}).catch(e=>{console.error('[ranking] falha ao iniciar:',e);return false});

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const AUTH_SESSION_SECRET = String(process.env.AUTH_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const AUTH_COOKIE = 'maumau_google_session';
const AUTH_TTL_SECONDS = 7 * 24 * 60 * 60;
const googleAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (!GOOGLE_CLIENT_ID) console.warn('[auth] GOOGLE_CLIENT_ID não configurado. O login Google ficará bloqueado até configurar a variável no Render.');
if (!process.env.AUTH_SESSION_SECRET) console.warn('[auth] AUTH_SESSION_SECRET não configurado. Foi criada uma chave temporária; sessões serão encerradas quando o servidor reiniciar.');

function googlePlayerKey(sub) {
  // O "sub" é a identidade estável da Conta Google. O hash evita expor esse identificador
  // diretamente e mantém o mesmo playerKey em celulares/computadores diferentes.
  return `g_${crypto.createHash('sha256').update(`mau-mau-google:${sub}`).digest('hex').slice(0,40)}`;
}
function signAuthSession(user) {
  const payload = Buffer.from(JSON.stringify({
    playerKey:user.playerKey,
    name:user.name,
    email:user.email || '',
    picture:user.picture || '',
    exp:Date.now() + AUTH_TTL_SECONDS * 1000,
  })).toString('base64url');
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
    return session;
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
  return verifyAuthSession(parseCookies(header)[AUTH_COOKIE]);
}
function setAuthCookie(req,res,token,maxAge=AUTH_TTL_SECONDS) {
  const forwarded=String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure=req.secure || forwarded==='https';
  const value=token ? encodeURIComponent(token) : '';
  const parts=[`${AUTH_COOKIE}=${value}`,'Path=/','HttpOnly','SameSite=Lax',`Max-Age=${maxAge}`];
  if(secure) parts.push('Secure');
  res.setHeader('Set-Cookie',parts.join('; '));
}

app.set('trust proxy', 1);
app.use(express.json({limit:'16kb'}));

app.get('/api/auth/config', (_,res)=>res.json({ok:true,configured:!!GOOGLE_CLIENT_ID,clientId:GOOGLE_CLIENT_ID || null}));
app.get('/api/auth/me', (req,res)=>{
  const session=authFromCookieHeader(req.headers.cookie);
  if(!session) return res.status(401).json({ok:false,message:'Login Google necessário.'});
  res.json({ok:true,user:{playerKey:session.playerKey,name:session.name,email:session.email,picture:session.picture}});
});
app.post('/api/auth/google', async (req,res)=>{
  try {
    if(!googleAuthClient || !GOOGLE_CLIENT_ID) return res.status(503).json({ok:false,message:'Login Google ainda não foi configurado no servidor.'});
    const credential=String(req.body?.credential || '').trim();
    if(!credential) return res.status(400).json({ok:false,message:'Credencial Google não informada.'});
    const ticket=await googleAuthClient.verifyIdToken({idToken:credential,audience:GOOGLE_CLIENT_ID});
    const payload=ticket.getPayload();
    if(!payload?.sub) throw new Error('Conta Google sem identificador válido.');
    if(payload.email_verified === false) throw new Error('O e-mail desta Conta Google não está verificado.');
    const user={
      playerKey:googlePlayerKey(payload.sub),
      name:String(payload.name || payload.given_name || 'Jogador').trim().slice(0,60),
      email:String(payload.email || '').trim().slice(0,180),
      picture:String(payload.picture || '').trim().slice(0,500),
    };
    setAuthCookie(req,res,signAuthSession(user));
    res.json({ok:true,user});
  } catch(e) {
    console.error('[auth] falha no login Google:',e?.message || e);
    res.status(401).json({ok:false,message:'Não foi possível validar esta Conta Google. Tente novamente.'});
  }
});
app.post('/api/auth/logout', (req,res)=>{
  setAuthCookie(req,res,'',0);
  res.json({ok:true});
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ok:true, rooms:rooms.size, ranking:rankingStore.kind}));

app.get('/api/ranking', async (req,res)=>{
  try {
    const period=normalizePeriod(req.query.period);
    const mode=normalizeMode(req.query.mode);
    if(!(await rankingReady)) throw new Error('Armazenamento do ranking indisponível.');
    const rows=await rankingStore.getLeaderboard({period,mode,limit:50});
    res.json({ok:true,period,mode,timezone:'America/Porto_Velho',rows});
  } catch(e) {
    console.error('[ranking] consulta falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o ranking agora.'});
  }
});

app.get('/api/profile', async (req,res)=>{
  try {
    const playerKey=String(req.query.playerKey||'').trim().slice(0,80);
    if(!playerKey) return res.status(400).json({ok:false,message:'Jogador não informado.'});
    const period=normalizePeriod(req.query.period||'all');
    const mode=normalizeMode(req.query.mode);
    if(!(await rankingReady)) throw new Error('Armazenamento do ranking indisponível.');
    const stats=await rankingStore.getPlayerStats({playerKey,period,mode});
    res.json({ok:true,period,mode,stats});
  } catch(e) {
    console.error('[ranking] perfil falhou:',e);
    res.status(500).json({ok:false,message:'Não foi possível carregar o perfil agora.'});
  }
});

function roomCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do {
    code=''; for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  } while(rooms.has(code));
  return code;
}

function maybeRecordFinished(room) {
  if (!room || room.status !== 'finished' || room.rankingRecorded || room.rankingRecording) return;
  const record=buildMatchRecord(room);
  if (!record.results.length) { room.rankingRecorded=true; return; }
  room.rankingRecording=true;
  rankingReady.then(ready=>{ if(!ready) throw new Error('Armazenamento do ranking indisponível.'); return rankingStore.recordMatch(record); }).then(inserted=>{
    room.rankingRecorded=true;
    if(inserted) Engine.appendLog(room, `🏆 Resultado registrado no ranking ${record.mode==='human'?'contra pessoas':'com máquina'}.`, 'system');
  }).catch(e=>{
    console.error('[ranking] gravação falhou:',e);
    room.rankingRecording=false;
  });
}

function emitRoom(room) {
  maybeRecordFinished(room);
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', Engine.roomPublicState(room,p.id));
  }
  scheduleBotTurn(room);
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
function roomWaitingForReconnect(room) {
  return !!(room && room.status==='playing' && room.players.some(p=>!p.isBot&&!p.connected&&!p.autoControlled));
}
function requireRoundNotPaused(room) {
  if(roomWaitingForReconnect(room)) throw new Error('Partida pausada: aguardando a reconexão de um jogador.');
}
function isAutomatedPlayer(player) { return !!(player && (player.isBot || player.autoControlled)); }
function scheduleReconnectTakeover(room, player) {
  const matchActive=room && (room.status==='playing' || (room.status==='between-rounds' && room.round>0));
  if(!matchActive || !player || player.isBot || player.connected) return;
  cancelReconnectTimer(room.code,player.id);
  const key=reconnectTimerKey(room.code,player.id);
  const delay=Math.max(0,Number(player.reconnectDeadlineAt||Date.now())-Date.now());
  const timer=setTimeout(()=>{
    reconnectTimers.delete(key);
    const liveRoom=rooms.get(room.code);
    if(!liveRoom || liveRoom!==room || !(liveRoom.status==='playing' || (liveRoom.status==='between-rounds' && liveRoom.round>0))) return;
    const stale=liveRoom.players.find(p=>p.id===player.id);
    if(!stale || stale.connected || stale.isBot || stale.autoControlled) return;
    stale.autoControlled=true;
    stale.reconnectDeadlineAt=null;
    Engine.appendLog(liveRoom, `🤖 ${stale.name} não retornou em 60 segundos. A Máquina assumiu temporariamente suas jogadas.`, 'system');
    io.to(liveRoom.code).emit('reconnectionEvent',{kind:'auto',playerId:stale.id,name:stale.name});
    emitRoom(liveRoom);
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

  // V36/V39.1: Queima com segunda carta só existe para quem já está na vez normal.
  // Bots e vagas em AUTO fora da vez podem apenas fazer Ação Rápida.
  const turnBot = room.players[room.currentPlayer];
  const burnBot = isAutomatedPlayer(turnBot) && !turnBot.finishedRound && Engine.canBurnMatch(room,turnBot).length > 0 ? turnBot : null;
  const quickBot = room.players.find(p => isAutomatedPlayer(p) && !p.finishedRound && p.id !== turnBot?.id && Engine.canQuickAction(room,p).length > 0);
  const actingBot = burnBot || quickBot || (isAutomatedPlayer(turnBot) && !turnBot.finishedRound ? turnBot : null);
  if (!actingBot) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const liveRoom = rooms.get(room.code);
    if (!liveRoom || liveRoom !== room || liveRoom.status !== 'playing') return;
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
      // Só avançamos a vez por segurança quando o erro ocorreu durante a vez
      // normal do bot. Uma tentativa de queima fora da vez nunca pula terceiros.
      if (isCurrentTurn) {
        liveBot.justDrawnCardId = null;
        liveRoom.continuationPlayerId = null;
        const idx = liveRoom.players.findIndex(p => p.id === liveBot.id);
        if (idx >= 0 && liveRoom.status === 'playing') {
          const n = liveRoom.players.length;
          let cursor = idx;
          for (let i=0; i<n; i++) {
            cursor = (cursor + liveRoom.direction + n) % n;
            if (!liveRoom.players[cursor].finishedRound) { liveRoom.currentPlayer = cursor; break; }
          }
        }
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

function nextBotInfo(room) {
  const bots = room.players.filter(p => p.isBot);
  const avatars = ['preta','costela','perna','homem','mulher'];
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

function cancelCurrentRoundAfterLeave(room, leavingName) {
  // A saída voluntária no meio da rodada não pode deixar a mesa pausada.
  // A rodada corrente é anulada e pode ser reiniciada com os jogadores restantes.
  room.round = Math.max(0, room.round - 1);
  room.status = room.round === 0 ? 'lobby' : 'between-rounds';
  room.deck = [];
  room.discard = [];
  room.direction = -1;
  room.currentPlayer = -1;
  room.requestedSuit = null;
  room.pendingSeven = 0;
  room.winnerId = null;
  room.lastWinnerCard = null;
  room.continuationPlayerId = null;
  room.lastPlayedById = null;
  room.burnTopCardId = null;
  room.reactionTopCardId = null;
  room.reactionSourcePlayerId = null;
  room.reactionNextPlayerId = null;
  room.finishPendingSeven = false;
  room.roundRoles = null;
  for (const p of room.players) {
    p.hand = [];
    p.roundScore = 0;
    p.finishedRound = false;
    p.declaration = null;
    p.justDrawnCardId = null;
  }
  Engine.appendLog(room, `${leavingName} saiu da sala. A rodada em andamento foi cancelada e deverá ser reiniciada.`, 'system');
}
function withRoom(socket, fn) {
  try {
    const room = rooms.get(socket.data.roomCode);
    if (!room) throw new Error('Sala não encontrada.');
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (!player) throw new Error('Jogador não encontrado na sala.');
    if (!player.isBot && player.playerKey && player.playerKey !== socket.data.auth?.playerKey) throw new Error('Esta vaga pertence a outra Conta Google.');
    fn(room, player);
    emitRoom(room);
  } catch(e) { err(socket,e); }
}


const SOCIAL_EFFECTS = new Set(['applause','laugh','horn','drum','victory','wow','jogaBoca']);
const QUICK_AUDIO_MAX_MS = 15000;
const QUICK_AUDIO_MAX_BYTES = 700 * 1024;
const QUICK_AUDIO_COOLDOWN_MS = 2500;
function ensureSocial(room) {
  if (!Array.isArray(room.chat)) room.chat = [];
}
function cleanChatText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}
function emitChatHistory(socket, room) {
  ensureSocial(room);
  socket.emit('chatHistory', room.chat.slice(-60));
}

io.use((socket,next)=>{
  const session=authFromCookieHeader(socket.handshake.headers.cookie);
  if(!session) return next(new Error('AUTH_REQUIRED'));
  socket.data.auth=session;
  next();
});

io.on('connection', socket => {
  socket.on('createRoom', payload => {
    try {
      const code = roomCode();
      const room = Engine.createRoom(code, {
        socketId:socket.id,
        token:payload?.token,
        name:payload?.name || socket.data.auth.name,
        avatar:payload?.avatar,
        playerKey:socket.data.auth.playerKey,
      });
      rooms.set(code,room);
      ensureSocial(room);
      if (payload?.withBot) addBotToRoom(room);
      const p=room.players[0];
      socket.data.roomCode=code; socket.data.playerId=p.id;
      socket.join(code);
      socket.emit('joined',{code,playerId:p.id,token:p.token});
      emitChatHistory(socket, room);
      emitRoom(room);
    } catch(e){err(socket,e);}
  });

  socket.on('joinRoom', payload => {
    try {
      const code=String(payload?.code||'').trim().toUpperCase();
      const room=rooms.get(code);
      if(!room) throw new Error('Sala não encontrada.');
      ensureSocial(room);
      let p = null;
      if (payload?.token) {
        const existing = room.players.find(x => x.token === payload.token);
        if (existing?.playerKey && existing.playerKey !== socket.data.auth.playerKey) {
          throw new Error('Esta vaga pertence a outra Conta Google.');
        }
        if (existing?.socketId && existing.socketId !== socket.id) {
          io.to(existing.socketId).emit('sessionReplaced');
        }
        const wasDisconnected=!!(existing && !existing.connected);
        const wasAutoControlled=!!existing?.autoControlled;
        if(existing){
          cancelReconnectTimer(room.code,existing.id);
          // Pode haver uma jogada automática já agendada para esta vaga.
          if(room.botTimer){ clearTimeout(room.botTimer); room.botTimer=null; }
        }
        p = Engine.reconnectPlayer(room,payload.token,socket.id);
        if(p && wasDisconnected){
          Engine.appendLog(room, wasAutoControlled
            ? `🟢 ${p.name} voltou e retomou seu lugar da Máquina.`
            : `🟢 ${p.name} voltou à mesa dentro do prazo de reconexão.`, 'system');
          socket.emit('reconnectionEvent',{kind:wasAutoControlled?'returned-from-auto':'returned',playerId:p.id,name:p.name});
          io.to(room.code).except(socket.id).emit('reconnectionEvent',{kind:'returned',playerId:p.id,name:p.name});
        }
      }
      if(!p) p = Engine.addPlayer(room,{socketId:socket.id, token:payload?.token, name:payload?.name || socket.data.auth.name, avatar:payload?.avatar, playerKey:socket.data.auth.playerKey});
      socket.data.roomCode=code; socket.data.playerId=p.id;
      socket.join(code);
      socket.emit('joined',{code,playerId:p.id,token:p.token});
      emitChatHistory(socket, room);
      emitRoom(room);
    } catch(e){err(socket,e);}
  });

  socket.on('addBot', () => withRoom(socket,(room,p)=>{
    if(!p.host) throw new Error('Somente o anfitrião pode adicionar uma máquina.');
    if(room.status==='playing') throw new Error('Adicione máquinas somente fora de uma rodada.');
    addBotToRoom(room);
  }));

  socket.on('removeBot', () => withRoom(socket,(room,p)=>{
    if(!p.host) throw new Error('Somente o anfitrião pode remover uma máquina.');
    if(room.status==='playing') throw new Error('Remova máquinas somente fora de uma rodada.');
    const bot = [...room.players].reverse().find(x => x.isBot);
    if(!bot) throw new Error('Não há jogador automático para remover.');
    room.players = room.players.filter(x => x.id !== bot.id);
    Engine.appendLog(room, `${bot.name} foi removido da mesa.`, 'system');
    ensureHost(room);
  }));

  socket.on('leaveRoom', () => {
    try {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      const room = rooms.get(code);
      if (!room) {
        socket.data.roomCode = null;
        socket.data.playerId = null;
        socket.emit('leftRoom');
        return;
      }

      const idx = room.players.findIndex(p => p.id === playerId);
      if (idx < 0) {
        socket.leave(code);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        socket.emit('leftRoom');
        return;
      }

      const leaving = room.players[idx];
      cancelReconnectTimer(code,leaving.id);
      const wasPlaying = room.status === 'playing';
      room.players.splice(idx, 1);

      if (!room.players.length || room.players.every(p => p.isBot)) {
        if (room.botTimer) clearTimeout(room.botTimer);
        clearReconnectTimersForRoom(code);
        rooms.delete(code);
      } else {
        if (wasPlaying) cancelCurrentRoundAfterLeave(room, leaving.name);
        else Engine.appendLog(room, `${leaving.name} saiu da sala.`, 'system');

        // Se restou somente um participante durante uma partida já iniciada,
        // ele retorna à espera. As regras de entrada tardia continuam valendo.
        if (room.players.length === 1 && room.status === 'between-rounds' && room.round === 0) {
          room.status = 'lobby';
        }
        ensureHost(room);
        emitRoom(room);
      }

      socket.leave(code);
      socket.data.roomCode = null;
      socket.data.playerId = null;
      socket.emit('leftRoom');
    } catch(e) { err(socket,e); }
  });

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
  }));

  socket.on('declare', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.declare(room,p.id,payload?.type); }));
  socket.on('playCard', payload => withRoom(socket,(room,p)=> {
    // V29: após comprar, o jogador pode jogar qualquer carta válida da mão.
    requireRoundNotPaused(room);
    Engine.playCard(room,p.id,payload.cardId,payload.chosenSuit);
  }));
  socket.on('playDoubleCard', payload => withRoom(socket,(room,p)=> {
    requireRoundNotPaused(room);
    Engine.playDoubleCard(room,p.id,payload?.firstCardId,payload?.secondCardId,payload?.chosenSuit);
  }));
  socket.on('burnMatch', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.burnMatch(room,p.id,payload.cardId); }));
  socket.on('quickAction', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.quickAction(room,p.id,payload.cardId); }));
  // Compatibilidade temporária com clientes V10/V9.
  socket.on('burnPair', payload => withRoom(socket,(room,p)=> { requireRoundNotPaused(room); Engine.burnMatch(room,p.id,payload.cardId); }));
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


  socket.on('chatMessage', payload => {
    try {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error('Sala não encontrada.');
      const player = room.players.find(p => p.id === socket.data.playerId);
      if (!player || !player.connected || player.isBot) throw new Error('Jogador não disponível para conversar.');
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
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
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
      if (!player || !player.connected || player.isBot) throw new Error('Jogador não disponível para enviar áudio.');

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
      const player = room.players.find(p => p.id === socket.data.playerId);
      if (!player || !player.connected || player.isBot) throw new Error('Jogador não disponível para enviar efeito.');
      const effect = String(payload?.effect || '');
      if (!SOCIAL_EFFECTS.has(effect)) throw new Error('Efeito sonoro inválido.');

      const now = Date.now();
      if (socket.data.lastEffectAt && now - socket.data.lastEffectAt < 900) return;
      socket.data.lastEffectAt = now;
      io.to(room.code).emit('soundEffect', {
        id: `fx-${now}-${Math.random().toString(36).slice(2,8)}`,
        at: now,
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        effect,
      });
    } catch(e) { err(socket,e); }
  });

  socket.on('updateProfile', payload => withRoom(socket,(room,p)=>{
    if(room.status==='playing') throw new Error('Altere nome/avatar somente fora de uma rodada.');
    if(payload?.name) p.name=String(payload.name).slice(0,24);
    if(payload?.avatar) p.avatar=String(payload.avatar).slice(0,8);
  }));

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room=rooms.get(code);
    if(!room) return;
    const p=room.players.find(x=>x.id===playerId);

    // Se outra aba já reconectou com o mesmo token, este socket é antigo.
    // Não devemos marcar o jogador como desconectado por causa da aba antiga.
    if(p && p.socketId === socket.id){
      p.connected=false;
      p.socketId=null;
      p.disconnectedAt=Date.now();

      // Uma jogada automática que já estava agendada é cancelada: durante a janela
      // de 60 s a mesa fica realmente congelada.
      if(room.botTimer){ clearTimeout(room.botTimer); room.botTimer=null; }

      // IMPORTANTE: não retiramos o papel de anfitrião imediatamente. Um F5, uma
      // ligação ou a troca Wi-Fi/5G não podem destruir a vaga do jogador.
      const matchActive=room.status==='playing' || (room.status==='between-rounds' && room.round>0);
      if(matchActive){
        p.autoControlled=false;
        p.reconnectDeadlineAt=Date.now()+RECONNECT_GRACE_MS;
        Engine.appendLog(room, `🔴 ${p.name} perdeu a conexão. 60 segundos para retornar.`, 'system');
        io.to(room.code).emit('reconnectionEvent',{kind:'lost',playerId:p.id,name:p.name,deadlineAt:p.reconnectDeadlineAt});
        scheduleReconnectTakeover(room,p);
        emitRoom(room);
        return;
      }

      p.autoControlled=false;
      p.reconnectDeadlineAt=Date.now()+RECONNECT_GRACE_MS;
      emitRoom(room);

      // Antes da primeira rodada a cadeira fica reservada por 60 s. Se o jogador
      // não retornar, a vaga é removida porque ainda não existe partida a preservar.
      const timer=setTimeout(() => {
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
          rooms.delete(code);
          return;
        }

        ensureHost(currentRoom);
        Engine.appendLog(currentRoom, `${leavingName} foi removido após 60 segundos desconectado.`, 'system');
        emitRoom(currentRoom);
      }, RECONNECT_GRACE_MS);
      if(typeof timer.unref==='function') timer.unref();
      reconnectTimers.set(reconnectTimerKey(code,playerId),timer);
    }
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms){
    const humans=room.players.filter(p=>!p.isBot);
    const allHumansGone=!humans.length || humans.every(p=>!p.connected);
    if(allHumansGone && now-room.createdAt>6*60*60*1000) {
      if (room.botTimer) clearTimeout(room.botTimer);
      clearReconnectTimersForRoom(code);
      rooms.delete(code);
    }
  }
}, 30*60*1000).unref();

server.listen(PORT,()=>console.log(`Mau-Mau online em http://localhost:${PORT}`));

'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Engine = require('./game-engine');
const BotPlayer = require('./bot-player');
const { RankingStore, buildMatchRecord, normalizePeriod, normalizeMode } = require('./ranking-store');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const rankingStore = new RankingStore();
const rankingReady = rankingStore.init().then(()=>{console.log(`[ranking] armazenamento: ${rankingStore.kind}`);return true}).catch(e=>{console.error('[ranking] falha ao iniciar:',e);return false});

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

function scheduleBotTurn(room) {
  if (!room || room.status !== 'playing' || room.botTimer) return;
  if (room.players.some(p => !p.isBot && !p.connected)) return;

  // V18: antes da jogada normal, uma máquina também pode reagir fora da vez.
  // Queima tem prioridade estratégica sobre Ação Rápida porque transfere o controle da jogada ao bot.
  // O atraso do timer deixa uma pequena janela para jogadores humanos reagirem primeiro.
  const burnBot = room.players.find(p => p.isBot && !p.finishedRound && Engine.canBurnMatch(room,p).length > 0);
  const quickBot = burnBot ? null : room.players.find(p => p.isBot && !p.finishedRound && Engine.canQuickAction(room,p).length > 0);
  const turnBot = room.players[room.currentPlayer];
  const actingBot = burnBot || quickBot || (turnBot?.isBot && !turnBot.finishedRound ? turnBot : null);
  if (!actingBot) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const liveRoom = rooms.get(room.code);
    if (!liveRoom || liveRoom !== room || liveRoom.status !== 'playing') return;
    const liveBot = liveRoom.players.find(p => p.id === actingBot.id);
    if (!liveBot?.isBot || liveBot.finishedRound) return;

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
    fn(room, player);
    emitRoom(room);
  } catch(e) { err(socket,e); }
}


const SOCIAL_EFFECTS = new Set(['applause','laugh','horn','drum','victory','wow','jogaBoca']);
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

io.on('connection', socket => {
  socket.on('createRoom', payload => {
    try {
      const code = roomCode();
      const room = Engine.createRoom(code, {
        socketId:socket.id,
        token:payload?.token,
        name:payload?.name,
        avatar:payload?.avatar,
        playerKey:payload?.playerKey,
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
        if (existing?.socketId && existing.socketId !== socket.id) {
          io.to(existing.socketId).emit('sessionReplaced');
        }
        p = Engine.reconnectPlayer(room,payload.token,socket.id);
      }
      if(!p) p = Engine.addPlayer(room,{socketId:socket.id, token:payload?.token, name:payload?.name, avatar:payload?.avatar, playerKey:payload?.playerKey});
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
      const wasPlaying = room.status === 'playing';
      room.players.splice(idx, 1);

      if (!room.players.length || room.players.every(p => p.isBot)) {
        if (room.botTimer) clearTimeout(room.botTimer);
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

  socket.on('declare', payload => withRoom(socket,(room,p)=> Engine.declare(room,p.id,payload?.type)));
  socket.on('playCard', payload => withRoom(socket,(room,p)=> {
    // V29: após comprar, o jogador pode jogar qualquer carta válida da mão.
    Engine.playCard(room,p.id,payload.cardId,payload.chosenSuit);
  }));
  socket.on('playDoubleCard', payload => withRoom(socket,(room,p)=> {
    Engine.playDoubleCard(room,p.id,payload?.firstCardId,payload?.secondCardId,payload?.chosenSuit);
  }));
  socket.on('burnMatch', payload => withRoom(socket,(room,p)=> Engine.burnMatch(room,p.id,payload.cardId)));
  socket.on('quickAction', payload => withRoom(socket,(room,p)=> Engine.quickAction(room,p.id,payload.cardId)));
  // Compatibilidade temporária com clientes V10/V9.
  socket.on('burnPair', payload => withRoom(socket,(room,p)=> Engine.burnMatch(room,p.id,payload.cardId)));
  socket.on('endBurn', () => withRoom(socket,(room,p)=> Engine.endBurnContinuation(room,p.id)));
  socket.on('draw', () => withRoom(socket,(room,p)=> Engine.drawAction(room,p.id)));
  socket.on('passTurn', () => withRoom(socket,(room,p)=> {
    const oldPlayerId = p.id;
    Engine.passTurn(room,p.id);
    socket.emit('passConfirmed', {
      playerId: oldPlayerId,
      nextPlayerId: room.players[room.currentPlayer]?.id || null,
    });
  }));
  // Compatibilidade com clientes V10/V11.
  socket.on('passAfterDraw', () => withRoom(socket,(room,p)=> {
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

      // IMPORTANTE: não retiramos o papel de anfitrião imediatamente.
      // Um simples F5 ou uma oscilação de internet derruba o socket por alguns
      // segundos. Mantendo host=true durante a tolerância, o criador da sala
      // recupera normalmente o botão "Iniciar" ao reconectar.
      emitRoom(room);

      // Fora de uma rodada, removemos somente quem continuar desconectado após
      // 20 s. Se era o anfitrião, outro conectado assume depois da remoção.
      if (room.status === 'lobby' || room.status === 'between-rounds') {
        setTimeout(() => {
          const currentRoom = rooms.get(code);
          if (!currentRoom || !['lobby','between-rounds'].includes(currentRoom.status)) return;
          const stale = currentRoom.players.find(x => x.id === playerId);
          if (!stale || stale.connected) return;

          const leavingName = stale.name;
          currentRoom.players = currentRoom.players.filter(x => x.id !== playerId);
          if (!currentRoom.players.length || currentRoom.players.every(p => p.isBot)) {
            if (currentRoom.botTimer) clearTimeout(currentRoom.botTimer);
            rooms.delete(code);
            return;
          }

          ensureHost(currentRoom);
          Engine.appendLog(currentRoom, `${leavingName} foi removido após ficar desconectado.`, 'system');
          emitRoom(currentRoom);
        }, 20000);
      }
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
      rooms.delete(code);
    }
  }
}, 30*60*1000).unref();

server.listen(PORT,()=>console.log(`Mau-Mau online em http://localhost:${PORT}`));

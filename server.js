'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Engine = require('./game-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ok:true, rooms:rooms.size}));

function roomCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do {
    code=''; for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  } while(rooms.has(code));
  return code;
}

function emitRoom(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', Engine.roomPublicState(room,p.id));
  }
}
function err(socket, e) {
  socket.emit('gameError', {message: e?.message || 'Ocorreu um erro.'});
}

function ensureHost(room) {
  if (!room.players.length) return;
  if (!room.players.some(p => p.host)) {
    const nextHost = room.players.find(p => p.connected) || room.players[0];
    nextHost.host = true;
  }
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

io.on('connection', socket => {
  socket.on('createRoom', payload => {
    try {
      const code = roomCode();
      const room = Engine.createRoom(code, {
        socketId:socket.id,
        token:payload?.token,
        name:payload?.name,
        avatar:payload?.avatar,
      });
      rooms.set(code,room);
      const p=room.players[0];
      socket.data.roomCode=code; socket.data.playerId=p.id;
      socket.join(code);
      socket.emit('joined',{code,playerId:p.id,token:p.token});
      emitRoom(room);
    } catch(e){err(socket,e);}
  });

  socket.on('joinRoom', payload => {
    try {
      const code=String(payload?.code||'').trim().toUpperCase();
      const room=rooms.get(code);
      if(!room) throw new Error('Sala não encontrada.');
      let p = null;
      if (payload?.token) {
        const existing = room.players.find(x => x.token === payload.token);
        if (existing?.socketId && existing.socketId !== socket.id) {
          io.to(existing.socketId).emit('sessionReplaced');
        }
        p = Engine.reconnectPlayer(room,payload.token,socket.id);
      }
      if(!p) p = Engine.addPlayer(room,{socketId:socket.id, token:payload?.token, name:payload?.name, avatar:payload?.avatar});
      socket.data.roomCode=code; socket.data.playerId=p.id;
      socket.join(code);
      socket.emit('joined',{code,playerId:p.id,token:p.token});
      emitRoom(room);
    } catch(e){err(socket,e);}
  });

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

      if (!room.players.length) {
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
    if(!p.host) throw new Error('Somente o anfitrião pode iniciar a rodada.');
    if(room.status==='playing') throw new Error('A rodada já está em andamento.');
    Engine.startRound(room);
  }));

  socket.on('declare', payload => withRoom(socket,(room,p)=> Engine.declare(room,p.id,payload?.type)));
  socket.on('playCard', payload => withRoom(socket,(room,p)=> {
    if(p.justDrawnCardId) {
      Engine.playDrawnCard(room,p.id,payload.cardId,payload.chosenSuit);
    } else {
      Engine.playCard(room,p.id,payload.cardId,payload.chosenSuit);
    }
  }));
  socket.on('burnPair', payload => withRoom(socket,(room,p)=> Engine.burnPair(room,p.id,payload.cardId,payload.chosenSuit)));
  socket.on('endBurn', () => withRoom(socket,(room,p)=> Engine.endBurnContinuation(room,p.id)));
  socket.on('draw', () => withRoom(socket,(room,p)=> Engine.drawAction(room,p.id)));
  socket.on('passAfterDraw', () => withRoom(socket,(room,p)=> Engine.passAfterDraw(room,p.id)));

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
      if(p.host){
        p.host=false;
        const nextHost=room.players.find(x=>x.connected);
        if(nextHost) nextHost.host=true;
      }
      emitRoom(room);

      // Na sala de espera, elimina automaticamente participantes que realmente
      // ficaram desconectados, evitando jogadores "fantasmas" no início.
      if (room.status === 'lobby') {
        setTimeout(() => {
          const currentRoom = rooms.get(code);
          if (!currentRoom || currentRoom.status !== 'lobby') return;
          const stale = currentRoom.players.find(x => x.id === playerId);
          if (!stale || stale.connected) return;
          currentRoom.players = currentRoom.players.filter(x => x.id !== playerId);
          if (!currentRoom.players.length) {
            rooms.delete(code);
            return;
          }
          if (!currentRoom.players.some(x => x.host)) {
            const nextHost = currentRoom.players.find(x => x.connected) || currentRoom.players[0];
            if (nextHost) nextHost.host = true;
          }
          emitRoom(currentRoom);
        }, 12000);
      }
    }
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms){
    const allGone=room.players.every(p=>!p.connected);
    if(allGone && now-room.createdAt>6*60*60*1000) rooms.delete(code);
  }
}, 30*60*1000).unref();

server.listen(PORT,()=>console.log(`Mau-Mau online em http://localhost:${PORT}`));

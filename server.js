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
      let p = payload?.token ? Engine.reconnectPlayer(room,payload.token,socket.id) : null;
      if(!p) p = Engine.addPlayer(room,{socketId:socket.id, token:payload?.token, name:payload?.name, avatar:payload?.avatar});
      socket.data.roomCode=code; socket.data.playerId=p.id;
      socket.join(code);
      socket.emit('joined',{code,playerId:p.id,token:p.token});
      emitRoom(room);
    } catch(e){err(socket,e);}
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
    const room=rooms.get(socket.data.roomCode);
    if(!room) return;
    const p=room.players.find(x=>x.id===socket.data.playerId);
    if(p){
      p.connected=false;p.socketId=null;
      if(p.host){
        p.host=false;
        const nextHost=room.players.find(x=>x.connected);
        if(nextHost) nextHost.host=true;
      }
    }
    emitRoom(room);
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

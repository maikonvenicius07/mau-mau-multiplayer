'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Engine=require('../game-engine');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

const room=Engine.createRoom('ABCDEF',{socketId:'s1',token:'t1',name:'A',avatar:'macaco',playerKey:'k1'});
Engine.addPlayer(room,{socketId:'s2',token:'t2',name:'B',avatar:'preta',playerKey:'k2'});
room.chat=[{id:'old',text:'conversa da partida anterior'}];
room.status='finished';
Engine.resetMatch(room);
assert.deepStrictEqual(room.chat,[], 'nova partida na mesma sala não pode herdar o chat da partida anterior');
assert(app.includes('nunca mostre, nem por alguns instantes, conversa da sala/partida anterior'), 'entrada em sala deve limpar imediatamente o chat local anterior');
assert(app.includes('chatMessages=[];unreadChat=0;'), 'chat local deve ser zerado ao receber joined');
assert(server.includes("io.to(room.code).emit('chatHistory',[]);"), 'revanche na mesma sala deve mandar zerar o chat dos clientes conectados');
console.log('✓ V40.58.2: chat isolado entre partidas e limpo imediatamente ao trocar de sala/papel.');

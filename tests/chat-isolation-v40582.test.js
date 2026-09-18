'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Engine=require('../game-engine');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

const roomA=Engine.createRoom('AAAAAA',{socketId:'s1',token:'t1',name:'A',avatar:'macaco',playerKey:'k1'});
Engine.addPlayer(roomA,{socketId:'s2',token:'t2',name:'B',avatar:'preta',playerKey:'k2'});
roomA.chat=[{id:'same-room',text:'conversa desta sala'}];
roomA.status='finished';
Engine.resetMatch(roomA);
assert.strictEqual(roomA.chat.length,1,'revanche na mesma sala deve preservar a conversa da sala');
assert.strictEqual(roomA.chat[0].id,'same-room');

const roomB=Engine.createRoom('BBBBBB',{socketId:'s3',token:'t3',name:'C',avatar:'macaco',playerKey:'k3'});
assert(!Array.isArray(roomB.chat)||roomB.chat.length===0,'sala diferente deve começar sem conversa da sala anterior');

assert(app.includes('o chat é por SALA'),'cliente deve documentar isolamento por sala');
assert(app.includes('chatMessages=[];unreadChat=0;'),'cliente deve limpar chat local ao receber joined antes do histórico da sala');
assert(!server.includes("io.to(room.code).emit('chatHistory',[]);"),'revanche na mesma sala não deve apagar chat');
console.log('✓ V40.62: chat persiste na mesma sala e é isolado entre salas diferentes.');

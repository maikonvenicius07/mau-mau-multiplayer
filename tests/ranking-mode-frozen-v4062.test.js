'use strict';

const assert=require('assert');
const Engine=require('../game-engine');
const Life=require('../room-lifecycle');
const RankingMode=require('../ranking-mode');
const {buildMatchRecord}=require('../ranking-store');
const {plainRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');
const pkg=require('../package.json');

assert.strictEqual(pkg.version,'40.69','package.json deve identificar V40.62');

function humanRoom(code='R62A'){
  const room=Engine.createRoom(code,{socketId:'h1',token:'t1',name:'Humano 1',avatar:'macaco',playerKey:'g1'});
  Engine.addPlayer(room,{socketId:'h2',token:'t2',name:'Humano 2',avatar:'boi',playerKey:'g2'});
  return room;
}

// Partida iniciada somente por humanos fica OFICIAL até o fim.
{
  const room=humanRoom('R62A');
  Engine.startRound(room);
  assert.strictEqual(room.rankingModeAtStart,'official');
  const quitter=room.players.find(p=>p.playerKey==='g2');
  Life.convertHumanSeatToPermanentBot(quitter,{name:'Máquina',avatar:'preta'},{now:5000,token:'bot-final'});
  assert.strictEqual(quitter.isBot,true);
  assert.strictEqual(buildMatchRecord(room).mode,'official','saída humana não pode rebaixar OFICIAL para TREINO');
}

// AUTO temporário continua representando uma cadeira humana e não muda a categoria.
{
  const room=humanRoom('R62B');
  Engine.startRound(room);
  const p=room.players.find(x=>x.playerKey==='g2');
  Life.markInvoluntaryDisconnect(p,{now:1000,graceMs:60000});
  Life.markAutoTakeover(p);
  assert.strictEqual(p.isBot,false);
  assert.strictEqual(p.autoControlled,true);
  assert.strictEqual(buildMatchRecord(room).mode,'official');
}

// Partida que COMEÇOU com Máquina permanece TREINO mesmo se o bot sair da composição depois.
{
  const room=Engine.createRoom('R62C',{socketId:'h1',token:'t1',name:'Humano',avatar:'macaco',playerKey:'g1'});
  Engine.addPlayer(room,{socketId:null,token:'b1',name:'Máquina',avatar:'preta',isBot:true});
  Engine.startRound(room);
  assert.strictEqual(room.rankingModeAtStart,'training');
  room.players=room.players.filter(p=>!p.isBot);
  assert.strictEqual(buildMatchRecord(room).mode,'training','TREINO não pode virar OFICIAL durante a mesma partida');
}

// Snapshot/restart preserva a categoria congelada.
{
  const room=humanRoom('R62D');
  Engine.startRound(room);
  const p=room.players.find(x=>x.playerKey==='g2');
  Life.convertHumanSeatToPermanentBot(p,{name:'Máquina',avatar:'preta'},{now:8000,token:'bot'});
  const restored=restoreRoomSnapshot(plainRoomSnapshot(room),{now:9000,reconnectGraceMs:60000});
  assert(restored);
  assert.strictEqual(restored.rankingModeAtStart,'official');
  assert.strictEqual(buildMatchRecord(restored).mode,'official');
}

// Migração de snapshot antigo: bot com voluntaryLeftAt veio de humano e não deve reclassificar.
{
  const room=humanRoom('R62E');
  Engine.startRound(room);
  const p=room.players.find(x=>x.playerKey==='g2');
  Life.convertHumanSeatToPermanentBot(p,{name:'Máquina',avatar:'preta'},{now:12000,token:'bot'});
  const snap=plainRoomSnapshot(room);
  delete snap.rankingModeAtStart; // simula snapshot pré-V40.62
  const restored=restoreRoomSnapshot(snap,{now:13000,reconnectGraceMs:60000});
  assert(restored);
  assert.strictEqual(restored.rankingModeAtStart,'official');
}

// Migração antiga com bot original deve continuar TREINO.
{
  const room=Engine.createRoom('R62F',{socketId:'h1',token:'t1',name:'Humano',avatar:'macaco',playerKey:'g1'});
  Engine.addPlayer(room,{socketId:null,token:'b1',name:'Máquina',avatar:'preta',isBot:true});
  Engine.startRound(room);
  const snap=plainRoomSnapshot(room);
  delete snap.rankingModeAtStart;
  const restored=restoreRoomSnapshot(snap,{now:15000,reconnectGraceMs:60000});
  assert(restored);
  assert.strictEqual(restored.rankingModeAtStart,'training');
}

// Nova partida/revanche deve limpar a categoria antiga para recalcular no novo início.
{
  const room=humanRoom('R62G');
  Engine.startRound(room);
  assert.strictEqual(room.rankingModeAtStart,'official');
  room.status='finished';
  Engine.resetMatch(room);
  assert.strictEqual(room.rankingModeAtStart,null);
}

assert.strictEqual(RankingMode.modeForNewMatch({players:[{isBot:false},{isBot:false}]}),'official');
assert.strictEqual(RankingMode.modeForNewMatch({players:[{isBot:false},{isBot:true}]}),'training');

console.log('✓ V40.62: categoria OFICIAL/TREINO congelada no início; saída/AUTO não reclassificam e snapshot preserva o modo.');

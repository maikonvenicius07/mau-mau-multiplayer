'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Engine=require('../game-engine');
const Life=require('../room-lifecycle');
const {plainRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');
const pkg=require('../package.json');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

assert.strictEqual(pkg.version,'40.69.1','package.json deve identificar V40.62');
assert(server.includes('RetentionPolicy.ALL_HUMANS_OFFLINE_EXPIRY_MS'),'prazo de 5 minutos deve ser usado para sala ativa sem humanos conectados');
assert(server.includes('refreshOfflineRoomExpiry(room);'),'mudanças de estado devem reavaliar o prazo de sala sem humanos conectados');
assert(server.includes("await removeRoomDurably(liveRoom.code,Date.now(),'A sala foi encerrada após 5 minutos sem nenhum jogador humano conectado.');"),'expiração deve excluir a sala com tombstone durável');
assert(server.includes("closeSpectatorsForRoom(liveRoom,'A sala foi encerrada após 5 minutos sem nenhum jogador humano conectado.');"),'expiração deve encerrar observadores/dados temporários');
assert(server.includes('cancelOfflineRoomExpiry(code,{clearState:false});'),'exclusão normal/durável deve cancelar timer offline pendente');

function soloRoom(code='S611'){
  const room=Engine.createRoom(code,{socketId:'h1',token:'t1',name:'Humano',avatar:'macaco',playerKey:'g1'});
  Engine.addPlayer(room,{socketId:null,token:'bot1',name:'Máquina',avatar:'preta',isBot:true});
  Engine.startRound(room);
  return room;
}

// Queda involuntária do único humano em jogo contra robô => candidato ao prazo de 5 min.
{
  const room=soloRoom('S611A');
  const human=room.players.find(p=>!p.isBot);
  Life.markInvoluntaryDisconnect(human,{now:1000,graceMs:60000});
  assert.strictEqual(Life.soloDisconnectedHuman(room),human);
  // Após 60 s, a Máquina temporária assume, mas os 5 minutos continuam válidos.
  Life.markAutoTakeover(human);
  assert.strictEqual(human.autoControlled,true);
  assert.strictEqual(Life.soloDisconnectedHuman(room),human);
}

// Retorno antes dos 5 min => deixa de ser candidato; o servidor cancela o timer no emitRoom.
{
  const room=soloRoom('S611B');
  const human=room.players.find(p=>!p.isBot);
  Life.markInvoluntaryDisconnect(human,{now:2000,graceMs:60000});
  assert(Life.soloDisconnectedHuman(room));
  const resumed=Engine.reconnectPlayer(room,human.token,'h1-return');
  assert(resumed&&resumed.connected);
  assert.strictEqual(Life.soloDisconnectedHuman(room),null);
}

// SAIR voluntariamente do único humano => nenhuma reserva; só restam bots,
// portanto a camada do servidor exclui a sala imediatamente, sem esperar 5 min.
{
  const room=soloRoom('S611C');
  const human=room.players.find(p=>!p.isBot);
  Life.convertHumanSeatToPermanentBot(human,{name:'Máquina 2',avatar:'boi'},{now:3000,token:'bot-final'});
  assert.strictEqual(Life.hasHumanMembers(room),false);
  assert.strictEqual(Life.soloDisconnectedHuman(room),null);
}

// Entrar em outra sala usa a mesma conversão definitiva da vaga antiga:
// a sala solo antiga fica sem humanos e deve ser excluída imediatamente.
{
  const old=soloRoom('S611D');
  const human=old.players.find(p=>!p.isBot),key=human.playerKey;
  Life.markInvoluntaryDisconnect(human,{now:4000,graceMs:60000});
  Life.convertHumanSeatToPermanentBot(human,{name:'Máquina 2',avatar:'boi'},{now:5000,token:'bot-switch'});
  const fresh=Engine.createRoom('S611E',{socketId:'fresh',token:'fresh',name:'Humano',avatar:'macaco',playerKey:key});
  assert.strictEqual(Life.hasHumanMembers(old),false);
  assert(fresh.players.some(p=>!p.isBot&&p.playerKey===key));
}

// Dois humanos na partida: esta regra de 5 min NÃO se aplica a apenas um deles.
{
  const room=Engine.createRoom('S611F',{socketId:'h1',token:'t1',name:'Humano',avatar:'macaco',playerKey:'g1'});
  Engine.addPlayer(room,{socketId:'h2',token:'t2',name:'Humano 2',avatar:'boi',playerKey:'g2'});
  Engine.addPlayer(room,{socketId:null,token:'bot1',name:'Máquina',avatar:'preta',isBot:true});
  Engine.startRound(room);
  const first=room.players.find(p=>!p.isBot&&p.playerKey==='g1');
  Life.markInvoluntaryDisconnect(first,{now:6000,graceMs:60000});
  assert.strictEqual(Life.soloDisconnectedHuman(room),null);
}

// O marco dos 5 minutos faz parte do snapshot para que restart não renove o prazo.
{
  const room=soloRoom('S611G');
  const human=room.players.find(p=>!p.isBot);
  Life.markInvoluntaryDisconnect(human,{now:7000,graceMs:60000});
  room.soloDisconnectStartedAt=7000;
  const restored=restoreRoomSnapshot(plainRoomSnapshot(room),{now:10000,reconnectGraceMs:60000});
  assert(restored,'snapshot da sala solo deve ser restaurável dentro do prazo');
  assert.strictEqual(restored.soloDisconnectStartedAt,7000,'restart não pode reiniciar o relógio dos 5 minutos');
}

console.log('✓ V40.61.1 preservada: sala solo segue com 5 min; V40.68.1 amplia o mesmo prazo para qualquer sala ativa sem humanos conectados.');

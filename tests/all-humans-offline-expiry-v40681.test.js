'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Engine=require('../game-engine');
const Life=require('../room-lifecycle');
const Retention=require('../retention-policy');
const {plainRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');
const pkg=require('../package.json');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

assert.strictEqual(pkg.version,'40.68.1','package.json deve identificar V40.68.1');
assert.strictEqual(Retention.ALL_HUMANS_OFFLINE_EXPIRY_MS,5*60*1000,'sala totalmente sem humanos deve expirar em 5 minutos');
assert.strictEqual(Retention.SOLO_ROOM_EXPIRY_MS,Retention.ALL_HUMANS_OFFLINE_EXPIRY_MS,'regra solo histórica deve continuar compatível com o mesmo prazo');

function multiplayer(code='OFF681'){
  const room=Engine.createRoom(code,{socketId:'h1',token:'t1',name:'Humano 1',avatar:'macaco',playerKey:'g1'});
  Engine.addPlayer(room,{socketId:'h2',token:'t2',name:'Humano 2',avatar:'boi',playerKey:'g2'});
  Engine.addPlayer(room,{socketId:null,token:'b1',name:'Máquina',avatar:'preta',isBot:true});
  Engine.startRound(room);
  return room;
}

// Um humano cai, outro continua: não existe prazo global de 5 minutos.
{
  const room=multiplayer('OFFA');
  const [a,b]=room.players.filter(p=>!p.isBot);
  Life.markInvoluntaryDisconnect(a,{now:1000,graceMs:60000});
  assert.strictEqual(Life.allHumansDisconnected(room),false);
  assert.strictEqual(b.connected,true);
}

// Todos os humanos caem: a sala entra no prazo global de 5 minutos.
{
  const room=multiplayer('OFFB');
  const [a,b]=room.players.filter(p=>!p.isBot);
  Life.markInvoluntaryDisconnect(a,{now:1000,graceMs:60000});
  Life.markInvoluntaryDisconnect(b,{now:4000,graceMs:60000});
  assert.strictEqual(Life.allHumansDisconnected(room),true);
  room.allHumansOfflineStartedAt=4000;
  const restored=restoreRoomSnapshot(plainRoomSnapshot(room),{now:9000,reconnectGraceMs:60000});
  assert(restored,'snapshot deve continuar restaurável antes da expiração');
  assert.strictEqual(restored.allHumansOfflineStartedAt,4000,'restart não pode reiniciar os 5 minutos');
}

// Se qualquer humano volta, a sala deixa imediatamente de estar totalmente offline.
{
  const room=multiplayer('OFFC');
  const [a,b]=room.players.filter(p=>!p.isBot);
  Life.markInvoluntaryDisconnect(a,{now:1000,graceMs:60000});
  Life.markInvoluntaryDisconnect(b,{now:2000,graceMs:60000});
  assert.strictEqual(Life.allHumansDisconnected(room),true);
  const resumed=Engine.reconnectPlayer(room,a.token,'h1-return');
  assert(resumed&&resumed.connected);
  assert.strictEqual(Life.allHumansDisconnected(room),false);
}

// Contratos de servidor: timer global, exclusão em 5 min e robôs só com humano conectado.
assert(server.includes('refreshOfflineRoomExpiry(room);'),'emitRoom deve atualizar prazo global offline');
assert(server.includes('room.allHumansOfflineStartedAt'),'servidor deve persistir o marco em que a sala ficou sem humanos');
assert(server.includes('ALL_HUMANS_OFFLINE_EXPIRY_MS'),'servidor deve usar a política central de 5 minutos');
assert(server.includes('A sala foi encerrada após 5 minutos sem nenhum jogador humano conectado.'),'mensagem de expiração global ausente');
assert(server.includes("if (!room.players.some(p => !p.isBot && p.connected)) return;"),'agendamento de robô deve parar quando não há humano');
assert(server.includes("if (!liveRoom.players.some(p => !p.isBot && p.connected)) return;"),'timer já agendado também deve revalidar presença humana antes de jogar');

console.log('✓ V40.68.1: qualquer partida ativa sem humanos expira em 5 min e robôs/AUTO nunca jogam sozinhos.');

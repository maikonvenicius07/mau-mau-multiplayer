'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Engine = require('../game-engine');
const AvatarWire = require('../avatar-wire');
const Delivery = require('../state-delivery');

const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('function emitRoom(room) {');
const end=source.indexOf('\n\nfunction reconnectTimerKey(',start);
assert(start>=0 && end>start,'usar a implementação real de emitRoom');
const room=Engine.createRoom('FASE4A',{socketId:'sock-1',token:'tk1',name:'Ana',avatar:'macaco',playerKey:'ana'});
Engine.addPlayer(room,{socketId:'sock-2',token:'tk2',name:'Beto',avatar:'boi',playerKey:'beto'});
const watcher={id:'obs-1',name:'Observadora',avatar:'macaco',socketId:'sock-3',connected:true,playerKey:'obs-key'};
room.spectators=[watcher];
const eventsById=new Map();const sockets=new Map();
for(const id of ['sock-1','sock-2','sock-3']){
  const calls=[];eventsById.set(id,calls);
  sockets.set(id,{id,emit(type,payload){calls.push({type,payload})}});
}
const ctx={
  Engine, AvatarWire,StateDelivery:Delivery,
  io:{sockets:{sockets}},
  clearClosedSpectatorSeatRequests(){}, processSpectatorSeatRequests(){},
  maybeRecordFinished(){},refreshOfflineRoomExpiry(){},
  emitRoomAvatarAssets(){},ensureSpectators(r){return r.spectators},
  ensureInviteReservations(){},SpectatorSeatAdmission:{pruneRestoredSeatRequests(){return 0},seatStatus(){return {status:'available'}}},
  scheduleBotTurn(){},refreshInviteReadiness(){},broadcastPresence(){},setTimeout(){},
  criticalSnapshotSignatures:new Map(),
  roomSnapshotStore:{saveNow(){return Promise.resolve()},queueSave(){}},
  console,
};
vm.runInNewContext(source.slice(start,end)+'\nthis.send=emitRoom;',ctx,{timeout:1000});
const count=(id)=>eventsById.get(id).filter(e=>e.type==='state').length;
ctx.send(room);
assert.deepEqual(['sock-1','sock-2','sock-3'].map(count),[1,1,1],'todos recebem state inicial');
const obs=eventsById.get('sock-3').find(e=>e.type==='state').payload;
assert.equal(obs.viewerRole,'SPECTATOR');
assert.deepEqual(obs.me.hand,[],'observador não pode ver mão privada');
assert.equal(obs.players.length,2);
const a=eventsById.get('sock-1').find(e=>e.type==='state').payload;
assert.equal(a.viewerRole,'PLAYER');
assert.equal(a.me.id,room.players[0].id);
ctx.send(room);
assert.deepEqual(['sock-1','sock-2','sock-3'].map(count),[1,1,1],'emitRoom repetido sem mudanças não reenvia');
room.players[0].score += 20;
ctx.send(room);
assert.deepEqual(['sock-1','sock-2','sock-3'].map(count),[2,2,2],'uma mudança legítima alcança todos');
// Mesma conexão pode receber um joined/reingresso que reinicia a tela.
Delivery.invalidate(sockets.get('sock-1'));
ctx.send(room);
assert.deepEqual(['sock-1','sock-2','sock-3'].map(count),[3,2,2],'novo joined obriga novo state sem enviar duplicado a outros');
// Promoção de observador para jogador não reutiliza o cache privado do papel anterior.
room.spectators=[];
const admitted=Engine.addPlayer(room,{socketId:'sock-3',token:'tk3',name:'Observadora',avatar:'macaco',playerKey:'obs-key'});
ctx.send(room);
assert.equal(eventsById.get('sock-3').at(-1).payload.viewerRole,'PLAYER');
assert.equal(eventsById.get('sock-3').at(-1).payload.me.id,admitted.id);
assert.equal(count('sock-3'),3);
console.log('✓ Fase 4A: emitRoom real preserva estado individual, observadores, promoção e reconexão; suprime apenas duplicatas.');

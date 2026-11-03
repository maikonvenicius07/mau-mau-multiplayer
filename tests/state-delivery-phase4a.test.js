'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Delivery = require('../state-delivery');
const Engine = require('../game-engine');
const AvatarWire = require('../avatar-wire');

function socket() {
  const events=[];
  return {
    events,
    emit(name, payload){events.push({name,payload});},
    states(){return events.filter(e=>e.name==='state');},
  };
}
const room = Engine.createRoom('P4A',{socketId:'s1',token:'t1',name:'Ana',avatar:'macaco',playerKey:'ana'});
const bruno = Engine.addPlayer(room,{socketId:'s2',token:'t2',name:'Bruno',avatar:'boi',playerKey:'bruno'});
Engine.startRound(room);
const ana = room.players[0];
const a = socket(), b = socket(), o = socket();
const playerScope = `PLAYER:${room.code}:${Number(room.matchSerial||1)}:${ana.id}`;
const brunoScope = `PLAYER:${room.code}:${Number(room.matchSerial||1)}:${bruno.id}`;
const spectator = {id:'s-ob',name:'Olga',avatar:'macaco'};
const watcherScope = `SPECTATOR:${room.code}:${Number(room.matchSerial||1)}:${spectator.id}`;
const forAna = () => AvatarWire.leanStateAvatars(Engine.roomPublicState(room,ana.id));
const forBruno = () => AvatarWire.leanStateAvatars(Engine.roomPublicState(room,bruno.id));
const forSpectator = () => AvatarWire.leanStateAvatars(Engine.roomSpectatorState(room,spectator));

assert.strictEqual(Delivery.emitState(a,playerScope,forAna()),true,'primeiro state completo é obrigatório');
assert.strictEqual(a.states().length,1);
assert.strictEqual(Delivery.emitState(a,playerScope,forAna()),false,'estado idêntico da mesma conexão não deve ser reenviado');
assert.strictEqual(a.states().length,1);
assert.strictEqual(Delivery.emitState(b,brunoScope,forBruno()),true,'outro jogador deve receber estado próprio');
assert.strictEqual(Delivery.emitState(o,watcherScope,forSpectator()),true,'observador deve receber seu estado seguro');
assert.strictEqual(o.states()[0].payload.me.hand.length,0,'não entregar mão privada ao observador');
assert.strictEqual(a.states()[0].payload.me.id,ana.id);
assert.strictEqual(b.states()[0].payload.me.id,bruno.id);
assert.strictEqual(Delivery.emitState(o,watcherScope,forSpectator()),false,'observador idêntico não recebe retransmissão');

// Alterar uma informação real da mesa envia a nova versão para todos os papéis.
const previous = room.players[0].score;
room.players[0].score = previous + 10;
assert.strictEqual(Delivery.emitState(a,playerScope,forAna()),true,'placar alterado é enviado ao jogador');
assert.strictEqual(Delivery.emitState(o,watcherScope,forSpectator()),true,'placar alterado é enviado ao observador');
assert.strictEqual(a.states().length,2);
assert.strictEqual(o.states().length,2);
assert.strictEqual(Delivery.emitState(a,playerScope,forAna()),false,'estado repetido após pontuação deve ser suprimido');

// Novo joined reinicializa o cliente, então precisa de state ainda que idêntico.
Delivery.invalidate(a);
assert.strictEqual(Delivery.emitState(a,playerScope,forAna()),true,'reenviar após joined ou reconexão');

// Mesmo conteúdo mas outra sala/papel/partida jamais é suprimido.
const same = {status:'playing',round:1,players:[]};
assert.strictEqual(Delivery.emitState(a,'PLAYER:AAA:1:p1',same),true);
assert.strictEqual(Delivery.emitState(a,'PLAYER:BBB:1:p1',same),true);
assert.strictEqual(Delivery.emitState(a,'SPECTATOR:BBB:1:p1',same),true);
assert.strictEqual(Delivery.emitState(a,'SPECTATOR:BBB:2:p1',same),true);
assert.strictEqual(Delivery.emitState(a,'SPECTATOR:BBB:2:p1',same),false);

// Uma conexão sem estado anterior não compartilha assinatura de outro socket.
const c=socket();
assert.strictEqual(Delivery.emitState(c,'SPECTATOR:BBB:2:p1',same),true);
Delivery.invalidate(c);
assert.strictEqual(Delivery.emitState(c,'SPECTATOR:BBB:2:p1',same),true);

// Estado excepcional não-JSON nunca é suprimido (fallback seguro).
const unusual={x:1n};
const d=socket();
assert.strictEqual(Delivery.emitState(d,'PLAYER:ODD:1:p1',unusual),true);
assert.strictEqual(Delivery.emitState(d,'PLAYER:ODD:1:p1',unusual),true);
assert.strictEqual(d.states().length,2);

const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert(server.includes("const StateDelivery = require('./state-delivery');"));
assert(server.includes('StateDelivery.emitState(target,`PLAYER:'));
assert(server.includes('StateDelivery.emitState(target,`SPECTATOR:'));
assert(server.includes('StateDelivery.invalidate(socket);'));
assert(server.includes('StateDelivery.invalidate(x.socket);'));
assert(server.includes("target.emit('joined',"),'a promoção deve conservar seu evento original');
assert(server.includes('scheduleBotTurn(room);'),'regras de bot devem continuar no fluxo');
assert(server.includes('roomSnapshotStore.queueSave(room);'),'persistência deve continuar no fluxo');
console.log('✓ Fase 4A: estados idênticos suprimidos por socket; reconexão, observador, privacidade e transições preservados.');

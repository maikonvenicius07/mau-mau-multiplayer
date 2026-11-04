'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createBroadcastGate} = require('../lobby-snapshot-delivery');

// Teste do filtro: só presença e salas com conteúdo alterado são retransmitidos.
const gate = createBroadcastGate();
const events = [];
const io = {emit(name,payload){events.push({name,payload})}};
const presence=(at,name='Ana')=>({onlineCount:1,players:[{playerKey:'ana',name,status:'available'}],at});
const rooms=(at,spectators=0)=>({publicRoomCount:1,watchableRoomCount:1,activeSpectatorCount:spectators,spectatorLimitPerRoom:5,rooms:[{code:'A1',spectatorCount:spectators}],at});
assert.equal(gate.emitIfChanged(io,'presenceSnapshot',presence(100)),true);
assert.equal(gate.emitIfChanged(io,'publicRoomsSnapshot',rooms(100)),true);
assert.equal(events.length,2);
assert.equal(gate.emitIfChanged(io,'presenceSnapshot',presence(101)),false,'at isolado não deve provocar broadcast');
assert.equal(gate.emitIfChanged(io,'publicRoomsSnapshot',rooms(102)),false);
assert.equal(events.length,2);
assert.equal(gate.emitIfChanged(io,'presenceSnapshot',presence(103,'Ana Maria')),true,'mudança de nome deve ser enviada');
assert.equal(gate.emitIfChanged(io,'publicRoomsSnapshot',rooms(104,1)),true,'quantidade de observadores deve ser enviada');
assert.deepEqual(events.map(e=>e.name),['presenceSnapshot','publicRoomsSnapshot','presenceSnapshot','publicRoomsSnapshot']);
assert.equal(events[3].payload.at,104,'payload mantém timestamp original');
assert.equal(gate.emitIfChanged(io,'presenceSnapshot',presence(105,'Ana Maria')),false);
assert.equal(gate.emitIfChanged(io,'publicRoomsSnapshot',rooms(105,1)),false);

// Nova instância (novo processo) não herda cache.
const fresh=createBroadcastGate();
assert.equal(fresh.emitIfChanged(io,'presenceSnapshot',presence(106,'Ana Maria')),true);

// Eventos independentes podem ter dados idênticos sem compartilhar cache.
const same={at:1,foo:'bar'};
assert.equal(gate.emitIfChanged(io,'presenceSnapshot',same),true);
assert.equal(gate.emitIfChanged(io,'publicRoomsSnapshot',same),true);

// Não modificar o objeto enviado nem invalidar seu horário informativo.
assert.equal(same.at,1);
assert.equal(same.foo,'bar');

// Segurança: dados excepcionais não serializáveis sempre são enviados.
const odd={data:1n,at:1};
assert.equal(gate.emitIfChanged(io,'presenceSnapshot',odd),true);
assert.equal(gate.emitIfChanged(io,'presenceSnapshot',odd),true);

// Exercitar a implementação REAL de broadcastPresence() no arquivo server.js.
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=server.indexOf('const lobbySnapshotDelivery = LobbySnapshotDelivery.createBroadcastGate();');
const end=server.indexOf('\nfunction emitToPlayerKey(',start);
assert(start>=0 && end>start,'broadcastPresence real encontrado');
const out=[];
const context={
  LobbySnapshotDelivery:{createBroadcastGate},
  io:{emit(name,payload){out.push({name,payload})}},
  buildPresenceSnapshot(){return presence(Date.now())},
  buildPublicRoomsSnapshot(){return rooms(Date.now())},
  Date,
};
vm.runInNewContext(server.slice(start,end)+'\nthis.broadcastPresence = broadcastPresence;',context,{timeout:1000});
context.broadcastPresence();
context.broadcastPresence();
assert.deepEqual(out.map(e=>e.name),['presenceSnapshot','publicRoomsSnapshot'],'broadcastPresence repetido sem mudança não deve reenviar');
assert(server.includes("socket.emit('presenceSnapshot',buildPresenceSnapshot());"),'snapshot inicial individual mantido');
assert(server.includes("socket.emit('publicRoomsSnapshot',buildPublicRoomsSnapshot());"),'snapshot de salas inicial e por pedido mantido');
assert(server.includes("socket.on('requestPublicRooms'"),'pedido explícito continua ativo');
console.log('✓ Fase 4B: presença e salas públicas sem retransmissões idênticas; alterações reais e snapshots individuais preservados.');

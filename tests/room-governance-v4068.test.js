'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Gov=require('../room-governance');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json'));
const server=read('server.js');

assert.strictEqual(pkg.version,'40.69.1','package.json deve identificar V40.68');
assert.ok(pkg.scripts.verify.includes('node --check room-governance.js'),'verify deve validar room-governance.js');
assert.strictEqual(Gov.DEFAULT_MAX_ROOMS,10,'limite padrão deve ser 10 salas');
assert.strictEqual(Gov.maxRooms({}),10,'sem configuração deve usar 10 salas');
assert.strictEqual(Gov.maxRooms({MAX_ROOMS:'25'}),25,'limite deve ser configurável');
assert.strictEqual(Gov.maxRooms({MAX_ROOMS:'9999'}),500,'configuração abusiva deve ser limitada');
assert.strictEqual(Gov.atCapacity(9,10,0,0),false);
assert.strictEqual(Gov.atCapacity(10,10,0,0),true);
assert.strictEqual(Gov.atCapacity(10,10,0,1),false,'troca que elimina uma sala solo pode reutilizar a vaga de capacidade');
assert.strictEqual(Gov.atCapacity(9,10,1,0),true,'criações simultâneas pendentes devem contar no limite');

const rooms=[
  {status:'playing',players:[{isBot:false,connected:true},{isBot:true}],spectators:[{connected:true}]},
  {status:'playing',players:[{isBot:false,connected:false,reconnectEligible:true,autoControlled:false}],spectators:[]},
  {status:'lobby',players:[{isBot:true}],spectators:[],soloDisconnectStartedAt:1},
];
const stats=Gov.summarizeRooms(rooms,10,2);
assert.strictEqual(stats.total,3);
assert.strictEqual(stats.playing,2);
assert.strictEqual(stats.lobby,1);
assert.strictEqual(stats.reconnecting,1);
assert.strictEqual(stats.botOnly,1);
assert.strictEqual(stats.humanSeats,2);
assert.strictEqual(stats.connectedHumans,1);
assert.strictEqual(stats.bots,2);
assert.strictEqual(stats.connectedSpectators,1);
assert.strictEqual(Gov.shouldCleanupRoom(rooms[2]),true,'sala apenas com bot deve ser marcada para limpeza');
assert.strictEqual(Gov.shouldCleanupRoom(rooms[0]),false,'sala com humano deve ser preservada');

assert.ok(server.includes('cleanupRoomResources'),'exclusão deve centralizar limpeza de recursos');
assert.ok(server.includes('clearDisconnectDebouncesForRoom'),'limpeza deve cancelar debounce de desconexão');
assert.ok(server.includes('purgeInvitesForRoom'),'limpeza deve remover convites e timers relacionados');
assert.ok(server.includes('auditRoomLifecycle'),'servidor deve auditar salas inconsistentes');
assert.ok(server.includes('reserveRoomCreationSlot'),'criação concorrente deve reservar capacidade');
assert.ok(server.includes('roomCapacity:{limit:roomStats.limit'),'health deve expor diagnóstico agregado de capacidade');
assert.ok(read('.env.example').includes('MAX_ROOMS=10'),'env de exemplo deve documentar limite de 10 salas');

console.log('✓ V40.68/V40.69.1: limite de 10 salas, reserva concorrente, auditoria e diagnóstico de limpeza validados.');

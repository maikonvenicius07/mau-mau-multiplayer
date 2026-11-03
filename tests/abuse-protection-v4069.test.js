'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Abuse=require('../abuse-guard');
const Gov=require('../room-governance');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json'));
const server=read('server.js');

assert.strictEqual(pkg.version,'40.69.2','package.json deve identificar V40.69.2');
assert.strictEqual(Gov.DEFAULT_MAX_ROOMS,10,'V40.69.2 deve usar 10 salas por padrão');
assert.strictEqual(Abuse.DEFAULT_MAX_SPECTATORS_PER_ROOM,5,'V40.69.2 deve usar 5 observadores por sala');
assert.strictEqual(Abuse.maxSpectatorsPerRoom({}),5);
assert.strictEqual(Abuse.maxSpectatorsPerRoom({MAX_SPECTATORS_PER_ROOM:'8'}),8,'limite de observadores deve permanecer configurável');
assert.strictEqual(Abuse.spectatorAtCapacity({spectators:new Array(4)},5,0),false);
assert.strictEqual(Abuse.spectatorAtCapacity({spectators:new Array(5)},5,0),true);
assert.strictEqual(Abuse.spectatorAtCapacity({spectators:new Array(4)},5,1),true,'entrada concorrente deve reservar a quinta vaga');

const limiter=new Abuse.ActionRateLimiter({test:{limit:2,windowMs:1000}});
assert.strictEqual(limiter.consume('conta','test',1000).allowed,true);
assert.strictEqual(limiter.consume('conta','test',1100).allowed,true);
const blocked=limiter.consume('conta','test',1200);
assert.strictEqual(blocked.allowed,false,'terceira ação dentro da janela deve ser bloqueada');
assert.ok(blocked.retryAfterMs>0);
assert.strictEqual(limiter.consume('conta','test',2100).allowed,true,'nova janela deve liberar a ação novamente');

assert.ok(server.includes("crypto.randomInt(0,chars.length)"),'código de sala deve usar crypto.randomInt');
assert.ok(server.includes("enforceActionRate(socket,'createRoom'"),'criação de sala deve ter rate limit');
assert.ok(server.includes("enforceActionRate(socket,'joinRoom'"),'entrada por código deve ter rate limit');
assert.ok(server.includes("enforceActionRate(socket,'joinSpectator'"),'entrada de observador deve ter rate limit');
assert.ok(server.includes('reserveSpectatorJoinSlot'),'entrada concorrente de observadores deve reservar capacidade');
assert.ok(server.includes('spectatorCapacity:{perRoom:MAX_SPECTATORS_PER_ROOM}'),'health deve expor somente capacidade agregada de observadores');
assert.ok(read('.env.example').includes('MAX_ROOMS=10'),'env deve documentar 10 salas');
assert.ok(read('.env.example').includes('MAX_SPECTATORS_PER_ROOM=5'),'env deve documentar 5 observadores');

console.log('✓ V40.69.2: 10 salas, 5 observadores, rate limit e códigos criptograficamente seguros validados.');

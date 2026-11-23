'use strict';
// Regressão funcional para o índice de presença; substitui teste legado do
// mesmo nome que tentava localizar blocos frágeis dentro do servidor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {indexPresenceSeats,seatPriority} = require('../presence-seat-index');

const now = 1_800_000_000_000;
const player = (key, extra={}) => ({playerKey:key,name:key,connected:false,autoControlled:false,reconnectDeadlineAt:0,...extra});
const room = (id, status, round, players) => ({code:id,status,round,players});
const rooms = new Map([
  ['lobby',room('lobby','lobby',0,[player('a'),player('b',{connected:true}),{playerKey:'bot',isBot:true,connected:true}])],
  ['inplay',room('inplay','playing',2,[player('a',{connected:true}),player('c',{reconnectDeadlineAt:now+10_000}),player('d',{autoControlled:true,reconnectDeadlineAt:now+10_000})])],
  ['legacy',room('legacy','between-rounds',4,[player('dupe'),player('dupe',{connected:true}),player('old',{reconnectDeadlineAt:now-1})])],
  ['secondary',room('secondary','playing',2,[player('a',{connected:true})])],
]);

const {seats,reconnectingKeys} = indexPresenceSeats(rooms,now);
assert.equal(seats.get('a').room.code,'inplay','cadeira conectada em partida prevalece sobre lobby');
assert.equal(seats.get('b').room.code,'lobby');
assert.equal(seats.get('dupe').player,rooms.get('legacy').players[0], 'Array.find original escolhe primeira cadeira por chave na mesma sala');
assert.equal(seats.get('a').player,rooms.get('inplay').players[0], 'prioridades empatadas mantêm primeira sala inserida');
assert.equal(seats.has('bot'),false,'robôs não entram no índice humano');
assert.deepEqual([...reconnectingKeys],['c'],'somente reserva humana ainda válida aparece desconectada');
assert.equal(seatPriority(rooms.get('inplay'),rooms.get('inplay').players[0]),145);
assert.equal(seatPriority(rooms.get('lobby'),rooms.get('lobby').players[0]),20);

// Compara todas as escolhas à busca original O(jogadores x salas), incluindo
// duplicatas históricas e diferentes estados da mesa.
function originalSeatForKey(key, list) {
  let best=null;
  for(const r of list.values()) {
    const p=r.players.find(x=>!x.isBot && x.playerKey===key);
    if(!p)continue;
    const score=(p.connected?100:0)
      +(r.status==='playing'?40:r.status==='between-rounds'?30:r.status==='lobby'?20:10)
      +(r.round>0?5:0);
    if(!best||score>best.score)best={room:r,player:p,score};
  }
  return best;
}
for(const key of ['a','b','c','d','dupe','old','missing']) {
  const original=originalSeatForKey(key,rooms),optimized=seats.get(key)||null;
  assert.equal(optimized?.player,original?.player);
  assert.equal(optimized?.room,original?.room);
  assert.equal(optimized?.score,original?.score);
}

// Instrumenta a leitura das mesas. O índice não faz busca por sala para
// cada jogador e não precisa construir índices persistentes ou caches globais.
let roomReads=0;
const bigRooms=new Map();
for(let r=0;r<120;r++){
  const members=Array.from({length:12},(_,i)=>player(`p${r*12+i}`,{connected:i%2===0}));
  const obj={status:'playing',round:1,get players(){roomReads++;return members}};
  bigRooms.set(r,obj);
}
const bigIndex=indexPresenceSeats(bigRooms,now);
assert.equal(bigIndex.seats.size,1440);
assert.equal(roomReads,120,'cada sala deve ser percorrida uma única vez por snapshot');

const source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
const match=source.match(/\bconst\s+RELEASE_VERSION\s*=\s*['"]V40\.69\.8\.(\d+)['"]/);
assert.ok(match&&Number(match[1])>=57, '[BUILD/VERSAO] server.js precisa ser V40.69.8.57 ou superior');
assert.ok(source.includes("require('./presence-seat-index')"),
  '[BUILD/SNAPSHOT] server.js deve importar o índice de presença');
assert.ok(/PresenceSeatIndex\.indexPresenceSeats\s*\(\s*rooms\s*,\s*now\s*\)/.test(source),
  '[BUILD/SNAPSHOT] o snapshot de jogadores online deve utilizar o índice temporário');
assert.ok(/status\s*=\s*presenceStatusForKey\s*\(\s*key\s*,\s*seat\s*,\s*now\s*\)/.test(source),
  '[BUILD/SNAPSHOT] calcular o status reutilizando a cadeira selecionada, sem nova busca');
assert.ok(source.includes("socket.emit('presenceSnapshot',buildPresenceSnapshot());"),
  'o snapshot inicial individual deve permanecer ativo');
assert.ok(source.includes("lobbySnapshotDelivery.emitIfChanged(io,'presenceSnapshot',buildPresenceSnapshot());"),
  'o broadcast com filtro de mudanças deve permanecer ativo');
console.log('✓ Presença indexada: paridade de vagas, reconexão, robôs, empate, 120 salas e integração estática.');

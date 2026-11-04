'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {emitIfChanged} = require('../matchmaking-delivery');

const makeSocket = name => ({name,events:[],emit(event,payload){this.events.push({event,payload})}});
const a = makeSocket('a'), b=makeSocket('b');
const payload=(list=['ana'],deadlineAt=null,reason='')=>({searching:true,players:list.map(playerKey=>({playerKey,name:playerKey})),foundCount:list.length,maxPlayers:5,deadlineAt,waitMs:15000,reason});
assert.equal(emitIfChanged(a,payload()),true);
assert.equal(emitIfChanged(a,payload()),false,'estado idêntico deve ser suprimido para a mesma conexão');
assert.equal(a.events.length,1);
assert.equal(emitIfChanged(b,payload()),true,'nova conexão não pode herdar o cache de outra');
assert.equal(emitIfChanged(a,payload(['ana','bia'],Date.now()+15000)),true,'segundo jogador deve provocar atualização');
assert.equal(emitIfChanged(a,payload(['ana','bia'],Date.now()+15000,'nova atualização')),true);
assert.equal(emitIfChanged(a,payload(),{force:true}),true,'pedido explícito deve reenviar mesmo estado');
assert.equal(a.events.at(-1).event,'matchmakingState');
const idle={searching:false,players:[],foundCount:0,maxPlayers:5,deadlineAt:null,waitMs:15000,reason:'Busca cancelada.'};
assert.equal(emitIfChanged(a,idle),true);
assert.equal(emitIfChanged(a,idle),false);
assert.equal(emitIfChanged(a,payload()),true,'após cancelamento a mesma busca precisa ser informada novamente');
const cyclic={}; cyclic.loop=cyclic;
assert.equal(emitIfChanged(a,cyclic),true,'falha de serialização não deve impedir entrega');
assert.equal(emitIfChanged(a,cyclic),true,'falha de serialização não deve criar assinatura de cache');

// Executa as funções REAIS do servidor em um contexto com sockets simulados.
const server = fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const start=server.indexOf('function matchmakingPayloadFor(');
const end=server.indexOf('\nfunction pruneMatchmakingQueue()',start);
assert.ok(start>=0 && end>start,'trecho de envio de matchmaking não encontrado');
const alice=makeSocket('alice'), bob=makeSocket('bob'), aliceOtherDevice=makeSocket('alice-other-device');
const sockets=new Map([['alice-1',alice],['bob-1',bob]]);
const presences=new Map([
  ['alice',{sockets:new Set(['alice-1']),name:'Alice',avatar:'macaco'}],
  ['bob',{sockets:new Set(['bob-1']),name:'Beto',avatar:'macaco'}],
]);
const matchmakingQueue=new Map([
  ['alice',{playerKey:'alice',joinedAt:1}],
  ['bob',{playerKey:'bob',joinedAt:2}],
]);
const ctx=vm.createContext({
  MatchmakingDelivery:{emitIfChanged},
  io:{sockets:{sockets}},
  presenceFor: key=>presences.get(key),
  matchmakingQueue,
  matchmakingSortedEntries:()=>[...matchmakingQueue.values()].sort((x,y)=>x.joinedAt-y.joinedAt),
  matchmakingPlayerPublic:key=>({playerKey:key,name:presences.get(key)?.name||'Jogador',avatar:'macaco'}),
  matchmakingDeadlineAt:100500,
  MATCHMAKING_MAX_PLAYERS:5,
  MATCHMAKING_WAIT_MS:15000,
});
vm.runInContext(server.slice(start,end)+'\nthis.api={emitMatchmakingState,emitMatchmakingIdle,emitMatchmakingToKey};',ctx,{timeout:2000});
ctx.api.emitMatchmakingState();
ctx.api.emitMatchmakingState();
assert.equal(alice.events.length,1,'reenviar fila idêntica não deve notificar Alice');
assert.equal(bob.events.length,1,'reenviar fila idêntica não deve notificar Beto');
assert.equal(alice.events[0].payload.foundCount,2);
assert.equal(alice.events[0].payload.deadlineAt,100500,'prazo da busca preservado');
presences.get('alice').sockets.add('alice-2');
sockets.set('alice-2',aliceOtherDevice);
ctx.api.emitMatchmakingState();
assert.equal(alice.events.length,1,'socket antigo não recebe mensagem repetida');
assert.equal(aliceOtherDevice.events.length,1,'segundo dispositivo deve receber estado inicial');
ctx.api.emitMatchmakingIdle('alice','Busca cancelada.');
assert.equal(alice.events.length,2);
assert.equal(aliceOtherDevice.events.length,2);
ctx.api.emitMatchmakingState();
assert.equal(alice.events.length,3,'depois de cancelar deve poder reentrar na busca com mesmo payload');
assert.equal(bob.events.length,1,'outra conta não deve receber estado sem alteração');
ctx.api.emitMatchmakingToKey('alice',payload(),{force:true});
assert.equal(alice.events.length,4,'consulta explícita deve manter resposta');

// Convites ativos seguem sendo invalidados; encerrados não recebem status indevido.
const purgeStart=server.indexOf('function purgeInvitesForRoom(');
const purgeEnd=server.indexOf('\nfunction invalidateInvitesForRoom(',purgeStart);
assert.ok(purgeStart>=0&&purgeEnd>purgeStart,'rotina original de encerramento de convites não encontrada');
const invites=new Map([
  ['pending',{id:'pending',status:'pending',toKey:'to',fromKey:'from',targetRoomCode:'A1'}],
  ['waiting',{id:'waiting',status:'accepted-waiting',toKey:'to',fromKey:'from',targetRoomCode:'A1'}],
  ['ready',{id:'ready',status:'ready',toKey:'to',fromKey:'from',targetRoomCode:'A1'}],
  ['completed',{id:'completed',status:'completed',toKey:'to',fromKey:'from',targetRoomCode:'A1'}],
  ['expired',{id:'expired',status:'expired',toKey:'to',fromKey:'from',targetRoomCode:'A1'}],
  ['other',{id:'other',status:'pending',toKey:'to',fromKey:'from',targetRoomCode:'B2'}],
]);
const statuses=[],cleared=[];
const purgeCtx=vm.createContext({
  invitations:invites,
  clearInviteTimer:id=>cleared.push(id),
  emitToPlayerKey:(key,event,data)=>statuses.push({key,event,data}),
  Date,
});
vm.runInContext(server.slice(purgeStart,purgeEnd)+'\nthis.purge=purgeInvitesForRoom;',purgeCtx,{timeout:2000});
purgeCtx.purge('A1');
assert.equal(statuses.length,6,'somente 3 convites ativos enviam status aos dois interessados');
assert.ok(statuses.every(x=>x.event==='inviteStatus'&&x.data.status==='unavailable'));
assert.ok(!invites.has('completed')&&!invites.has('expired'),'convites terminais devem ser liberados sem notificações falsas');
assert.equal(invites.size,1,'convites de outras salas permanecem');
assert.equal(cleared.length,5,'timers da sala encerrada são limpos');
assert(server.includes('const INVITE_TTL_MS = 30 * 1000'),'prazo de convite preservado');
assert(server.includes('const INVITE_RESERVATION_MS = 20 * 60 * 1000'),'prazo de reserva preservado');
assert(server.includes('const MATCHMAKING_WAIT_MS = 15 * 1000'),'prazo de matchmaking preservado');
assert(server.includes('const MATCHMAKING_MAX_PLAYERS = 5'),'5 jogadores preservados');
console.log('✓ Fase 4C: fila por socket sem eventos repetidos, estados novos e convites ativos preservados.');

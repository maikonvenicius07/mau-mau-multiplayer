'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Engine=require('../game-engine');
const Life=require('../room-lifecycle');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const pkg=require('../package.json');

assert.strictEqual(pkg.version,'40.62','package.json deve identificar V40.60');

function makeRoom(code='MM60'){
  const room=Engine.createRoom(code,{socketId:'old-socket',token:'old-token',name:'Orlando',avatar:'macaco',playerKey:'google-orlando'});
  Engine.addPlayer(room,{socketId:'peer',token:'peer-token',name:'Carlos',avatar:'boi',playerKey:'google-carlos'});
  Engine.startRound(room);
  return room;
}

// 1) Queda involuntária cria uma reserva que NÃO bloqueia a fila.
{
  const room=makeRoom('MM601');
  const p=room.players[0];
  Life.markInvoluntaryDisconnect(p,{now:1000,graceMs:60000});
  assert.strictEqual(Life.canAutoReconnect(p),true);
  assert.strictEqual(Life.blocksMatchmaking(p),false,'reserva involuntária não deve bloquear matchmaking');
  assert.strictEqual(p.playerKey,'google-orlando');
  assert.strictEqual(p.reconnectEligible,true);
}

// 2) Cancelar a busca não toca na reserva: a cadeira continua humana e recuperável.
{
  const room=makeRoom('MM602');
  const p=room.players[0];
  Life.markInvoluntaryDisconnect(p,{now:2000,graceMs:60000});
  // Entrar/sair da fila é efêmero no servidor; nenhuma função de lifecycle é chamada.
  assert.strictEqual(p.isBot,false);
  assert.strictEqual(p.playerKey,'google-orlando');
  assert.strictEqual(p.reconnectEligible,true);
  assert.strictEqual(Life.blocksMatchmaking(p),false);
}

// 3) Uma vaga realmente ativa/conectada continua bloqueando nova busca.
{
  const room=makeRoom('MM603');
  const p=room.players[0];
  assert.strictEqual(p.connected,true);
  assert.strictEqual(Life.blocksMatchmaking(p),true,'jogador conectado em mesa ativa deve bloquear matchmaking');
}

// 4) Quando a nova mesa é efetivamente formada, a reserva antiga pode ser encerrada.
{
  const room=makeRoom('MM604');
  const p=room.players[0];
  Life.markInvoluntaryDisconnect(p,{now:3000,graceMs:60000});
  Life.markAutoTakeover(p);
  assert.strictEqual(p.reconnectEligible,true);
  Life.convertHumanSeatToPermanentBot(p,{name:'Máquina',avatar:'preta'},{now:70000,token:'bot-final'});
  assert.strictEqual(p.isBot,true);
  assert.strictEqual(p.playerKey,null);
  assert.strictEqual(p.reconnectEligible,false);
}

// Contrato do servidor: iniciar busca não pode chamar abandono; o abandono deve
// existir apenas na confirmação da nova sala dentro de formMatchmakingGroup().
const startAt=server.indexOf("socket.on('startMatchmaking'");
const cancelAt=server.indexOf("socket.on('cancelMatchmaking'",startAt);
assert(startAt>=0&&cancelAt>startAt,'handler de matchmaking não encontrado');
const startBlock=server.slice(startAt,cancelAt);
assert(!startBlock.includes('abandonOtherPlayerMembershipsForSwitch('),'iniciar busca não pode abandonar reserva antiga');
assert(startBlock.includes('matchmakingBlockingRoomForKey(key)'),'início da busca deve distinguir reserva recuperável de vaga ativa');

const formAt=server.indexOf('function formMatchmakingGroup()');
const inviteAt=server.indexOf('function ensureInviteReservations',formAt);
assert(formAt>=0&&inviteAt>formAt,'formMatchmakingGroup não encontrada');
const formBlock=server.slice(formAt,inviteAt);
const createAt=formBlock.indexOf('room=Engine.createRoom');
const abandonAt=formBlock.indexOf("abandonOtherPlayerMembershipsForSwitch(x.socket,code,'entrou em nova sala pelo matchmaking')");
assert(createAt>=0&&abandonAt>createAt,'reserva antiga só pode ser cancelada depois que a nova sala foi criada');
assert(formBlock.includes('playerHasMatchmakingBlockingRoom'),'fila deve aceitar reserva involuntária e bloquear vaga realmente ativa');

// Criar uma sala manualmente também deve criar primeiro e só depois confirmar a troca.
const createEventAt=server.indexOf("socket.on('createRoom'");
const setPublicAt=server.indexOf("socket.on('setRoomPublic'",createEventAt);
const createBlock=server.slice(createEventAt,setPublicAt);
assert(createBlock.indexOf('Engine.createRoom') < createBlock.indexOf('prepareForRoomSwitch(socket,code)'),
  'criação manual deve preservar reserva anterior se a nova sala falhar antes de existir');

console.log('✓ V40.60: busca/cancelamento preservam reserva involuntária; somente entrada real em nova sala cancela a reconexão anterior.');

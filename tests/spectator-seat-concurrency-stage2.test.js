'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Seats = require('../spectator-seat-admission');
const source = fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const from = source.indexOf('function processSpectatorSeatRequests(room){');
const until = source.indexOf('\n\n// A fila é efêmera:',from);
assert(from>0 && until>from, 'Localizar o código de processamento real, sem criar implementação paralela');
const processor = source.slice(from,until);

function scenario({free=1, disconnectedFirst=false,reserve=0}={}) {
  let serial=0;
  const initial=5-free-reserve;
  const players=Array.from({length:initial},(_,i)=>({id:`existing-${i}`,isBot:true}));
  const spectators=[
    {id:'s-A',playerKey:'A',name:'Alice',avatar:'macaco',connected:!disconnectedFirst,socketId:disconnectedFirst?null:'socket-A'},
    {id:'s-B',playerKey:'B',name:'Bruno',avatar:'macaco',connected:true,socketId:'socket-B'},
  ];
  const requests=spectators.map((s,i)=>({spectatorId:s.id,playerKey:s.playerKey,at:100+i}));
  const room={code:'ABC123',status:'between-rounds',round:4,rules:{rounds:5},players,spectators,
    inviteReservations:new Map(Array.from({length:reserve},(_,i)=>[`invite-${i}`,{expiresAt:Date.now()+60000}])),
    spectatorSeatRequests:requests,tournament:null};
  const sockets=new Map();
  const messages={A:[],B:[]};
  for(const [who,s] of [['A',spectators[0]],['B',spectators[1]]]){
    const target={id:`socket-${who}`,data:{role:'SPECTATOR',spectatorId:s.id,roomCode:room.code,auth:{playerKey:s.playerKey}},
      emit(name,data){messages[who].push({name,data})}};
    sockets.set(target.id,target);
  }
  const ctx={
    ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',
    SpectatorSeatAdmission:Seats,
    ensureSpectators(room){return room.spectators;},
    io:{sockets:{sockets}},
    roomHasInviteCapacity(room,key){return room.players.length + [...room.inviteReservations.keys()].filter(k=>k!==key).length < 5;},
    Engine:{addPlayer(room,opts){if(room.players.length>=5||room.status==='playing')throw Error('mesa lotada');
      const p={...opts,id:`p-${++serial}`,isBot:false};room.players.push(p);return p;},appendLog(){}},
    crypto:{randomUUID(){return `token-${++serial}`}},
    removeSpectator(room,s){room.spectators=room.spectators.filter(x=>x.id!==s.id)},
    releaseReservation(room,key){room.inviteReservations.delete(key)},
    ensureInviteReservations(room){return room.inviteReservations},
    invitations:new Map(),completeInvite(){},
    updatePresenceFromSocket(){},
  };
  vm.runInNewContext(processor+'\nthis.process=processSpectatorSeatRequests;',ctx,{timeout:1000});
  return {room,sockets,messages,process:ctx.process};
}
// Dois pedidos para uma cadeira: somente o primeiro recebe uma vaga.
let t=scenario();t.process(t.room);
assert.equal(t.room.players.length,5);
assert.equal(t.messages.A.find(x=>x.name==='spectatorSeatStatus')?.data.status,'accepted');
assert.equal(t.messages.B.find(x=>x.name==='spectatorSeatStatus')?.data.status,'rejected');
assert.equal(t.room.spectatorSeatRequests.length,0);
assert.equal(t.sockets.get('socket-A').data.role,'PLAYER');
assert.equal(t.sockets.get('socket-B').data.role,'SPECTATOR');
assert(t.messages.A.find(x=>x.name==='joined')?.data.token.startsWith('token-'));
// O primeiro está temporariamente offline: não ocupa cadeira, pedido fica na
// fila enquanto o segundo conectado (primeiro VÁLIDO) pode assumir a vaga.
t=scenario({disconnectedFirst:true});t.process(t.room);
assert.equal(t.room.players.length,5);
assert.equal(t.messages.B.find(x=>x.name==='spectatorSeatStatus')?.data.status,'accepted');
assert.deepEqual(t.room.spectatorSeatRequests.map(r=>r.playerKey),['A']);
// Retorno ainda no intervalo, com vaga disponível: a identidade original é retomada.
t=scenario({free:2,disconnectedFirst:true});t.process(t.room);
assert.equal(t.room.players.length,4);
assert.equal(t.room.spectatorSeatRequests[0].playerKey,'A');
t.room.spectators[0].connected=true;t.room.spectators[0].socketId='socket-A';
t.process(t.room);
assert.equal(t.room.players.length,5);
assert.equal(t.messages.A.find(x=>x.name==='spectatorSeatStatus')?.data.status,'accepted');
assert.equal(t.room.spectatorSeatRequests.length,0);
// Reserva da última cadeira vence a fila: nenhum pedido é aceito.
t=scenario({free:0,reserve:1});t.process(t.room);
assert.equal(t.messages.A.find(x=>x.name==='spectatorSeatStatus')?.data.status,'rejected');
assert.equal(t.messages.B.find(x=>x.name==='spectatorSeatStatus')?.data.status,'rejected');
assert.equal(t.room.players.length,4);
// Uma rodada em andamento não pode distribuir cartas a um novo jogador.
t=scenario();t.room.status='playing';t.process(t.room);
assert.equal(t.room.players.length,4);
assert.equal(t.room.spectatorSeatRequests.length,2);
// Mesas de torneio continuam com sua composição original.
t=scenario();t.room.tournament={id:'T'};t.process(t.room);
assert.equal(t.room.players.length,4);
console.log('✓ Etapa 2: concorrência real do processador (fila, reserva, desconexão, reconexão, torneio)');

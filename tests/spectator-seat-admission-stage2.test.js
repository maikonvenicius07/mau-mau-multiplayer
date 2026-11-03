'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Seats = require('../spectator-seat-admission');
const { buildRoomSnapshot, restoreRoomSnapshot } = require('../room-snapshot-store');

function room({count=3,round=4,status='playing',reservations=[],queue=[]}={}) {
  return {
    code:'ABC123',status,round,rules:{rounds:5},players:Array.from({length:count},(_,i)=>({id:`p${i}`,isBot:i===0,connected:i!==1})),
    spectators:[],tournament:null,
    inviteReservations:new Map(reservations.map(key=>[key,{inviteId:'i',expiresAt:Date.now()+60000}])),
    spectatorSeatRequests:queue,
  };
}
const spectator={id:'s_abc',playerKey:'account-a',connected:true};
let r=room({reservations:['other']});
assert.equal(Seats.countAvailableSeats(r),1, 'Vagas devem descontar convite reservado');
assert.equal(Seats.countAvailableSeats(r,'account-a'),1);
assert.equal(Seats.countAvailableSeats(r,'other'),2, 'Dono do convite pode usar sua própria reserva');
assert.equal(Seats.seatStatus(r,spectator).availableSeats,1);
assert.equal(Seats.seatStatus(r,spectator).canRequest,true);
assert.equal(Seats.isEligibleRound(r),true,'É possível solicitar durante a 4ª rodada');
assert.equal(Seats.isEligibleRound(room({round:5})),false,'Não se pode entrar durante a 5ª rodada');
assert.equal(Seats.isEligibleRound(room({round:4,status:'between-rounds'})),true);
assert.equal(Seats.isEligibleRound(room({round:4,status:'finished'})),false);
r.tournament={id:'t-123'};
assert.equal(Seats.seatStatus(r,spectator).canRequest,false,'Torneio precisa continuar bloqueado');
r=room({reservations:['other','another']});
assert.equal(Seats.seatStatus(r,spectator).availableSeats,0,'Convites ocupam as últimas vagas');
assert.equal(Seats.seatStatus(r,spectator).canRequest,false);
r=room({count:5});
assert.equal(Seats.countAvailableSeats(r),0,'Bots e desconectados continuam ocupando cadeira');
r=room({queue:[
  {spectatorId:'s_previous',playerKey:'first',at:1000},
  {spectatorId:'s_abc',playerKey:'account-a',at:2000},
  {spectatorId:'s_last',playerKey:'last',at:3000},
]});
const queued=Seats.seatStatus(r,spectator);
assert.equal(queued.status,'queued');
assert.equal(queued.queuePosition,2);
assert.equal(queued.queueLength,3);
assert.equal(queued.canRequest,false);
assert(!('token' in queued) && !('playerKey' in queued),'Dados privados não devem sair no estado');
spectator.connected=false;
assert.equal(Seats.seatStatus(r,spectator).queuePosition,2,'Queda temporária não elimina posição');
spectator.connected=true;
Seats.removeRequestForSpectator(r,'s_previous');
assert.equal(Seats.seatStatus(r,spectator).queuePosition,1,'Remoção mantém ordem relativa');
Seats.removeRequestForSpectator(r,'s_abc');
assert.equal(Seats.seatStatus(r,spectator).queuePosition,null);

// Um pedido temporário NÃO deve ser persistido como se fosse uma identidade
// válida após reinício do processo Node no Render.
r=room();
r.spectatorSeatRequests=[{spectatorId:'s_abc',playerKey:'account-a',at:1000}];
const snapshot=buildRoomSnapshot(r).snapshot;
assert.equal(Object.prototype.hasOwnProperty.call(snapshot,'spectatorSeatRequests'),false);
const restored=restoreRoomSnapshot(snapshot);
assert(restored,'Snapshot de partida deve continuar restaurável');
assert.deepEqual(restored.spectatorSeatRequests,[]);
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const part=server.slice(server.indexOf('function processSpectatorSeatRequests(room)'),server.indexOf('\n\nfunction emitRoom(room)'));
assert(part.includes('awaitingReconnect.push(request)'),'Queda transitória não deve cancelar o pedido');
assert(part.includes('Engine.addPlayer(room'),'Conversão precisa usar o motor existente');
assert(part.includes('roomHasInviteCapacity(room,spectator.playerKey)'),'Capacidade precisa ser validada na hora da conversão');
assert(part.includes("role:ROLE_PLAYER,source:'spectator-promotion'"),'Sessão e token de jogador devem ser enviados ao navegador');
assert(server.includes('SpectatorSeatAdmission.removeRequestForSpectator(room,spectator.id)'),'Fila deve ser limpa na saída definitiva');
assert(server.includes('spectatorState.spectatorSeat=SpectatorSeatAdmission.seatStatus(room,spectator)'),'Reconexão deve restaurar fila via estado');
console.log('✓ Etapa 2: vagas reais, fila, reconexão, segurança e snapshots validados');

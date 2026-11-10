'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Seats=require('../spectator-seat-admission');
const Engine=require('../game-engine');
const {buildRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');

const room=Engine.createRoom('ABC123',{name:'Anfitrião',avatar:'macaco',socketId:'host',token:'host-token',playerKey:'owner'});
for(let i=1;i<=3;i++)Engine.addPlayer(room,{name:`Pessoa ${i}`,avatar:'macaco',socketId:`s${i}`,token:`token-${i}`,playerKey:`human-${i}`});
room.status='playing';room.round=3;room.rules.rounds=5;room.tournament=null;
room.spectators=[
  {id:'old-a',playerKey:'person-a',name:'A',avatar:'macaco',connected:true,socketId:'socket-old-a',token:'token-secret-a'},
  {id:'old-b',playerKey:'person-b',name:'B',avatar:'macaco',connected:true,socketId:'socket-old-b',token:'token-secret-b'},
];
room.spectatorSeatRequests=[
  {spectatorId:'old-a',playerKey:'person-a',at:100},
  {spectatorId:'old-b',playerKey:'person-b',at:200},
  {spectatorId:'old-a',playerKey:'person-a',at:300}, // retry não duplica a fila persistida
];
const snap=buildRoomSnapshot(room).snapshot;
assert(!('spectatorSeatRequests' in snap),'Identificadores de sessão do espectador não devem ser persistidos');
assert.deepEqual(snap.pendingSpectatorSeatRequests.map(x=>x.playerKey),['person-a','person-b']);
assert.deepEqual(Object.keys(snap.pendingSpectatorSeatRequests[0]).sort(),['at','expiresAt','playerKey']);
assert(!JSON.stringify(snap.pendingSpectatorSeatRequests).includes('token-secret'));
assert(!JSON.stringify(snap.pendingSpectatorSeatRequests).includes('socket-old'));

const restored=restoreRoomSnapshot(snap);
assert(restored);
assert.equal(restored.spectators.length,0,'Não recuperar antigas sessões de espectadores após restart');
assert.equal(restored.spectatorSeatRequests.length,2);
assert(restored.spectatorSeatRequests.every(r=>r.spectatorId===null));
assert.deepEqual(restored.spectatorSeatRequests.map(r=>r.playerKey),['person-a','person-b']);
assert.equal(Seats.claimRestoredSeatRequest(restored,{id:'fake',playerKey:'different'}),false,'Outra conta não pode capturar pedido anterior');

// O processador real não pode destruir o pedido quando o servidor acaba de reiniciar
// e o espectador ainda não fez login novamente.
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const from=server.indexOf('function processSpectatorSeatRequests(room){');
const until=server.indexOf('\n\n// A fila é efêmera:',from);
assert(from>0&&until>from);
restored.status='between-rounds';
const sockets=new Map();
const events=[];
const ctx={
  SpectatorSeatAdmission:Seats,ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',
  ensureSpectators:r=>r.spectators,
  ensureInviteReservations:r=>r.inviteReservations,
  io:{sockets:{sockets}},
  roomHasInviteCapacity:(r,k)=>Seats.countAvailableSeats(r,k)>0,
  Engine,
  crypto:{randomUUID:()=>`temp-${Math.random()}`},
  removeSpectator(r,s){r.spectators=r.spectators.filter(x=>x.id!==s.id);Seats.removeRequestForSpectator(r,s.id)},
  updatePresenceFromSocket(){},invitations:new Map(),completeInvite(){},
};
vm.runInNewContext(server.slice(from,until)+'\nthis.process=processSpectatorSeatRequests;',ctx);
ctx.process(restored);
assert.equal(restored.spectatorSeatRequests.length,2,'Pedido pendente deve sobreviver à primeira emissão após reinício');
assert.equal(restored.players.length,4);

// O login autenticado reatribui o pedido; a capacidade continua sendo conferida
// apenas durante a promoção, sem reservar a cadeira para a conta ausente.
const spectator={id:'new-a',playerKey:'person-a',name:'A',avatar:'macaco',connected:true,socketId:'socket-new-a'};
restored.spectators.push(spectator);
assert.equal(Seats.claimRestoredSeatRequest(restored,spectator),true);
assert.equal(restored.spectatorSeatRequests[0].spectatorId,'new-a');
assert.equal(Seats.claimRestoredSeatRequest(restored,{id:'second-a',playerKey:'person-a'}),false,'Tentativas duplicadas não criam novo vínculo');
assert.equal(Seats.seatStatus(restored,spectator).queuePosition,1);
sockets.set('socket-new-a',{id:'socket-new-a',data:{role:'SPECTATOR',spectatorId:'new-a',roomCode:restored.code,auth:{playerKey:'person-a'}},emit:(event,payload)=>events.push({event,payload})});
ctx.process(restored);
assert.equal(restored.players.length,5,'Só uma vaga deve ser ocupada');
assert.equal(restored.players.filter(p=>p.playerKey==='person-a').length,1);
assert.deepEqual(restored.spectatorSeatRequests.map(r=>r.playerKey),['person-b']);
assert(events.some(e=>e.event==='spectatorSeatStatus'&&e.payload.status==='accepted'));
const newcomer=restored.players.find(p=>p.playerKey==='person-a');
assert.equal(Engine.roomPublicState(restored,newcomer.id).me.id,newcomer.id);
assert.equal(Engine.roomSpectatorState(restored,{id:'observer-other',playerKey:'other',name:'Other'}).me.hand.length,0,'Observadores não recebem cartas privadas');

// Pedido expirado, snapshot antigo, quinta rodada e torneio não geram entrada.
const old={...snap,savedAt:Date.now()-Seats.RESTORED_REQUEST_GRACE_MS-1000};
assert.equal(restoreRoomSnapshot(old).spectatorSeatRequests.length,0);
const expired=restoreRoomSnapshot(snap);
expired.spectatorSeatRequests[0].recoveryExpiresAt=Date.now()-1;
assert.equal(Seats.pruneRestoredSeatRequests(expired),1);
assert.equal(Seats.claimRestoredSeatRequest(expired,{id:'late-a',playerKey:'person-a'}),false);
const finalRound=Engine.createRoom('OTHER1',{name:'Jogador',avatar:'macaco',socketId:'x',token:'t',playerKey:'x'});
finalRound.status='playing';finalRound.round=5;
assert.deepEqual(Seats.persistableSeatRequests(finalRound),[]);
const tournament=Engine.createRoom('OTHER2',{name:'Jogador',avatar:'macaco',socketId:'x',token:'t',playerKey:'x'});
tournament.status='playing';tournament.round=3;tournament.tournament={id:'t'};
assert.deepEqual(Seats.persistableSeatRequests(tournament),[]);
console.log('✓ V40.69.8: fila persistida sem sessão, retomada autenticada, vaga concorrente, expiração e sigilo aprovados');

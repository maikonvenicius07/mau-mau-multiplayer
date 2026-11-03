'use strict';
// Etapa 3: testes de regressão do fluxo real de promoção no intervalo após a 4ª rodada.
// Não depende do servidor HTTP nem do banco de produção.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Engine=require('../game-engine');
const Seats=require('../spectator-seat-admission');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const client=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const start=server.indexOf('function processSpectatorSeatRequests(room){');
const end=server.indexOf('\n\n// A fila é efêmera:',start);
assert(start>=0&&end>start,'Processador de pedidos deve existir no servidor');

function scenario({disconnectedFirst=false, reservations=0, playersCount=4}={}){
  const room=Engine.createRoom('TESTE1',{name:'Dona da sala',avatar:'macaco',socketId:'host',token:'host-token',playerKey:'host-key'});
  for(let i=1;i<playersCount;i++)Engine.addPlayer(room,{name:`Jogador ${i}`,avatar:'macaco',socketId:`player-${i}`,token:`token-${i}`,playerKey:`member-${i}`});
  room.round=4;room.status='between-rounds';
  room.players.forEach((p,i)=>{p.score=i*10;p.roundHistory=[null,null,null,null];});
  room.tournament=null;
  room.inviteReservations=new Map(Array.from({length:reservations},(_,i)=>[`invite-${i}`,{expiresAt:Date.now()+60000}]));
  const spectators=[
    {id:'s-A',playerKey:'account-A',name:'Observadora A',avatar:'macaco',connected:!disconnectedFirst,socketId:disconnectedFirst?null:'socket-A'},
    {id:'s-B',playerKey:'account-B',name:'Observador B',avatar:'macaco',connected:true,socketId:'socket-B'},
  ];
  room.spectators=spectators;
  room.spectatorSeatRequests=spectators.map((s,i)=>({spectatorId:s.id,playerKey:s.playerKey,at:100+i}));
  const events={A:[],B:[]};
  const sockets=new Map();
  for(const [who,s] of [['A',spectators[0]],['B',spectators[1]]]){
    sockets.set(`socket-${who}`,{id:`socket-${who}`,data:{role:'SPECTATOR',spectatorId:s.id,roomCode:room.code,auth:{playerKey:s.playerKey}},emit(event,payload){events[who].push({event,payload});}});
  }
  const context={
    ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',
    ensureSpectators(r){return r.spectators;},
    ensureInviteReservations(r){return r.inviteReservations;},
    io:{sockets:{sockets}},
    roomHasInviteCapacity(r,key){return Seats.countAvailableSeats(r,key)>0;},
    Engine,
    crypto:{randomUUID(){return `generated-token-${Math.random().toString(36).slice(2)}`;}},
    removeSpectator(r,s){r.spectators=r.spectators.filter(x=>x.id!==s.id);Seats.removeRequestForSpectator(r,s.id);},
    updatePresenceFromSocket(){},
    invitations:new Map(),completeInvite(){},
  };
  vm.runInNewContext(server.slice(start,end)+'\nthis.run=processSpectatorSeatRequests;',context,{timeout:1000});
  return {room,events,sockets,process:()=>context.run(room)};
}

// Segurança: só dados públicos durante a observação.
let t=scenario();
const publicSpectator=Engine.roomSpectatorState(t.room,t.room.spectators[0]);
assert.equal(publicSpectator.viewerRole,'SPECTATOR');
assert.deepEqual(publicSpectator.me.hand,[]);
assert.equal(publicSpectator.me.legalCardIds.length,0);
assert.equal(Seats.isEligibleRound(t.room),true,'Observador pode pedir durante a 4ª rodada e seu intervalo');
assert.equal(Seats.seatStatus(t.room,t.room.spectators[0]).queuePosition,1);

// Concorrência: mesmo com dois pedidos para a única cadeira, só um é promovido.
t.process();
assert.equal(t.room.players.length,5);
assert.equal(t.room.spectators.length,1);
assert.equal(t.room.spectatorSeatRequests.length,0);
const admitted=t.room.players.find(p=>p.playerKey==='account-A');
assert(admitted,'Primeira solicitação válida deve ser atendida');
assert.equal(admitted.score,30,'Pontuação inicial segue a regra do motor');
assert.equal(admitted.roundHistory.length,4,'Rodadas já realizadas não são disputadas retroativamente');
assert(t.events.A.some(e=>e.event==='joined'&&e.payload.source==='spectator-promotion'&&e.payload.token===admitted.token));
assert(t.events.A.some(e=>e.event==='spectatorSeatStatus'&&e.payload.status==='accepted'));
assert(t.events.B.some(e=>e.event==='spectatorSeatStatus'&&e.payload.status==='rejected'));
assert.equal(t.sockets.get('socket-A').data.role,'PLAYER');
assert.equal(t.sockets.get('socket-A').data.spectatorId,null);
// Não duplica jogadores numa segunda atualização do estado.
t.process();
assert.equal(t.room.players.length,5);

// A quinta rodada distribui cartas para o novo jogador e mantém a ordem original.
const beforeIds=t.room.players.map(p=>p.id);
Engine.startRound(t.room);
assert.equal(t.room.status,'playing');assert.equal(t.room.round,5);
assert.equal(t.room.direction,-1);
assert.deepEqual(t.room.players.map(p=>p.id),beforeIds);
assert(t.room.players.every(p=>p.hand.length===6),'Todos devem receber seis cartas');
assert.equal(Engine.roomPublicState(t.room,admitted.id).me.hand.length,6,'Novo jogador recebe somente a própria mão');
assert.equal(Seats.isEligibleRound(t.room),false,'Nova entrada proibida durante a 5ª rodada');
assert.throws(()=>Engine.addPlayer(t.room,{name:'Outro',avatar:'macaco',playerKey:'other'}),/A sala já possui 5 jogadores|Não é permitido entrar durante uma rodada/);

// Vaga reservada por convite prevalece; observador desconectado não ocupa cadeira.
t=scenario({reservations:1});t.process();
assert.equal(t.room.players.length,4);
assert.equal(t.events.A.at(-1).payload.status,'rejected');
assert.equal(t.events.B.at(-1).payload.status,'rejected');
t=scenario({disconnectedFirst:true});t.process();
assert.equal(t.room.players.length,5);
assert.equal(t.room.players.at(-1).playerKey,'account-B');
assert.deepEqual(t.room.spectatorSeatRequests.map(q=>q.playerKey),['account-A']);

// Regras de interface: chat local mantido durante promoção na mesma sala,
// aviso único de boas-vindas e eventos de fila sem toast duplicado.
assert(client.includes("const spectatorPromotion=data?.source==='spectator-promotion' && data?.role==='PLAYER'"));
const joined=client.slice(client.indexOf("socket.on('joined',data=>{"),client.indexOf("socket.on('publicRoomsSnapshot'"));
assert(joined.includes('if(!spectatorPromotion){'),'Chat deve ser limpo apenas em entradas normais');
assert(joined.includes('else if(spectatorPromotion)toast('),'Promoção deve informar o jogador');
assert(client.includes("info?.status!=='accepted')toast(info.message)"),'Confirmação não deve ser duplicada');
assert(server.includes("if(existing){\n        // ETAPA 3"),'Pedido repetido deve ter retorno sem nova mutação da sala');
console.log('✓ Etapa 3: concorrência, pontuação, 5ª rodada, privacidade, reconexão e aviso único OK');

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function part(from,to){const x=server.indexOf(from),y=server.indexOf(to,x+from.length);assert(x>=0&&y>x,`Trecho não encontrado: ${from}`);return server.slice(x,y)}
async function main(){
  // The server does not rely on the client identifying its own table.
  const sockets=[],sent=[];
  const socket={data:{auth:{playerKey:'player-1'},role:null},on:(event,fn)=>sockets.push([event,fn]),emit:(name,data)=>sent.push([name,data])};
  const bracket={currentStage:'semi',champion:null,stages:[{stage:'semi',tables:[{number:3,players:[{playerKey:'player-1'}]}]}]};
  let activeRoom=null,forfeited=false,bindingResult=null;
  const sandbox={socket,Date,console,
    ROLE_SPECTATOR:'SPECTATOR',activePlayerRoomForKey:()=>activeRoom,
    ensureTournamentBracketReady:async()=>true,
    tournamentCatalog:{list:async()=>[{id:'cup-abc',status:'closed'}]},
    tournamentDraw:{get:async()=>[{number:1,players:[{name:'Test Player'}]}],assignedTableFor:async()=>null},
    tournamentBracket:{summary:async()=>bracket,rows:async()=>[{stage:'semi',number:3,players:[{playerKey:'player-1'}]}],getBinding:async()=>({roomCode:'CODE11',result:bindingResult})},
    tournamentGames:{get:async()=>null},
    rooms:new Map([['CODE11',{tournament:{forfeits:[]}}]])
  };
  vm.runInNewContext(part("  // V40.69.8.13 — jogador sorteado",'  // V51.4: entrada autenticada'),sandbox);
  const locate=sockets.find(([name])=>name==='locateTournamentSeat')?.[1];assert.equal(typeof locate,'function');
  await locate();
  assert.equal(sent.length,1,'O sorteado deve receber a sua atribuição');
  assert.equal(sent[0][0],'tournamentSeatAssigned');
  assert.equal(sent[0][1].tableNumber,3);
  assert.equal(sent[0][1].stage,'semi');
  assert.equal('roomCode' in sent[0][1],false,'Código de sala nunca é revelado');
  // no repeated emission within one rapid retry
  await locate();assert.equal(sent.length,1);
  socket.data.lastTournamentSeatLookup=0;sandbox.rooms.get('CODE11').tournament.forfeits.push({playerKey:'player-1'});
  await locate();assert.equal(sent.length,1,'Desistente não recebe convite para retornar');
  sandbox.rooms.get('CODE11').tournament.forfeits=[];
  socket.data.lastTournamentSeatLookup=0;bindingResult={results:[]};
  await locate();assert.equal(sent.length,1,'Mesa encerrada não faz nova convocação');
  bindingResult=null;
  socket.data.lastTournamentSeatLookup=0;socket.data.role='SPECTATOR';
  await locate();assert.equal(sent.length,1,'Observador nunca recebe promoção automática');
  socket.data.role=null;activeRoom={status:'playing'};socket.data.lastTournamentSeatLookup=0;
  await locate();assert.equal(sent.length,1,'Não muda jogadores já em outra sala');
  // Notifications from draw/phase advancement contain only public assignment metadata.
  const notifications=[];
  const sandboxNotify={emitToPlayerKey:(key,event,value)=>notifications.push({key,event,value}),
    tournamentDraw:{seatAssignments:async()=>[{playerKey:'player-1',tableNumber:3},{playerKey:'player-2',tableNumber:3}]},
    tournamentBracket:{rows:async()=>[{stage:'semi',number:3,players:[{playerKey:'player-1'},{playerKey:'player-2'}]}]}};
  const notifyDef=part('async function notifyTournamentSeats(id,stage,tables){','// V40.69.8.1 — falhas transitórias');
  await vm.runInNewContext(notifyDef+'\nnotifyTournamentSeats("cup-abc","semi",[{number:3,players:[{name:"P1"},{name:"P2"}]}]);',sandboxNotify);
  assert.equal(notifications.length,2,'Todos os dois participantes devem ser avisados');
  notifications.length=0;
  await vm.runInNewContext(notifyDef+'\nnotifyTournamentSeats("cup-abc","qualifier",[{number:3,players:[{name:"P1"},{name:"P2"}]}]);',sandboxNotify);
  assert.equal(notifications.length,2,'A fase classificatória também requer chaves privadas');
  assert.equal(notifications[0].value.tableNumber,3);
  assert.equal('code' in notifications[0].value,false);
  // Client flow: no extra click, no duplicate entry, no observer promotion.
  const autoEvents=new Map(),autoEmits=[];
  const client={socket:{connected:true,on:(name,fn)=>autoEvents.set(name,fn),emit:(name,value)=>autoEmits.push({name,value})},
    pendingVoluntaryLeave:()=>null,leaveRoomPending:false,URLSearchParams,location:{search:''},
    state:null,saved:()=>({role:'PLAYER'}),tournamentWatchMode:false,
    savedSessionResumePending:false,accountSeatResumePending:false,
    setTimeout:()=>1,clearTimeout:()=>{},toast:()=>{}};
  const begin=app.indexOf('// V40.69.8.13 — encaminhamento automático');
  const end=app.indexOf("socket.on('joined',data=>{",begin);
  assert(begin>=0&&end>begin,'Bloco de entrada automática não encontrado');
  vm.runInNewContext(app.slice(begin,end),client);
  const target={tournamentId:'cup-abc',stage:'semi',tableNumber:3};
  const onAssignment=autoEvents.get('tournamentSeatAssigned');
  onAssignment(target);onAssignment(target);
  assert.equal(autoEmits.length,1,'Convocação duplicada não duplica evento de entrada');
  assert.equal(autoEmits[0].name,'enterTournamentTable');
  assert.equal(autoEmits[0].value.automatic,true);
  assert.equal(autoEmits[0].value.tableNumber,3);
  const observer={...client,socket:{connected:true,on:()=>{},emit:()=>{throw Error('Observador jamais entra automaticamente');}},saved:()=>({role:'SPECTATOR'})};
  vm.runInNewContext(app.slice(begin,end),observer);
  vm.runInNewContext(`autoEnterTournamentSeat(${JSON.stringify(target)})`,observer);
  // User-facing UI and client automation contract.
  assert(ui.includes('ASSISTIR AO TORNEIO'));
  assert(ui.includes("game?.liveStatus==='lobby'"),'Espectador deve poder entrar no lobby do torneio');
  assert(!ui.includes("join.textContent=game?.created?"),'Jogador inscrito não deve depender de botão manual');
  assert(app.includes("socket.on('tournamentSeatAssigned',autoEnterTournamentSeat)"));
  assert(app.includes('automatic:true'));
  assert(server.includes("if(tournamentWatch?room.status==='finished'"));
  assert(html.includes('Os jogadores sorteados entram automaticamente'));
  console.log('✓ V40.69.8.13: atribuição autenticada, sem retomada de desistente, proteção do observador e entrada automática.');
}
main().catch(e=>{console.error(e);process.exitCode=1});

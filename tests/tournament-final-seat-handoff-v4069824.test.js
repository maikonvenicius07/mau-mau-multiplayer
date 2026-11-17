'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const client=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const handoff=require('../tournament-seat-handoff');
const target={tournamentId:'copa-teste',stage:'final',tableNumber:1};

// A mesa comum do relato da captura (0 rodadas e 2 jogadores) não pode
// bloquear a convocação; uma partida real não deve ser interrompida.
const idle={status:'lobby',round:0,players:[{connected:true},{connected:true}],tournament:null};
assert.equal(handoff.canAutoSwitchFrom(idle),true);
for(const candidate of [
  {...idle,status:'playing'},
  {...idle,status:'between-rounds'},
  {...idle,round:1},
  {...idle,tournament:{id:'outro-torneio'}},
  null
])assert.equal(handoff.canAutoSwitchFrom(candidate),false);
assert(server.includes("if(playing&&!TournamentSeatHandoff.canAutoSwitchFrom(playing))return"));
assert(server.includes('&&!TournamentSeatHandoff.canAutoSwitchFrom(other)'));

async function locate(activeRoom){
  const listeners=new Map(),messages=[];
  const socket={data:{auth:{playerKey:'finalista-1'},role:null},on:(name,fn)=>listeners.set(name,fn),emit:(name,body)=>messages.push({name,body})};
  const context={socket,Date,Number,String,console,ROLE_SPECTATOR:'SPECTATOR',
    activePlayerRoomForKey:()=>activeRoom,TournamentSeatHandoff:handoff,
    ensureTournamentBracketReady:async()=>true,
    tournamentCatalog:{list:async()=>[{id:target.tournamentId,status:'closed'}]},
    tournamentDraw:{get:async()=>[{number:1}],assignedTableFor:async()=>null},
    tournamentBracket:{summary:async()=>({champion:null,currentStage:'final',stages:[{stage:'final',tables:[{number:1}]}]}),
      rows:async()=>[{stage:'final',number:1,players:[{playerKey:'finalista-1'}]}],
      getBinding:async()=>({roomCode:null,result:null})},
    tournamentGames:{get:async()=>null},rooms:new Map(),
  };
  const start=server.indexOf("  // V40.69.8.13 — jogador sorteado");
  const end=server.indexOf("  // V51.4: entrada autenticada",start);
  assert(start>0&&end>start);
  vm.runInNewContext(server.slice(start,end),context);
  await listeners.get('locateTournamentSeat')();
  return messages;
}
async function main(){
  assert.equal((await locate(idle)).filter(m=>m.name==='tournamentSeatAssigned').length,1,
    'Finalista em sala comum sem rodada deve receber convocação da final');
  assert.equal((await locate({...idle,status:'playing'})).length,0,
    'Jamais convocar automaticamente quem está jogando uma partida');
  const begin=client.indexOf('// V40.69.8.13 — encaminhamento automático');
  const end=client.indexOf("socket.on('joined',data=>{",begin);
  assert(begin>0&&end>begin);
  function clientScenario(state,search=""){
    const events=new Map(),sent=[];
    const ctx={socket:{connected:true,on:(name,fn)=>events.set(name,fn),emit:(name,payload)=>sent.push({name,payload})},
      state,pendingVoluntaryLeave:()=>null,leaveRoomPending:false,
      URLSearchParams,location:{search},saved:()=>({role:'PLAYER'}),tournamentWatchMode:false,
      savedSessionResumePending:false,accountSeatResumePending:false,
      setTimeout:()=>99,clearTimeout:()=>{},toast:()=>{}};
    vm.runInNewContext(client.slice(begin,end),ctx);
    events.get('tournamentSeatAssigned')(target);
    return sent;
  }
  assert.equal(clientScenario({status:'lobby',round:0,viewerRole:'PLAYER',tournamentWait:null,tournamentSchedule:null})
    .filter(m=>m.name==='enterTournamentTable').length,1,
    'Cliente deve seguir a final automaticamente mesmo estando em lobby comum');
  assert.equal(clientScenario({status:'lobby',round:0,viewerRole:'PLAYER'},'?room=FGRYM6')
    .filter(m=>m.name==='enterTournamentTable').length,1,
    'Link antigo de sala comum não pode impedir a mudança segura para a final');
  assert.equal(clientScenario(null,'?room=FGRYM6').length,0,
    'Antes de concluir o convite não se deve ignorar a intenção de entrar na sala');
  for(const state of [
    {status:'playing',round:2,viewerRole:'PLAYER'},
    {status:'lobby',round:0,viewerRole:'PLAYER',tournamentSchedule:{name:'Outra copa'}},
    {status:'lobby',round:0,viewerRole:'SPECTATOR'}
  ])assert.equal(clientScenario(state).length,0,'Não abandonar jogo ou trocar privilégios indevidamente');
  assert(ui.includes('🎮 ENTRAR NA MINHA MESA'));
  assert(ui.includes("socket.emit('enterTournamentTable'"),'Botão manual deve acionar entrada autenticada');
  assert(ui.includes("source==='tournament-resume'"),'Retomada deve fechar o painel');
  assert(client.includes('🏆 Mesa de torneio · observadores: Torneios'));
  assert(ui.includes("game?.liveStatus==='lobby'"),'Observadores podem assistir à espera');
  assert(ui.includes('Aguardando pelo menos dois jogadores na mesa do torneio'));
  console.log('✓ V40.69.8.24: finalista em lobby comum entra automaticamente na final; partida ativa e observador protegidos, cronômetro e acesso alternativo verificados.');
}
main().catch(e=>{console.error(e);process.exitCode=1});

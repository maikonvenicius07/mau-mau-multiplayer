'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(dir,'server.js'),'utf8');
const app=fs.readFileSync(path.join(dir,'public/app.js'),'utf8');
const ui=fs.readFileSync(path.join(dir,'public/tournament-ui.js'),'utf8');
const html=fs.readFileSync(path.join(dir,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(dir,'public/styles.css'),'utf8');
const begin=app.indexOf('// V40.69.8.31 — ingresso automático SOMENTE');
const end=app.indexOf("socket.on('joined',data=>{",begin);
assert(begin>=0&&end>begin);
const block=app.slice(begin,end);
const makeUI=()=>{
 const elements={};for(const id of ['tournamentNextPhaseNotice','tournamentNextPhaseTitle','tournamentNextPhaseStatus',
  'tournamentNextPhaseEnter','tournamentNextPhaseClose','tournamentOpenHome']){
  elements[id]={hidden:true,textContent:'',clicks:0,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},click(){this.clicks++;this.handlers.click?.();}};
 }
 return elements;
};
function clientScenario({state=null,role='PLAYER'}={}){
 const events=new Map(),sent=[],toasts=[],nodes=makeUI();
 const context={socket:{connected:true,on:(event,handler)=>events.set(event,handler),emit:(event,payload)=>sent.push({event,payload})},
  state,pendingVoluntaryLeave:()=>false,leaveRoomPending:false,URLSearchParams,location:{search:''},
  saved:()=>({role}),tournamentWatchMode:false,savedSessionResumePending:false,accountSeatResumePending:false,
  document:{getElementById:id=>nodes[id]||null},toast:m=>toasts.push(m),setTimeout:()=>1,clearTimeout:()=>{}};
 vm.runInNewContext(block,context);
 return {events,sent,toasts,nodes,context};
}
const target=stage=>({tournamentId:'copa-teste',stage,tableNumber:1});
for(const stage of ['semi','quarter','final']){
 const x=clientScenario();x.events.get('tournamentSeatAssigned')(target(stage));
 assert.equal(x.sent.length,0,`${stage}: não entrar automaticamente`);
 assert.equal(x.toasts.length,1,`${stage}: exibir uma orientação`);
 assert.equal(x.nodes.tournamentNextPhaseEnter.hidden,false);
 assert.match(x.nodes.tournamentNextPhaseStatus.textContent,/Torneios.*ENTRAR NA MINHA MESA/);
 x.events.get('tournamentSeatAssigned')(target(stage));
 assert.equal(x.toasts.length,1,'convocação repetida não pode gerar avisos sem fim');
 x.nodes.tournamentNextPhaseEnter.click();
 assert.equal(x.nodes.tournamentOpenHome.clicks,1,'botão de aviso abre painel; não entra em sala');
 assert.equal(x.sent.length,0);
 x.nodes.tournamentNextPhaseClose.click();
 assert.equal(x.nodes.tournamentNextPhaseNotice.hidden,true);
 x.events.get('tournamentSeatAssigned')(target(stage));
 assert.equal(x.nodes.tournamentNextPhaseNotice.hidden,true,'aviso fechado não reaparece a cada reconciliação');
}
for(const situation of [{status:'finished',round:5},{status:'lobby',round:0},{status:'playing',round:4}]){
 const x=clientScenario({state:situation});
 x.events.get('tournamentSeatAssigned')(target('final'));
 assert.equal(x.sent.length,0,'nenhuma mudança de mesa sem clique');
}
const first=clientScenario();first.events.get('tournamentSeatAssigned')(target('qualifier'));
assert.equal(first.sent.length,1,'inscritos da primeira fase continuam com entrada automática');
assert.equal(first.sent[0].event,'enterTournamentTable');
assert.equal(first.sent[0].payload.automatic,true);
const observer=clientScenario({role:'SPECTATOR'});
observer.events.get('tournamentSeatAssigned')(target('qualifier'));
assert.equal(observer.sent.length,0,'observador nunca é promovido a jogador');
assert(html.indexOf('tournamentNextPhaseNotice')>html.indexOf('id="landing"'));
assert(html.indexOf('tournamentNextPhaseNotice')<html.indexOf('id="game"'));
assert(css.includes('position:relative;z-index:1;width:min(560px,100%)'),'aviso não é overlay na mesa');
assert(ui.includes("socket.emit('enterTournamentTable'"),'entrada manual pelo painel');
assert(ui.includes('GRANDE FINAL FORMADA!'));
assert(server.includes("if(phase!=='qualifier')throw new Error('Entre manualmente"),
 'clientes antigos não podem transferir automaticamente na semifinal/final');
assert(server.includes('await awaitTournamentTableJoinLock(lockKey)'),'concorrência da mesma mesa deve aguardar');
assert(server.includes('if(room.tournament&&room.status===\'finished\')'),'mesa concluída sai sem tombstone');
assert(server.includes('await abandonHumanSeatDurably(previous,member,'),'troca da mesa concluída preserva a classificação');
console.log('✓ V40.69.8.31: classificatórias automáticas, semifinais/finais manuais, aviso compacto fechável, observador protegido e saída concluída segura.');
// Testes de transição de sala e espera por entradas simultâneas com persistência simulada.
(async()=>{
 const part=(from,to)=>{
  const fromIndex=server.indexOf(from),toIndex=server.indexOf(to,fromIndex+from.length);
  assert(fromIndex>=0&&toIndex>fromIndex,`Trecho ausente: ${from}`);
  return server.slice(fromIndex,toIndex);
 };
 const marked=[],saved=[],result={changed:true,deleted:false};
 const room={code:'OLD123',status:'finished',tournament:{id:'copa-teste'},rankingRecorded:false};
 const player={playerKey:'A',id:'p1',score:25};
 const ctx={roomSnapshotStore:{markPlayerAbandoned:async(...args)=>marked.push(args),
   saveNow:async r=>saved.push(r),markRoomDeleted:async()=>{}},
  requireRoomPersistenceReady:async()=>{},abandonHumanSeat:(r,p)=>{
   p.connected=false;return result;
  },Date,console};
 vm.runInNewContext(part('async function abandonHumanSeatDurably(', '\nfunction withRoom('),ctx);
 assert.equal(await ctx.abandonHumanSeatDurably(room,player),result);
 assert.equal(marked.length,0,'SAIR depois de uma fase concluída não registra desistência');
 assert.equal(player.score,25,'pontuação preservada');
 assert.equal(saved.length,1,'resultado pendente conserva snapshot');
 const active={...room,status:'playing'};
 await ctx.abandonHumanSeatDurably(active,player);
 assert.equal(marked.length,1,'desistência DURANTE partida continua registrada');
 const locks=new Set(['cup:final:1']);
 const lockCtx={tournamentTableJoinLocks:locks,Date,Error,Promise,setTimeout};
 vm.runInNewContext(part('async function awaitTournamentTableJoinLock(', '\nconst tournamentTestDeleteLocks='),lockCtx);
 const wait=lockCtx.awaitTournamentTableJoinLock('cup:final:1',{timeoutMs:500});
 setTimeout(()=>locks.delete('cup:final:1'),80);
 await wait;
 console.log('✓ V40.69.8.31: saída concluída sem desistência, pontuação preservada e segundo finalista aguarda o bloqueio da mesa.');
})().catch(e=>{console.error(e);process.exitCode=1});

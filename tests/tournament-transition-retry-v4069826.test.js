'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const client=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const start=client.indexOf('// V40.69.8.31 — ingresso automático SOMENTE');
const end=client.indexOf("socket.on('joined',data=>{",start);
assert(start>0&&end>start);
const code=client.slice(start,end);
const ids=['tournamentNextPhaseNotice','tournamentNextPhaseTitle','tournamentNextPhaseStatus','tournamentNextPhaseEnter'];
const elements=Object.fromEntries(ids.map(id=>[id,{id,hidden:true,textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}}]));
const requests=[],events=new Map(),timers=new Map();let nextTimer=1,time=10000;
class Clock extends Date{static now(){return time;}}
const socket={connected:true,on:(name,fn)=>events.set(name,fn),emit:(name,payload)=>requests.push({name,payload})};
const context={socket,Date:Clock,document:{getElementById:id=>elements[id]||null},
  state:null,leaveRoomPending:false,pendingVoluntaryLeave:()=>false,
  URLSearchParams,location:{search:''},saved:()=>({role:'PLAYER'}),tournamentWatchMode:false,
  savedSessionResumePending:false,accountSeatResumePending:false,
  setTimeout:(fn)=>{const n=nextTimer++;timers.set(n,fn);return n;},
  clearTimeout:n=>timers.delete(n),toast:()=>{}};
vm.runInNewContext(code,context);
const target={tournamentId:'copa123',stage:'qualifier',tableNumber:1};
const count=()=>requests.filter(x=>x.name==='enterTournamentTable').length;
events.get('tournamentSeatAssigned')(target);
assert.equal(count(),1);
assert.equal(elements.tournamentNextPhaseNotice.hidden,false);
assert.match(elements.tournamentNextPhaseTitle.textContent,/CLASSIFICATÓRIAS/);
assert.equal(elements.tournamentNextPhaseEnter.hidden,true);
for(let i=0;i<8;i++){
  const next=[...timers.entries()][0];assert(next,'A tentativa precisa possuir timeout');
  timers.delete(next[0]);next[1]();
}
assert.equal(count(),8);
events.get('tournamentSeatAssigned')(target);
assert.equal(count(),8,'Convocação repetida não pode criar tempestade de tentativas');
assert.match(elements.tournamentNextPhaseStatus.textContent,/aguardando nova tentativa/);
time+=61000;
events.get('tournamentSeatAssigned')(target);
assert.equal(count(),9,'A mesma vaga deve poder ser tentada novamente após a janela de resfriamento');
elements.tournamentNextPhaseEnter.handlers.click();
assert.equal(count(),9,'Primeira fase segue o fluxo automático, sem exigir botão na notificação');
assert.equal(requests.at(-1).payload.automatic,true,'O servidor ainda deve aplicar as restrições do encaminhamento automático');
assert.match(html,/id="tournamentNextPhaseEnter"/);
assert.match(css,/tournament-phase-notice\[hidden\]/);
// A convocação pode chegar ANTES da fase antiga ficar encerrada.
// Deve ficar guardada e ser retomada após 'finished' (sem nova notificação).
const deferredEvents=new Map(),deferredCalls=[];
const deferredNotice=Object.fromEntries(ids.map(id=>[id,{hidden:true,textContent:'',addEventListener(){}}]));
const deferredCtx={...context,state:{status:'playing',round:5,viewerRole:'PLAYER'},
 document:{getElementById:id=>deferredNotice[id]||null},
 socket:{connected:true,on:(name,fn)=>deferredEvents.set(name,fn),emit:(name,payload)=>deferredCalls.push({name,payload})}};
vm.runInNewContext(code,deferredCtx);
deferredEvents.get('tournamentSeatAssigned')(target);
assert.equal(deferredCalls.length,0,'Não remover jogador de partida anterior em andamento');
assert.equal(deferredNotice.tournamentNextPhaseNotice.hidden,false,'Não ocultar classificação durante transição');
assert(client.includes('autoEnterTournamentSeat(autoTournamentSeat);'),'Transição após state finished deve usar a vaga pendente');
deferredCtx.state={status:'finished',round:5};
vm.runInNewContext('autoEnterTournamentSeat(autoTournamentSeat)',deferredCtx);
assert.equal(deferredCalls.filter(x=>x.name==='enterTournamentTable').length,1,
  'A mesma convocação deve ser retomada após término da partida anterior');
assert(client.includes("if(!$('#networkDiagnosticsDialog')?.open)return;"),
  'O diagnóstico fechado não deve escrever os diversos campos ocultos a cada estado');
assert(client.includes('sampleNow-lastStatePayloadSampleAt>=5000'),
  'Medição do tamanho do estado não deve serializar todos os eventos');
console.log('✓ V40.69.8.31: limite de tentativas automáticas apenas na primeira fase, aviso manual nas posteriores e diagnóstico seletivo.');

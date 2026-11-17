'use strict';
// V40.69.8.22 — a contagem libera o botão; jamais autoriza início sem clique.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Wait=require('../tournament-wait');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const tableUi=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const clockBanner=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const makeRoster=(n=5)=>Array.from({length:n},(_,i)=>({playerKey:`id${i}`,name:`Jogador ${i}`}));
const day=Date.UTC(2026,10,17,12,0);
function checkWait(){
 const roster=makeRoster();const deadline=day+300000;
 const decision=(n,now)=>Wait.decide({roster,present:roster.slice(0,n).map(p=>p.playerKey),deadline,now});
 assert.equal(decision(5,day).action,'ready','com todos presentes, botão libera antes do prazo');
 assert.equal(decision(4,day+299999).action,'wait','com um ausente, não libera antes do prazo');
 assert.equal(decision(4,deadline).action,'ready','ao chegar em zero, libera início manual');
 assert.equal(decision(4,deadline).missing.length,1);
 assert.equal(decision(5,deadline+5000).action,'ready','atrasado antes do clique ainda participa');
 assert.equal(decision(1,deadline).action,'needs-attention','com um presente não há partida válida');
 assert.equal(decision(0,deadline).action,'needs-attention','com zero presentes não há início');
 assert.equal(decision(4,deadline+10000).action,'ready','o fim da espera não encerra o lobby');
 assert.equal(Wait.deadlineAt(day),deadline,'o prazo persiste como absoluto');
}
function checkBrowser(){
 const start=app.indexOf('function isTournamentStartReady(');
 const end=app.indexOf('function tournamentStartHint(',start);
 assert(start>0&&end>start,'regra do botão deve existir no navegador');
 const snippet=app.slice(start,end);
 const values=(present,expected,deadlineAt,now)=>{
   const sandbox={state:{status:'lobby',tournamentWait:{present,expected,deadlineAt}}};
   vm.runInNewContext(snippet+'; this.ready=isTournamentStartReady;',sandbox);
   return sandbox.ready(now);
 };
 assert.equal(values(5,5,day+300000,day),true);
 assert.equal(values(4,5,day+300000,day),false);
 assert.equal(values(4,5,day+300000,day+300000),true);
 assert.equal(values(1,5,day+300000,day+300000),false);
 assert.equal(values(5,5,null,day),true,'legado com todos ainda pode iniciar');
 assert(app.includes("b.id='tournamentManualStartButton'"),'botão deve ter referência para o ticker');
 assert(app.includes("b.disabled=blocked||(tournamentLobby&&!isTournamentStartReady())"));
 assert(app.includes("if(button)button.disabled=!socket.connected||!isTournamentStartReady()"));
 assert(!tableUi.includes('Início automático em'),'painel não deve prometer auto-início');
 assert(clockBanner.includes('A partida só começa quando o anfitrião clicar em INICIAR PARTIDA'));
}
function checkServer(){
 const enter=server.slice(server.indexOf("socket.on('enterTournamentTable'"),server.indexOf("socket.on('createRoom'"));
 const reconcile=server.slice(server.indexOf('async function reconcileTournamentProgress()'),server.indexOf('const tournamentProgressTimer='));
 const manual=server.slice(server.indexOf("socket.on('startRound'"),server.indexOf("socket.on('declare'"));
 const helper=server.slice(server.indexOf('async function startTournamentLobbyOnRequest('),server.indexOf('// V40.69.8.1 — falhas transitórias'));
 assert(!enter.includes('startTournamentLobbyOnRequest('));
 assert(!reconcile.includes('startTournamentLobbyOnRequest('));
 assert(manual.includes('await startTournamentLobbyOnRequest(room,p,socket.id)'));
 assert(helper.includes('if(!stillAuthorized())'),'validação de anfitrião é responsabilidade do servidor');
 assert(helper.indexOf('tournamentRoundStartLocks.add(room.code)')<helper.indexOf('await tournamentGames.get('),
   'mutex precisa anteceder qualquer await para evitar início duplicado');
 assert(helper.includes("if(plan.action!=='ready')"));
 assert(helper.includes('room.players.length<2'));
 assert(helper.includes('if(plan.expired)'));
 assert(helper.includes('TournamentForfeit.recordForfeit('),'ausente só é desclassificado no clique válido');
 assert(enter.includes("if(tournamentRoundStartLocks.has(room.code))"),'entrada concorrente precisa respeitar início em curso');
 const withRoom=server.slice(server.indexOf('function withRoom('),server.indexOf('const SOCIAL_EFFECTS ='));
 assert(withRoom.includes('ROLE_SPECTATOR'),'observador não pode solicitar início');
}
checkWait();checkBrowser();checkServer();
console.log('✓ V40.69.8.22 — regra de tempo, botão, autorização, simultaneidade, observador e ausência de auto-início.');

'use strict';
// V40.69.8.40: regressão focada no limite de 120 s e nos prazos persistidos.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const Wait=require('../tournament-wait');
const Clock=require('../public/tournament-schedule');
const Retention=require('../retention-policy');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentStore}=require('../tournament-store');
const {TournamentDraw}=require('../tournament-draw');
const {TournamentBracket}=require('../tournament-bracket');
const {TournamentGames}=require('../tournament-games');
const {recordTournamentResult}=require('../tournament-result-commit');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const tableUi=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const roster=Array.from({length:4},(_,i)=>({playerKey:`p${i}`,name:`P${i}`}));
const all=roster.map(x=>x.playerKey);

function testTwoMinutesAndManualStart(){
  const start=Date.UTC(2026,10,19,12,0,0),deadline=start+120000;
  assert.equal(Wait.WAIT_MS,120000,'nova espera central deve ser 2 minutos');
  assert.equal(Wait.deadlineAt(start),deadline);
  assert.equal(Wait.deadlineAt(new Date(start).toISOString()),deadline);
  const decide=(present,ms,limit=deadline)=>Wait.decide({roster,present,deadline:limit,now:ms});
  assert.equal(decide(all,start).action,'ready','4/4 podem iniciar manualmente no primeiro segundo');
  assert.equal(decide(all.slice(0,3),start+75000).action,'wait','3/4 aguardam com 45 s faltando');
  assert.equal(decide(all,start+75000).action,'ready','4º chegou: libera início antes do prazo');
  assert.equal(decide(all.slice(0,3),deadline-1).action,'wait','3/4 não iniciam com 1 ms faltando');
  assert.equal(decide(all.slice(0,3),deadline).action,'ready','3/4 podem optar pelo início em 00:00');
  assert.equal(decide(all.slice(0,3),deadline+3600000).action,'ready','aguardar após zero não reinicia prazo');
  assert.equal(decide(all.slice(0,1),deadline).action,'needs-attention','1/4 não pode iniciar partida');
  assert.equal(decide([],deadline).action,'needs-attention','0/4 não pode iniciar partida');
  assert.equal(decide(['p0','p0'],deadline).present,1,'reconexão duplicada não cria jogador');
  assert.equal(decide(all.slice(0,3),start+299999,start+300000).action,'wait',
    'prazo de mesa antiga salvo com 5 minutos não deve ser reduzido retroativamente');
  assert.equal(Retention.ALL_HUMANS_OFFLINE_EXPIRY_MS,300000,
    'prazo de retenção offline, diferente da espera do torneio, permanece em 5 min');
  assert(server.includes('async function startTournamentLobbyOnRequest('),'início manual preservado');
  const enter=server.slice(server.indexOf("socket.on('enterTournamentTable'"),server.indexOf("socket.on('createRoom'"));
  assert(!enter.includes('startTournamentLobbyOnRequest('),'entrada automática de classificados não pode iniciar a partida');
}
function testClockAndClient(){
  assert(html.includes('id="tournamentWaitClock" aria-label="Tempo restante">02:00'),
    'HTML precisa exibir 02:00 antes do primeiro estado');
  assert(!app.includes('Aguarde os cinco minutos'),'texto antigo deve ser removido');
  assert(app.includes('tournamentScheduleClock?.now()??Date.now()'),
    'relógio de lobby precisa reutilizar a sincronização existente com o servidor');
  assert(tableUi.includes('scheduleClock?.now()??Date.now()'),
    'relógio do painel precisa reutilizar sincronização do servidor');
  const start=Date.UTC(2026,10,19,12,0,0),deadline=start+120000;
  let monotonicMs=0;
  const clock=Clock.clock(()=>monotonicMs);
  assert.equal(clock.sync(start),true);
  const snippet=app.slice(app.indexOf('function isTournamentStartReady('),app.indexOf('function tournamentStartHint('));
  const sandbox={tournamentScheduleClock:clock,state:{status:'lobby',tournamentWait:{expected:4,present:3,deadlineAt:deadline}}};
  vm.runInNewContext(snippet+';this.isReady=isTournamentStartReady',sandbox);
  assert.equal(sandbox.isReady(),false,'botão bloqueado no começo com ausentes');
  monotonicMs=75000;
  assert.equal(Math.ceil((deadline-clock.now())/1000),45,'espera sincronizada mostra 45 s sem usar relógio do dispositivo');
  assert.equal(sandbox.isReady(),false,'3/4, com 45 s restantes, não liberados');
  sandbox.state.tournamentWait.present=4;
  assert.equal(sandbox.isReady(),true,'todos presentes liberam início manual com 45 s restantes');
  sandbox.state.tournamentWait.present=3;
  monotonicMs=120000;
  assert.equal(sandbox.isReady(),true,'3/4 liberados ao chegar a zero');
  assert.equal(Math.max(0,Math.ceil((deadline-clock.now())/1000)),0,'contador fica em zero');
}
async function testPersistenceAndFinal(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-wait-2m-'));
  const at=(name)=>path.join(dir,name);
  try{
    const args={databaseUrl:'',filePath:at('draws.json'),signupsFilePath:at('signups.json')};
    const cat=new TournamentCatalog({databaseUrl:'',filePath:at('tournaments.json'),signupsFilePath:at('signups.json')});
    const store=new TournamentStore({databaseUrl:'',filePath:at('signups.json')});
    const draw=new TournamentDraw(args);
    const bracket=new TournamentBracket({databaseUrl:'',filePath:at('bracket.json'),draw});
    const games=new TournamentGames({databaseUrl:'',filePath:at('games.json')});
    for(const x of [cat,store,draw,bracket,games])await x.init();
    const cup=await cat.create({data:{name:'Teste 2 minutos',capacity:9,startAt:null},actor:'owner'});
    const opened=await cat.update({id:cup.id,data:{status:'open'}});
    for(let i=0;i<9;i++)await store.change({action:'join',playerKey:`user-${i}`,name:`Jogador ${i}`,config:opened});
    await cat.update({id:cup.id,data:{status:'closed'}});
    const initial=await draw.draw(cup.id);
    assert.deepEqual(initial.map(t=>t.players.length),[3,3,3],'nove inscritos distribuídos em três mesas de três');
    const start=await draw.waitStartedAt(cup.id,1);
    const originalDeadline=await draw.waitDeadlineAt(cup.id,1);
    assert.equal(originalDeadline,start+120000,'primeira mesa tem 2 minutos');
    assert.equal(await draw.waitDeadlineAt(cup.id,2),originalDeadline,'mesmo prazo no sorteio');
    assert.equal(await draw.waitDeadlineAt(cup.id,3),originalDeadline,'mesmo prazo para todas as mesas');
    const restartedDraw=new TournamentDraw(args);await restartedDraw.init();
    assert.equal(await restartedDraw.waitDeadlineAt(cup.id,1),originalDeadline,
      'consulta/reinício não renova prazo inicial');
    for(const t of initial){
      const assignments=await draw.seatAssignments(cup.id);
      const seat=assignments.find(p=>p.tableNumber===t.number);
      const authorized=(await draw.seatFor(cup.id,t.number,seat.playerKey)).players;
      const roomCode=`MESA${t.number}`;
      await games.claim(cup.id,t.number,roomCode);
      await games.markStarted(cup.id,t.number,roomCode);
      const record={matchId:`match-${t.number}`,results:authorized.map((p,i)=>({playerKey:p.playerKey,name:p.name,position:i+1,score:i*10,won:i===0}))};
      await recordTournamentResult({bracket,games,id:cup.id,phase:'qualifier',number:t.number,roomCode,record,roster:authorized});
    }
    const progressed=await bracket.advance(cup.id,initial);
    assert.equal(progressed.currentStage,'semi');
    for(const t of (await bracket.rows(cup.id)).filter(x=>x.stage==='semi')){
      const code='SEM'+t.number;
      await bracket.claim(cup.id,'semi',t.number,code);
      const record={matchId:'semi-'+code,results:t.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))};
      await recordTournamentResult({bracket,games,id:cup.id,phase:'semi',number:t.number,roomCode:code,record,roster:t.players});
    }
    await bracket.advance(cup.id,initial);
    const final=await bracket.getBinding(cup.id,'final',1);
    assert.equal(final.players.length,4,'a final ainda tem quatro classificados');
    assert.equal(final.waitDeadlineAt,final.createdAt+120000,'a final recebe novo prazo de 2 minutos');
    const restoredBracket=new TournamentBracket({databaseUrl:'',filePath:at('bracket.json'),draw:restartedDraw});
    await restoredBracket.init();
    assert.equal((await restoredBracket.getBinding(cup.id,'final',1)).waitDeadlineAt,final.waitDeadlineAt,
      'reconexão/restart não renova prazo da final');
    await restoredBracket.advance(cup.id,initial);
    assert.equal((await restoredBracket.getBinding(cup.id,'final',1)).waitDeadlineAt,final.waitDeadlineAt,
      'avanço duplicado não altera a final');
    // Em produção, mesas já sorteadas antes do deploy podem ter 5 minutos persistidos:
    // o servidor lê e respeita o valor absoluto salvo, sem migração retroativa.
    draw.reloadLocal();draw.local[cup.id][0].waitDeadlineAt=start+300000;draw.save();
    assert.equal(await restartedDraw.waitDeadlineAt(cup.id,1),start+300000,
      'prazo de mesa antiga não é recalculado');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{
  testTwoMinutesAndManualStart();testClockAndClient();await testPersistenceAndFinal();
  console.log('✓ V40.69.8.40: 02:00, sincronismo, 9 participantes, prazo persistente e início manual.');
})().catch(e=>{console.error(e);process.exitCode=1;});

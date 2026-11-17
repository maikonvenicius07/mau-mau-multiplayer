'use strict';
// V40.69.8.21 — espera oficial, W.O. sem máquinas e passagem de nove inscritos.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const Wait=require('../tournament-wait');
const {distribute,TournamentDraw}=require('../tournament-draw');
const {TournamentBracket}=require('../tournament-bracket');
const {TournamentGames}=require('../tournament-games');
const {recordTournamentResult}=require('../tournament-result-commit');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentStore}=require('../tournament-store');
const Forfeit=require('../tournament-forfeit');

async function testWait(){
  assert.equal(Wait.WAIT_MS,300000);
  const start=Date.UTC(2026,10,17,15,0);assert.equal(Wait.deadlineAt(start),start+300000);
  assert.equal(Wait.deadlineAt(new Date(start).toISOString()),start+300000);
  const roster=Array.from({length:5},(_,i)=>({playerKey:`p${i}`,name:`P ${i}`}));
  const plan=(present,now)=>Wait.decide({roster,present,deadline:start+300000,now});
  assert.equal(plan(['p0','p1','p2','p3','p4'],start+1000).action,'ready','todos chegam: liberar início manual');
  assert.equal(plan(['p0','p1','p2','p3'],start+299999).action,'wait','falta um: aguardar');
  assert.equal(plan(['p0','p1','p2','p3'],start+300000).action,'ready','quatro chegam: botão liberado ao prazo');
  assert.equal(plan(['p0'],start+300000).action,'needs-attention','um presente: sem partida inválida');
  assert.equal(plan([],start+300000).action,'needs-attention','sem presentes: não inventar vencedor');
  assert.equal(plan(['p0','p0'],start+300000).present,1,'uma conta não ocupa dois lugares');
}

async function testManualServer(){
  const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const a=src.indexOf('async function startTournamentLobbyOnRequest(room,player,socketId){');
  const b=src.indexOf('// V40.69.8.1 — falhas transitórias',a);
  assert(a>0&&b>a,'O início deve estar ligado a solicitação explícita');
  const startFn=src.slice(a,b);
  const join=src.slice(src.indexOf("socket.on('enterTournamentTable'"),src.indexOf("socket.on('createRoom'"));
  const reconcile=src.slice(src.indexOf('async function reconcileTournamentProgress()'),src.indexOf('const tournamentProgressTimer='));
  assert(!join.includes('startTournamentLobbyOnRequest('),'Entrar na mesa não inicia partida');
  assert(!reconcile.includes('startTournamentLobbyOnRequest('),'Reconciliação não inicia partida');
  const manual=src.slice(src.indexOf("socket.on('startRound'"),src.indexOf("socket.on('declare'"));
  assert(manual.includes('await startTournamentLobbyOnRequest(room,p,socket.id)'),'Apenas clique solicita início');
  async function scenario({present,expected=5,deadlineOffset,phase='qualifier',concurrent=false}){
    const roster=Array.from({length:expected},(_,i)=>({playerKey:`p${i}`,name:`Pessoa ${i}`}));
    const room={code:'WAIT21',status:'lobby',round:0,
      players:roster.slice(0,present).map((r,i)=>({...r,isBot:false,connected:true,id:`seat${i}`,score:0,host:i===0,socketId:`sock${i}`})),
      tournament:{id:'cup',phase,tableNumber:1,rosterKeys:roster.map(r=>r.playerKey),rosterNames:roster,forfeits:[],waitDeadlineAt:Date.now()+deadlineOffset}};
    const rooms=new Map([[room.code,room]]);let marks=0,engineStarts=0,saved=0,emits=0;
    const locks=new Set();
    const binding=()=>({roomCode:room.code,result:null,roomState:marks?'started':'lobby'});
    const sandbox={
      rooms,tournamentRoundStartLocks:locks,
      tournamentGames:{get:async()=>binding(),markStarted:async()=>{marks++;return true;}},
      tournamentBracket:{getBinding:async()=>binding(),markStarted:async()=>{marks++;return true;}},
      roomSnapshotStore:{saveNow:async()=>{saved++;return true;}},
      tournamentWaitDeadline:async()=>room.tournament.waitDeadlineAt,
      TournamentWait:Wait,TournamentForfeit:Forfeit,
      requireRoomPersistenceReady:async()=>true,ensureTournamentBracketReady:async()=>true,
      Engine:{startRound:rm=>{engineStarts++;rm.round=1;rm.status='playing';},appendLog:()=>{}},
      ensureHost:()=>{},emitRoom:()=>{emits++;},broadcastPresence:()=>{},console
    };
    vm.runInNewContext(startFn+';this.start=startTournamentLobbyOnRequest;',sandbox);
    assert.equal(marks,0);assert.equal(room.status,'lobby','Passagem do tempo por si só não inicia');
    if(!present)return {marks,room};
    const invoke=()=>sandbox.start(room,room.players[0],'sock0');
    if(concurrent){
      const outcomes=await Promise.allSettled([invoke(),invoke()]);
      assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1,'Somente um clique concorrente pode vencer');
    }else{
      const result=await Promise.allSettled([invoke()]);
      const allowed=present>=2&&(present===expected||deadlineOffset<0);
      assert.equal(result[0].status,allowed?'fulfilled':'rejected');
    }
    const allowed=present>=2&&(present===expected||deadlineOffset<0);
    assert.equal(marks,Number(allowed),'Somente clique autorizado marca início');
    assert.equal(room.status,allowed?'playing':'lobby');
    assert.equal(engineStarts,Number(allowed));
    if(allowed){
      assert.equal(saved,2);assert.equal(room.tournament.forfeits.length,expected-present);
      assert.equal(room.players.length,present);assert(room.players.every(p=>!p.isBot));
    }else{
      assert.equal(room.tournament.forfeits.length,0,'Ausentes não são punidos só por esperar');
    }
    return {marks,room};
  }
  await scenario({present:5,deadlineOffset:300000});
  await scenario({present:4,deadlineOffset:300000});
  await scenario({present:4,deadlineOffset:-1000});
  await scenario({present:1,deadlineOffset:-1000});
  await scenario({present:0,deadlineOffset:-1000});
  await scenario({present:5,deadlineOffset:300000,phase:'final',concurrent:true});
}

async function ninePlayers(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-wait21-'));
  const at=name=>path.join(dir,name);
  try{
    const cat=new TournamentCatalog({databaseUrl:'',filePath:at('tournaments.json'),signupsFilePath:at('signups.json')});
    const store=new TournamentStore({databaseUrl:'',filePath:at('signups.json')});
    const draw=new TournamentDraw({databaseUrl:'',filePath:at('draws.json'),signupsFilePath:at('signups.json')});
    const bracket=new TournamentBracket({databaseUrl:'',filePath:at('bracket.json'),draw});
    const games=new TournamentGames({databaseUrl:'',filePath:at('games.json')});
    for(const x of [cat,store,draw,bracket,games])await x.init();
    const cup=await cat.create({data:{name:'Teste nove participantes',capacity:9,startAt:null},actor:'owner'});
    const opened=await cat.update({id:cup.id,data:{status:'open'}});
    for(let i=0;i<9;i++)await store.change({action:'join',playerKey:`p${i}`,name:`Pessoa ${i}`,config:opened});
    await cat.update({id:cup.id,data:{status:'closed'}});
    const tables=await draw.draw(cup.id);
    assert.deepEqual(tables.map(x=>x.players.length),[5,4]);
    const start=await draw.waitStartedAt(cup.id,1);
    assert(start>0);assert.equal(await draw.waitStartedAt(cup.id,2),start);
    assert.equal(await draw.waitDeadlineAt(cup.id,1),start+300000);
    assert.equal(await draw.waitDeadlineAt(cup.id,2),start+300000);
    for(const table of tables){
      const entries=await draw.seatAssignments(cup.id);const first=entries.find(p=>p.tableNumber===table.number);
      const roster=(await draw.seatFor(cup.id,table.number,first.playerKey)).players;
      const code='C'+table.number;
      await games.claim(cup.id,table.number,code);await games.markStarted(cup.id,table.number,code);
      const record={matchId:'game-'+code,results:roster.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))};
      await recordTournamentResult({bracket,games,id:cup.id,phase:'qualifier',number:table.number,roomCode:code,record,roster});
    }
    const advance=await bracket.advance(cup.id,tables);
    assert.equal(advance.currentStage,'final');
    const final=await bracket.getBinding(cup.id,'final',1);
    assert.equal(final.players.length,4,'dois classificados de cada mesa');
    assert(final.createdAt>0,'fase final tem início persistido');
    assert.equal(final.waitDeadlineAt,final.createdAt+300000,'final tem data-limite absoluta persistida');
    const repeat=await bracket.advance(cup.id,tables);
    assert.equal(repeat.stages.find(s=>s.stage==='final').tables.length,1,'final não duplicada');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{
  await testWait();await testManualServer();await ninePlayers();
  console.log('✓ V40.69.8.22: cronômetro não inicia partidas, cliques únicos, 5/5, 4/5, 1/5, final e 9 inscritos → final.');
})().catch(e=>{console.error(e);process.exitCode=1;});

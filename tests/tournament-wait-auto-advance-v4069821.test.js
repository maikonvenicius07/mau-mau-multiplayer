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
  assert.equal(plan(['p0','p1','p2','p3','p4'],start+1000).action,'start','todos chegam: imediato');
  assert.equal(plan(['p0','p1','p2','p3'],start+299999).action,'wait','falta um: aguardar');
  assert.equal(plan(['p0','p1','p2','p3'],start+300000).action,'start','quatro chegam: comeca ao prazo');
  assert.equal(plan(['p0'],start+300000).action,'walkover','um presente: W.O.');
  assert.equal(plan([],start+300000).action,'needs-attention','sem presentes: não inventar vencedor');
  assert.equal(plan(['p0','p0'],start+300000).present,1,'uma conta não ocupa dois lugares');
}

async function testAutomaticServer(){
  const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const a=src.indexOf('async function maybeAutoStartTournamentLobby(room){');
  const b=src.indexOf('// V40.69.8.1 — falhas transitórias',a);
  assert(a>0&&b>a);
  const startFn=src.slice(a,b);
  async function scenario({present,expected=5,deadlineOffset,walkover=false}){
    const roster=Array.from({length:expected},(_,i)=>({playerKey:`p${i}`,name:`Pessoa ${i}`}));
    const room={code:'WAIT21',status:'lobby',round:0,players:roster.slice(0,present).map((r,i)=>({...r,isBot:false,connected:true,id:`seat${i}`,score:0})),
      tournament:{id:'cup',phase:'qualifier',tableNumber:1,rosterKeys:roster.map(r=>r.playerKey),rosterNames:roster,forfeits:[],waitDeadlineAt:Date.now()+deadlineOffset}};
    const rooms=new Map([[room.code,room]]);let marks=0,engineStarts=0,saved=0,emits=0;
    const locks=new Set();
    const sandbox={
      rooms,tournamentRoundStartLocks:locks,tournamentGames:{get:async()=>({roomCode:room.code,result:null}),markStarted:async()=>{marks++;return true;}},
      tournamentBracket:{},roomSnapshotStore:{saveNow:async()=>{saved++;return true;}},
      tournamentWaitDeadline:async()=>room.tournament.waitDeadlineAt,
      TournamentWait:Wait,TournamentForfeit:Forfeit,
      requireRoomPersistenceReady:async()=>true,ensureTournamentBracketReady:async()=>true,
      Engine:{startRound:rm=>{engineStarts++;rm.round=1;rm.status='playing';},appendLog:()=>{}},
      ensureHost:()=>{},emitRoom:()=>{emits++;},broadcastPresence:()=>{},console
    };
    vm.runInNewContext(startFn+';this.auto=maybeAutoStartTournamentLobby;',sandbox);
    const actions=await Promise.all([sandbox.auto(room),sandbox.auto(room)]);
    assert.equal(actions.filter(Boolean).length,marks,'uma única tentativa por mesa');
    if(deadlineOffset>0&&present<expected){assert.equal(marks,0);assert.equal(room.status,'lobby');return;}
    if(present===0){assert.equal(marks,0);assert.equal(room.status,'lobby');return;}
    assert.equal(marks,1);assert.equal(saved,2);assert.equal(emits,1);
    assert.equal(room.tournament.forfeits.length,expected-present,'ausentes registrados na classificação');
    assert.equal(room.players.length,present,'ninguém substituído por robô');
    assert(room.players.every(p=>!p.isBot));
    if(walkover){
      assert.equal(room.status,'finished');assert.equal(engineStarts,0);
      const record=Forfeit.tournamentMatchRecord(room,{matchId:'walkover',results:room.players.map(p=>({playerKey:p.playerKey,name:p.name,score:0,position:1,won:true}))});
      assert.equal(record.results.length,expected,'resultado inclui todos os sorteados');
      assert.equal(record.results.filter(p=>p.forfeited).length,expected-1);
      assert.equal(record.results.filter(p=>p.won).length,1);
    }
    else {assert.equal(room.status,'playing');assert.equal(engineStarts,1);}
  }
  await scenario({present:5,deadlineOffset:300000});
  await scenario({present:4,deadlineOffset:300000});
  await scenario({present:4,deadlineOffset:-1000});
  await scenario({present:1,deadlineOffset:-1000,walkover:true});
  await scenario({present:0,deadlineOffset:-1000});
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
  await testWait();await testAutomaticServer();await ninePlayers();
  console.log('✓ V40.69.8.21: cronômetro, 5/5, 4/5, 1/5 (W.O.), zero presentes, concorrência, 9 inscritos → final sem duplicação.');
})().catch(e=>{console.error(e);process.exitCode=1;});

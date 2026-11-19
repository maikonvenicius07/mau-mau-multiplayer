'use strict';
// V40.69.8.44 — testes locais reais de armazenamento, motor de rodadas e transição de fases.
// Finalização das rodadas é induzida no motor (sem simular todas as cartas).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Engine=require('../game-engine');
const {TournamentCatalog,cleanPayload}=require('../tournament-catalog');
const {TournamentStore}=require('../tournament-store');
const {TournamentDraw}=require('../tournament-draw');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const {recordTournamentResult}=require('../tournament-result-commit');
const {buildMatchRecord}=require('../ranking-store');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','public','tournament-ui.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

const setup=async dir=>{
  const opts={databaseUrl:'',filePath:path.join(dir,'tournaments.json'),signupsFilePath:path.join(dir,'tournament-signups.json')};
  const catalog=new TournamentCatalog(opts);
  const store=new TournamentStore({databaseUrl:'',filePath:opts.signupsFilePath});
  const draw=new TournamentDraw({databaseUrl:'',filePath:path.join(dir,'tournament-draws.json'),signupsFilePath:opts.signupsFilePath});
  const games=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'tournament-games.json')});
  const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'tournament-bracket.json'),draw});
  await catalog.init();await store.init();await draw.init();await games.init();await bracket.init();
  return {catalog,store,draw,games,bracket,opts};
};
const person=i=>({playerKey:`player-${i}`,name:`Pessoa ${i}`,token:`token-${i}`,avatar:'macaco'});
function playConfiguredMatch({id,stage,tableNumber,players,rounds}){
  const first=players[0];
  const room=Engine.createRoom(`M${tableNumber}${stage[0]}`,person(Number(first.playerKey.split('-').at(-1))));
  // No servidor, esses campos são definidos no lobby antes do snapshot/claim:
  room.rules.rounds=rounds;
  room.tournament={id,phase:stage,tableNumber,rounds,rosterKeys:players.map(p=>p.playerKey)};
  for(const p of players.slice(1))Engine.addPlayer(room,{name:p.name,playerKey:p.playerKey,token:p.playerKey,avatar:'macaco'});
  assert.equal(room.rules.rounds,rounds);
  for(let r=1;r<=rounds;r++){
    assert.equal(room.status,r===1?'lobby':'between-rounds',`antes da rodada ${r}`);
    Engine.startRound(room);
    assert.equal(room.round,r);
    assert.equal(Engine.roomPublicState(room,null).rounds,rounds);
    assert.equal(Engine.roomPublicState(room,null).tournamentSchedule.rounds,rounds);
    room.winnerId=room.players[0].id;
    room.lastWinnerCard={rank:'2',suit:'clubs'};
    const before=room.players.map(p=>p.score);
    Engine.finalizeRound(room);
    assert.equal(room.players[0].score,before[0],`vencedor soma zero na rodada ${r}`);
    assert(room.players.slice(1).every((p,i)=>p.score>=before[i+1]),'pontuações acumuladas não diminuem');
    assert.equal(room.status,r===rounds?'finished':'between-rounds',`partida ${rounds}, rodada ${r}`);
    assert.equal(room.players[0].roundHistory.length,r);
  }
  assert.equal(room.round,rounds);
  assert.match(room.log.at(-1).message,new RegExp(`Fim das ${rounds} rodadas`));
  assert.throws(()=>Engine.startRound(room),/rodadas já foram concluídas/);
  return room;
}

async function caseRounds(rounds,{participants=9,complete=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),`mm-v44-${rounds}-`));
  try{
    const {catalog,store,draw,games,bracket,opts}=await setup(dir);
    const event=await catalog.create({actor:'organizador',data:{name:`Torneio de ${rounds}`,capacity:participants,startAt:null,rounds}});
    assert.equal(event.rounds,rounds);
    assert.equal((await catalog.list()).find(t=>t.id===event.id).rounds,rounds);
    const afterRestart=new TournamentCatalog(opts);await afterRestart.init();
    assert.equal((await afterRestart.get(event.id)).rounds,rounds,'persistência após reinício');
    const opened=await catalog.update({id:event.id,data:{status:'open'}});
    for(let i=0;i<participants;i++)await store.change({action:'join',name:`Pessoa ${i}`,playerKey:`player-${i}`,config:opened});
    await catalog.update({id:event.id,data:{status:'closed'}});
    const firstTables=await draw.draw(event.id);
    assert.equal((await catalog.get(event.id)).rounds,rounds);
    await assert.rejects(catalog.update({id:event.id,data:{rounds:rounds===5?10:5}}),/não pode mudar após o sorteio/);
    assert.equal((await catalog.get(event.id)).rounds,rounds);
    const phases=[];
    for(let step=0;step<5;step++){
      const summary=await bracket.summary(event.id,firstTables);
      if(summary.champion)break;
      const stage=summary.currentStage;
      phases.push(stage);
      const tables=stage==='qualifier'?firstTables:(await bracket.rows(event.id)).filter(t=>t.stage===stage);
      assert(tables.length>0);
      for(const t of tables){
        const members=stage==='qualifier'?
          (await draw.seatFor(event.id,t.number,(await draw.seatAssignments(event.id)).find(x=>x.tableNumber===t.number).playerKey)).players:t.players;
        const room=playConfiguredMatch({id:event.id,stage,tableNumber:t.number,players:members,rounds});
        const record=buildMatchRecord(room);
        if(stage==='qualifier'){
          await games.claim(event.id,t.number,room.code);
          await games.markStarted(event.id,t.number,room.code);
        }else{
          await bracket.claim(event.id,stage,t.number,room.code);
          await bracket.markStarted(event.id,stage,t.number,room.code);
        }
        await recordTournamentResult({bracket,games,id:event.id,phase:stage,number:t.number,roomCode:room.code,record,roster:members});
      }
      await bracket.advance(event.id,firstTables);
    }
    const summary=await bracket.summary(event.id,firstTables);
    assert(summary.champion,'torneio termina com campeão');
    assert(phases.includes('qualifier'));
    if(participants>=6)assert(phases.includes('final'),'avança para final automaticamente');
    if(participants>=20)assert(phases.includes('semi'),'avança para semifinal automaticamente');
    console.log(`✓ ${rounds} rodadas: ${participants} inscritos, fases ${phases.join(' → ')}, ${summary.champion.names[0].name}; persistência e imutabilidade OK`);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{
  for(const bad of [0,4,6,11,16,NaN])assert.throws(()=>cleanPayload({name:'Copa',capacity:10,startAt:null,rounds:bad}),/Escolha 5, 10 ou 15/);
  assert.equal(cleanPayload({name:'Copa',capacity:10,startAt:null}).rounds,5);
  assert.equal(Engine.createRoom('NORMAL',{name:'Normal'}).rules.rounds,5,'salas normais continuam com cinco');
  for(const n of [5,10,15]){
    assert(html.includes(`value="${n}"`),'seletor inclui a escolha '+n);
    assert(ui.includes('rounds:Number(rounds?.value||5)'),'frontend envia a escolha ao servidor');
  }
  assert(server.includes('candidate.rules.rounds=event.rounds'),'novo lobby usa o total armazenado');
  assert(server.includes('rounds:event.rounds,forfeits:[]'),'snapshot da mesa mantém a duração');
  assert(/const RELEASE_VERSION = 'V40\.69\.8\.(\d+)'/.test(server) &&
    Number(server.match(/const RELEASE_VERSION = 'V40\.69\.8\.(\d+)'/)[1]) >= 45,
    'Versão funcional deve preservar as correções de limite e rodadas da V40.69.8.45');
  assert(server.includes('await tournamentBracket.seatFor('),'segurança da entrada de classificados permanece');
  assert(server.includes("if(binding?.roomCode&&!room)"),'proteção da transição aprovada permanece');
  assert(server.includes('await startTournamentLobbyOnRequest(room,p,socket.id)'),'início exclusivo manual permanece');
  assert.equal(require('../tournament-wait').WAIT_MS,120000,'dois minutos preservados');
  // Torneios legados não devem ser migrados para uma duração nova.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-v44-legacy-'));
  try{
    const {catalog,opts}=await setup(dir);
    const legacy=await catalog.create({actor:'legacy',data:{name:'Copa antiga',capacity:2,startAt:null}});
    const rows=JSON.parse(fs.readFileSync(opts.filePath,'utf8'));
    delete rows.find(t=>t.id===legacy.id).rounds;
    fs.writeFileSync(opts.filePath,JSON.stringify(rows));
    const recovered=new TournamentCatalog(opts);await recovered.init();
    assert.equal((await recovered.get(legacy.id)).rounds,5);
    assert.equal((await recovered.update({id:legacy.id,data:{name:'Copa antiga'}})).rounds,5);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  await caseRounds(5,{participants:9});
  await caseRounds(10,{participants:20});
  await caseRounds(15,{participants:9});
  console.log('✓ V40.69.8.44: motor, catálogo legado, finais, fases, controle de versão e contrato do frontend.');
})().catch(e=>{console.error(e);process.exitCode=1});

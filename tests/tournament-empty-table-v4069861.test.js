'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const vm=require('node:vm');
const {TournamentDraw,distribute}=require('../tournament-draw');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const {TournamentPodiumArchive}=require('../tournament-podium-archive');
const {recordTournamentResult}=require('../tournament-result-commit');
const Empty=require('../tournament-empty-table');
const RoomGovernance=require('../room-governance');
const {assertTournamentTable}=require('../tournament-table-capacity');
const {restoreRoomSnapshot,plainRoomSnapshot}=require('../room-snapshot-store');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const helper=source.slice(source.indexOf('async function closeEmptyTournamentTable('),source.indexOf('let tournamentReconcileRunning=false;'));
const routine=source.slice(source.indexOf('let tournamentReconcileRunning=false;'),source.indexOf('const tournamentProgressTimer='));
const now=Date.now(),deadline=now-1000;
const roster=[{playerKey:'a',name:'Ana',seat:1},{playerKey:'b',name:'Beto',seat:2}];
const record=Empty.absenceRecord({id:'cup',phase:'qualifier',number:1,roster,deadline});
const bound={roomCode:'TEST01',roomState:'lobby',claimedAt:now-180000};
const room={code:'TEST01',status:'lobby',round:0,players:[]};
for(const [opts,expected] of [
  [{},true],[{deadline:now+1},false],[{deadline:null},false],[{snapshotsReady:false},false],
  [{binding:bound,snapshot:true},false],[{binding:{...bound,roomState:'started'}},false],
  [{binding:{...bound,roomState:'legacy'}},false],[{binding:bound},true],
  [{binding:bound,room},true],[{binding:bound,room:{...room,status:'playing',round:1}},false],
  [{binding:bound,room:{...room,players:[{connected:true}]}},false],
  [{binding:bound,room:{...room,players:[{connected:false,reconnectEligible:true,reconnectDeadlineAt:now+1000}]}},false],
  [{binding:{...bound,result:record}},false],
])assert.equal(Empty.canCloseEmpty({deadline,now,...opts}),expected,JSON.stringify(opts));
assert(Empty.isAbsenceRecord(record));assert(record.results.every(p=>!p.won&&p.forfeited));
assert.throws(()=>Empty.absenceRecord({id:'cup',phase:'final',number:1,roster:roster.slice(0,1),deadline}),/2 a 4/);

async function scenario(count,mode){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-empty61-'));const file=n=>path.join(dir,n+'.json');
  const id='cup-'+mode;
  try{
    const draw=new TournamentDraw({databaseUrl:'',filePath:file('draw'),signupsFilePath:file('signups')});
    const games=new TournamentGames({databaseUrl:'',filePath:file('games')});
    const bracket=new TournamentBracket({databaseUrl:'',filePath:file('bracket'),draw});
    const archive=new TournamentPodiumArchive({databaseUrl:'',filePath:file('podium')});
    for(const x of [draw,games,bracket,archive])await x.init();
    const players=Array.from({length:count},(_,i)=>({playerKey:'key'+i,name:'Pessoa '+i}));
    const groups=distribute(players,()=>0);
    draw.local[id]=groups.map(t=>({...t,drawnAt:deadline-120000,waitDeadlineAt:deadline}));draw.save();
    const first=await draw.get(id);const rooms=new Map(),locks=new Set(),notices=[],errors=[],liveWrites=[];
    const waiting=async(id,phase,n,b)=>phase==='qualifier'?draw.waitDeadlineAt(id,n):b?.waitDeadlineAt;
    const ctx={snapshotsRestored:true,ensureTournamentBracketReady:async()=>true,ensureTournamentPodiumReady:async()=>true,
      tournamentCatalog:{list:async()=>[{id,name:'Copa',status:'closed'}]},tournamentDraw:draw,tournamentGames:games,
      tournamentBracket:bracket,tournamentPodiumArchive:archive,rooms,tournamentTableJoinLocks:locks,tournamentTestDeleteLocks:new Set(),
      tournamentRoundStartLocks:new Set(),RoomGovernance,MAX_ROOMS:10,pendingRoomCreations:0,tournamentWaitDeadline:waiting,TournamentEmptyTable:Empty,assertTournamentTable,recordTournamentResult,
      roomSnapshotStore:{hasStoredSnapshot:async code=>code==='GUARD1',isRoomDeleted:()=>false},
      maybeResolveTournamentLobbyWalkover:()=>false,maybeRecordFinished:()=>{},
      emitRoom:r=>{if(r.tournament?.noShowRecord)liveWrites.push(recordTournamentResult({bracket,games,id,phase:r.tournament.phase,number:r.tournament.tableNumber,roomCode:r.code,record:r.tournament.noShowRecord,roster:groups.find(g=>g.number===r.tournament.tableNumber).players}));},
      Engine:{appendLog:()=>{}},notifyTournamentSeats:async(id,phase,tables)=>notices.push({phase,numbers:tables.map(t=>t.number)}),
      console:{info:()=>{},error:(...a)=>errors.push(a)},Date,Map,Set};
    vm.runInNewContext(helper+routine,ctx);
    const close=(phase,n)=>vm.runInNewContext(`closeEmptyTournamentTable(${JSON.stringify(id)},${JSON.stringify(phase)},${n})`,ctx);
    const tick=()=>vm.runInNewContext('reconcileTournamentProgress()',ctx);
    const play=async(group,phase,code,{single=false}={})=>{
      if(phase==='qualifier')await games.claim(id,group.number,code);else await bracket.claim(id,phase,group.number,code);
      const results=group.players.map((p,i)=>({...p,position:i+1,score:i*10,won:i===0,forfeited:single&&i>0}));
      await recordTournamentResult({bracket,games,id,phase,number:group.number,roomCode:code,roster:group.players,record:{matchId:code,finishedAt:new Date(now).toISOString(),results}});
    };
    if(mode==='mixed'){
      await play(groups[1],'qualifier','MIXED2');await play(groups[2],'qualifier','MIXED3');
      await tick();assert.equal((await games.get(id,1)).roomCode,null);assert((await games.get(id,1)).result.noShow);
      assert.equal((await bracket.rows(id)).filter(r=>r.stage==='qualifier').length,3);
      await tick();let summary=await bracket.summary(id,first);assert.equal(summary.currentStage,'semi');
      const semis=(await bracket.rows(id)).filter(r=>r.stage==='semi');assert.equal(semis.length,1);assert.equal(semis[0].players.length,4);
      const excluded=new Set(groups[0].players.map(p=>p.playerKey));assert(semis[0].players.every(p=>!excluded.has(p.playerKey)));
      await play(semis[0],'semi','MIXSEM');await tick();summary=await bracket.summary(id,first);assert.equal(summary.currentStage,'final');
      const final=(await bracket.rows(id)).find(r=>r.stage==='final');await play(final,'final','MIXFIN');await tick();
      assert.equal((await archive.list()).length,1);assert.equal((await bracket.summary(id,first)).champion.names.length,1);
    }else if(mode==='none'){
      await tick();await tick();const summary=await bracket.summary(id,first);assert.equal(summary.endedWithoutChampion,true);assert.equal(summary.champion,null);assert.equal((await archive.list()).length,0);assert.deepEqual(await archive.pending(),[id]);
      assert.equal((await bracket.rows(id)).length,groups.length);assert((await bracket.rows(id)).every(t=>t.result.noShow));
      const catalog={local:[{id,status:'closed'}],save(){}},store={filePath:file('signups'),local:[],reloadLocal(){}};
      assert.equal(await archive.cleanup(id,{catalog,store,draw,games,bracket}),true);
      assert.deepEqual(await archive.pending(),[]);assert.deepEqual(await archive.list(),[]);
      assert.deepEqual(await bracket.rows(id),[]);assert.deepEqual(await draw.get(id),[]);
      assert.equal(await games.get(id,1),null);assert.equal(catalog.local.length,0);
      assert.equal(JSON.parse(fs.readFileSync(archive.filePath)).length,0,'sem pódio, marcador eliminado após limpeza');
    }else if(mode==='single'){
      await play(groups[0],'qualifier','SINGL1',{single:true});await tick();await tick();
      const summary=await bracket.summary(id,first);assert.equal(summary.champion.byAbsence,true);assert.equal(summary.champion.standings.length,1);assert.equal((await archive.list())[0].champion.names[0].name,groups[0].players[0].name);
    }else if(mode==='live'){
      await games.claim(id,1,'LIVE01');const group=groups[0];const live={code:'LIVE01',status:'lobby',round:0,players:[{...group.players[0],id:'p',connected:false}],tournament:{id,phase:'qualifier',tableNumber:1,rosterKeys:group.players.map(p=>p.playerKey)}};
      rooms.set(live.code,live);assert.equal(await close('qualifier',1),true);await Promise.all(liveWrites);assert.equal(live.status,'finished');assert.equal(live.winnerId,null);assert((await games.get(id,1)).result.noShow);assert(live.tournament.forfeits.length===group.players.length);
      const snap=plainRoomSnapshot({...live,players:[]});assert(restoreRoomSnapshot(snap),'snapshot pendente sem cadeiras pode ser recuperado');
    }else if(mode==='repair'){
      const group=groups[0];const args={id,number:1,roomCode:null,result:Empty.absenceRecord({id,phase:'qualifier',number:1,roster:group.players,deadline}),expectedPlayers:group.players.length};
      await games.finishEmpty(args);assert.equal((await bracket.rows(id)).length,0);await tick();assert.equal((await bracket.rows(id)).length,1);await tick();assert.equal((await bracket.summary(id,first)).endedWithoutChampion,true);
    }else if(mode==='guard'){
      ctx.MAX_ROOMS=0;ctx.pendingRoomCreations=10;assert.equal(await close('qualifier',1),false,'capacidade indisponível não elimina jogadores');ctx.MAX_ROOMS=10;ctx.pendingRoomCreations=0;
      await games.claim(id,1,'GUARD1');assert.equal(await close('qualifier',1),false);assert.equal((await games.get(id,1)).result,null);
      await games.markStarted(id,1,'GUARD1');assert.equal(await close('qualifier',1),false);
      await assert.rejects(games.finishEmpty({id,number:1,roomCode:'GUARD1',result:Empty.absenceRecord({id,phase:'qualifier',number:1,roster:groups[0].players,deadline}),expectedPlayers:groups[0].players.length}),/iniciada/);
    }else if(mode==='final-empty'){
      for(const g of groups)await play(g,'qualifier','FEMPTY'+g.number);
      await tick();const row=(await bracket.rows(id)).find(r=>r.stage==='final');assert(row);
      // Move persisted final deadline into the past to simulate time passing.
      bracket.reload();bracket.local[id].find(r=>r.stage==='final').waitDeadlineAt=deadline;bracket.save();
      await tick();await tick();const summary=await bracket.summary(id,first);assert.equal(summary.endedWithoutChampion,true);assert.equal(summary.champion,null);assert.equal((await archive.list()).length,0);
      assert.equal((await bracket.claim(id,'final',1,'NOJOIN')).roomCode,null,'mesa encerrada sem código não pode ser reclamada');
    }
    assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(locks.size,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
// Exercita o contrato transacional da escrita sem room_code com um pool
// controlado. Não substitui a execução em PostgreSQL real.
async function sqlContract(){
  const rows={stage:null,game:null};let before=null;let failGame=true;const commands=[];
  const pool={connect:async()=>({query:pool.query,release(){}}),query:async(sql,args=[])=>{
    const q=sql.trim();commands.push(q);
    if(q==='BEGIN'){before=structuredClone(rows);return {rowCount:0,rows:[]};}
    if(q==='ROLLBACK'){Object.assign(rows,before);return {rowCount:0,rows:[]};}
    if(q==='COMMIT')return {rowCount:0,rows:[]};
    if(q.startsWith('INSERT INTO mm_tournament_stage_tables')){
      assert.equal(args[4],null);if(rows.stage)return {rowCount:0,rows:[]};
      rows.stage={players:JSON.parse(args[3]),roomCode:null,result:JSON.parse(args[5])};return {rowCount:1,rows:[{result:rows.stage.result}]};
    }
    if(q.startsWith('SELECT players_json AS players'))return {rowCount:rows.stage?1:0,rows:rows.stage?[rows.stage]:[]};
    if(q.startsWith('INSERT INTO mm_tournament_table_games')){
      assert.match(q,/VALUES\(\$1,\$2,NULL,/);if(failGame)throw new Error('DB_SIMULATED');
      if(!rows.game)rows.game={roomCode:null,result:JSON.parse(args[2]),roomState:'lobby'};return {rowCount:1,rows:[]};
    }
    if(q.startsWith('SELECT room_code AS'))return {rowCount:rows.game?1:0,rows:rows.game?[rows.game]:[]};
    throw new Error('Consulta inesperada '+q);
  }};
  const bracket=new TournamentBracket({pool,databaseUrl:''}),games=new TournamentGames({pool,databaseUrl:''});
  const args={bracket,games,id:'cup',phase:'qualifier',number:1,roomCode:null,record,roster};
  await assert.rejects(recordTournamentResult(args),/DB_SIMULATED/);assert.equal(rows.stage,null);assert.equal(rows.game,null);assert(commands.includes('ROLLBACK'));
  failGame=false;await recordTournamentResult(args);assert(rows.stage.result.noShow&&rows.game.result.noShow);assert(commands.includes('COMMIT'));
  await recordTournamentResult(args);assert(rows.stage.result.results.every(p=>p.forfeited&&!p.won));
}
(async()=>{
  await sqlContract();
  for(const [n,mode] of [[12,'mixed'],[6,'none'],[6,'single'],[2,'live'],[2,'repair'],[2,'guard'],[6,'final-empty']])await scenario(n,mode);
  console.log('✓ V40.69.8.61: mesas sem presentes, sala não criada, lobby vazio, proteção de snapshot/partida iniciada, avanço, campeão único e torneio sem campeão.');
})().catch(e=>{console.error(e);process.exitCode=1;});

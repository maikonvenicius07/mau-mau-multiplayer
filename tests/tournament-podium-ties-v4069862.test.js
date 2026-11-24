'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {TournamentPodiumArchive,podiumFromChampion}=require('../tournament-podium-archive');
const {TournamentDraw,distribute}=require('../tournament-draw');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const {TournamentStore}=require('../tournament-store');
const {TournamentCatalog}=require('../tournament-catalog');
const {recordTournamentResult}=require('../tournament-result-commit');
const {tournamentMatchRecord}=require('../tournament-forfeit');
const names=['Ana','Beto','Caio','Dora'];
function result(players,scores){
  const rows=players.map((p,i)=>({...p,score:scores[i]}));
  return tournamentMatchRecord({tournament:{rosterKeys:players.map(p=>p.playerKey)}},{matchId:'match-'+players[0].playerKey,results:rows});
}
const players=names.map((name,i)=>({name,playerKey:'private-'+i}));
function champion(scores){const {results}=result(players,scores);return {names:results.filter(p=>p.won),standings:results};}
for(const [scores,positions] of [
  [[10,20,30,40],[1,2,3]],[[10,10,10,10],[1,1,1,1]],
  [[10,20,30,30],[1,2,3,3]],[[10,10,20,20],[1,1,2,2]],
  [[10,20,20,20],[1,2,2,2]],[[10,10,10,20],[1,1,1]],
  [[10,10,20,30],[1,1,2]],[[10,20,20,30],[1,2,2]]
]){
  const c=champion(scores),before=JSON.stringify(c),p=podiumFromChampion(c);
  assert.deepEqual(p.map(x=>x.position),positions);assert.equal(JSON.stringify(c),before);
  assert(!JSON.stringify(p).includes('private-'));
}
assert.equal(podiumFromChampion({byAbsence:true,names:[{name:'Ana'}],standings:[{name:'Ana',position:1,score:0}]}).length,1);
assert.throws(()=>podiumFromChampion({...champion([10,10,10,10]),names:[{name:'Não consta'}]}),/Campeao ausente/);
assert.throws(()=>podiumFromChampion({names:[{name:'Ana'}],standings:[]}),/incompleto/);
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const cleanupCode=source.slice(source.indexOf('let tournamentPodiumCleanupRunning=false;'),source.indexOf('const tournamentPodiumCleanupTimer='));
assert(cleanupCode.includes('async function cleanupCompletedTournamentData'));
async function localScenario(scores,{legacy=false,conflict=false,failSave=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-podium62-')),file=n=>path.join(dir,n+'.json'),id='cup-tie';
 try{
  const draw=new TournamentDraw({databaseUrl:'',filePath:file('draw'),signupsFilePath:file('signups')}),games=new TournamentGames({databaseUrl:'',filePath:file('games')}),bracket=new TournamentBracket({databaseUrl:'',filePath:file('bracket'),draw}),archive=new TournamentPodiumArchive({databaseUrl:'',filePath:file('podium')}),catalog=new TournamentCatalog({databaseUrl:'',filePath:file('catalog'),signupsFilePath:file('signups')}),store=new TournamentStore({databaseUrl:'',filePath:file('signups')});
  for(const x of [draw,games,bracket,archive,catalog,store])await x.init();
  const name='Copa Empate';catalog.local=[{id,name,status:'closed'},{id:'other-cup',name:'Outra',status:'open'}];catalog.save();
  const initial=distribute(Array.from({length:8},(_,i)=>({playerKey:'private-'+i,name:'Jogador '+i})),()=>0);
  draw.local[id]=initial;draw.local['other-cup']=initial;draw.save();
  store.local=initial.flatMap(t=>t.players.map(p=>({...p,tournamentId:id}))).concat({tournamentId:'other-cup',playerKey:'other'});fs.writeFileSync(store.filePath,JSON.stringify(store.local));
  for(const t of initial){const code='QUAL0'+t.number;await games.claim(id,t.number,code);await recordTournamentResult({bracket,games,id,phase:'qualifier',number:t.number,roomCode:code,roster:t.players,record:result(t.players,[1,2,3,4])});}
  await bracket.advance(id,initial);const final=(await bracket.rows(id)).find(t=>t.stage==='final');assert.equal(final.players.length,4);
  await bracket.claim(id,'final',1,'FINAL1');await recordTournamentResult({bracket,games,id,phase:'final',number:1,roomCode:'FINAL1',roster:final.players,record:result(final.players,scores)});
  const {champion:official}=await bracket.summary(id,initial);assert(official);
  const expected=podiumFromChampion(official);
  if(legacy){const old=expected.slice(0,3);if(conflict)old[0]={...old[0],score:999};archive.local=[{id,name,standings:old,finishedAt:'2026-11-24T10:00:00Z',cleanedAt:null}];archive.save();}
  else{await archive.record({id,name,champion:official});await archive.record({id,name,champion:official});}
  const tombstones=[],errors=[],rooms=new Map();let writes=0;
  const originalRecord=archive.record.bind(archive);archive.record=async args=>{writes++;if(failSave)throw Error('Falha simulada de gravação');return originalRecord(args);};
  const ctx={snapshotsRestored:true,ensureTournamentPodiumReady:async()=>true,tournamentPodiumArchive:archive,tournamentCatalog:catalog,tournamentDraw:draw,tournamentBracket:bracket,tournamentGames:games,tournamentStore:store,rooms,ensureSpectators:r=>r.spectators||[],removeRoomDurably:async()=>{throw Error('não deve remover sala ocupada');},roomSnapshotStore:{markRoomDeleted:async code=>{tombstones.push(code);}},completedTournamentIds:new Set([id]),tournamentSeatNoticeAt:new Map([[id+':final:1',1],['other-cup:final:1',2]]),console:{info(){},error(...a){errors.push(a);}}};
  vm.runInNewContext(cleanupCode,ctx);const tick=()=>vm.runInNewContext('cleanupCompletedTournamentData()',ctx);
  rooms.set('FINAL1',{code:'FINAL1',tournament:{id},status:'finished',rankingRecorded:true,players:[{connected:true}],spectators:[]});
  await tick();assert.equal(writes,0);assert.equal(tombstones.length,0);assert.equal(errors.length,0);
  rooms.get('FINAL1').players=[];rooms.get('FINAL1').spectators=[{connected:true}];await tick();assert.equal(writes,0);
  rooms.clear();await tick();
  if(conflict||failSave){assert.equal(errors.length,1);assert.equal(tombstones.length,0);assert((await bracket.rows(id)).length);assert(await catalog.get(id));assert.deepEqual(await archive.pending(),[id]);return;}
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(writes,1);assert(tombstones.includes('FINAL1'));assert.equal((await bracket.rows(id)).length,0);assert.deepEqual(await draw.get(id),[]);assert.equal(await games.get(id,1),null);assert.equal(await catalog.get(id),null);assert(await catalog.get('other-cup'));assert((await draw.get('other-cup')).length);store.reloadLocal();assert.deepEqual(store.local.map(p=>p.tournamentId),['other-cup']);assert.deepEqual(await archive.pending(),[]);
  const restarted=new TournamentPodiumArchive({databaseUrl:'',filePath:file('podium')});await restarted.init();const saved=await restarted.list();assert.equal(saved.length,1);assert.deepEqual(saved[0].champion.standings,expected);assert.equal(saved[0].champion.names.length,official.names.length);assert(!JSON.stringify(saved).includes('private-'));
  await tick();assert.equal(writes,1);assert.equal(ctx.tournamentSeatNoticeAt.get('other-cup:final:1'),2);
  // Confirmar a UI real, sem criar regras novas de apresentação.
  const ui=fs.readFileSync(path.join(__dirname,'../public/tournament-ui.js'),'utf8');
  class Node{constructor(tag){this.tag=tag;this.children=[];this.label='';}append(...a){this.children.push(...a);}set textContent(v){this.label=String(v);this.children=[];}get textContent(){return this.label+this.children.map(c=>c.textContent).join('');}}
  const start=ui.indexOf('  // V40.69.8.15 — Resultado completo'),end=ui.indexOf("  const champions=document.getElementById('tournamentResultsInfo');",start);
  const view={document:{createElement:tag=>new Node(tag)}};vm.runInNewContext(ui.slice(start,end)+'\nthis.show=renderTournamentRankingResults;',view);
  const target=new Node('div');view.show(target,saved[0]);const all=(n,tag)=>[n,...n.children.flatMap(c=>all(c,tag))].filter(c=>c.tag===tag);
  assert.equal(all(target,'tbody')[0].children.length,expected.length);if(official.names.length>1)assert(target.textContent.includes('Campeões:'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
// Contrato SQL controlado: INSERT idempotente, extensão apenas de arquivo
// pendente e exatamente correspondente, e bloqueio de alteração concorrente.
async function sqlScenario(){
 const c=champion([10,10,10,10]),expected=podiumFromChampion(c),id='cup-pg',name='Copa SQL';let row=null,blockUpdate=false,updates=0;
 const pool={query:async(q,args)=>{
  if(q.startsWith('INSERT INTO mm_tournament_podium')){if(!row)row={name:args[1],standings:JSON.parse(args[2]),cleanedAt:null};return {rowCount:1,rows:[]};}
  if(q.startsWith('SELECT tournament_name AS name'))return {rowCount:row?1:0,rows:row?[structuredClone(row)]:[]};
  if(q.startsWith('UPDATE mm_tournament_podium SET standings_json')){updates++;assert.match(q,/cleaned_at IS NULL/);assert.equal(args[3],name);if(!blockUpdate&&!row.cleanedAt&&JSON.stringify(row.standings)===JSON.stringify(JSON.parse(args[2])))row.standings=JSON.parse(args[1]);return {rowCount:1,rows:[]};}
  throw Error('SQL não previsto: '+q);
 }};
 const archive=new TournamentPodiumArchive({pool,databaseUrl:''});await archive.record({id,name,champion:c});await archive.record({id,name,champion:c});assert.deepEqual(row.standings,expected);assert.equal(updates,0);
 row.standings=expected.slice(0,3);await archive.record({id,name,champion:c});assert.deepEqual(row.standings,expected);assert.equal(updates,1);
 row.standings=expected.slice(0,3);row.cleanedAt='2026-11-24';await assert.rejects(archive.record({id,name,champion:c}),/diverge/);assert.equal(updates,1);
 row.cleanedAt=null;blockUpdate=true;await assert.rejects(archive.record({id,name,champion:c}),/diverge/);assert.equal(row.standings.length,3);
}
(async()=>{
 await sqlScenario();
 await localScenario([10,10,10,10]);await localScenario([10,20,30,40]);
 await localScenario([10,20,30,30],{legacy:true});await localScenario([10,20,30,30],{legacy:true,conflict:true});await localScenario([10,10,10,10],{failSave:true});
 console.log('✓ V40.69.8.62: pódio com empates, final real simulada, limpeza, legado, UI, falhas e contrato SQL.');
})().catch(e=>{console.error(e);process.exitCode=1;});

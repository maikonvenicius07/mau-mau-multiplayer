'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {summarize,tableStatus}=require('../public/tournament-dashboard');
const {TournamentBracket}=require('../tournament-bracket');
const {distribute}=require('../tournament-draw');
assert.equal(tableStatus({finished:true},{liveStatus:'playing'}),'finished');
assert.equal(tableStatus({}, {liveStatus:'playing'}),'playing');
assert.equal(tableStatus({}, {liveStatus:'between-rounds'}),'playing');
assert.equal(tableStatus({}, {liveStatus:'lobby'}),'lobby');
assert.equal(tableStatus({created:true}, {}),'created');
assert.equal(tableStatus({}, {}),'waiting');
const initial=[1,2,3,4].map(number=>({number,players:[{name:'Ana'},{name:'Beto'}]}));
const halfway=summarize({
 bracket:{stages:[{stage:'qualifier',tables:[{number:1,players:initial[0].players,created:true,finished:true,result:{results:[{name:'Ana',position:1,score:30},{name:'Beto',position:2,score:60}]}}]}]},
 currentStage:'qualifier',currentTables:initial,games:{2:{liveStatus:'playing',created:true},3:{liveStatus:'lobby',created:true}}
});
assert.equal(halfway[0].total,4,'a exibição não pode esconder mesas ainda sem resultado');
assert.equal(halfway[0].finished,1);assert.equal(halfway[0].active,1);
assert.deepEqual(halfway[0].tables.map(t=>t.status),['finished','playing','lobby','waiting']);
async function test(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v516-'));
 try{
   const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(folder,'bracket.json')});await bracket.init();
   const id='v516-cup';
   // Deliberate duplicate display names; the account key, not the name, must decide who advances.
   const initial=distribute(Array.from({length:8},(_,i)=>({playerKey:'user'+i,name:i===0||i===5?'Mesmo nome':'Pessoa '+i})));
   for(const t of initial){
     await bracket.recordResult({id,stage:'qualifier',number:t.number,roomCode:'R'+t.number,
       players:t.players,result:{results:t.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:5+i*10,position:i+1,won:i===0}))}});
   }
   await bracket.advance(id,initial);
   const summary=await bracket.summary(id,initial);
   assert.equal(summary.currentStage,'final');
   const publicJson=JSON.stringify(summary);
   assert(!publicJson.includes('playerKey'));assert(!publicJson.includes('user0'));
   const qualifiers=summary.stages.find(x=>x.stage==='qualifier');
   assert.equal(qualifiers.tables.length,2);
   assert.equal(qualifiers.tables.flatMap(t=>t.result.results).filter(p=>p.advanced===true).length,4);
   assert.equal(qualifiers.tables.flatMap(t=>t.result.results).filter(p=>p.advanced===false).length,4);
   const display=summarize({bracket:summary,currentStage:'final',currentTables:summary.stages.at(-1).tables,games:{1:{liveStatus:'lobby',connectedPlayers:2,expectedPlayers:4}}});
   assert.equal(display.length,2);assert.equal(display[0].finished,2);
   assert.equal(display[1].tables[0].status,'lobby');
   assert.equal(display[1].tables[0].connectedPlayers,2);
   // No next phase: do not incorrectly call anyone eliminated.
   assert(display[1].tables[0].result===null);
   const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
   assert(server.includes('liveTableStatus.set(n,'),'server must publish sanitized live state');
   assert(!server.slice(server.indexOf('liveTableStatus.set(n,'),server.indexOf('liveTableStatus.set(n,')+270).includes('playerKey'));
   const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
   assert(html.includes('id="tournamentOverview"'));
   assert(html.includes('tournament-dashboard.js?v=51.6'));
   console.log('✓ V51.6: estados das mesas, mesas pendentes, classificados/eliminados por conta, painel e privacidade.');
 } finally {fs.rmSync(folder,{force:true,recursive:true});}
}
test().catch(e=>{console.error(e);process.exitCode=1});

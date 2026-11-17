'use strict';
// Regressao operacional dos torneios: consulta HTTP, readiness e classificatoria parcial.
// Nao toca em banco de dados real nem altera jogos existentes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {TournamentBracket}=require('../tournament-bracket');
const {distribute}=require('../tournament-draw');
const TournamentTableHealth=require('../tournament-table-health');
const {createRetryableInitialization}=require('../ranking-init-retry');
const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

async function testApiConsultation(){
  const begin=src.indexOf("app.get('/api/tournament', async(req,res)=>{");
  const end=src.indexOf("app.post('/api/tournament/registration',",begin);
  assert(begin>=0&&end>begin,'Rota /api/tournament deve estar presente');
  let handler;
  const app={get:(route,cb)=>{assert.equal(route,'/api/tournament');handler=cb;}};
  const tables=[{number:1,players:[{name:'Ana',seat:1},{name:'Bruno',seat:2}]}];
  let bracketPhase='qualifier',missingFinalBinding=null,retainedSnapshot=false;
  const sandbox={app,console,TournamentTableHealth,snapshotsRestored:true,roomSnapshotStore:{hasStoredSnapshot:async()=>retainedSnapshot,isRoomDeleted:()=>false},
    ensureTournamentCatalogReady:async()=>true,
    ensureTournamentDrawReady:async()=>true,
    ensureTournamentBracketReady:async()=>true,
    authFromCookieHeaderVerified:async()=>({playerKey:'ana'}),
    tournamentIsAdmin:()=>false,
    tournamentCatalog:{list:async()=>[{id:'tor-abc'}],get:async()=>({id:'tor-abc',name:'Copa Teste',status:'closed',capacity:2,canManage:true})},
    tournamentStore:{get:async({config})=>({tournament:{...config,enrolled:2,spotsRemaining:0,registered:true},players:[{name:'Ana'},{name:'Bruno'}]})},
    tournamentDraw:{get:async()=>tables,seatFor:async()=>({number:1})},
    tournamentBracket:{summary:async()=>{
      await Promise.resolve();
      return {currentStage:bracketPhase,champion:null,stages:bracketPhase==='qualifier'?[]:[{stage:'final',tables:[{number:1,players:tables[0].players,created:true,finished:false}]}]};
    },seatFor:async()=>({number:1}),getBinding:async()=>missingFinalBinding},
    tournamentGames:{statuses:async()=>{await Promise.resolve();return {1:{created:true,finished:false}};}},
    rooms:new Map(),ensureSpectators:()=>[],MAX_SPECTATORS_PER_ROOM:5};
  vm.runInNewContext(src.slice(begin,end),sandbox,{filename:'server.js:api/tournament'});
  async function call(){const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({headers:{cookie:'fake'},query:{id:'tor-abc'}},res);return res;}
  let res=await call();
  assert.equal(res.code,200,'consulta HTTP nao deve falhar com uma Promise de chaveamento');
  assert.equal(res.body?.ok,true);assert.equal(res.body?.bracket?.currentStage,'qualifier');
  assert.equal(res.body.games['1'].created,true,'o status assincrono de jogos deve ser aguardado');
  assert.equal(res.body.myTable,1);assert(!JSON.stringify(res.body).includes('playerKey'));
  bracketPhase='final';res=await call();assert.equal(res.code,200);
  assert.equal(res.body.bracket.currentStage,'final');assert.equal(res.body.tables.length,1);
  missingFinalBinding={roomCode:'OLD999',roomState:'started',result:null,claimedAt:1};
  res=await call();assert.equal(res.code,200);
  assert.equal(res.body.games['1'].availability,'recovery-required');
  assert.equal(res.body.games['1'].repairAllowed,true,'Organizador recebe recuperação somente sem snapshot');
  retainedSnapshot=true;res=await call();assert.equal(res.code,200);
  assert.equal(res.body.games['1'].availability,'snapshot-review');
  assert.equal(res.body.games['1'].repairAllowed,false,'Estado persistido nunca pode ser reiniciado por engano');
}
async function testPartialQualifiers(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-tournament-hotfix-'));
  try{
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'bracket.json')});await bracket.init();
    for(const size of [6,9,20,100]){
      const id=`cup-partial-${size}`;
      const participants=Array.from({length:size},(_,i)=>({playerKey:`k${i}`,name:`Jogador ${i}`}));
      const initial=distribute(participants);assert(initial.length>1);
      const first=initial[0];
      const result={matchId:`m-${size}`,results:first.players.map((p,index)=>({playerKey:p.playerKey,name:p.name,score:index*10,position:index+1,won:index===0}))};
      await bracket.recordResult({id,stage:'qualifier',number:first.number,roomCode:`R${size}`,result,players:first.players});
      const status=await bracket.summary(id,initial);
      assert.equal(status.champion,null,`nao ha campeao depois de apenas uma mesa (${size} jogadores)`);
      assert.equal(status.currentStage,'qualifier');
      await bracket.advance(id,initial);
      const after=await bracket.summary(id,initial);
      assert.equal(after.currentStage,'qualifier','nao avanca a fase sem terminar todas as mesas');
    }
    const id='cup-single';const initial=distribute(Array.from({length:3},(_,i)=>({playerKey:`p${i}`,name:`P ${i}`})));
    await bracket.recordResult({id,stage:'qualifier',number:1,roomCode:'SINGLE',players:initial[0].players,
      result:{matchId:id,results:initial[0].players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))}});
    assert((await bracket.summary(id,initial)).champion,'campeao de torneio com mesa unica permanece');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
async function testRetryAfterTransientOutage(){
  let now=0,attempts=0;
  const {ensureReady}=createRetryableInitialization({initialize:async()=>{attempts++;if(attempts===1)throw new Error('PostgreSQL dormindo');},cooldownMs:5000,clock:()=>now});
  assert.equal(await ensureReady(),false);
  assert.equal(await ensureReady(),false);assert.equal(attempts,1,'cooldown impede tempestade');
  now=5000;assert.equal(await ensureReady(),true);assert.equal(attempts,2);
  assert.equal(await ensureReady(),true);assert.equal(attempts,2);
  assert(src.includes('void ensureTournamentBracketReady()'));
}
(async()=>{
  await testApiConsultation();await testPartialQualifiers();await testRetryAfterTransientOutage();
  console.log('✓ Hotfix torneios: consulta HTTP 200, status de jogos, fase parcial sem campeão, mesa única e recuperação de inicialização.');
})().catch(e=>{console.error(e);process.exitCode=1});

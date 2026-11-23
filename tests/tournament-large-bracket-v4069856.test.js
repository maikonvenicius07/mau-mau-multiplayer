'use strict';
// Regressão: V40.69.8.56 — torneios de 65 a 100 inscritos com fase adicional
// e mesma quota de dois classificados por mesa das fases anteriores.
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {TournamentBracket,STAGES,nextStage}=require('../tournament-bracket');
const {distribute}=require('../tournament-draw');
const {assertExistingStageDraw}=require('../tournament-next-stage-draw');
const {canHandoffObserver}=require('../tournament-observer-handoff');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
assert.deepEqual(STAGES,['qualifier','quarter','extra','semi','final']);
assert.deepEqual(nextStage('quarter',Array(4).fill(null)),{phase:'semi',quota:2});
assert.deepEqual(nextStage('quarter',Array(5).fill(null)),{phase:'extra',quota:2});
assert.deepEqual(nextStage('extra',Array(3).fill(null)),{phase:'semi',quota:2});
assert(server.includes("'qualifier','quarter','extra','semi','final'].includes(stage)"));
assert(app.includes("'qualifier','quarter','extra','semi','final'].includes(data.stage)"));
assert(ui.includes("extra:'Fase adicional'"));
assert.equal(canHandoffObserver({role:'SPECTATOR',automatic:true,watchTournamentId:'cup1',tournamentId:'cup1',watchStage:'quarter',stage:'extra'}),true);
assert.equal(canHandoffObserver({role:'SPECTATOR',automatic:true,watchTournamentId:'cup1',tournamentId:'cup1',watchStage:'extra',stage:'quarter'}),false);

// Banco de produção: a instalação antiga deve receber CHECK que aceita a
// nova fase, sem apagar registros existentes; a migração é repetível.
(async()=>{
 const sql=[];const pool={query:async statement=>{sql.push(String(statement));return {rows:[],rowCount:0};}};
 const dummy=new TournamentBracket({pool});await dummy.init();await dummy.init();
 assert(sql.some(q=>q.includes('DROP CONSTRAINT IF EXISTS mm_tournament_stage_tables_stage_check')));
 assert(sql.some(q=>q.includes('mm_tournament_stage_allowed')&&q.includes("'extra'")));
 assert(sql.some(q=>q.includes("WHEN 'extra' THEN 2"))===false,'queries de ordenação só são emitidas com rows()');
 await dummy.rows('cup1');
 assert(sql.some(q=>q.includes("WHEN 'extra' THEN 2")));
 for(const total of [64,65,66,70,75,80,81,90,95,99,100]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-large-v56-'));
  try{
   const id='cup-large-'+total;
   const engine=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'bracket.json')});await engine.init();
   const initial=distribute(Array.from({length:total},(_,i)=>({playerKey:'k'+i,name:'Jogador '+i})),()=>0);
   const expectedStages=total<=64?['qualifier','quarter','semi','final']:['qualifier','quarter','extra','semi','final'];
   for(const phase of expectedStages){
    const tables=phase==='qualifier'?initial:(await engine.rows(id)).filter(r=>r.stage===phase);
    assert(tables.length>0,`fase ${phase} ausente (${total})`);
    for(const table of tables){
     assert(table.players.length>=2&&table.players.length<=4,`mesa inválida (${total},${phase})`);
     const code=`T${phase[0]}${table.number}`;
     if(phase!=='qualifier')await engine.claim(id,phase,table.number,code);
     const results=table.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:10+i,position:i+1,won:i===0}));
     await engine.recordResult({id,stage:phase,number:table.number,roomCode:code,players:table.players,
       result:{matchId:`${id}:${phase}:${table.number}`,results}});
    }
    const before=await engine.rows(id);
    await engine.advance(id,initial);
    const after=await engine.rows(id);
    if(phase!=='final'){
     const move=nextStage(phase,tables);
     const generated=after.filter(r=>r.stage===move.phase);
     assert(generated.length>0,`sem avanço (${total},${phase})`);
     assertExistingStageDraw(before.filter(r=>r.stage===phase),move.quota,generated);
     // Não repetir sorteio nem modificar os participantes das mesas.
     await engine.advance(id,initial);
     assert.deepEqual(await engine.rows(id),after,`fase foi sorteada novamente (${total},${phase})`);
    }else{
     assert.equal(tables.length,1,`mais de uma final (${total})`);
     assert.equal(tables[0].players.length,4);
     const result=await engine.summary(id,initial);
     assert(result.champion&&result.champion.standings.length===4,`sem pódio (${total})`);
     assert.equal(result.currentStage,'final');
     assert(!JSON.stringify(result).includes('playerKey'),'identidades privadas expostas');
    }
   }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
 console.log('✓ V40.69.8.56: 64–100 inscritos, até 4 jogadores/mesa, cotas preservadas, final única, migração PG e observador.');
})().catch(e=>{console.error(e);process.exitCode=1});

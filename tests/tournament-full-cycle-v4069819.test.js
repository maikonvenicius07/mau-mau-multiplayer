'use strict';
// V40.69.8.19 - simulacao deterministica de torneio completo com modulos reais.
// Nao substitui testes de rede, Browser/Socket.IO e PostgreSQL em producao.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TournamentStore}=require('../tournament-store');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentDraw}=require('../tournament-draw');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const {recordTournamentResult}=require('../tournament-result-commit');

async function fullCycle(size){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),`mm-cycle-${size}-`));
  try{
    const opts={databaseUrl:'',filePath:path.join(dir,'tournaments.json'),signupsFilePath:path.join(dir,'tournament-signups.json')};
    const cat=new TournamentCatalog(opts);
    const store=new TournamentStore({databaseUrl:'',filePath:opts.signupsFilePath});
    const draw=new TournamentDraw({databaseUrl:'',filePath:path.join(dir,'tournament-draws.json'),signupsFilePath:opts.signupsFilePath});
    const games=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'tournament-games.json')});
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'tournament-bracket.json'),draw});
    await cat.init();await store.init();await draw.init();await games.init();await bracket.init();
    const event=await cat.create({data:{name:`Copa com ${size} inscritos`,capacity:size,startAt:null},actor:'dono'});
    const opened=await cat.update({id:event.id,data:{status:'open'}});
    for(let i=0;i<size;i++)await store.change({action:'join',playerKey:`key-${i}`,name:`Jogador ${i}`,config:opened});
    assert.equal((await store.get({config:opened})).tournament.enrolled,size);
    await cat.update({id:event.id,data:{status:'closed'}});
    const first=await draw.draw(event.id);
    assert.equal(first.reduce((n,t)=>n+t.players.length,0),size);
    assert.equal(new Set((await draw.seatAssignments(event.id)).map(p=>p.playerKey)).size,size);
    await assert.rejects(draw.draw(event.id),/sortead/i);
    assert.equal((await bracket.summary(event.id,first)).champion,null);
    const seen=new Map();
    for(let iteration=0;iteration<4;iteration++){
      const stageSummary=await bracket.summary(event.id,first);
      const stage=stageSummary.currentStage;
      const initial=stage==='qualifier';
      const tables=initial?first:(await bracket.rows(event.id)).filter(t=>t.stage===stage);
      assert(tables.length>0,`mesas disponiveis na fase ${stage}`);
      for(const t of tables){
        const code=`T${iteration}${t.number}`;
        // O sorteio exposto no painel e publico, sem playerKey. A consulta
        // privada da vaga representa a identidade autenticada no servidor.
        const assigned=initial?(await draw.seatAssignments(event.id)).find(p=>p.tableNumber===t.number):null;
        const roster=initial?(await draw.seatFor(event.id,t.number,assigned.playerKey)).players:t.players;
        if(initial){await games.claim(event.id,t.number,code);await games.markStarted(event.id,t.number,code);}
        else{await bracket.claim(event.id,stage,t.number,code);await bracket.markStarted(event.id,stage,t.number,code);}
        // Em uma das mesas maiores, desistencia nao concede classificacao a quem sai.
        const forfeit=initial&&roster.length>=3&&t.number===1;
        const record={matchId:`${event.id}-${stage}-${t.number}`,results:roster.map((p,i)=>({
          playerKey:p.playerKey,name:p.name,score:forfeit&&i===roster.length-1?0:i*13,
          position:i+1,won:i===0,forfeited:forfeit&&i===roster.length-1
        }))};
        await recordTournamentResult({bracket,games,id:event.id,phase:stage,number:t.number,roomCode:code,record,roster});
        // Repetir a gravacao deve ser idempotente e nao pode gerar nova fase.
        await recordTournamentResult({bracket,games,id:event.id,phase:stage,number:t.number,roomCode:code,record,roster});
        assert.equal((await bracket.getBinding(event.id,stage,t.number)).result.results.length,roster.length);
        if(initial)assert.equal((await games.statuses(event.id,[t.number]))[t.number].finished,true);
      }
      seen.set(stage,tables.length);
      await bracket.advance(event.id,first);
      const next=await bracket.summary(event.id,first);
      if(next.champion){
        assert.equal(next.champion.names.length,1,'campeao unico');
        assert(next.champion.standings.length>=2,'classificacao completa da decisao');
        assert.equal(next.stages.filter(s=>s.stage==='qualifier')[0].tables.length,first.length);
        assert(!next.stages.some(s=>s.tables.some(t=>t.result?.results.some(r=>Object.hasOwn(r,'playerKey')))),
          'API publica nao expõe identificadores privados');
        assert(seen.has('qualifier'));
        return {size,phases:[...seen.keys()],champion:next.champion.names[0].name};
      }
      assert.notEqual(next.currentStage,stage,'proxima etapa aparece apos concluir todas as mesas');
    }
    throw new Error(`Torneio de ${size} participantes nao concluiu apos quatro fases`);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{
  const results=[];
  for(const n of [2,6,20,50,64])results.push(await fullCycle(n));
  console.log('✓ V40.69.8.19: ciclo completo local de inscricao ate campeao com 2, 6, 20, 50 e 64 jogadores.');
  for(const r of results)console.log(`  ${r.size} inscritos: ${r.phases.join(' → ')} → ${r.champion}`);
})().catch(e=>{console.error(e);process.exitCode=1;});

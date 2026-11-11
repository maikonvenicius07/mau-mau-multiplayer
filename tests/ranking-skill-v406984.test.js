'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RankingStore}=require('../ranking-store');
const {initialState,updateGlicko2,skillSettings,calculateSkillHistory,skillLeaderboardView}=require('../ranking-skill');
const current=Date.parse('2026-11-10T18:00:00Z');
const timestamp=(day,hour=12)=>`2026-11-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00Z`;
function match(id,position,mode='official',day=10,seasonId=1){
  const smallest=Math.min(...position.map(([,p])=>p));
  return {matchId:id,roomCode:'ABC123',mode,seasonId,rounds:5,startedAt:timestamp(day,10),finishedAt:timestamp(day),
    results:position.map(([playerKey,p])=>({playerKey,name:playerKey,avatar:'macaco',position:p,score:p*10,won:p===smallest}))};
}
(async()=>{
  // Valor de referência do documento Glicko-2 de Mark Glickman, 3 confrontos.
  const reference=updateGlicko2({rating:1500,rd:200,volatility:0.06},[
    {rating:1400,rd:30,score:1},{rating:1550,rd:100,score:0},{rating:1700,rd:300,score:0}
  ]);
  assert(Math.abs(reference.rating-1464.06)<0.15);
  assert(Math.abs(reference.rd-151.52)<0.15);
  assert(Math.abs(reference.volatility-0.059996)<0.0001);
  assert.deepEqual(initialState(),{rating:1500,rd:350,volatility:0.06,totalGames:0,totalWins:0});
  // Duelo e partida de 4 jogadores: uma observação por participante, não 3 partidas.
  const duel=calculateSkillHistory([match('duel',[['A',1],['B',2]])],{now:current});
  const four=calculateSkillHistory([match('four',[['A',1],['B',2],['C',3],['D',4]])],{now:current});
  assert.equal(duel.players.get('A').totalGames,1);
  assert.equal(four.players.get('A').totalGames,1);
  assert(four.players.get('A').rating>1500);
  assert(duel.players.get('A').rating>1500);
  // A mesa maior não gera automaticamente três vezes a atualização do vencedor.
  assert(Math.abs(four.players.get('A').rating-1500)<2*Math.abs(duel.players.get('A').rating-1500));
  const sameReversed=calculateSkillHistory([match('four', [['D',4],['C',3],['B',2],['A',1]])],{now:current});
  assert(Math.abs(four.players.get('A').rating-sameReversed.players.get('A').rating)<1e-9);
  // Empate mantém mesmo rating, RD diminui porque houve informação estatística.
  const tie=calculateSkillHistory([match('tie',[['A',1],['B',1]])],{now:current});
  assert(Math.abs(tie.players.get('A').rating-1500)<1e-8);
  assert(tie.players.get('A').rd<350);
  // Idêntico matchId não soma novamente, mas revancha com outro ID é válida.
  const repeated=calculateSkillHistory([
    match('first',[['A',1],['B',2]]),match('first',[['A',1],['B',2]]),match('second',[['A',1],['B',2]])
  ],{now:current});
  assert.equal(repeated.players.get('A').totalGames,2);
  assert.equal(repeated.skippedMatches,1);
  // Registros incompletos ou posições inválidas não recebem rating fictício.
  const broken=calculateSkillHistory([
    match('single',[['A',1]]),match('invalid',[['A',0],['B',1]]),match('duplicated-account',[['A',1],['A',2]])
  ],{now:current});
  assert.equal(broken.ratedMatches,0);assert.equal(broken.skippedMatches,3);
  // Provisório: uma única vitória não garante a liderança, mesmo rating alto.
  const settings={period:'month',minimumGames:10,maxRD:200,seasonId:1,periodStart:'2026-11-01T04:00:00Z'};
  const few=skillLeaderboardView(four,settings);
  assert(few.every(r=>r.provisional&&r.rank===null));
  assert.equal(few[0].gamesNeeded,9);
  const many=[];
  for(let i=0;i<30;i++)many.push(match(`m${i}`,[['A',i%3?1:2],['B',i%3?2:1]],'official',10));
  const batch=calculateSkillHistory(many,{now:current});
  const ranks=skillLeaderboardView(batch,settings);
  assert(ranks.some(r=>!r.provisional&&r.rank===1));
  assert(ranks.every(r=>r.totalGames===30&&r.games===30));
  assert.equal(skillSettings('month',{}).minimumGames,10);
  assert.equal(skillSettings('month',{RANK_SKILL_MAX_RD:'140',RANK_SKILL_TAU:'0.7'}).maxRD,140);
  assert.equal(skillSettings('month',{RANK_SKILL_MAX_RD:'not-a-number'}).maxRD,200);
  assert.equal(skillSettings('month',{RANK_SKILL_START_AT:'2026-11-10T00:00:00-04:00'}).ratingStartAt,'2026-11-10T04:00:00.000Z');
  assert.equal(skillSettings('month',{RANK_SKILL_START_AT:'2026-11-10'}).ratingStartAt,null);

  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mm-skill-'));
  try{
    const file=path.join(temp,'ranking.json');
    let store=new RankingStore({databaseUrl:null,filePath:file});await store.init();
    await store.recordMatch(match('one',[['Ana',1],['Beto',2]]));
    await store.recordMatch(match('two',[['Ana',1],['Beto',2]]));
    await store.recordMatch(match('train',[['Beto',1],['Ana',2]],'training'));
    await store.recordMatch(match('incomplete',[['Solo',1]]));
    assert.equal(await store.recordMatch(match('one',[['Ana',1],['Beto',2]])),false);
    const baseline=await store.getLeaderboard({period:'month',mode:'official',now:current});
    const perf=await store.getPerformanceLeaderboard({period:'month',mode:'official',now:current});
    let skill=await store.getSkillLeaderboard({period:'month',mode:'official',now:current});
    assert.equal(skill.length,2,'partida incompleta não recebe habilidade');
    assert.equal(skill.find(r=>r.playerKey==='Ana').totalGames,2);
    assert(skill.find(r=>r.playerKey==='Ana').rating>1500);
    const training=await store.getSkillLeaderboard({period:'month',mode:'training',now:current});
    assert.equal(training.find(r=>r.playerKey==='Ana').totalGames,1,'TREINO separado');
    assert(training.find(r=>r.playerKey==='Ana').rating<1500);
    assert.equal((await store.getSkillPlayerStats({playerKey:'Ana',period:'month',mode:'official',now:current})).totalGames,2);
    assert.deepEqual(await store.getLeaderboard({period:'month',mode:'official',now:current}),baseline);
    assert.deepEqual(await store.getPerformanceLeaderboard({period:'month',mode:'official',now:current}),perf);
    // Reinício não reseta rating; nenhuma tabela nova ou escrita extra.
    store=new RankingStore({databaseUrl:null,filePath:file});await store.init();
    assert.deepEqual(await store.getSkillLeaderboard({period:'month',mode:'official',now:current}),skill);
    const before=fs.readFileSync(file,'utf8');
    await store.getSkillLeaderboard({period:'month',mode:'official',now:current});
    assert.equal(fs.readFileSync(file,'utf8'),before);
    // Filtragem por período NÃO zera rating global. Evolução no período é separada.
    await store.recordMatch(match('older',[['Ana',2],['Beto',1]],'official',9));
    skill=await store.getSkillLeaderboard({period:'day',mode:'official',now:current});
    assert.equal(skill.find(r=>r.playerKey==='Ana').games,2);
    assert.equal(skill.find(r=>r.playerKey==='Ana').totalGames,3);
    assert.equal((await store.getSkillLeaderboard({period:'history',mode:'official',now:current})).find(r=>r.playerKey==='Ana').games,3);

    // PostgreSQL simulado: consulta lê resultados, respeita modalidade e agrupa por partida.
    const calls=[];
    const mockedPool={query:async(sql,params)=>{
      calls.push({sql,params});return {rows:[
        {matchId:'pg1',seasonId:1,finishedAt:timestamp(10),playerKey:'Ana',name:'Ana',avatar:'macaco',position:1,won:true},
        {matchId:'pg1',seasonId:1,finishedAt:timestamp(10),playerKey:'Beto',name:'Beto',avatar:'macaco',position:2,won:false}
      ]};
    }};
    const pg=new RankingStore({pool:mockedPool});
    const pgRows=await pg.getSkillLeaderboard({period:'month',mode:'official',now:current});
    assert.equal(pgRows.length,2);
    assert.equal(calls[0].params[0],'official');
    assert.match(calls[0].sql,/JOIN mm_match_results/);
    assert.match(calls[0].sql,/ORDER BY m.finished_at ASC,m.match_id ASC/);
    assert.equal(calls[0].params[2],200001);
    assert.equal(calls[0].params[3],null);

    const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
    assert(source.includes("category==='skill'?await rankingStore.getSkillLeaderboard"));
    assert(source.includes('getSkillPlayerStats'));
    const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
    assert(html.includes('data-rank-category="wins"'));
    assert(html.includes('data-rank-category="performance"'));
    assert(html.includes('data-rank-category="skill"'),'aba de habilidade disponível na V40.69.8.5');
    console.log('✓ V40.69.8.4: Glicko-2 de referência, mesas multiplayer, empates, períodos, deduplicação, persistência, perfis e API.');
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});

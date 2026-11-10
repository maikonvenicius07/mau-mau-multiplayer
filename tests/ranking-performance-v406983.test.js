'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {RankingStore}=require('../ranking-store');
const {performanceSettings,aggregatePerformanceMatches,rankPerformanceRows}=require('../ranking-performance');
const root=path.join(__dirname,'..');
const base={roomCode:'T123',mode:'official',rounds:5,startedAt:'2026-11-10T13:00:00Z',finishedAt:'2026-11-10T13:30:00Z'};
function match(id,results,mode='official'){
  return {...base,mode,matchId:id,results:results.map(([key,won])=>({playerKey:key,name:key,avatar:'macaco',won,score:won?10:90,position:won?1:2}))};
}
(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mm-performance-'));
  try{
    const store=new RankingStore({databaseUrl:null,filePath:path.join(tmp,'ranking.json')});
    await store.init();
    // Maria tem 20 partidas em mesas de 4, Carlos 200 em mesas de 2, João 50 em mesas de 4.
    for(let i=0;i<200;i++){
      await store.recordMatch(match(`c-${i}`,[['Carlos',i<60],[`c-other-${i}`,i>=60]]));
    }
    for(let i=0;i<50;i++){
      await store.recordMatch(match(`j-${i}`,[['Joao',i<30],['j-a',i>=30],['j-b',false],['j-c',false]]));
    }
    for(let i=0;i<20;i++){
      await store.recordMatch(match(`m-${i}`,[['Maria',i<15],['m-a',i>=15],['m-b',false],['m-c',false]]));
    }
    await store.recordMatch(match('only-win',[['Lucky',true],['unlucky',false]]));
    await store.recordMatch(match('training-only',[['Lucky',true],['CPU',false]],'training'));
    const now=Date.parse('2026-11-10T16:00:00Z');
    const wins=await store.getLeaderboard({period:'month',mode:'official',now});
    assert.equal(wins[0].playerKey,'Carlos','ranking histórico de vitórias continua igual');
    const ranked=await store.backend._performanceRows({period:'month',mode:'official',now});
    assert.equal(ranked.find(r=>r.playerKey==='Maria').games,20);
    const maria=ranked.find(r=>r.playerKey==='Maria');
    const joao=ranked.find(r=>r.playerKey==='Joao');
    const carlos=ranked.find(r=>r.playerKey==='Carlos');
    const lucky=ranked.find(r=>r.playerKey==='Lucky');
    assert.equal(maria.wins,15); assert.equal(maria.winRate,75);
    assert.equal(maria.adjustedRate,58.33,'redução da amostra para expectativa de 25%');
    assert.equal(maria.performanceIndex,72.22,'índice normaliza dificuldade das mesas');
    assert(maria.rank<joao.rank && joao.rank<carlos.rank,'aproveitamento superior leva a classificação superior');
    assert.equal(lucky.provisional,true);
    assert.equal(lucky.rank,null,'uma partida vitoriosa não pode obter primeiro lugar oficial');
    assert(ranked.indexOf(lucky)>ranked.indexOf(carlos),'provisórios depois dos classificados');
    assert.equal(lucky.gamesNeeded,9);
    const one=await store.getPerformancePlayerStats({playerKey:'Lucky',period:'month',mode:'official',now});
    assert.deepEqual(one,lucky,'perfil do provisório não pode depender do top 50');
    const training=await store.getPerformanceLeaderboard({period:'month',mode:'training',now});
    assert.equal(training.find(r=>r.playerKey==='Carlos'),undefined,'treino nunca mistura com oficial');
    assert.equal(training.find(r=>r.playerKey==='Lucky').games,1);
    const unchanged=await store.getLeaderboard({period:'month',mode:'official',now});
    assert.deepEqual(unchanged,wins,'cálculo não grava nem modifica vitórias');
    assert.deepEqual(await store.getPerformanceLeaderboard({period:'history',now}),[]);
    const day=await store.getPerformancePlayerStats({playerKey:'Lucky',period:'day',mode:'official',now});
    assert.equal(day.gamesNeeded,2);
    // Empate: cada vencedor recebe apenas uma fração do crédito, sem duplicar jogos.
    const tie=aggregatePerformanceMatches([match('tie',[['A',true],['B',true],['C',false]])]);
    assert.equal(tie.find(x=>x.playerKey==='A').winCredits,.5);
    assert.equal(tie.find(x=>x.playerKey==='B').expectedWins,1/3);
    const tieRank=rankPerformanceRows(tie,{priorGames:10,minimumGames:1});
    assert.equal(tieRank.find(x=>x.playerKey==='A').rank,tieRank.find(x=>x.playerKey==='B').rank);
    // Uma partida histórica com um único participante persistido nunca gera divisão por zero.
    const incomplete=rankPerformanceRows(aggregatePerformanceMatches([match('legacy',[['solo',true]])]),{priorGames:10,minimumGames:1});
    assert.equal(incomplete[0].uncertainGames,1);
    assert.equal(incomplete[0].expectedRate,50);
    // Com a mesma taxa relativa, a mesa mais difícil não pode ser penalizada.
    const two=rankPerformanceRows([{playerKey:'a',name:'a',games:20,wins:10,winCredits:10,expectedWins:10}],{priorGames:10,minimumGames:10})[0];
    const four=rankPerformanceRows([{playerKey:'b',name:'b',games:20,wins:10,winCredits:10,expectedWins:5}],{priorGames:10,minimumGames:10})[0];
    assert(four.performanceIndex>two.performanceIndex,'duplas e mesas com quatro têm dificuldade diferente');
    assert.equal(performanceSettings('month',{RANK_MIN_MONTH:'12',RANK_PERFORMANCE_PRIOR_GAMES:'15'}).minimumGames,12);
    assert.equal(performanceSettings('month',{RANK_MIN_MONTH:'-1',RANK_PERFORMANCE_PRIOR_GAMES:'abc'}).minimumGames,10);
    assert.equal(performanceSettings('season',{}).minimumGames,20);

    // PostgreSQL simulado: conferir SQL parametrizado e cálculo idêntico ao JSON.
    const sqlCalls=[];
    const mockedPool={query:async(sql,params)=>{sqlCalls.push({sql,params});return {rows:[
      {playerKey:'A',name:'A',avatar:'macaco',games:20,wins:15,winCredits:15,expectedWins:5,uncertainGames:0},
      {playerKey:'B',name:'B',avatar:'macaco',games:20,wins:10,winCredits:10,expectedWins:10,uncertainGames:0}
    ]};}};
    const dbStore=new RankingStore({pool:mockedPool});
    const dbRows=await dbStore.getPerformanceLeaderboard({period:'month',mode:'official',now});
    assert.equal(dbRows[0].playerKey,'A'); assert.equal(dbRows[0].adjustedRate,58.33);
    assert.match(sqlCalls[0].sql,/COUNT\(DISTINCT r.player_key\)/);
    assert.match(sqlCalls[0].sql,/COUNT\(\*\) FILTER\(WHERE r.won\)/);
    assert.equal(sqlCalls[0].params[0],'official');
    assert.equal(sqlCalls[0].params[2],1);
    assert.equal(await dbStore.getPerformancePlayerStats({playerKey:'A',period:'month',mode:'official',now}).then(x=>x.rank),1);

    // API & UI preservam ranking antigo como seleção padrão e a identidade do perfil.
    const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
    const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
    const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
    assert(html.includes('data-rank-category="wins"'));
    assert(html.includes('data-rank-category="performance"'));
    assert(html.includes('<th>Vitórias</th>'),'modo antigo permanece');
    assert(app.includes("rankingCategory='wins'"),'modo padrão preserva vitórias');
    assert(app.includes('rankingRequestId'),'filtros antigos não podem sobrescrever novos');
    assert(server.includes('rankingStore.getPerformanceLeaderboard'));
    assert(server.includes('rankingStore.getPerformancePlayerStats'));
    console.log('✓ V40.69.8.3: índices, limiares, empates, 2/4 jogadores, PostgreSQL, JSON, isolamento e UI validados.');
  } finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});

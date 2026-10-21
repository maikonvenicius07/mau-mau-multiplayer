'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RankingStore}=require('../ranking-store');

(async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'mm-wins-period-'));
  try {
    const store=new RankingStore({databaseUrl:null,filePath:path.join(folder,'ranking.json')});
    await store.init();
    let number=0;
    const insert=async(when,won,mode='official')=>{
      number++;
      await store.recordMatch({matchId:`mwins-${number}`,roomCode:'WIN510',mode,rounds:5,
        startedAt:when,finishedAt:when,results:[
          {playerKey:'player-a',name:'Pessoa A',avatar:'macaco',position:won?1:2,score:won?20:90,won},
          {playerKey:'player-b',name:'Pessoa B',avatar:'homem',position:won?2:1,score:won?90:20,won:!won}
        ]});
    };
    // Cinco vitórias na semana, mais cinco no mês e mais dez na temporada.
    for(let i=0;i<5;i++)await insert(`2026-10-20T${String(10+i).padStart(2,'0')}:00:00Z`,true);
    for(let i=0;i<5;i++)await insert(`2026-10-10T${String(10+i).padStart(2,'0')}:00:00Z`,true);
    for(let i=0;i<10;i++)await insert(`2026-09-15T${String(10+i).padStart(2,'0')}:00:00Z`,true);
    for(let i=0;i<3;i++)await insert(`2026-10-20T${String(20+i).padStart(2,'0')}:00:00Z`,false);
    await insert('2026-10-20T08:00:00Z',true,'training');
    const now=Date.parse('2026-10-21T16:00:00Z');
    const load=period=>store.getDetailedPlayerStats({playerKey:'player-a',period,mode:'official',now});
    const week=await load('week'), month=await load('month'), season=await load('season');
    assert.deepEqual([week.wins,month.wins,season.wins],[5,10,20]);
    assert.deepEqual([week.recentMatches.length,month.recentMatches.length,season.recentMatches.length],[5,10,20]);
    assert.deepEqual([week.games,month.games,season.games],[8,13,23]);
    assert.deepEqual([week.nonWins,month.nonWins,season.nonWins],[3,3,3]);
    assert(season.recentMatches.every(r=>r.won),'historico deve conter somente vitorias');
    assert(season.recentMatches.every((r,i,a)=>!i || new Date(a[i-1].finishedAt)>=new Date(r.finishedAt)),
      'ordem deve ser das vitorias mais recentes para as antigas');
    const training=await store.getDetailedPlayerStats({playerKey:'player-a',period:'week',mode:'training',now});
    assert.deepEqual([training.games,training.wins,training.recentMatches.length],[1,1,1]);
    const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
    const client=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
    const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
    const backend=fs.readFileSync(path.join(__dirname,'..','ranking-store.js'),'utf8');
    assert(html.includes('🏆 Vitórias no período'));
    assert(client.includes('Nenhuma vitória registrada neste período e modalidade.'));
    assert(!server.includes('getDetailedPlayerStats({playerKey,period,mode,limit:10})'));
    assert(backend.includes('AND r.won=TRUE'),'PostgreSQL deve filtrar somente vitórias');
    assert(!backend.includes('LIMIT $5`'),'PostgreSQL não deve limitar o histórico a 10');
    console.log('✓ V51.0.3: 5 vitórias semana, 10 mês e 20 temporada; derrotas permanecem nos indicadores; modalidade isolada.');
  }finally{
    fs.rmSync(folder,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exit(1)});

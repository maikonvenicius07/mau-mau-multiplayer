'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {RankingStore}=require('../ranking-store');
const {calculateSkillHistory}=require('../ranking-skill');
const {rankAwards,windows}=require('../ranking-awards');
const now=Date.parse('2026-11-12T15:00:00Z');
const match=(id,time,keys=['A','B'],mode='official')=>({matchId:id,mode,seasonId:1,finishedAt:time,results:keys.map((key,i)=>({playerKey:key,name:key,avatar:'macaco',position:i+1,won:i===0,score:i*10}))});
(async()=>{
  // Corte pelo fuso de Rondônia: no UTC anterior a 04:00 continua dia anterior.
  assert.equal(windows(Date.parse('2026-11-01T03:50:00Z')).month.label,'10/2026');
  assert.equal(windows(Date.parse('2026-11-01T04:00:00Z')).month.label,'11/2026');
  const matches=[];
  for(let i=0;i<33;i++)matches.push(match('nov-'+i,`2026-11-${String(2+i%8).padStart(2,'0')}T12:00:00Z`));
  const snap=calculateSkillHistory(matches,{now});
  const awards=rankAwards(snap,{now});
  assert.equal(awards.length,5);
  assert.equal(awards.find(a=>a.title.includes('Rei do Mês')).winner.playerKey,'A');
  assert.equal(awards.find(a=>a.title.includes('Rei do Ano')).winner.playerKey,'A');
  assert.equal(awards.find(a=>a.title.includes('Mais Vitorioso')).winner.wins,33);
  assert(awards.every(a=>a.winner===null||a.winner.games>=a.minimumGames));
  const few=rankAwards(calculateSkillHistory(matches.slice(0,2),{now}),{now});
  assert(few.every(a=>a.winner===null),'amostra insuficiente nunca rende título');
  const crossed=calculateSkillHistory([
    match('oct','2026-11-01T03:59:00Z'),
    match('nov','2026-11-01T04:00:00Z'),
    match('future','2026-11-13T12:00:00Z')
  ],{now});
  assert.equal(rankAwards(crossed,{now})[0].winner,null);
  assert.equal([...crossed.events.get('A')].length,2,'futuro ignorado');
  // Store JSON: títulos oficiais independem do treino; as leituras não gravam.
  const os=require('node:os');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mm-awards-'));
  try{
    const file=path.join(temp,'ranking.json');
    const store=new RankingStore({databaseUrl:null,filePath:file});await store.init();
    for(const m of matches)await store.recordMatch(m);
    for(let i=0;i<38;i++)await store.recordMatch(match('train-'+i,'2026-11-05T12:00:00Z',['C','D'],'training'));
    const before=fs.readFileSync(file,'utf8');
    const fromStore=await store.getSkillAwards({now});
    assert.equal(fromStore[0].winner.playerKey,'A','treino excluído dos títulos');
    assert.deepEqual(fromStore,awards);
    assert.equal(fs.readFileSync(file,'utf8'),before,'consulta de títulos somente leitura');
    const wins=await store.getLeaderboard({period:'month',mode:'official',now});
    assert.equal(wins.find(x=>x.playerKey==='A').wins,33);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  assert(html.includes('data-rank-category="skill"'));
  assert(html.includes('id="rankingAwards"'));
  assert(app.includes("category==='skill'") && app.includes('loadRankingAwards(requestId)'));
  assert(app.includes("period==='history'&&!skill"),'histórico da habilidade não é ocultado');
  assert(server.includes("app.get('/api/ranking/awards'"));
  assert(server.includes('getSkillAwards()'));
  console.log('✓ V40.69.8.5: títulos por mês/ano, fuso RO, provisórios, treino isolado, UI e histórico preservados.');
})().catch(e=>{console.error(e);process.exitCode=1;});

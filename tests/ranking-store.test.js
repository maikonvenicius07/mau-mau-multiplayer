'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {RankingStore,periodStart}=require('../ranking-store');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-ranking-'));
  const store=new RankingStore({databaseUrl:null,filePath:path.join(dir,'rank.json')});
  await store.init();
  const now=Date.parse('2026-08-24T16:00:00Z'); // meio-dia em RO
  assert.strictEqual(periodStart('day',now),'2026-08-24T04:00:00.000Z');
  const base={roomCode:'ABC123',mode:'human',rounds:5,startedAt:'2026-08-24T12:00:00Z'};
  await store.recordMatch({...base,matchId:'m1',finishedAt:'2026-08-24T13:00:00Z',results:[
    {playerKey:'p1',name:'Ana',avatar:'mulher',score:20,position:1,won:true},
    {playerKey:'p2',name:'Paulo',avatar:'jacare',score:40,position:2,won:false},
  ]});
  await store.recordMatch({...base,matchId:'m2',finishedAt:'2026-08-24T15:00:00Z',results:[
    {playerKey:'p1',name:'Ana',avatar:'mulher',score:35,position:2,won:false},
    {playerKey:'p2',name:'Paulo',avatar:'jacare',score:25,position:1,won:true},
  ]});
  await store.recordMatch({...base,matchId:'old',finishedAt:'2026-07-20T15:00:00Z',results:[
    {playerKey:'p1',name:'Ana',avatar:'mulher',score:10,position:1,won:true},
  ]});
  const day=await store.getLeaderboard({period:'day',mode:'human',now});
  assert.strictEqual(day.length,2);
  assert.strictEqual(day[0].wins,1);
  assert.strictEqual(day[0].name,'Ana'); // empate em vitórias: menor média vence
  const month=await store.getLeaderboard({period:'month',mode:'human',now});
  assert.strictEqual(month[0].games,2);
  const all=await store.getLeaderboard({period:'all',mode:'human',now});
  assert.strictEqual(all.find(x=>x.playerKey==='p1').games,3);
  const prof=await store.getPlayerStats({playerKey:'p2',period:'day',mode:'human',now});
  assert.strictEqual(prof.wins,1);
  console.log('✓ ranking-store V24');
})().catch(e=>{console.error(e);process.exit(1)});

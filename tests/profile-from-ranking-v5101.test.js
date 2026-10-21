'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {RankingStore}=require('../ranking-store');
(async()=>{
  const root=path.join(__dirname,'..');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-profile-others-'));
  try {
    const store=new RankingStore({databaseUrl:null,filePath:path.join(dir,'rank.json')});
    await store.init();
    const match={roomCode:'ABC123',rounds:5,startedAt:'2026-10-20T10:00:00Z',finishedAt:'2026-10-20T10:30:00Z',matchId:'game-v5101',mode:'official',results:[
      {playerKey:'alice',name:'Alice',avatar:'macaco',position:2,score:25,won:false},
      {playerKey:'bruno',name:'Bruno',avatar:'homem',position:1,score:8,won:true}
    ]};
    await store.recordMatch(match);
    const r=await store.getDetailedPlayerStats({playerKey:'bruno',mode:'official',period:'season'});
    assert.equal(r.name,'Bruno');
    assert.deepEqual([r.games,r.wins,r.nonWins,r.winRate,r.averagePosition,r.averageScore],[1,1,0,100,1,8]);
    assert.deepEqual([r.recentMatches.length,r.recentMatches[0].score],[1,8]);
    const other=await store.getDetailedPlayerStats({playerKey:'alice',mode:'official',period:'season'});
    assert.deepEqual([other.games,other.wins,other.averagePosition],[1,0,2]);
    assert.equal((await store.getDetailedPlayerStats({playerKey:'bruno',mode:'training',period:'season'})).games,0);
    const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
    const client=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
    const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
    const block=server.slice(server.indexOf("app.get('/api/players/stats'"),server.indexOf("app.get('/api/profile'"));
    assert(block.includes('authFromCookieHeaderVerified(req.headers.cookie)'));
    assert(block.includes("String(req.query.playerKey||'').trim()"));
    assert(block.includes('getDetailedPlayerStats({playerKey,period,mode,limit:10})'));
    assert(block.includes("'Cache-Control','private, no-store'"));
    assert(client.includes('data-rank-player-index'));
    assert(client.includes('rankingPlayerRows[index]'));
    assert(client.includes('openProfileStatsForPlayer(player.playerKey)'));
    assert(client.includes('profileStatsTargetKey=null'));
    assert(client.includes('profileStatsReturnToRanking'));
    assert(client.includes('statsEndpoint=profileStatsTargetKey'));
    assert(client.includes('/api/me/stats?period='));
    assert(html.includes('Toque no nome de um jogador'));
    assert(!client.includes('Jogadas Rápidas válidas'),'não adicionar contadores descartados');
    console.log('✓ V51.0.1: leitura de perfis, histórico, filtros, autorização e acesso via ranking aprovados.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});

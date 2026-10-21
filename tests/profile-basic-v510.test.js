'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {RankingStore}=require('../ranking-store');
(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-profile-v510-'));
  try{
    const store=new RankingStore({databaseUrl:null,filePath:path.join(tmp,'ranking.json')});
    await store.init();
    const base={roomCode:'ABC123',seasonId:1,rounds:5,startedAt:'2026-10-01T12:00:00Z'};
    const now=Date.parse('2026-10-21T13:00:00Z');
    let zero=await store.getDetailedPlayerStats({playerKey:'p1',mode:'official',period:'season',now});
    assert.deepEqual([zero.games,zero.wins,zero.nonWins,zero.winRate],[0,0,0,0]);
    assert.strictEqual(zero.averagePosition,null);
    assert.strictEqual(zero.averageScore,null);
    assert.deepEqual(zero.recentMatches,[]);
    async function add(id,mode,finishedAt,p1,p2){
      await store.recordMatch({...base,matchId:id,mode,finishedAt,results:[
        {playerKey:'p1',name:'Pessoa 1',avatar:'macaco',...p1},
        {playerKey:'p2',name:'Pessoa 2',avatar:'homem',...p2},
      ]});
    }
    await add('m1','official','2026-10-20T20:00:00Z', {score:10,position:1,won:true},{score:30,position:2,won:false});
    await add('m2','official','2026-10-21T10:00:00Z',{score:30,position:2,won:false},{score:8,position:1,won:true});
    await add('m3','training','2026-10-21T11:00:00Z',{score:5,position:1,won:true},{score:15,position:2,won:false});
    // Idempotência de registro preservada.
    assert.equal(await store.recordMatch({...base,mode:'official',matchId:'m2',finishedAt:'2026-10-21T10:00:00Z',results:[]}),false);
    const stats=await store.getDetailedPlayerStats({playerKey:'p1',period:'season',mode:'official',now});
    assert.deepEqual([stats.games,stats.wins,stats.nonWins,stats.winRate],[2,1,1,50]);
    assert.equal(stats.averagePosition,1.5);
    assert.equal(stats.averageScore,20);
    assert.deepEqual(stats.recentMatches.map(x=>x.score),[10]);
    assert.equal(stats.rank,1); // empate em vitórias não divide posição artificialmente.
    const day=await store.getDetailedPlayerStats({playerKey:'p1',period:'day',mode:'official',now});
    assert.deepEqual([day.games,day.wins,day.averageScore],[1,0,30]);
    const training=await store.getDetailedPlayerStats({playerKey:'p1',period:'season',mode:'training',now});
    assert.deepEqual([training.games,training.wins,training.averageScore],[1,1,5]);
    const empty=await store.getDetailedPlayerStats({playerKey:'none',period:'day',mode:'official',now});
    assert.equal(empty.games,0);
    const historical=await store.getDetailedPlayerStats({playerKey:'p1',period:'history'});
    assert.strictEqual(historical,null);
    const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
    const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
    const client=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
    const route=server.slice(server.indexOf("app.get('/api/me/stats'"),server.indexOf("app.get('/api/profile'"));
    assert(route.includes('authFromCookieHeaderVerified(req.headers.cookie)'),'endpoint deve validar cookie autenticado');
    assert(route.includes('playerKey:session.playerKey'),'nunca usar playerKey arbitrário enviado pelo navegador');
    for(const id of ['profileStatsOpenRanking','profileStatsDialog','profileStatsGrid','profileStatsRecent','profileStatsClose'])
      assert(html.includes(`id="${id}"`),`faltou ${id}`);
    assert(client.includes('/api/me/stats?period='),'cliente deve consultar a própria conta');
    assert(!html.includes('Jogadas Rápidas válidas'),'não colocar contadores rejeitados');
    console.log('✓ V51.0 Perfil Básico: agregação, filtros, histórico, partidas antigas, privacidade e UI aprovados.');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});

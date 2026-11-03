'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {RankingStore,periodStart,buildMatchRecord,RANKING_GENERATION}=require('../ranking-store');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maumau-ranking-v408-'));
  const filePath=path.join(dir,'rank.json');

  // Simula o ranking antigo: na primeira inicialização da V40.8 ele deve ser descartado uma única vez.
  fs.writeFileSync(filePath,JSON.stringify({version:1,matches:[{matchId:'antigo',mode:'human',finishedAt:'2026-09-07T12:00:00Z',results:[]}]}));
  const store=new RankingStore({databaseUrl:null,filePath});
  await store.init();
  const migrated=JSON.parse(fs.readFileSync(filePath,'utf8'));
  assert.equal(migrated.rankingGeneration,RANKING_GENERATION);
  assert.deepEqual(migrated.matches,[],'ranking antigo deve ser descartado ao inaugurar a Temporada 1');

  const now=Date.parse('2026-09-08T16:00:00Z'); // terça-feira, meio-dia em RO
  assert.strictEqual(periodStart('day',now),'2026-09-08T04:00:00.000Z');
  assert.strictEqual(periodStart('week',now),'2026-09-07T04:00:00.000Z'); // segunda-feira em RO
  assert.strictEqual(periodStart('month',now),'2026-09-01T04:00:00.000Z');
  assert.strictEqual(periodStart('season',now),null);

  const base={roomCode:'ABC123',mode:'official',seasonId:1,rounds:5,startedAt:'2026-09-08T12:00:00Z'};
  await store.recordMatch({...base,matchId:'m1',finishedAt:'2026-09-08T13:00:00Z',results:[
    {playerKey:'google-p1',name:'Orlando',avatar:'homem',score:20,position:1,won:true},
    {playerKey:'google-p2',name:'Paulo',avatar:'jacare',score:40,position:2,won:false},
  ]});
  await store.recordMatch({...base,matchId:'m2',finishedAt:'2026-09-08T15:00:00Z',results:[
    {playerKey:'google-p1',name:'CAMPEÃO',avatar:'macaco',score:35,position:2,won:false}, // mesmo Google, outro nome
    {playerKey:'google-p2',name:'Paulo',avatar:'jacare',score:25,position:1,won:true},
  ]});
  await store.recordMatch({...base,matchId:'m3',finishedAt:'2026-09-08T15:30:00Z',results:[
    {playerKey:'google-p1',name:'Rei do Mau-Mau',avatar:'macaco',score:18,position:1,won:true}, // mesmo Google novamente
    {playerKey:'google-p2',name:'Paulo',avatar:'jacare',score:33,position:2,won:false},
  ]});
  await store.recordMatch({...base,mode:'training',matchId:'bot1',finishedAt:'2026-09-08T15:40:00Z',results:[
    {playerKey:'google-p1',name:'Treino',avatar:'macaco',score:12,position:1,won:true},
  ]});

  const official=await store.getLeaderboard({period:'day',mode:'official',now});
  assert.equal(official.length,2);
  const p1=official.find(x=>x.playerKey==='google-p1');
  const p2=official.find(x=>x.playerKey==='google-p2');
  assert.equal(p1.wins,2,'vitórias do mesmo playerKey Google devem ser somadas mesmo mudando o nome');
  assert.equal(p1.name,'Rei do Mau-Mau','ranking deve exibir o nome mais recente sem criar outro jogador');
  assert.equal(p2.wins,1);
  assert.equal(official.filter(x=>x.playerKey==='google-p1').length,1,'mesma Conta Google não pode aparecer duas vezes');

  const training=await store.getLeaderboard({period:'day',mode:'training',now});
  assert.equal(training.length,1);
  assert.equal(training[0].wins,1);

  // Empates em vitórias ocupam a mesma posição.
  await store.recordMatch({...base,matchId:'m4',finishedAt:'2026-09-08T15:50:00Z',results:[
    {playerKey:'google-p2',name:'Paulo',avatar:'jacare',score:15,position:1,won:true},
    {playerKey:'google-p1',name:'Rei do Mau-Mau',avatar:'macaco',score:40,position:2,won:false},
  ]});
  const tied=await store.getLeaderboard({period:'day',mode:'official',now});
  assert.equal(tied[0].wins,2); assert.equal(tied[1].wins,2);
  assert.equal(tied[0].rank,1); assert.equal(tied[1].rank,1,'empate em vitórias deve compartilhar a posição');

  const history=await store.getLeaderboard({period:'history',mode:'official',now});
  assert.deepEqual(history,[],'Histórico deve começar vazio na Temporada 1');

  const prof=await store.getPlayerStats({playerKey:'google-p1',period:'season',mode:'official',now});
  assert.equal(prof.wins,2);

  // Revanche: mesmo código/data da sala, matchSerial diferente = matchId diferente.
  const room={code:'ABC123',createdAt:1000,finishedAt:2000,matchSerial:1,rules:{rounds:5},players:[
    {playerKey:'google-p1',name:'A',avatar:'homem',score:10,isBot:false},
    {playerKey:'google-p2',name:'B',avatar:'mulher',score:20,isBot:false},
  ]};
  const first=buildMatchRecord(room);
  room.matchSerial=2;
  const replay=buildMatchRecord(room);
  assert.notEqual(first.matchId,replay.matchId,'cada Jogar de Novo deve gerar matchId exclusivo');
  assert(first.matchId.endsWith('-1')); assert(replay.matchId.endsWith('-2'));
  assert.equal(first.mode,'official');

  console.log('✓ V40.8: ranking zerado, vitórias apenas, Conta Google única, OFICIAL/TREINO e períodos validados.');
})().catch(e=>{console.error(e);process.exit(1)});

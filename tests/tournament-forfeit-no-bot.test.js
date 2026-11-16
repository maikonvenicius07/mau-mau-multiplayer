'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Engine=require('../game-engine');
const Forfeit=require('../tournament-forfeit');
const {buildMatchRecord}=require('../ranking-store');
const {TournamentBracket}=require('../tournament-bracket');
const {TournamentGames}=require('../tournament-games');
const {distribute}=require('../tournament-draw');
const {buildRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');

function makeTournamentRoom(n){
  const room=Engine.createRoom('FOR123',{name:'P0',avatar:'macaco',playerKey:'key0',token:'token0'});
  for(let i=1;i<n;i++)Engine.addPlayer(room,{name:`P${i}`,avatar:'macaco',playerKey:`key${i}`,token:`token${i}`});
  room.tournament={id:'cup-abandono',phase:'qualifier',tableNumber:1,rosterKeys:room.players.map(p=>p.playerKey),forfeits:[]};
  Engine.startRound(room);
  return room;
}
function result(room){return Forfeit.tournamentMatchRecord(room,buildMatchRecord(room));}
function checks(room,forfeited){
  assert(room.players.every(p=>!p.isBot&&!p.autoControlled),'nenhuma cadeira de torneio vira Máquina ou AUTO');
  assert.equal(room.tournament.forfeits.length,forfeited);
  assert.equal(result(room).results.length,room.tournament.rosterKeys.length,'o roster segue completo no resultado');
  assert.equal(result(room).results.filter(x=>x.forfeited).length,forfeited);
  assert.equal(result(room).results.filter(x=>x.forfeited&&x.won).length,0,'desistente nunca vence');
}
(async()=>{
  // Duas pessoas: desistência define mesa imediatamente sem bot.
  let room=makeTournamentRoom(2);
  room.players[0].score=50;room.players[1].score=0;
  const left=room.players[1];
  assert.equal(Forfeit.forfeitActiveSeat(room,left).finished,true);
  assert.equal(room.players.length,1);assert.equal(room.status,'finished');
  assert.equal(room.players[0].name,'P0');
  checks(room,1);
  const rec=result(room);
  assert.equal(rec.results.find(p=>p.playerKey==='key0').won,true);
  assert.equal(rec.results.find(p=>p.playerKey==='key1').forfeited,true);
  assert.equal(rec.results.find(p=>p.playerKey==='key1').won,false);
  // Se o vencedor também sair APÓS a mesa terminar, o restore não pode
  // transformar essa identidade em Máquina.
  room.players[0].voluntaryLeftAt=Date.now();
  const snapshot=buildRoomSnapshot(room).snapshot;
  const restored=restoreRoomSnapshot(snapshot,{now:Date.now()});
  assert(restored && restored.players[0].isBot===false);
  assert.equal(restored.players[0].playerKey,'key0');
  assert.equal(restored.tournament.forfeits.length,1);

  // Quatro pessoas: quem está na vez pode desistir sem pular outro humano.
  room=makeTournamentRoom(4);
  const now=room.players[room.currentPlayer];
  const direction=room.direction===1?1:-1;
  const expected=room.players[(room.currentPlayer+direction+room.players.length)%room.players.length].id;
  Forfeit.forfeitActiveSeat(room,now);
  assert.equal(room.status,'playing');
  assert.equal(room.players[room.currentPlayer].id,expected);
  checks(room,1);
  Forfeit.forfeitActiveSeat(room,room.players.find(p=>p.playerKey==='key0'));
  assert.equal(room.players.length,2);checks(room,2);
  Forfeit.forfeitActiveSeat(room,room.players[0]);
  assert.equal(room.status,'finished');checks(room,3);

  // Entre rodadas: a próxima rodada é formada só por pessoas remanescentes.
  room=makeTournamentRoom(3);
  room.status='between-rounds';room.currentPlayer=-1;
  Forfeit.forfeitActiveSeat(room,room.players[0]);
  assert.equal(room.players.length,2);checks(room,1);
  Engine.startRound(room);assert.equal(room.round,2);
  assert.equal(room.players.length,2);assert.equal(room.players.filter(p=>p.isBot).length,0);

  // Classificatória com duas mesas: a pessoa desclassificada não avança,
  // mesmo que tenha feito menos pontos que os sobreviventes.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-forfeit-'));
  try{
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'bracket.json')});
    const games=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'games.json')});
    await bracket.init();await games.init();
    const groups=distribute(Array.from({length:6},(_,i)=>({playerKey:`g${i}`,name:`G${i}`})),()=>0);
    for(const table of groups){
      const rows=table.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,
        score:i===table.players.length-1?0:20+i,position:i+1,
        won:i===0,forfeited:i===table.players.length-1}));
      const record={matchId:`m${table.number}`,finishedAt:new Date().toISOString(),results:rows};
      await games.claim('cup-6',table.number,`RM${table.number}`);
      const saved=await games.finish({id:'cup-6',number:table.number,roomCode:`RM${table.number}`,
        result:record,expectedPlayers:table.players.length});
      assert.equal(saved.complete,true);
      assert.equal(saved.results.filter(x=>x.forfeited).length,1);
      await bracket.recordResult({id:'cup-6',stage:'qualifier',number:table.number,roomCode:`RM${table.number}`,
        result:record,players:table.players});
    }
    await bracket.advance('cup-6',groups);
    const rows=await bracket.rows('cup-6');
    const classified=rows.filter(row=>row.stage!=='qualifier').flatMap(row=>row.players.map(p=>p.playerKey));
    const disqualified=groups.flatMap(t=>t.players.slice(-1).map(p=>p.playerKey));
    assert(classified.length>=2);
    assert(disqualified.every(key=>!classified.includes(key)), 'desclassificados não avançam');
    assert.equal((await games.statuses('cup-6',[1]))[1].finished,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}

  const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert(source.includes('if(room.tournament && activeMatch)'), 'saída usa caminho de torneio separado');
  assert(source.includes('TournamentForfeit.forfeitActiveSeat(room,player)'), 'saída chama desistência sem bot');
  assert(source.includes("if(room.tournament)throw new Error('Máquinas nunca podem substituir participantes de torneio.')"));
  assert(source.includes("room.botTimer || room.tournament) return"), 'não agenda jogadas automáticas em torneios');
  assert(source.includes('Você foi desclassificado por desistência e não pode retornar à mesa.'),
    'não permite voltar pelo código enquanto está desclassificado');
  assert(source.includes('não retornou no prazo de reconexão e desistiu do torneio'),
    'queda sem retorno vira desistência, não AUTO');
  console.log('✓ Torneios: saída sem máquina, resultado completo, vitórias por desistência e eliminados fora das próximas fases.');
})().catch(e=>{console.error(e);process.exitCode=1});

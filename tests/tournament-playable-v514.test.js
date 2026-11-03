'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentStore}=require('../tournament-store');
const {TournamentDraw}=require('../tournament-draw');
const {TournamentGames}=require('../tournament-games');
const Engine=require('../game-engine');
const {buildMatchRecord}=require('../ranking-store');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-514-'));
  try{
    const cfg={databaseUrl:'',filePath:path.join(dir,'tournaments.json'),signupsFilePath:path.join(dir,'tournament-signups.json')};
    const catalog=new TournamentCatalog(cfg);
    const store=new TournamentStore({databaseUrl:'',filePath:cfg.signupsFilePath});
    const draw=new TournamentDraw({databaseUrl:'',filePath:path.join(dir,'tournament-draws.json'),signupsFilePath:cfg.signupsFilePath});
    const games=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'tournament-games.json')});
    await store.init();await catalog.init();await draw.init();await games.init();
    const cup=await catalog.create({data:{name:'Copa Teste V51.4',capacity:5,startAt:null},actor:'dono'});
    const open=await catalog.update({id:cup.id,data:{status:'open'}});
    for(let i=0;i<5;i++)await store.change({action:'join',playerKey:'key-'+i,name:'Pessoa '+i,config:open});
    await catalog.update({id:cup.id,data:{status:'closed'}});
    const groups=await draw.draw(cup.id);
    assert.equal(groups.length,1);assert.equal(groups[0].players.length,5);
    assert.equal(await draw.seatFor(cup.id,1,'outsider'),null);
    const seat=await draw.seatFor(cup.id,1,'key-0');
    assert.equal(seat.players.length,5);
    assert(seat.players.every(p=>p.playerKey));
    const room=Engine.createRoom('ABC123',{name:'Pessoa 0',avatar:'macaco',playerKey:'key-0',token:'tok0'});
    room.tournament={id:cup.id,tableNumber:1,rosterKeys:seat.players.map(p=>p.playerKey)};
    for(const p of seat.players.filter(p=>p.playerKey!=='key-0')){
      Engine.addPlayer(room,{name:p.name,avatar:'macaco',playerKey:p.playerKey,token:p.playerKey});
    }
    assert.equal(room.players.length,5);
    const binding=await games.claim(cup.id,1,room.code);assert.equal(binding.roomCode,room.code);
    assert.equal((await games.claim(cup.id,1,'XYZ987')).roomCode,'ABC123');
    Engine.startRound(room);assert.equal(room.round,1);
    // As outras rodadas e a lógica de cartas permanecem pertencendo ao Engine.
    room.players.forEach((p,i)=>p.score=10+i*10);
    room.status='finished';room.finishedAt=Date.now();
    const rec=buildMatchRecord(room);
    assert(rec.results.length===5);
    const result=await games.finish({id:cup.id,number:1,roomCode:room.code,result:rec});
    assert.equal(result.results.length,5);assert.equal(result.results.filter(p=>p.won).length,1);
    const again=await games.finish({id:cup.id,number:1,roomCode:room.code,result:{...rec,results:rec.results.map(p=>({...p,score:999}))}});
    assert.deepEqual(again,result,'o resultado salvo não pode ser sobrescrito');
    const statuses=await games.statuses(cup.id,[1]);assert.equal(statuses[1].finished,true);
    const persisted=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'tournament-games.json')});await persisted.init();
    assert.deepEqual((await persisted.get(cup.id,1)).result,result);
    assert(!JSON.stringify(result).includes('playerKey'));
    assert(!JSON.stringify(result).includes('hand'));
    await catalog.delete({id:cup.id,actor:'dono'});await games.clearLocal(cup.id);
    assert.equal(await games.get(cup.id,1),null);
    const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
    assert(src.includes('if(room.tournament && !room.tournament.rosterKeys.includes(socket.data.auth?.playerKey))'));
    assert(src.includes("socket.on('enterTournamentTable'"));
    assert(src.includes("if(room.tournament)throw new Error('Máquinas não podem ocupar vagas em torneios.')"));
    assert(src.includes('if(room.tournament){\n    room.rankingRecording=true;'));
    assert(src.indexOf('if(room.tournament){\n    room.rankingRecording=true;')<src.indexOf('return rankingStore.recordMatch(record)'));
    console.log('✓ V51.4: roster autenticado, sala única, partida com 5 jogadores, resultado idempotente, sem cartas privadas nem alteração do ranking.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});

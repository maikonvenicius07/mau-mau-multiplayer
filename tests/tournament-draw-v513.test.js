'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentStore}=require('../tournament-store');
const {TournamentDraw,distribute}=require('../tournament-draw');
(async()=>{
 for(let count=2;count<=100;count++){
  const rows=Array.from({length:count},(_,i)=>({playerKey:'p'+i,name:'P '+i}));
  const groups=distribute(rows, n=>n-1);
  assert.equal(groups.flatMap(g=>g.players).length,count);
  assert.equal(new Set(groups.flatMap(g=>g.players.map(x=>x.playerKey))).size,count);
  assert(groups.every(g=>g.players.length>=2&&g.players.length<=5));
  const sizes=groups.map(g=>g.players.length);assert(Math.max(...sizes)-Math.min(...sizes)<=1);
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-v513-'));
 try{
  const catalog=new TournamentCatalog({databaseUrl:'',filePath:path.join(dir,'tournaments.json'),signupsFilePath:path.join(dir,'tournament-signups.json')});
  const store=new TournamentStore({databaseUrl:'',filePath:path.join(dir,'tournament-signups.json')});
  const draw=new TournamentDraw({databaseUrl:'',filePath:path.join(dir,'tournament-draws.json'),signupsFilePath:path.join(dir,'tournament-signups.json')});
  await store.init();await catalog.init();await draw.init();
  const a=await catalog.create({data:{name:'Copa Teste',capacity:20,startAt:null},actor:'organizer'});
  await assert.rejects(draw.draw(a.id),/encerre as inscrições/i);
  const open=await catalog.update({id:a.id,data:{status:'open'}});
  for(let i=0;i<17;i++)await store.change({action:'join',playerKey:'conta-'+i,name:'Jogador '+i,config:open});
  await assert.rejects(draw.draw(a.id),/encerre as inscrições/i);
  const closed=await catalog.update({id:a.id,data:{status:'closed'}});
  assert(!closed.registrationOpen);
  const tables=await draw.draw(a.id);
  assert.deepEqual(tables.map(t=>t.players.length),[5,4,4,4]);
  assert.equal(new Set(tables.flatMap(t=>t.players.map(x=>x.name))).size,17);
  await assert.rejects(draw.draw(a.id),/já foram sorteadas/i);
  await assert.rejects(catalog.update({id:a.id,data:{status:'open'}}),/não é possível reabrir/i);
  const drawAgain=new TournamentDraw({databaseUrl:'',filePath:path.join(dir,'tournament-draws.json'),signupsFilePath:path.join(dir,'tournament-signups.json')});await drawAgain.init();
  assert.deepEqual(await drawAgain.get(a.id),tables);
  const empty=await catalog.create({data:{name:'Copa Vazia',capacity:10,startAt:null},actor:'organizer'});
  await catalog.update({id:empty.id,data:{status:'closed'}});
  await assert.rejects(draw.draw(empty.id),/pelo menos dois/i);
  const raw=JSON.stringify(await drawAgain.get(a.id));assert(!raw.includes('playerKey'));
  console.log('✓ V51.3 sorteio: 2–100 inscritos, mesas equilibradas, persistência, bloqueio de reinscrição e sem chaves privadas.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});

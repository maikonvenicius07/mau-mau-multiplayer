'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentStore}=require('../tournament-store');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-v512-'));
 try{
  const events=new TournamentCatalog({databaseUrl:'',filePath:path.join(dir,'events.json'),signupsFilePath:path.join(dir,'signups.json')});
  const signups=new TournamentStore({databaseUrl:'',filePath:path.join(dir,'signups.json')});
  await events.init();await signups.init();
  const original=(await events.list())[0];assert(original&&original.status==='draft');
  const created=await events.create({data:{name:'Campeonato Teste',capacity:3,startAt:'2026-11-21T19:00:00-04:00'},actor:'admin1'});
  assert.equal(created.status,'draft');assert.equal(created.capacity,3);
  await assert.rejects(signups.change({action:'join',playerKey:'a',name:'Ana',config:created}),/fechadas/i);
  const opened=await events.update({id:created.id,data:{status:'open'}});
  assert(opened.registrationOpen);
  await signups.change({action:'join',playerKey:'a',name:'Ana',config:opened});
  await signups.change({action:'join',playerKey:'b',name:'Bruno',config:opened});
  assert.equal((await signups.get({config:opened})).tournament.enrolled,2);
  const updated=await events.update({id:created.id,data:{name:'Campeonato Oficial',capacity:4}});
  assert.equal(updated.name,'Campeonato Oficial');assert.equal(updated.capacity,4);
  await signups.change({action:'join',playerKey:'c',name:'Carla',config:updated});
  await assert.rejects(events.update({id:created.id,data:{capacity:2}}),/inscritos/i);
  await events.update({id:created.id,data:{status:'closed'}});
  const closed=await events.get(created.id);
  await assert.rejects(signups.change({action:'join',playerKey:'d',name:'Diego',config:closed}),/fechadas/i);
  await events.update({id:created.id,data:{status:'cancelled'}});
  await assert.rejects(events.update({id:created.id,data:{status:'open'}}),/cancelado/i);
  const persisted=new TournamentCatalog({databaseUrl:'',filePath:path.join(dir,'events.json'),signupsFilePath:path.join(dir,'signups.json')});await persisted.init();
  assert.equal((await persisted.get(created.id)).status,'cancelled');
  assert.equal((await persisted.list()).length,2);
  const publicRows=await signups.get({config:closed});assert(!JSON.stringify(publicRows).includes('playerKey'));
  assert.equal((await signups.get({config:original})).tournament.enrolled,0);
  console.log('✓ V51.2 catálogo: criar, editar, abrir/fechar, cancelar, limite de vagas e persistência.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(err=>{console.error(err);process.exitCode=1;});

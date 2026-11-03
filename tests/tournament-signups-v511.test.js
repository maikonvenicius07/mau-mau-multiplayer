'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TournamentStore,tournamentConfig}=require('../tournament-store');

(async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'mau-tourney-'));
  try{
    const config=tournamentConfig({MAUMAU_TOURNAMENT_OPEN:'1',MAUMAU_TOURNAMENT_CAPACITY:'3',MAUMAU_TOURNAMENT_NAME:'Copa Teste',MAUMAU_TOURNAMENT_ID:'teste-2026'});
    assert.equal(config.capacity,3);
    assert.equal(config.registrationOpen,true);
    const store=new TournamentStore({databaseUrl:'',filePath:path.join(folder,'signup.json')});
    await store.init();
    let data=await store.change({action:'join',playerKey:'g1',name:'Ana',config});
    assert.equal(data.tournament.enrolled,1);
    assert.equal(data.tournament.registered,true);
    data=await store.change({action:'join',playerKey:'g1',name:'Ana',config});
    assert.equal(data.tournament.enrolled,1,'repetição não duplica inscrição');
    await store.change({action:'join',playerKey:'g2',name:'Bruno',config});
    await store.change({action:'join',playerKey:'g3',name:'Carla',config});
    await assert.rejects(store.change({action:'join',playerKey:'g4',name:'Diego',config}),/vagas/i);
    let view=await store.get({config,playerKey:'outsider'});
    assert.equal(view.tournament.spotsRemaining,0);
    assert.equal(view.players.length,3);
    assert.equal(JSON.stringify(view).includes('playerKey'),false,'chaves privadas não aparecem na lista pública');
    await store.change({action:'leave',playerKey:'g2',name:'Bruno',config});
    data=await store.change({action:'join',playerKey:'g4',name:'Diego',config});
    assert.equal(data.tournament.enrolled,3);
    const restored=new TournamentStore({databaseUrl:'',filePath:path.join(folder,'signup.json')});
    await restored.init();
    assert.equal((await restored.get({config})).tournament.enrolled,3,'persiste reinício');
    const closed={...config,registrationOpen:false};
    await assert.rejects(restored.change({action:'join',playerKey:'g5',name:'Eva',config:closed}),/fechadas/i);
    await assert.rejects(restored.change({action:'leave',playerKey:'g1',name:'Ana',config:closed}),/fechadas/i);
    const different={...config,id:'nova-edicao'};
    assert.equal((await restored.get({config:different})).tournament.enrolled,0,'edições independentes');
    assert.equal(tournamentConfig({}).registrationOpen,false,'inscrições fechadas por padrão');
    console.log('✓ Torneio V51.1: limites, autenticação lógica, inscrição única, cancelamento e persistência local.');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

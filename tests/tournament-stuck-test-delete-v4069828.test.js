'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const policy=require('../tournament-test-deletion');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-v28-test-cleanup-'));
  try{
    assert(policy.isTestName('Torneio TESTE'));
    assert(!policy.isTestName('Torneio importante'));
    assert(!policy.isTestName('Contestem isso'));
    const catalog=new TournamentCatalog({databaseUrl:'',filePath:path.join(dir,'tournaments.json'),signupsFilePath:path.join(dir,'tournament-signups.json')});
    const games=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'tournament-games.json')});
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'tournament-bracket.json')});
    await catalog.init();await games.init();await bracket.init();
    const create=async(name,owner='dono')=>catalog.create({data:{name,capacity:9,startAt:null},actor:owner});
    const cup=await create('Torneio TESTE');
    await catalog.update({id:cup.id,data:{status:'closed'}});
    await games.claim(cup.id,1,'ABC123');await games.markStarted(cup.id,1,'ABC123');
    bracket.local[cup.id]=[{stage:'final',number:1,roomCode:'FIN001',roomState:'started',result:null,players:[{name:'Ana',playerKey:'x'},{name:'Beto',playerKey:'y'}]}];bracket.save();
    await assert.rejects(catalog.delete({id:cup.id,actor:'dono'}),/partida iniciada/i);
    const override={id:cup.id,actor:'dono',forceTest:true,confirmation:policy.CONFIRMATION};
    await assert.rejects(catalog.delete({...override,actor:'intruso'}),/Somente o criador/i);
    await assert.rejects(catalog.delete({...override,confirmation:'SIM'}),/Confirmação obrigatória/i);
    await catalog.delete(override);
    assert.equal(await catalog.get(cup.id),null);
    await games.clearLocal(cup.id);await bracket.clearLocal(cup.id);
    assert.equal(await games.get(cup.id,1),null);
    assert.equal((await bracket.rows(cup.id)).length,0);
    const real=await create('Copa Candeias');await catalog.update({id:real.id,data:{status:'closed'}});
    await games.claim(real.id,1,'REAL01');await games.markStarted(real.id,1,'REAL01');
    await assert.rejects(catalog.delete({...override,id:real.id}),/exclusiva de torneios/i);
    assert(await catalog.get(real.id));
    const open=await create('Torneio TESTE Aberto');await catalog.update({id:open.id,data:{status:'open'}});
    await assert.rejects(catalog.delete({...override,id:open.id}),/Encerre as inscrições/i);
    assert(await catalog.get(open.id));
    // Simulação PostgreSQL: validação é feita dentro da transação de exclusão.
    const calls=[];const mock={
      async connect(){return {query:async(sql)=>{
        const q=sql.trim();calls.push(q);
        if(q.startsWith('SELECT created_by FROM'))return {rows:[{created_by:'dono'}],rowCount:1};
        if(q.startsWith('SELECT name,status FROM'))return {rows:[{name:'Torneio TESTE',status:'closed'}],rowCount:1};
        if(q.startsWith('SELECT ('))return {rows:[{hasCompetitiveActivity:true}],rowCount:1};
        if(q.startsWith('SELECT pg_advisory'))return {rows:[],rowCount:1};
        if(q.startsWith('DELETE FROM'))return {rows:[],rowCount:1};
        if(['BEGIN','COMMIT','ROLLBACK'].includes(q))return {rows:[],rowCount:0};
        throw new Error('SQL inesperado: '+q.slice(0,100));
      },release(){}};}
    };
    const onPg=new TournamentCatalog({pool:mock,databaseUrl:''});
    await assert.rejects(onPg.delete({id:'cup-test',actor:'dono'}),/partida iniciada/i);
    assert(calls.includes('ROLLBACK'));assert(!calls.includes('COMMIT'));
    calls.length=0;await onPg.delete({id:'cup-test',actor:'dono',forceTest:true,confirmation:policy.CONFIRMATION});
    assert(calls.includes('COMMIT'));
    assert(calls.some(x=>x.startsWith('SELECT name,status FROM')));
    const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
    const ui=fs.readFileSync(path.join(__dirname,'..','public','tournament-ui.js'),'utf8');
    const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
    const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
    assert(server.includes("'/api/tournaments/:id/force-delete-test'"));
    assert(server.includes('if([...rooms.values()].some(room=>room.tournament?.id===id))'));
    assert(server.includes('roomSnapshotStore.markRoomDeleted(code,Date.now())'));
    assert(server.includes("'tournamentSeatRevoked'"));
    assert(html.includes('tournamentAdminForceDeleteTest'));
    assert(ui.includes("config.canManage&&['closed','cancelled'].includes(config.status)"));
    assert(ui.includes("window.prompt('Confirme a exclusão definitiva"));
    assert(ui.includes('/force-delete-test'));
    assert(app.includes("socket.on('tournamentSeatRevoked'"));
    assert(app.includes("autoTournamentBlockedKey=task.key"));
    console.log('✓ V40.69.8.28: limpeza de TESTE travado, confirmações, dono, transação, proteção de torneio real, revogação e anti-spam.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});

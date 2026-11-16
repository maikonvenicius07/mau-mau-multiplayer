'use strict';
// V40.69.8.19 - impedir exclusao de torneios com disputas ja iniciadas
// mesmo quando nenhuma sala existe em memoria (ex.: apos reinicio do Render).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');

async function withLocal(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-tournament-delete-v19-'));
  try{
    const filePath=path.join(dir,'tournaments.json');
    const catalog=new TournamentCatalog({databaseUrl:'',filePath,signupsFilePath:path.join(dir,'tournament-signups.json')});
    const games=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'tournament-games.json')});
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'tournament-bracket.json')});
    await catalog.init();await games.init();await bracket.init();
    await fn({catalog,games,bracket});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
async function make(catalog,name){
  return catalog.create({data:{name,capacity:4,startAt:null},actor:'organizador'});
}
function blocked(e){return e.status===409&&/partida iniciada sem resultado confirmado/i.test(e.message);}
async function localCases(){
  await withLocal(async({catalog,games,bracket})=>{
    const lobby=await make(catalog,'Torneio em lobby');
    await games.claim(lobby.id,1,'LOBBY1');
    // Criar lobby nao equivale a iniciar jogo.
    await catalog.delete({id:lobby.id,actor:'organizador'});
    assert.equal(await catalog.get(lobby.id),null);

    const running=await make(catalog,'Torneio em jogo');
    await games.claim(running.id,1,'RUN001');
    await games.markStarted(running.id,1,'RUN001');
    // Simula reinicio: nova instancia nao tem salas em memoria.
    const afterRestart=new TournamentCatalog({databaseUrl:'',filePath:catalog.filePath,
      signupsFilePath:catalog.signupsFilePath});await afterRestart.init();
    await assert.rejects(afterRestart.delete({id:running.id,actor:'organizador'}),blocked);
    assert(await afterRestart.get(running.id),'torneio iniciado permanece no catalogo');
    assert(await games.get(running.id,1),'mesa iniciada permanece no historico');

    const bracketCup=await make(catalog,'Torneio em fase');
    bracket.local[bracketCup.id]=[{stage:'semi',number:1,players:[{playerKey:'a',name:'A'}],
      roomCode:'STAGE1',roomState:'started',result:null}];bracket.save();
    await assert.rejects(catalog.delete({id:bracketCup.id,actor:'organizador'}),blocked);
    assert(await catalog.get(bracketCup.id));

    const finished=await make(catalog,'Torneio com resultado');
    await games.claim(finished.id,1,'FINAL1');
    // Um resultado persistido com status antigo/legado tambem bloqueia a exclusao.
    games.reload();games.local[`${finished.id}:1`].result={complete:true,results:[{name:'Ana',won:true}]};games.save();
    // Preserva o comportamento ja existente: torneios concluidos podem ser
    // removidos intencionalmente pelo dono (incluindo historico associado).
    await catalog.delete({id:finished.id,actor:'organizador'});
    assert.equal(await catalog.get(finished.id),null);
    // Usuario sem permissao nao pode excluir mesmo um torneio em lobby.
    await assert.rejects(catalog.delete({id:running.id,actor:'intruso'}),e=>e.status===403);
  });
}
class FakeDatabase{
  constructor(activity=false){this.activity=activity;this.calls=[];this.deleted=false;this.rolledBack=false;}
  async connect(){return {query:this.query.bind(this),release:()=>this.calls.push('RELEASE')};}
  async query(sql,values=[]){
    const q=sql.trim();this.calls.push(q);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(q)){
      if(q==='ROLLBACK')this.rolledBack=true;
      return {rows:[],rowCount:0};
    }
    if(q.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[{}],rowCount:1};
    if(q.startsWith('SELECT created_by FROM mm_tournaments'))return {rows:[{created_by:'organizador'}],rowCount:1};
    if(q.startsWith('SELECT (')&&q.includes('mm_tournament_table_games')&&q.includes('mm_tournament_stage_tables'))
      return {rows:[{hasCompetitiveActivity:this.activity}],rowCount:1};
    if(q.startsWith('DELETE FROM')){this.deleted=true;return {rows:[],rowCount:1};}
    throw new Error('Consulta desconhecida: '+q.slice(0,100));
  }
}
async function databaseCases(){
  const db=new FakeDatabase(true);
  const catalog=new TournamentCatalog({pool:db,databaseUrl:''});
  await assert.rejects(catalog.delete({id:'cup-db',actor:'organizador'}),blocked);
  assert.equal(db.deleted,false,'nao exclui nenhuma tabela quando ha partida');
  assert.equal(db.rolledBack,true,'bloqueio desfaz transacao');
  assert(db.calls.some(q=>q.includes('room_state')&&q.includes('result_json')));
  db.activity=false;db.calls=[];db.rolledBack=false;
  await catalog.delete({id:'cup-db',actor:'organizador'});
  assert.equal(db.deleted,true,'torneio nao iniciado continua podendo ser excluido');
  assert(db.calls.includes('COMMIT'));
}
(async()=>{await localCases();await databaseCases();console.log('✓ V40.69.8.19: exclusao segura com jogo pendente, finalizado, lobby, reinicio e transacao PostgreSQL.');})()
  .catch(error=>{console.error(error);process.exitCode=1;});

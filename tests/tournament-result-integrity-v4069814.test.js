'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');
const {recordTournamentResult}=require('../tournament-result-commit');

const id='cup-integrity',roomCode='RES123';
const roster=[{playerKey:'id-a',name:'Ana'},{playerKey:'id-b',name:'Bruno'},{playerKey:'id-c',name:'Clara'}];
const record={matchId:'match-123',finishedAt:'2026-11-16T15:00:00Z',results:roster.map((p,i)=>({...p,score:i*10,position:i+1,won:i===0}))};
const args={id,phase:'qualifier',number:1,roomCode,record,roster};
const clone=x=>structuredClone(x);

class FakePool{
  constructor(){this.stage=null;this.game={roomCode,result:null};this.events=[];this.failGames=false;this.zeroStageUpdate=false;}
  async connect(){return {query:this.query.bind(this),release:()=>this.events.push('release')};}
  async query(sql,params=[]){
    const q=sql.trim();
    if(q==='BEGIN'){this.before=clone({stage:this.stage,game:this.game});this.events.push('BEGIN');return {rowCount:0,rows:[]};}
    if(q==='COMMIT'){this.before=null;this.events.push('COMMIT');return {rowCount:0,rows:[]};}
    if(q==='ROLLBACK'){if(this.before){this.stage=this.before.stage;this.game=this.before.game;}this.before=null;this.events.push('ROLLBACK');return {rowCount:0,rows:[]};}
    if(q.startsWith('INSERT INTO mm_tournament_stage_tables')){
      if(this.stage)return {rowCount:0,rows:[]};
      this.stage={stage:params[1],number:params[2],players:JSON.parse(params[3]),roomCode:params[4],result:JSON.parse(params[5])};
      return {rowCount:1,rows:[{result:clone(this.stage.result)}]};
    }
    if(q.startsWith('UPDATE mm_tournament_stage_tables SET result_json=')){
      if(this.zeroStageUpdate||!this.stage||this.stage.result)return {rowCount:0,rows:[]};
      this.stage.result=JSON.parse(params[4]);return {rowCount:1,rows:[{result:clone(this.stage.result)}]};
    }
    if(q.startsWith('SELECT players_json AS players')){
      return {rowCount:this.stage?1:0,rows:this.stage?[{players:clone(this.stage.players),roomCode:this.stage.roomCode,result:clone(this.stage.result)}]:[]};
    }
    if(q.startsWith('UPDATE mm_tournament_table_games SET result_json=')){
      if(this.failGames)throw new Error('PostgreSQL indisponível durante registro de mesa');
      if(this.game.result)return {rowCount:0,rows:[]};
      this.game.result=JSON.parse(params[3]);return {rowCount:1,rows:[{result:clone(this.game.result)}]};
    }
    if(q.startsWith('SELECT room_code AS "roomCode",result_json AS result')){
      return {rowCount:1,rows:[{roomCode:this.game.roomCode,result:clone(this.game.result)}]};
    }
    throw Error('Consulta de teste não reconhecida: '+q.slice(0,120));
  }
}

async function run(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-results-integrity-'));
  try{
    const games=new TournamentGames({databaseUrl:'',filePath:path.join(dir,'games.json')});
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'bracket.json')});
    await games.init();await bracket.init();
    await games.claim(id,1,roomCode);
    await assert.rejects(games.finish({id,number:1,roomCode,expectedPlayers:3,result:{...record,results:record.results.slice(0,2)}}),/incompleto/i);
    assert.equal((await games.statuses(id,[1]))[1].finished,false,'parcial não encerra mesa');
    await assert.rejects(bracket.recordResult({id,number:1,roomCode,players:roster,result:{...record,results:record.results.slice(0,2)}}),/completo/i);
    assert.equal((await bracket.rows(id)).length,0,'parcial não cria resultado de fase');
    const localArgs={bracket,games,...args};
    await recordTournamentResult(localArgs);
    assert.equal((await games.statuses(id,[1]))[1].finished,true);
    assert.equal((await bracket.rows(id))[0].result.results.length,3);
    await recordTournamentResult(localArgs); // repetição idêntica
    await assert.rejects(recordTournamentResult({...localArgs,record:{...record,results:record.results.map(p=>({...p,score:p.score+7}))}}),/diferente|conflitante/i);
    assert.equal((await games.get(id,1)).result.results[0].score,0,'conflito não altera a mesa');
    assert.equal((await bracket.rows(id))[0].result.results[0].score,0,'conflito não altera a classificação');
    // Estados legados incompletos permanecem pendentes, nunca "finished".
    const old=await games.get(id,1);old.result.complete=false;games.save();
    assert.equal((await games.statuses(id,[1]))[1].finished,false);

    const db=new FakePool();const pGames=new TournamentGames({pool:db,databaseUrl:''});
    const pBracket=new TournamentBracket({pool:db,databaseUrl:''});
    const pgArgs={bracket:pBracket,games:pGames,...args};
    await recordTournamentResult(pgArgs);
    assert.equal(db.stage.result.results.length,3);
    assert.equal(db.game.result.results.length,3);
    assert(db.events.includes('COMMIT'));
    // PostgreSQL JSONB pode alterar a ordem das propriedades; a repetição deve continuar idempotente.
    db.stage.result.results=db.stage.result.results.map(p=>Object.fromEntries(Object.entries(p).reverse()));
    db.game.result.results=db.game.result.results.map(p=>Object.fromEntries(Object.entries(p).reverse()));
    await recordTournamentResult(pgArgs);
    await assert.rejects(recordTournamentResult({...pgArgs,record:{...record,matchId:'another-match'}}),/divergentes|conflitante/i);
    assert.equal(db.stage.result.matchId,'match-123');
    assert.equal(db.game.result.matchId,'match-123');

    const errDb=new FakePool();errDb.failGames=true;
    const errArgs={bracket:new TournamentBracket({pool:errDb,databaseUrl:''}),games:new TournamentGames({pool:errDb,databaseUrl:''}),...args};
    await assert.rejects(recordTournamentResult(errArgs),/PostgreSQL indisponível/);
    assert.equal(errDb.stage,null,'falha na segunda gravação desfaz a classificação');
    assert.equal(errDb.game.result,null,'falha na segunda gravação não confirma a mesa');
    assert(errDb.events.includes('ROLLBACK'));
    errDb.failGames=false;await recordTournamentResult(errArgs);
    assert(errDb.stage?.result&&errDb.game.result,'nova tentativa grava ambas as tabelas');

    // Após erro em fase avançada, UPDATE de zero registros não pode retornar sucesso.
    const zero=new FakePool();const zB=new TournamentBracket({pool:zero,databaseUrl:''});
    await assert.rejects(zB.recordResult({id,stage:'semi',number:1,roomCode,result:record,players:roster}),/incompatíveis|divergentes/i);
    zero.stage={stage:'semi',number:1,roomCode,players:roster.map((p,i)=>({...p,seat:i+1})),result:null};
    zero.zeroStageUpdate=true;
    await assert.rejects(zB.recordResult({id,stage:'semi',number:1,roomCode,result:record,players:roster}),/não foi gravado/i);
    assert.equal(zero.stage.result,null);
    zero.zeroStageUpdate=false;
    await zB.recordResult({id,stage:'semi',number:1,roomCode,result:record,players:roster});
    assert(zero.stage.result);
    await zB.recordResult({id,stage:'semi',number:1,roomCode,result:record,players:roster});
    await assert.rejects(zB.recordResult({id,stage:'semi',number:1,roomCode,result:{...record,matchId:'outro'},players:roster}),/conflitante/i);
    zero.stage.result=null;zero.stage.players[0].playerKey='intruso';
    await assert.rejects(zB.recordResult({id,stage:'semi',number:1,roomCode,result:record,players:roster}),/incompatíveis/i);

    console.log('✓ Integridade dos torneios: parcial rejeitado, conflitos bloqueados, gravação idempotente, rollback atômico, UPDATE 0 detectado.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1});

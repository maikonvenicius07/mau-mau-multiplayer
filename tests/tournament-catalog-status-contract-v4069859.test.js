'use strict';
// Contrato real do catálogo: filtro eficiente na memória e SQL parametrizado.
// Evita regressões em que teste e servidor esperam assinaturas divergentes.
const assert=require('node:assert/strict');
const {TournamentCatalog}=require('../tournament-catalog');

const makeRow=(id,status)=>({id,name:`Copa ${id}`,capacity:8,rounds:5,
  startAt:null,status,createdBy:'criador',createdAt:'2026-11-23T00:00:00.000Z'});
(async()=>{
  const rows=[makeRow('aberto','open'),makeRow('concluido','closed'),makeRow('rascunho','draft')];
  const local=new TournamentCatalog({databaseUrl:'',filePath:'/tmp/mm-test-not-written.json'});
  local.local=rows;
  assert.deepEqual((await local.list({status:'closed'})).map(x=>x.id),['concluido']);
  assert.deepEqual(new Set((await local.list()).map(x=>x.id)),new Set(rows.map(x=>x.id)));
  assert.equal((await local.list({status:'invalid'})).length,3,
    'Status não reconhecido não pode ser interpolado na SQL');

  const calls=[];
  const fakePool={query:async(sql,params=[])=>{
    calls.push({sql,params});
    return {rows:params.length?rows.filter(x=>x.status===params[0]):rows};
  }};
  const pg=new TournamentCatalog({pool:fakePool,databaseUrl:''});
  assert.deepEqual((await pg.list({status:'closed'})).map(x=>x.id),['concluido']);
  assert.match(calls[0].sql,/WHERE status=\$1/);
  assert.deepEqual(calls[0].params,['closed']);
  assert.equal((await pg.list()).length,3);
  assert(!calls[1].sql.includes('WHERE status='));
  assert.deepEqual(calls[1].params,[]);
  console.log('✓ V40.69.8.59: filtro de torneio fechado em memória e SQL, listagem pública sem filtro e API consistente.');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
// Regressão do hotfix V40.69.8.55: seletividade do reconciliador e cache
// versionado por conteúdo. Sem acesso ao banco de produção.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {TournamentCatalog}=require('../tournament-catalog');
const {contentVersion,versionedIndex}=require('../static-asset-versioning');

(async()=>{
  const row=(id,status)=>({id,name:id,capacity:4,rounds:5,status,startAt:null,createdBy:'owner',createdAt:'2026-11-23T12:00:00.000Z'});
  const catalog=new TournamentCatalog({databaseUrl:'',pool:null});
  catalog.local=[row('draft','draft'),row('open','open'),row('closed','closed'),row('cancelled','cancelled')];
  assert.equal((await catalog.list()).length,4,'listagem pública preserva todos os status');
  assert.deepEqual((await catalog.list({status:'closed'})).map(x=>x.id),['closed']);
  assert.deepEqual((await catalog.list({status:'invalid'})).length,4,'status desconhecido não elimina torneios');

  const calls=[];
  const fakePool={query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:params?.length? [row('closed','closed')]:[row('draft','draft'),row('closed','closed')]};
  }};
  const pgCatalog=new TournamentCatalog({databaseUrl:'',pool:fakePool});
  assert.equal((await pgCatalog.list({status:'closed'})).length,1);
  assert.match(calls[0].sql,/WHERE status=\$1/);
  assert.deepEqual(calls[0].params,['closed'],'filtro deve ser parametrizado');
  assert.equal((await pgCatalog.list()).length,2);
  assert.doesNotMatch(calls[1].sql,/WHERE status=\$1/,'consulta pública permanece sem filtro');
  assert.deepEqual(calls[1].params,[]);

  const base=path.resolve(__dirname,'..'),server=fs.readFileSync(path.join(base,'server.js'),'utf8');
  assert.match(server,/const RELEASE_VERSION = 'V40\.69\.8\.55'/);
  assert.match(server,/const events=await tournamentCatalog\.list\(\{status:'closed'\}\)/);

  const html=versionedIndex(path.join(base,'public'));
  for(const name of ['media-session.js','controls-positioning.js','tournament-schedule.js','tournament-auto-refresh.js']){
    const file=fs.readFileSync(path.join(base,'public',name));
    assert(html.includes(`${name}?v=${contentVersion(file)}`),`${name} deve usar hash de conteúdo`);
  }
  assert(html.includes('/socket.io/socket.io.js'),'script dinâmico do Socket.IO deve permanecer intocado');
  console.log('✓ V40.69.8.55: seleção SQL segura de torneios encerrados, listagem intacta e assets versionados.');
})().catch(error=>{console.error(error);process.exitCode=1});

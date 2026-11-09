'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createAppDatabasePool,createDatabasePoolConfig}=require('../database-pool');
const {RankingStore}=require('../ranking-store');
const {AuthIdentityStore}=require('../auth-identity-store');
const {RoomSnapshotStore}=require('../room-snapshot-store');
const {TournamentStore}=require('../tournament-store');
const {TournamentCatalog}=require('../tournament-catalog');
const {TournamentDraw}=require('../tournament-draw');
const {TournamentGames}=require('../tournament-games');
const {TournamentBracket}=require('../tournament-bracket');

class FakePool {
  static instances=[];
  constructor(config){this.config=config;this.queries=[];this.ends=0;this.connects=0;this.releases=0;FakePool.instances.push(this);}
  async query(sql,params){
    this.queries.push({sql:String(sql),params});
    if(/SELECT 1 AS ok/i.test(sql))return {rows:[{ok:1}],rowCount:1};
    return {rows:[],rowCount:0};
  }
  async connect(){
    this.connects++;
    return {query:(...args)=>this.query(...args),release:()=>{this.releases++;}};
  }
  async end(){this.ends++;}
}

(async()=>{
  assert.equal(createAppDatabasePool('',{PoolClass:FakePool}),null,'modo sem DATABASE_URL não abre conexão');
  assert.equal(FakePool.instances.length,0);
  // O build do Render herda PGSSLMODE do ambiente de produção. Este teste
  // verifica a política TLS padrão de forma determinística e não deve ser
  // alterado por uma opção de transporte usada somente na rede interna.
  const databaseUrl='postgresql://user:pass@localhost:5432/db';
  const pool=createAppDatabasePool(databaseUrl,{PoolClass:FakePool,env:{}});
  assert.equal(FakePool.instances.length,1,'deve criar um único Pool');
  assert.equal(pool.config.connectionString,'postgresql://user:pass@localhost:5432/db');
  assert.equal(pool.config.ssl?.rejectUnauthorized,true,'TLS deve validar a cadeia de certificados');
  assert.equal(createDatabasePoolConfig(databaseUrl,{env:{PGSSLMODE:'disable'}}).ssl,false,
    'conexão interna sem TLS exige PGSSLMODE=disable explícito');
  assert.equal(Object.prototype.hasOwnProperty.call(pool.config,'max'),false,'não alterar limite padrão do pg');

  const options={databaseUrl:'',pool};
  const ranking=new RankingStore(options),auth=new AuthIdentityStore(options);
  const snapshots=new RoomSnapshotStore({...options,debounceMs:5});
  const signups=new TournamentStore(options);
  const catalog=new TournamentCatalog(options),draw=new TournamentDraw(options);
  const games=new TournamentGames(options),bracket=new TournamentBracket({...options,draw});

  for(const store of [ranking,auth,snapshots,signups,catalog,draw,games,bracket]){
    assert.equal(store.kind||'postgres','postgres');
    assert.equal(store.backend?.pool||store.pool,pool,'todas as áreas devem utilizar a mesma instância');
  }
  for(const store of [ranking,auth,snapshots,signups,catalog,draw,games,bracket])await store.init();
  assert(pool.connects>0,'transações precisam funcionar com .connect()');
  assert.equal(pool.connects,pool.releases,'cada conexão de transação deve ser devolvida');
  assert.equal(await ranking.healthCheck(),true);
  assert.equal(await auth.healthCheck(),true);
  assert.equal(await snapshots.healthCheck(),true);
  await auth.close();
  await snapshots.close();
  assert.equal(pool.ends,0,'módulos injetados não devem encerrar um pool de uso coletivo');
  await pool.end();
  assert.equal(pool.ends,1,'somente o servidor deve encerrar o pool compartilhado');

  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert(server.includes('const appDatabasePool=createAppDatabasePool(process.env.DATABASE_URL);'));
  for(const name of ['RankingStore','TournamentStore','AuthIdentityStore','RoomSnapshotStore']){
    assert(server.includes(`new ${name}({pool:appDatabasePool})`),`${name} precisa receber pool compartilhado`);
  }
  assert(server.includes('await appDatabasePool.end()'),'pool deve fechar uma única vez no shutdown');
  console.log('✓ Fase 6A: pool único injetado em 8 módulos; transações e encerramento seguros; modo JSON preservado.');
})().catch(e=>{console.error(e);process.exitCode=1});

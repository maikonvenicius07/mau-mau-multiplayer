'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createDatabasePoolConfig,createAppDatabasePool}=require('../database-pool');
const {ActionRateLimiter,DEFAULT_ACTION_RULES}=require('../abuse-guard');
const {TournamentCatalog,maxTournamentsPerAccount}=require('../tournament-catalog');
const root=path.join(__dirname,'..');

(async()=>{
 const url='postgresql://alice:secret@db.example.org:5432/mm';
 const config=createDatabasePoolConfig(url,{env:{}});
 assert.equal(config.connectionString,url);
 assert.deepEqual(config.ssl,{rejectUnauthorized:true},'conexões TLS devem validar certificados por padrão');
 assert.equal(createDatabasePoolConfig(url,{env:{PGSSLMODE:'disable'}}).ssl,false,'rede privada exige escolha explícita');
 assert.equal(createDatabasePoolConfig(url,{env:{PGSSLMODE:'require'}}).ssl.rejectUnauthorized,true);
 assert.throws(()=>createDatabasePoolConfig(url+'?sslmode=no-verify',{env:{}}),/não é permitido/);
 assert.throws(()=>createDatabasePoolConfig(url+'?sslmode=disable',{env:{}}),/explicitamente/);
 assert.throws(()=>createDatabasePoolConfig(url+'?sslmode=require',{env:{PGSSLMODE:'disable'}}),/Conflito/);
 const fromUrl=createDatabasePoolConfig(url+'?sslmode=require&application_name=maumau',{env:{}});
 assert.equal(fromUrl.ssl.rejectUnauthorized,true);
 assert(!fromUrl.connectionString.includes('sslmode='),'URL não pode sobrescrever SSL seguro no parser pg');
 assert(fromUrl.connectionString.includes('application_name=maumau'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v40696-ca-'));
 try{
   const caFile=path.join(dir,'ca.pem');fs.writeFileSync(caFile,'TESTE CA');
   assert.equal(createDatabasePoolConfig(url,{env:{PGSSLROOTCERT:caFile}}).ssl.ca,'TESTE CA');
   assert.equal(createDatabasePoolConfig(url,{env:{DATABASE_SSL_CA:'LINHA1\\nLINHA2'}}).ssl.ca,'LINHA1\nLINHA2');
   assert.throws(()=>createDatabasePoolConfig(url,{env:{DATABASE_SSL_CA:'X',PGSSLROOTCERT:caFile}}),/somente/);
 } finally{fs.rmSync(dir,{recursive:true,force:true});}
 class FakePool{constructor(options){this.options=options;}}
 assert.equal(createAppDatabasePool(url,{PoolClass:FakePool,env:{}}).options.ssl.rejectUnauthorized,true);
 assert.equal(maxTournamentsPerAccount({}),10);
 assert.equal(maxTournamentsPerAccount({MAUMAU_MAX_TOURNAMENTS_PER_ACCOUNT:'100'}),50);
 const limiter=new ActionRateLimiter(DEFAULT_ACTION_RULES);
 for(let i=0;i<180;i++)assert(limiter.consume('conta','voiceSignal',1000).allowed,'ICE/SDP normal deve funcionar');
 assert.equal(limiter.consume('conta','voiceSignal',1000).allowed,false,'sinalização excessiva deve ser bloqueada');
 assert(limiter.consume('outra-conta','voiceSignal',1000).allowed,'outra conta não deve ser afetada');
 assert(limiter.consume('conta','voiceSignal',11000).allowed,'janela posterior deve se recuperar');
 for(let i=0;i<3;i++)assert(limiter.consume('tournament:ana','createTournament',1000).allowed);
 assert(!limiter.consume('tournament:ana','createTournament',1000).allowed);
 assert(limiter.consume('tournament:ana','createTournament',3601000).allowed);
 
 // No JSON, a criação e a contagem são síncronas; quota persiste em arquivo.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'v40696-tournament-'));
 try{
  const args={databaseUrl:'',filePath:path.join(temp,'catalog.json'),maxPerAccount:2};
  const cat=new TournamentCatalog(args);await cat.init();
  const data={name:'Copa Segurança',capacity:4,startAt:null};
  const a=await cat.create({actor:'ana',data});
  await cat.create({actor:'ana',data});
  await assert.rejects(cat.create({actor:'ana',data}),e=>e.status===409);
  await cat.create({actor:'bruno',data});
  await cat.update({id:a.id,data:{status:'cancelled'}});
  await cat.create({actor:'ana',data});
  const reopened=new TournamentCatalog(args);await reopened.init();
  await assert.rejects(reopened.create({actor:'ana',data}),e=>e.status===409);
 } finally{fs.rmSync(temp,{recursive:true,force:true});}
 
 // Pool simulado com lock transacional por conta; replica interleavings de
 // conexões simultâneas sem afirmar validação PostgreSQL no Render.
 class FakePgPool{
  constructor(){this.rows=[];this.locks=new Map();this.rollbacks=0;this.commits=0;}
  async connect(){
   const pool=this;let unlock=null;let pending=null;
   return {async query(sql,args=[]){
    if(sql==='BEGIN')return {rows:[]};
    if(sql.startsWith('SELECT pg_advisory_xact_lock')){
     const key=args[0],previous=pool.locks.get(key)||Promise.resolve();
     let release;const wait=new Promise(resolve=>{release=resolve;});
     pool.locks.set(key,previous.then(()=>wait));
     await previous;unlock=release;return {rows:[]};
    }
    if(sql.startsWith('SELECT COUNT(*)')){
     await new Promise(resolve=>setTimeout(resolve,4));
     return {rows:[{count:pool.rows.filter(x=>x.actor===args[0]&&x.status!=='cancelled').length}]};
    }
    if(sql.startsWith('INSERT INTO mm_tournaments')){
     pending={id:args[0],actor:args[4],status:'draft'};return {rows:[],rowCount:1};
    }
    if(sql==='COMMIT'){if(pending)pool.rows.push(pending);pool.commits++;unlock?.();return {rows:[]};}
    if(sql==='ROLLBACK'){pending=null;pool.rollbacks++;unlock?.();return {rows:[]};}
    throw new Error('SQL inesperado '+sql);
   },release(){}};
  }
 }
 const pool=new FakePgPool();
 const pgCat=new TournamentCatalog({pool,databaseUrl:'',maxPerAccount:2});
 const data={name:'Copa Segurança',capacity:4,startAt:null};
 const outcomes=await Promise.allSettled(Array.from({length:3},()=>pgCat.create({actor:'ana',data})));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,2,'não pode exceder quota com criações simultâneas');
 assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
 assert.equal(pool.rows.length,2);assert.equal(pool.commits,2);assert.equal(pool.rollbacks,1);

 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert(server.includes("abuseLimiter.consume(abuseSubject(socket),'voiceSignal')"));
 assert(server.includes("socket.emit('liveVoiceSignalLimited'"),'limite deve usar aviso específico e não alterar estado das jogadas');
 assert(server.includes("String(sdp.type||'')!==kind"),'offer/answer devem corresponder ao tipo declarado');
 assert(server.includes("abuseLimiter.consume(`tournament:${session.playerKey}`,'createTournament')"));
 assert(server.includes('res.status(429)'));
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/verify.yml'),'utf8');
 assert(workflow.includes('npm audit --omit=dev --audit-level=high'));
 console.log('✓ V40.69.6: TLS verificado; sinalização limitada; quota de torneios concorrente; auditoria CI configurada.');
})().catch(e=>{console.error(e);process.exitCode=1;});

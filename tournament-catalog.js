'use strict';
// V51.3.1: cada conta pode criar torneios; exclusão e gestão restritas ao criador.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {tournamentConfig}=require('./tournament-store');

function fail(message,status=400){return Object.assign(new Error(message),{status});}
const STATES=new Set(['draft','open','closed','cancelled']);
function cleanPayload(data,existing=null){
  const name=String(data?.name??existing?.name??'').trim();
  if(name.length<3||name.length>70)throw fail('O nome precisa ter entre 3 e 70 caracteres.');
  const capacity=Number(data?.capacity??existing?.capacity);
  if(!Number.isInteger(capacity)||capacity<2||capacity>100)throw fail('Informe de 2 a 100 vagas.');
  const raw=data?.startAt===undefined?existing?.startAt:data.startAt;
  let startAt=null;
  if(raw!==null&&raw!==''){
    const d=new Date(raw);
    if(!Number.isFinite(d.getTime()))throw fail('Data ou horário inválidos.');
    startAt=d.toISOString();
  }
  return {name,capacity,startAt};
}
function toPublic(row,{actor='',isAdmin=false}={}){
  return {id:row.id,name:row.name,capacity:Number(row.capacity),startAt:row.startAt?new Date(row.startAt).toISOString():null,
    registrationOpen:row.status==='open',status:row.status,
    canManage:!!(actor&&(row.createdBy===actor||isAdmin))};
}
function newId(){return `tor-${crypto.randomUUID()}`;}
function sanitizeStatus(value){if(!STATES.has(value))throw fail('Situação de torneio inválida.');return value;}
class TournamentCatalog {
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournaments.json'),signupsFilePath=path.join(__dirname,'data','tournament-signups.json'),pool=null}={}){
    this.filePath=filePath;this.signupsFilePath=signupsFilePath;this.local=[];this.pool=pool;
    if(!this.pool&&databaseUrl){const {Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});this.ownsPool=true;}
  }
  async init(){
    if(this.pool){
      await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournaments (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(70) NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 100),
        start_at TIMESTAMPTZ,
        status VARCHAR(12) NOT NULL CHECK(status IN ('draft','open','closed','cancelled')),
        created_by VARCHAR(80) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      const seed=tournamentConfig();
      await this.pool.query(`INSERT INTO mm_tournaments(id,name,capacity,start_at,status,created_by)
       VALUES($1,$2,$3,$4,$5,'legacy-v51.1') ON CONFLICT(id) DO NOTHING`,
       [seed.id,seed.name,seed.capacity,seed.startAt,seed.registrationOpen?'open':'draft']);
    }else{
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
      try{const data=JSON.parse(fs.readFileSync(this.filePath,'utf8'));this.local=Array.isArray(data)?data:[];}
      catch(e){if(e.code!=='ENOENT')throw e;}
      const seed=tournamentConfig();
      if(!this.local.some(x=>x.id===seed.id)){
        this.local.push({id:seed.id,name:seed.name,capacity:seed.capacity,startAt:seed.startAt,status:seed.registrationOpen?'open':'draft',createdBy:'legacy-v51.1',createdAt:new Date().toISOString()});this.save();
      }
    }
  }
  save(){const temp=this.filePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.local,null,2));fs.renameSync(temp,this.filePath);}
  async list({actor='',isAdmin=false}={}){
    const rows=this.pool?(await this.pool.query(`SELECT id,name,capacity,start_at AS "startAt",status,created_by AS "createdBy" FROM mm_tournaments ORDER BY CASE WHEN status='open' THEN 0 WHEN status='draft' THEN 1 WHEN status='closed' THEN 2 ELSE 3 END,created_at DESC`)).rows:
      [...this.local].sort((a,b)=>(a.status==='open'?0:a.status==='draft'?1:a.status==='closed'?2:3)-(b.status==='open'?0:b.status==='draft'?1:b.status==='closed'?2:3)||String(b.createdAt).localeCompare(String(a.createdAt)));
    return rows.map(row=>toPublic(row,{actor,isAdmin}));
  }
  async get(id,{actor='',isAdmin=false}={}){
    if(typeof id!=='string'||!id||id.length>64)return null;
    const row=this.pool?(await this.pool.query(`SELECT id,name,capacity,start_at AS "startAt",status,created_by AS "createdBy" FROM mm_tournaments WHERE id=$1`,[id])).rows[0]:this.local.find(x=>x.id===id);
    return row?toPublic(row,{actor,isAdmin}):null;
  }
  async create({data,actor}){
    const info=cleanPayload(data);
    if(!actor)throw fail('Entre na sua conta para criar um torneio.',401);
    const id=newId();const row={id,...info,status:'draft',createdBy:actor,createdAt:new Date().toISOString()};
    if(this.pool)await this.pool.query(`INSERT INTO mm_tournaments(id,name,capacity,start_at,status,created_by) VALUES($1,$2,$3,$4,'draft',$5)`,[id,info.name,info.capacity,info.startAt,actor]);
    else{this.local.push(row);this.save();}
    return toPublic(row);
  }
  async isOwner(id,actor){
    if(!actor||!id)return false;
    if(this.pool){const {rows}=await this.pool.query('SELECT created_by FROM mm_tournaments WHERE id=$1',[id]);return rows[0]?.created_by===actor;}
    return this.local.find(x=>x.id===id)?.createdBy===actor;
  }
  async delete({id,actor,isAdmin=false}){
    if(!actor)throw fail('Entre na sua conta.',401);
    if(typeof id!=='string'||!id||id.length>64)throw fail('Torneio inválido.',400);
    if(this.pool){
      const conn=await this.pool.connect();
      try{
        await conn.query('BEGIN');
        await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tournament:${id}`]);
        const row=await conn.query('SELECT created_by FROM mm_tournaments WHERE id=$1 FOR UPDATE',[id]);
        if(!row.rowCount)throw fail('Torneio não encontrado.',404);
        if(row.rows[0].created_by!==actor&&!isAdmin)throw fail('Somente o criador pode excluir este torneio.',403);
        await conn.query('DELETE FROM mm_tournament_table_seats WHERE tournament_id=$1',[id]);
        await conn.query('DELETE FROM mm_tournament_signups WHERE tournament_id=$1',[id]);
        await conn.query('DELETE FROM mm_tournaments WHERE id=$1',[id]);
        await conn.query('COMMIT');
      }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
    }else{
      const row=this.local.find(x=>x.id===id);
      if(!row)throw fail('Torneio não encontrado.',404);
      if(row.createdBy!==actor&&!isAdmin)throw fail('Somente o criador pode excluir este torneio.',403);
      const directory=path.dirname(this.filePath);
      const persist=(file,data)=>{const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file);};
      const signupsPath=this.signupsFilePath;
      let signups=[];
      try{signups=JSON.parse(fs.readFileSync(signupsPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      persist(signupsPath,signups.filter(x=>x.tournamentId!==id));
      const drawsPath=path.join(directory,'tournament-draws.json');
      let draws={};
      try{draws=JSON.parse(fs.readFileSync(drawsPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      delete draws[id];persist(drawsPath,draws);
      this.local=this.local.filter(x=>x.id!==id);this.save();
    }
    return {id};
  }
  async update({id,data}){
    const existing=await this.get(id);if(!existing)throw fail('Torneio não encontrado.',404);
    if(existing.status==='cancelled')throw fail('Um torneio cancelado não pode ser reaberto ou editado.',409);
    let status=existing.status;
    if(data&&Object.hasOwn(data,'status')){
      status=sanitizeStatus(String(data.status));
      if(status==='draft'&&existing.status!=='draft')throw fail('Não é possível voltar o torneio ao rascunho.',409);
    }
    const fields=cleanPayload(data,existing);
    if(this.pool){
      const conn=await this.pool.connect();
      try{
        await conn.query('BEGIN');
        await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tournament:${id}`]);
        const current=await conn.query('SELECT status FROM mm_tournaments WHERE id=$1 FOR UPDATE',[id]);
        if(!current.rowCount)throw fail('Torneio não encontrado.',404);
        if(current.rows[0].status==='cancelled')throw fail('Torneio cancelado não pode ser editado.',409);
        if(status==='open'){
          const drawn=await conn.query('SELECT 1 FROM mm_tournament_table_seats WHERE tournament_id=$1 LIMIT 1',[id]);
          if(drawn.rowCount)throw fail('Não é possível reabrir inscrições após o sorteio das mesas.',409);
        }
        const n=await conn.query('SELECT COUNT(*)::int AS n FROM mm_tournament_signups WHERE tournament_id=$1',[id]);
        if(fields.capacity<Number(n.rows[0].n))throw fail('O número de vagas não pode ser menor que os inscritos.',409);
        await conn.query('UPDATE mm_tournaments SET name=$2,capacity=$3,start_at=$4,status=$5,updated_at=NOW() WHERE id=$1',[id,fields.name,fields.capacity,fields.startAt,status]);
        await conn.query('COMMIT');
      }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
    }else{
      // Em execução local os métodos são serializados pelo próprio processo.
      let signupCount=0;
      try{const signups=JSON.parse(fs.readFileSync(this.signupsFilePath,'utf8'));signupCount=signups.filter(x=>x.tournamentId===id).length;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(fields.capacity<signupCount)throw fail('O número de vagas não pode ser menor que os inscritos.',409);
      if(status==='open'){
        try{const draws=JSON.parse(fs.readFileSync(path.join(path.dirname(this.filePath),'tournament-draws.json'),'utf8'));
          if(draws[id]?.length)throw fail('Não é possível reabrir inscrições após o sorteio das mesas.',409);
        }catch(e){if(e.code!=='ENOENT')throw e;}
      }
      const row=this.local.find(x=>x.id===id);row.name=fields.name;row.capacity=fields.capacity;row.startAt=fields.startAt;row.status=status;this.save();
    }
    return {...existing,...fields,status,registrationOpen:status==='open'};
  }
}
module.exports={TournamentCatalog,cleanPayload};

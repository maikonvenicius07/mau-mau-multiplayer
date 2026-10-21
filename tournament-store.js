'use strict';

// V51.1 — inscrições compactas; não gerencia cartas, pontos ou resultados de partidas.
const fs = require('fs');
const path = require('path');

function tournamentConfig(env=process.env) {
  const rawId=String(env.MAUMAU_TOURNAMENT_ID||'copa-candeias-1').trim();
  const id=/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(rawId)?rawId:'copa-candeias-1';
  const name=String(env.MAUMAU_TOURNAMENT_NAME||'Copa MAU-MAU CANDEIAS').trim().slice(0,70);
  const capacity=Math.max(2,Math.min(100,Math.floor(Number(env.MAUMAU_TOURNAMENT_CAPACITY)||20)));
  const start=Date.parse(String(env.MAUMAU_TOURNAMENT_START_AT||''));
  return {id,name,capacity,startAt:Number.isFinite(start)?new Date(start).toISOString():null,
    registrationOpen:String(env.MAUMAU_TOURNAMENT_OPEN||'0')==='1'};
}

function publicList(rows,config,playerKey='') {
  const members=rows.map(x=>({name:String(x.name||'Jogador').slice(0,24),joinedAt:x.joinedAt}));
  return {tournament:{...config,registered:rows.some(x=>x.playerKey===playerKey),enrolled:rows.length,
    spotsRemaining:Math.max(0,config.capacity-rows.length)},players:members};
}

class TournamentStore {
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-signups.json')}={}) {
    this.filePath=filePath;
    this.kind=databaseUrl?'postgres':'json';
    if(databaseUrl){const {Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});}
    this.local=[];
  }
  async init(){
    if(this.pool){
      await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_signups (
        tournament_id VARCHAR(64) NOT NULL,
        player_key VARCHAR(80) NOT NULL,
        display_name VARCHAR(24) NOT NULL,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(tournament_id, player_key)
      )`);
    }else{
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
      try{const data=JSON.parse(fs.readFileSync(this.filePath,'utf8'));this.local=Array.isArray(data)?data:[];}
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
  }
  async get({config=tournamentConfig(),playerKey='' }={}){
    let rows;
    if(this.pool){
      const result=await this.pool.query(`SELECT player_key AS "playerKey",display_name AS name,joined_at AS "joinedAt"
        FROM mm_tournament_signups WHERE tournament_id=$1 ORDER BY joined_at ASC,player_key ASC`,[config.id]);
      rows=result.rows;
    }else rows=this.local.filter(x=>x.tournamentId===config.id).sort((a,b)=>String(a.joinedAt).localeCompare(String(b.joinedAt)));
    return publicList(rows,config,playerKey);
  }
  async change({action,playerKey,name,config=tournamentConfig()}={}){
    if(!['join','leave'].includes(action))throw Object.assign(new Error('Ação inválida.'),{status:400});
    if(!playerKey||String(playerKey).length>80)throw Object.assign(new Error('Entre na sua conta.'),{status:401});
    if(!config.registrationOpen)throw Object.assign(new Error('As inscrições estão fechadas.'),{status:409});
    name=String(name||'Jogador').trim().slice(0,24)||'Jogador';
    if(this.pool){
      const client=await this.pool.connect();
      try{
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tournament:${config.id}`]);
        if(action==='join'){
          const existing=await client.query('SELECT 1 FROM mm_tournament_signups WHERE tournament_id=$1 AND player_key=$2',[config.id,playerKey]);
          if(!existing.rowCount){
            const count=await client.query('SELECT COUNT(*)::int AS n FROM mm_tournament_signups WHERE tournament_id=$1',[config.id]);
            if(Number(count.rows[0].n)>=config.capacity)throw Object.assign(new Error('Todas as vagas estão preenchidas.'),{status:409});
            await client.query('INSERT INTO mm_tournament_signups(tournament_id,player_key,display_name) VALUES ($1,$2,$3)',[config.id,playerKey,name]);
          }
        }else await client.query('DELETE FROM mm_tournament_signups WHERE tournament_id=$1 AND player_key=$2',[config.id,playerKey]);
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }else{
      const existing=this.local.some(x=>x.tournamentId===config.id&&x.playerKey===playerKey);
      if(action==='join'&&!existing){
        if(this.local.filter(x=>x.tournamentId===config.id).length>=config.capacity)throw Object.assign(new Error('Todas as vagas estão preenchidas.'),{status:409});
        this.local.push({tournamentId:config.id,playerKey,name,joinedAt:new Date().toISOString()});
      }
      if(action==='leave')this.local=this.local.filter(x=>!(x.tournamentId===config.id&&x.playerKey===playerKey));
      const tmp=this.filePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.local,null,2));fs.renameSync(tmp,this.filePath);
    }
    return this.get({config,playerKey});
  }
}
module.exports={TournamentStore,tournamentConfig,publicList};

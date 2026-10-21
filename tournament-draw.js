'use strict';
// V51.3: sorteio de mesas, sem criar partidas, tocar nas cartas ou registrar resultados.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message, status=409){return Object.assign(new Error(message),{status});}
function shuffled(rows, randomInt=crypto.randomInt){
  const out=rows.slice();
  for(let i=out.length-1;i>0;i--){const j=randomInt(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function distribute(rows, randomInt=crypto.randomInt){
  if(rows.length<2)throw fail('O sorteio exige pelo menos dois inscritos.');
  const count=Math.ceil(rows.length/5);
  const base=Math.floor(rows.length/count),extra=rows.length%count;
  const groups=[],list=shuffled(rows,randomInt);let index=0;
  for(let t=0;t<count;t++){
    const size=base+(t<extra?1:0),players=[];
    for(let seat=1;seat<=size;seat++){
      const p=list[index++];players.push({playerKey:p.playerKey,name:p.name,seat});
    }
    groups.push({number:t+1,players});
  }
  return groups;
}
function publicTables(groups){return groups.map(t=>({number:t.number,players:t.players.map(p=>({name:p.name,seat:p.seat}))}));}
class TournamentDraw{
  constructor({pool=null,databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-draws.json'),signupsFilePath=path.join(__dirname,'data','tournament-signups.json')}={}){
    this.filePath=filePath;this.signupsFilePath=signupsFilePath;this.pool=pool;
    if(!this.pool&&databaseUrl){const {Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});}
    this.local={};
  }
  async init(){
    if(this.pool){
      await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_table_seats (
        tournament_id VARCHAR(64) NOT NULL,
        player_key VARCHAR(80) NOT NULL,
        display_name VARCHAR(24) NOT NULL,
        table_number INTEGER NOT NULL CHECK(table_number>=1),
        seat_number INTEGER NOT NULL CHECK(seat_number BETWEEN 1 AND 5),
        drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(tournament_id,player_key),
        UNIQUE(tournament_id,table_number,seat_number)
      )`);
    }else{
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
      try{const data=JSON.parse(fs.readFileSync(this.filePath,'utf8'));this.local=data&&typeof data==='object'&&!Array.isArray(data)?data:{};}
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
  }
  async get(id){
    if(typeof id!=='string'||!id||id.length>64)return [];
    if(!this.pool)return publicTables(this.local[id]||[]);
    const {rows}=await this.pool.query(`SELECT table_number AS "tableNumber", seat_number AS "seatNumber",display_name AS name
      FROM mm_tournament_table_seats WHERE tournament_id=$1 ORDER BY table_number,seat_number`,[id]);
    const groups=[];
    for(const x of rows){let group=groups.at(-1);if(!group||group.number!==x.tableNumber){group={number:x.tableNumber,players:[]};groups.push(group);}
      group.players.push({name:x.name,seat:x.seatNumber});}
    return groups;
  }
  save(){const temp=this.filePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.local,null,2));fs.renameSync(temp,this.filePath);}
  async draw(id){
    if(typeof id!=='string'||!id||id.length>64)throw fail('Torneio inválido.',400);
    if(this.pool){
      const client=await this.pool.connect();
      try{
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tournament:${id}`]);
        const state=await client.query('SELECT status FROM mm_tournaments WHERE id=$1 FOR UPDATE',[id]);
        if(!state.rowCount)throw fail('Torneio não encontrado.',404);
        if(state.rows[0].status!=='closed')throw fail('Encerre as inscrições antes de sortear as mesas.');
        const exists=await client.query('SELECT 1 FROM mm_tournament_table_seats WHERE tournament_id=$1 LIMIT 1',[id]);
        if(exists.rowCount)throw fail('As mesas desse torneio já foram sorteadas.');
        const {rows}=await client.query(`SELECT player_key AS "playerKey",display_name AS name FROM mm_tournament_signups
          WHERE tournament_id=$1 ORDER BY joined_at,player_key`,[id]);
        const tables=distribute(rows);
        for(const t of tables){for(const p of t.players){
          await client.query('INSERT INTO mm_tournament_table_seats(tournament_id,player_key,display_name,table_number,seat_number) VALUES($1,$2,$3,$4,$5)',[id,p.playerKey,p.name,t.number,p.seat]);
        }}
        await client.query('COMMIT');return publicTables(tables);
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }
    // Armazenamento JSON apenas para testes/desenvolvimento local.
    if(this.local[id]?.length)throw fail('As mesas desse torneio já foram sorteadas.');
    const catalogPath=path.join(path.dirname(this.filePath),'tournaments.json');
    let events=[];try{events=JSON.parse(fs.readFileSync(catalogPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const event=events.find(t=>t.id===id);
    if(!event)throw fail('Torneio não encontrado.',404);
    if(event.status!=='closed')throw fail('Encerre as inscrições antes de sortear as mesas.');
    let signups=[];try{signups=JSON.parse(fs.readFileSync(this.signupsFilePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const tables=distribute(signups.filter(s=>s.tournamentId===id).map(s=>({playerKey:s.playerKey,name:s.name})));
    this.local[id]=tables;this.save();return publicTables(tables);
  }
}
module.exports={TournamentDraw,distribute,publicTables};

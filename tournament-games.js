'use strict';
// V51.4 — identidade de cada mesa e resultado compacto, sem armazenar cartas.
const fs = require('node:fs');
const path = require('node:path');
function fail(message,status=409){return Object.assign(new Error(message),{status});}
class TournamentGames {
  constructor({pool=null,databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-games.json')}={}){
    this.pool=pool;this.filePath=filePath;this.local={};
    if(!pool&&databaseUrl){const {Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});}
  }
  async init(){
    if(this.pool){await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_table_games (
      tournament_id VARCHAR(64) NOT NULL REFERENCES mm_tournaments(id) ON DELETE CASCADE,
      table_number INTEGER NOT NULL CHECK(table_number>=1),
      room_code VARCHAR(10) NOT NULL UNIQUE,
      result_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      PRIMARY KEY(tournament_id,table_number)
    )`);}
    else {fs.mkdirSync(path.dirname(this.filePath),{recursive:true});this.reload();}
  }
  reload(){if(this.pool)return;try{this.local=JSON.parse(fs.readFileSync(this.filePath,'utf8'));}catch(e){if(e.code==='ENOENT')this.local={};else throw e;}}
  save(){const tmp=this.filePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.local,null,2));fs.renameSync(tmp,this.filePath);}
  key(id,number){return `${id}:${number}`;}
  async get(id,number){
    if(this.pool){const r=await this.pool.query(`SELECT room_code AS "roomCode",result_json AS result FROM mm_tournament_table_games WHERE tournament_id=$1 AND table_number=$2`,[id,number]);return r.rows[0]||null;}
    this.reload();return this.local[this.key(id,number)]||null;
  }
  async claim(id,number,roomCode){
    if(!id||!Number.isInteger(number)||number<1||!roomCode)throw fail('Mesa inválida.',400);
    if(this.pool){await this.pool.query(`INSERT INTO mm_tournament_table_games(tournament_id,table_number,room_code) VALUES($1,$2,$3) ON CONFLICT (tournament_id,table_number) DO NOTHING`,[id,number,roomCode]);return this.get(id,number);}
    this.reload();const key=this.key(id,number);if(!this.local[key]){this.local[key]={roomCode,result:null};this.save();}return this.local[key];
  }
  async finish({id,number,roomCode,result,expectedPlayers=null}){
    if(!Array.isArray(result?.results)||!result.results.length)throw fail('Resultado inválido.',400);
    // Guarda somente nomes, posições, pontuação e vencedores da partida já encerrada.
    const safe={matchId:String(result.matchId||'').slice(0,160),finishedAt:result.finishedAt,
      complete:result.results.length===Number(expectedPlayers||result.results.length),
      results:result.results.map(p=>({name:String(p.name||'Jogador').slice(0,24),score:Number(p.score)||0,position:Number(p.position)||0,won:!!p.won})).sort((a,b)=>a.position-b.position||a.score-b.score)};
    if(this.pool){const r=await this.pool.query(`UPDATE mm_tournament_table_games SET result_json=$4::jsonb,finished_at=NOW()
      WHERE tournament_id=$1 AND table_number=$2 AND room_code=$3 AND result_json IS NULL`,[id,number,roomCode,JSON.stringify(safe)]);
      if(!r.rowCount){const prev=await this.get(id,number);if(!prev||prev.roomCode!==roomCode)throw fail('Mesa incompatível.');}
      return safe;}
    this.reload();const current=this.local[this.key(id,number)];if(!current||current.roomCode!==roomCode)throw fail('Mesa incompatível.');
    if(!current.result){current.result=safe;this.save();}return current.result;
  }
  async hasStarted(id){
    if(this.pool){const r=await this.pool.query('SELECT 1 FROM mm_tournament_table_games WHERE tournament_id=$1 LIMIT 1',[id]);return !!r.rowCount;}
    this.reload();return Object.keys(this.local).some(key=>key.startsWith(id+':'));
  }
  async clearLocal(id){if(this.pool)return;this.reload();for(const key of Object.keys(this.local)){if(key.startsWith(id+':'))delete this.local[key];}this.save();}
  async statuses(id,numbers){const out={};for(const n of numbers){const row=await this.get(id,n);if(row)out[n]={created:true,finished:!!row.result,result:row.result||null};}return out;}
}
module.exports={TournamentGames};

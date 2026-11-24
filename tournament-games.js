'use strict';
// V51.4 — identidade de cada mesa e resultado compacto, sem armazenar cartas.
const fs = require('node:fs');
const path = require('node:path');
const {isAbsenceRecord}=require('./tournament-empty-table');
function fail(message,status=409){return Object.assign(new Error(message),{status});}
class TournamentGames {
  constructor({pool=null,databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-games.json')}={}){
    this.pool=pool;this.filePath=filePath;this.local={};
    if(!pool&&databaseUrl){const {createAppDatabasePool}=require('./database-pool');this.pool=createAppDatabasePool(databaseUrl);}
  }
  async init(){
    if(this.pool){await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_table_games (
      tournament_id VARCHAR(64) NOT NULL REFERENCES mm_tournaments(id) ON DELETE CASCADE,
      table_number INTEGER NOT NULL CHECK(table_number>=1),
      room_code VARCHAR(10) NOT NULL UNIQUE,
      result_json JSONB,
      room_state VARCHAR(16) NOT NULL DEFAULT 'legacy',
      claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      PRIMARY KEY(tournament_id,table_number)
    )`);
      // Existing bindings cannot be assumed to be in the lobby.
      await this.pool.query(`ALTER TABLE mm_tournament_table_games ADD COLUMN IF NOT EXISTS room_state VARCHAR(16) NOT NULL DEFAULT 'legacy'`);
      await this.pool.query(`ALTER TABLE mm_tournament_table_games ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`);
      // Mesa sem comparecimento pode terminar sem nunca possuir código de sala.
      await this.pool.query(`ALTER TABLE mm_tournament_table_games ALTER COLUMN room_code DROP NOT NULL`);
    }
    else {fs.mkdirSync(path.dirname(this.filePath),{recursive:true});this.reload();}
  }
  reload(){if(this.pool)return;try{this.local=JSON.parse(fs.readFileSync(this.filePath,'utf8'));}catch(e){if(e.code==='ENOENT')this.local={};else throw e;}}
  save(){const tmp=this.filePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.local,null,2));fs.renameSync(tmp,this.filePath);}
  key(id,number){return `${id}:${number}`;}
  async get(id,number,client=null){
    if(this.pool){const r=await (client||this.pool).query(`SELECT room_code AS "roomCode",result_json AS result,room_state AS "roomState",EXTRACT(EPOCH FROM claimed_at)*1000 AS "claimedAt" FROM mm_tournament_table_games WHERE tournament_id=$1 AND table_number=$2`,[id,number]);return r.rows[0]||null;}
    this.reload();return this.local[this.key(id,number)]||null;
  }
  async claim(id,number,roomCode){
    if(!id||!Number.isInteger(number)||number<1||!roomCode)throw fail('Mesa inválida.',400);
    if(this.pool){await this.pool.query(`INSERT INTO mm_tournament_table_games(tournament_id,table_number,room_code,room_state,claimed_at)
      VALUES($1,$2,$3,'lobby',NOW()) ON CONFLICT (tournament_id,table_number) DO NOTHING`,[id,number,roomCode]);return this.get(id,number);}
    this.reload();const key=this.key(id,number);if(!this.local[key]){this.local[key]={roomCode,result:null,roomState:'lobby',claimedAt:Date.now()};this.save();}return this.local[key];
  }
  async markStarted(id,number,code){
    if(this.pool){const r=await this.pool.query(`UPDATE mm_tournament_table_games SET room_state='started'
      WHERE tournament_id=$1 AND table_number=$2 AND room_code=$3 AND room_state='lobby' AND result_json IS NULL RETURNING room_code`,[id,number,code]);
      if(!r.rowCount)throw fail('Não foi possível confirmar o início desta mesa.');return true;}
    this.reload();const row=this.local[this.key(id,number)];
    if(!row||row.roomCode!==code||row.result||row.roomState!=='lobby')throw fail('Mesa alterada ou já encerrada.');
    row.roomState='started';this.save();return true;
  }
  async reclaimLobby(id,number,oldCode,newCode){
    if(!oldCode||!newCode||oldCode===newCode)throw fail('Código de recuperação inválido.',400);
    if(this.pool){const r=await this.pool.query(`UPDATE mm_tournament_table_games
      SET room_code=$4, claimed_at=NOW() WHERE tournament_id=$1 AND table_number=$2
      AND room_code=$3 AND room_state='lobby' AND result_json IS NULL RETURNING room_code`,[id,number,oldCode,newCode]);
      if(!r.rowCount)throw fail('A mesa mudou de estado durante a recuperação. Tente novamente.');return this.get(id,number);}
    this.reload();const row=this.local[this.key(id,number)];
    if(!row||row.roomCode!==oldCode||row.roomState!=='lobby'||row.result)throw fail('A mesa mudou de estado durante a recuperação.');
    row.roomCode=newCode;row.claimedAt=Date.now();this.save();return row;
  }
  async finish({id,number,roomCode,result,expectedPlayers=null,client=null}){
    if(!roomCode||!Array.isArray(result?.results)||!result.results.length)throw fail('Resultado inválido.',400);
    // O resultado deve incluir todos os sorteados, inclusive ausentes.
    if(expectedPlayers===null)throw fail('Quantidade de participantes sorteados não informada.',400);
    const count=Number(expectedPlayers);
    if(!Number.isInteger(count)||count<1||result.results.length!==count)
      throw fail('Resultado incompleto: confira todos os participantes sorteados antes de encerrar a mesa.');
    const safe={...(isAbsenceRecord(result)?{noShow:true}:{}),matchId:String(result.matchId||'').slice(0,160),finishedAt:result.finishedAt,
      complete:true,
      results:result.results.map(p=>({name:String(p.name||'Jogador').slice(0,24),score:Number(p.score)||0,position:Number(p.position)||0,won:!!p.won&&!p.forfeited,forfeited:!!p.forfeited})).sort((a,b)=>a.position-b.position||a.score-b.score)};
    // finishedAt não deve tornar uma tentativa de repetição inválida quando o
    // conteúdo competitivo e o matchId são exatamente os mesmos.
    const normalizedRows=rows=>rows.map(p=>({name:p.name,score:p.score,position:p.position,
      won:p.won,forfeited:p.forfeited})).sort((a,b)=>a.position-b.position||a.score-b.score);
    const same=(saved)=>!!saved && saved.complete!==false && saved.matchId===safe.matchId &&
      Array.isArray(saved.results) && JSON.stringify(normalizedRows(saved.results))===JSON.stringify(normalizedRows(safe.results));
    if(this.pool){
      const query=client||this.pool;
      const r=await query.query(`UPDATE mm_tournament_table_games SET result_json=$4::jsonb,finished_at=NOW()
        WHERE tournament_id=$1 AND table_number=$2 AND room_code=$3 AND result_json IS NULL${safe.noShow?" AND room_state='lobby'":''}
        RETURNING result_json AS result`,[id,number,roomCode,JSON.stringify(safe)]);
      if(r.rowCount)return r.rows[0].result;
      const prev=await this.get(id,number,client);
      if(!prev||prev.roomCode!==roomCode)throw fail('Mesa incompatível ou não registrada.');
      if(!same(prev.result))throw fail('Esta mesa já tem um resultado diferente ou incompleto. A gravação foi bloqueada.');
      return prev.result;
    }
    this.reload();const current=this.local[this.key(id,number)];
    if(!current||current.roomCode!==roomCode)throw fail('Mesa incompatível.');
    if(current.result){
      if(!same(current.result))throw fail('Esta mesa já tem um resultado diferente ou incompleto. A gravação foi bloqueada.');
      return current.result;
    }
    if(safe.noShow&&current.roomState!=='lobby')throw fail('Mesa iniciada não pode ser encerrada por ausência inicial.');
    current.result=safe;this.save();return current.result;
  }
  async finishEmpty({id,number,roomCode,result,expectedPlayers,client=null}){
    if(!isAbsenceRecord(result)||result.results.length!==expectedPlayers)throw fail('Resultado de ausência inválido.');
    if(roomCode)return this.finish({id,number,roomCode,result,expectedPlayers,client});
    const safe={noShow:true,matchId:result.matchId,finishedAt:result.finishedAt,complete:true,
      results:result.results.map(p=>({name:String(p.name||'Jogador').slice(0,24),score:0,position:p.position,won:false,forfeited:true}))};
    if(this.pool){
      const query=client||this.pool;
      await query.query(`INSERT INTO mm_tournament_table_games(tournament_id,table_number,room_code,room_state,result_json,finished_at)
        VALUES($1,$2,NULL,'lobby',$3::jsonb,NOW()) ON CONFLICT(tournament_id,table_number) DO NOTHING`,[id,number,JSON.stringify(safe)]);
      const prev=await this.get(id,number,client);
      if(!prev||prev.roomCode!==null||!isAbsenceRecord(prev.result)||prev.result.matchId!==safe.matchId||JSON.stringify(prev.result.results.map(p=>[p.name,p.position]))!==JSON.stringify(safe.results.map(p=>[p.name,p.position])))throw fail('Mesa alterada durante o encerramento por ausência.');
      return prev.result;
    }
    this.reload();const key=this.key(id,number),prev=this.local[key];
    if(prev){if(prev.roomCode!==null||!isAbsenceRecord(prev.result)||JSON.stringify(prev.result)!==JSON.stringify(safe))throw fail('Mesa alterada durante o encerramento por ausência.');return prev.result;}
    this.local[key]={roomCode:null,roomState:'lobby',result:safe};this.save();return safe;
  }
  async hasStarted(id){
    if(this.pool){const r=await this.pool.query('SELECT 1 FROM mm_tournament_table_games WHERE tournament_id=$1 LIMIT 1',[id]);return !!r.rowCount;}
    this.reload();return Object.keys(this.local).some(key=>key.startsWith(id+':'));
  }
  async clearLocal(id){if(this.pool)return;this.reload();for(const key of Object.keys(this.local)){if(key.startsWith(id+':'))delete this.local[key];}this.save();}
  async statuses(id,numbers){const out={};for(const n of numbers){const row=await this.get(id,n);if(row){const complete=!!row.result&&row.result.complete!==false;out[n]={created:!!row.roomCode,finished:complete,result:complete?row.result:null};}}return out;}
}
module.exports={TournamentGames};

'use strict';
// V51.5 — fases e campeões de torneios. Apenas resultados compactos, identificados por conta.
// Jogadas, cartas, áudio, vídeo e mãos NÃO são registrados.
const fs=require('node:fs');
const path=require('node:path');
const {distribute}=require('./tournament-draw');
const STAGES=['qualifier','quarter','semi','final'];
const LABELS={qualifier:'Classificatórias',quarter:'Quartas de final',semi:'Semifinais',final:'Grande final'};
function fail(s,status=409){return Object.assign(new Error(s),{status});}
function validate(id,phase,number){
  if(!/^[-a-z0-9]{3,64}$/i.test(id||'')||!STAGES.includes(phase)||!Number.isInteger(number)||number<1||number>30)throw fail('Mesa inválida.',400);
}
function publicStage(row,advancedKeys=null){
  // Never expose playerKey: compare private identifiers exclusively on the server.
  return {stage:row.stage,number:row.number,players:row.players.map(p=>({name:p.name,seat:p.seat})),
    created:!!row.roomCode,finished:!!row.result,
    result:row.result?{complete:true,results:row.result.results.map(p=>({
      name:p.name,position:p.position,score:p.score,won:p.won,
      ...(advancedKeys?{advanced:advancedKeys.has(p.playerKey)}:{})
    }))}:null};
}
function candidatesFromStage(rows,quota){
  const candidates=[];
  for(const table of rows){
    if(!table.result||table.result.results.length!==table.players.length)throw fail('Há resultado ausente ou parcial. Conclua todas as partidas antes da classificação.');
    const ordered=[...table.result.results].sort((a,b)=>a.score-b.score || a.position-b.position);
    // Empate no limite: sorteio automático, sem escolha do organizador.
    const randomized=[];
    for(let i=0;i<ordered.length;){let j=i+1;while(j<ordered.length&&ordered[i].score===ordered[j].score)j++;
      const group=ordered.slice(i,j);const crypto=require('node:crypto');
      for(let k=group.length-1;k>0;k--){const x=crypto.randomInt(k+1);[group[x],group[k]]=[group[k],group[x]];}
      randomized.push(...group);i=j;}
    for(const p of randomized.slice(0,quota))candidates.push({playerKey:p.playerKey,name:p.name});
  }
  return candidates;
}
function nextStage(stage,tables){
  const n=tables.length;
  if(stage==='qualifier'){
    if(n===1)return null;
    if(n===2)return {phase:'final',quota:2};
    if(n<=5)return {phase:'semi',quota:2};
    if(n<=10)return {phase:'semi',quota:1};
    return {phase:'quarter',quota:1};
  }
  if(stage==='quarter')return {phase:'semi',quota:2};
  if(stage==='semi')return {phase:'final',quota:2};
  return null;
}
class TournamentBracket{
  constructor({pool=null,databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-bracket.json'),draw=null}={}){
    this.pool=pool;this.draw=draw;this.filePath=filePath;this.local={};
    if(!pool&&databaseUrl){const {Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});}
  }
  async init(){
    if(this.pool){await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_stage_tables(
      tournament_id VARCHAR(64) NOT NULL REFERENCES mm_tournaments(id) ON DELETE CASCADE,
      stage VARCHAR(12) NOT NULL CHECK(stage IN ('qualifier','quarter','semi','final')),
      table_number INTEGER NOT NULL CHECK(table_number>=1),
      players_json JSONB NOT NULL,
      room_code VARCHAR(10) UNIQUE,
      result_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(tournament_id,stage,table_number))`);}
    else {fs.mkdirSync(path.dirname(this.filePath),{recursive:true});this.reload();}
  }
  reload(){if(this.pool)return;try{this.local=JSON.parse(fs.readFileSync(this.filePath,'utf8'));}catch(e){if(e.code==='ENOENT')this.local={};else throw e;}}
  save(){const tmp=this.filePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.local,null,2));fs.renameSync(tmp,this.filePath);}
  async rows(id,client=null){
    if(this.pool){const r=await (client||this.pool).query(`SELECT stage,table_number AS number,players_json AS players,room_code AS "roomCode",result_json AS result FROM mm_tournament_stage_tables WHERE tournament_id=$1 ORDER BY CASE stage WHEN 'qualifier' THEN 0 WHEN 'quarter' THEN 1 WHEN 'semi' THEN 2 ELSE 3 END,table_number`,[id]);return r.rows;}
    this.reload();return this.local[id]||[];
  }
  async seatFor(id,phase,number,playerKey){
    validate(id,phase,number);if(!playerKey)return null;
    const t=(await this.rows(id)).find(r=>r.stage===phase&&r.number===number);
    return t?.players.some(p=>p.playerKey===playerKey)?{number,players:t.players}:null;
  }
  async getBinding(id,phase,number){const rows=await this.rows(id);return rows.find(t=>t.stage===phase&&t.number===number)||null;}
  async claim(id,phase,number,roomCode){
    validate(id,phase,number);if(phase==='qualifier')throw fail('Mesa inicial usa o sorteio original.');
    if(this.pool){await this.pool.query(`UPDATE mm_tournament_stage_tables SET room_code=$4 WHERE tournament_id=$1 AND stage=$2 AND table_number=$3 AND room_code IS NULL`,[id,phase,number,roomCode]);return this.getBinding(id,phase,number);}
    this.reload();const row=(this.local[id]||[]).find(t=>t.stage===phase&&t.number===number);if(!row)throw fail('Mesa não encontrada.',404);
    if(!row.roomCode){row.roomCode=roomCode;this.save();}return row;
  }
  async recordResult({id,stage='qualifier',number,roomCode,result,players}){
    validate(id,stage,number);
    if(!roomCode||!Array.isArray(result?.results)||!result.results.length||!Array.isArray(players)||!players.length)throw fail('Resultado de torneio inválido.',400);
    const byKey=new Map(players.map(p=>[p.playerKey,p]));
    const mapped=result.results.map(p=>({playerKey:p.playerKey,name:String(p.name||'Jogador').slice(0,24),score:Number(p.score),position:Number(p.position),won:!!p.won}));
    if(mapped.length!==players.length||new Set(mapped.map(p=>p.playerKey)).size!==players.length||
       mapped.some(p=>!byKey.has(p.playerKey)||!Number.isFinite(p.score)||p.score<0||!Number.isInteger(p.position)||p.position<1))
      throw fail('A partida não tem o resultado completo dos jogadores sorteados. Avanço bloqueado.');
    const record={matchId:String(result.matchId||'').slice(0,160),finishedAt:String(result.finishedAt||new Date().toISOString()),results:mapped};
    const seats=players.map((p,i)=>({playerKey:p.playerKey,name:String(p.name||'Jogador').slice(0,24),seat:i+1}));
    if(this.pool){
      if(stage==='qualifier')await this.pool.query(`INSERT INTO mm_tournament_stage_tables(tournament_id,stage,table_number,players_json,room_code,result_json)
        VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT(tournament_id,stage,table_number) DO NOTHING`,[id,stage,number,JSON.stringify(seats),roomCode,JSON.stringify(record)]);
      else await this.pool.query(`UPDATE mm_tournament_stage_tables SET result_json=$5::jsonb WHERE tournament_id=$1 AND stage=$2 AND table_number=$3 AND room_code=$4 AND result_json IS NULL`,[id,stage,number,roomCode,JSON.stringify(record)]);
    }else{
      this.reload();const list=this.local[id]||[];let row=list.find(t=>t.stage===stage&&t.number===number);
      if(!row&&stage==='qualifier'){row={stage,number,players:seats,roomCode,result:record};list.push(row);this.local[id]=list;this.save();}
      else if(!row||row.roomCode!==roomCode)throw fail('Mesa não encontrada ou diferente.',409);
      else if(!row.result){row.result=record;this.save();}
    }
    return record;
  }
  async advance(id,initialTables){
    if(!Array.isArray(initialTables)||!initialTables.length)return this.summary(id,initialTables);
    if(this.pool){
      const conn=await this.pool.connect();
      try{await conn.query('BEGIN');await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tournament:${id}`]);
        await this.advanceLocked(id,initialTables,conn);await conn.query('COMMIT');
      }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
    }else await this.advanceLocked(id,initialTables,null);
    return this.summary(id,initialTables);
  }
  async advanceLocked(id,initialTables,conn){
    let rows=await this.rows(id,conn);
    for(const stage of STAGES){
      const current=rows.filter(r=>r.stage===stage);
      if(stage==='qualifier'&&current.length!==initialTables.length)return;
      if(!current.length)continue;
      if(!current.every(t=>t.result&&t.result.results.length===t.players.length))return;
      const move=nextStage(stage,current);
      if(!move)return;
      if(rows.some(x=>x.stage===move.phase))continue;
      const qualified=candidatesFromStage(current,move.quota);
      const tables=distribute(qualified);
      if(this.pool){for(const t of tables)await conn.query(`INSERT INTO mm_tournament_stage_tables(tournament_id,stage,table_number,players_json)
        VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,[id,move.phase,t.number,JSON.stringify(t.players)]);}
      else{const list=this.local[id]||[];for(const t of tables)list.push({stage:move.phase,number:t.number,players:t.players,roomCode:null,result:null});this.local[id]=list;this.save();}
      rows=await this.rows(id,conn);
    }
  }
  async summary(id,initialTables=[]){
    const rows=await this.rows(id);
    const stages=STAGES.map((stage,index)=>{
      const next=STAGES.slice(index+1).find(candidate=>rows.some(r=>r.stage===candidate));
      const advancedKeys=next?new Set(rows.filter(r=>r.stage===next).flatMap(r=>r.players.map(p=>p.playerKey))):null;
      return {stage,label:LABELS[stage],tables:rows.filter(r=>r.stage===stage).map(row=>publicStage(row,advancedKeys))};
    }).filter(s=>s.tables.length);
    const latest=stages.at(-1);let champion=null;
    if(latest&&latest.tables.length===1&&latest.tables[0].finished){
      const winners=latest.tables[0].result.results.filter(p=>p.won).map(p=>({name:p.name,score:p.score}));
      if(winners.length)champion={names:winners,stage:latest.stage,standings:latest.tables[0].result.results.map(p=>({name:p.name,position:p.position,score:p.score})).sort((a,b)=>a.position-b.position||a.score-b.score)};
    }
    // Partidas intermediárias com apenas uma mesa só são finais se não houver fase seguinte.
    return {stages,currentStage:latest?.stage||'qualifier',champion};
  }
  async clearLocal(id){if(this.pool)return;this.reload();delete this.local[id];this.save();}
}
module.exports={TournamentBracket,STAGES,LABELS,nextStage,candidatesFromStage};

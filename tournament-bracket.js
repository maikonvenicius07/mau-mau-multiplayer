'use strict';
// V51.5 — fases e campeões de torneios. Apenas resultados compactos, identificados por conta.
// Jogadas, cartas, áudio, vídeo e mãos NÃO são registrados.
const fs=require('node:fs');
const path=require('node:path');
const {planNextStageDraw,assertExistingStageDraw}=require('./tournament-next-stage-draw');
const TournamentWait=require('./tournament-wait');
const {assertTournamentTable}=require('./tournament-table-capacity');
// Fase adicional apenas para torneios grandes (65–100 inscritos).
// A progressão de torneios menores permanece intocada.
const STAGES=['qualifier','quarter','extra','semi','final'];
const LABELS={qualifier:'Classificatórias',quarter:'Quartas de final',extra:'Fase adicional',semi:'Semifinais',final:'Grande final'};
function fail(s,status=409){return Object.assign(new Error(s),{status});}
function validate(id,phase,number){
  if(!/^[-a-z0-9]{3,64}$/i.test(id||'')||!STAGES.includes(phase)||!Number.isInteger(number)||number<1||number>30)throw fail('Mesa inválida.',400);
}
function publicStage(row,advancedKeys=null){
  // Never expose playerKey: compare private identifiers exclusively on the server.
  return {stage:row.stage,number:row.number,players:row.players.map(p=>({name:p.name,seat:p.seat})),
    created:!!row.roomCode,finished:!!row.result,
    result:row.result?{complete:true,results:row.result.results.map(p=>({
      name:p.name,position:p.position,score:p.score,won:p.won,forfeited:!!p.forfeited,
      ...(advancedKeys?{advanced:advancedKeys.has(p.playerKey)}:{})
    }))}:null};
}
function candidatesFromStage(rows,quota){
  const candidates=[];
  for(const table of rows){
    if(!table.result||table.result.results.length!==table.players.length)throw fail('Há resultado ausente ou parcial. Conclua todas as partidas antes da classificação.');
    // Desistentes nunca podem ocupar as vagas de classificação.
    const ordered=table.result.results.filter(p=>!p.forfeited).sort((a,b)=>a.score-b.score || a.position-b.position);
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
    // A cap de quatro lugares cria mais mesas que o antigo sorteio de cinco.
    // Mantemos a quota original POR mesa de origem; usamos as quartas (fase
    // existente) para que 5+ mesas não produzam mais de 4 finalistas.
    if(n===3||n===4)return {phase:'semi',quota:2};
    if(n===5)return {phase:'quarter',quota:2};
    if(n<=10)return {phase:'quarter',quota:1};
    return {phase:'quarter',quota:1};
  }
  // Com mais de quatro mesas de quartas, manter os dois classificados por
  // mesa, mas criar uma fase adicional antes das semifinais. Isso permite
  // reduzir 10–14 classificados a 6–8 e preservar uma final única de 4.
  if(stage==='quarter')return {phase:n>4?'extra':'semi',quota:2};
  if(stage==='extra')return {phase:'semi',quota:2};
  if(stage==='semi')return {phase:'final',quota:2};
  return null;
}
class TournamentBracket{
  constructor({pool=null,databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-bracket.json'),draw=null}={}){
    this.pool=pool;this.draw=draw;this.filePath=filePath;this.local={};this._localAdvances=new Map();
    if(!pool&&databaseUrl){const {createAppDatabasePool}=require('./database-pool');this.pool=createAppDatabasePool(databaseUrl);}
  }
  async init(){
    if(this.pool){await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_stage_tables(
      tournament_id VARCHAR(64) NOT NULL REFERENCES mm_tournaments(id) ON DELETE CASCADE,
      stage VARCHAR(12) NOT NULL CHECK(stage IN ('qualifier','quarter','extra','semi','final')),
      table_number INTEGER NOT NULL CHECK(table_number>=1),
      players_json JSONB NOT NULL,
      room_code VARCHAR(10) UNIQUE,
      result_json JSONB,
      room_state VARCHAR(16) NOT NULL DEFAULT 'legacy',
      claimed_at TIMESTAMPTZ,
      wait_deadline_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(tournament_id,stage,table_number))`);
      // Instalação existente: o CHECK criado nas versões anteriores não permite
      // 'extra'. A migração é idempotente e não altera mesas já gravadas.
      await this.pool.query('ALTER TABLE mm_tournament_stage_tables DROP CONSTRAINT IF EXISTS mm_tournament_stage_tables_stage_check');
      await this.pool.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mm_tournament_stage_allowed'
          AND conrelid='mm_tournament_stage_tables'::regclass) THEN
          ALTER TABLE mm_tournament_stage_tables ADD CONSTRAINT mm_tournament_stage_allowed
            CHECK(stage IN ('qualifier','quarter','extra','semi','final')) NOT VALID;
        END IF;
      END $$;`);
      await this.pool.query(`ALTER TABLE mm_tournament_stage_tables ADD COLUMN IF NOT EXISTS room_state VARCHAR(16) NOT NULL DEFAULT 'legacy'`);
      await this.pool.query(`ALTER TABLE mm_tournament_stage_tables ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`);
      await this.pool.query(`ALTER TABLE mm_tournament_stage_tables ADD COLUMN IF NOT EXISTS wait_deadline_at TIMESTAMPTZ`);
      await this.pool.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mm_tournament_stage_max4'
          AND conrelid = 'mm_tournament_stage_tables'::regclass) THEN
          ALTER TABLE mm_tournament_stage_tables ADD CONSTRAINT mm_tournament_stage_max4
            CHECK (jsonb_typeof(players_json) = 'array' AND jsonb_array_length(players_json) BETWEEN 2 AND 4) NOT VALID;
        END IF;
      END $$;`);
    }
    else {fs.mkdirSync(path.dirname(this.filePath),{recursive:true});this.reload();}
  }
  reload(){if(this.pool)return;try{this.local=JSON.parse(fs.readFileSync(this.filePath,'utf8'));}catch(e){if(e.code==='ENOENT')this.local={};else throw e;}}
  save(){const tmp=this.filePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.local,null,2));fs.renameSync(tmp,this.filePath);}
  async rows(id,client=null){
    if(this.pool){const r=await (client||this.pool).query(`SELECT stage,table_number AS number,players_json AS players,room_code AS "roomCode",result_json AS result,room_state AS "roomState",EXTRACT(EPOCH FROM claimed_at)*1000 AS "claimedAt",EXTRACT(EPOCH FROM created_at)*1000 AS "createdAt",EXTRACT(EPOCH FROM wait_deadline_at)*1000 AS "waitDeadlineAt" FROM mm_tournament_stage_tables WHERE tournament_id=$1 ORDER BY CASE stage WHEN 'qualifier' THEN 0 WHEN 'quarter' THEN 1 WHEN 'extra' THEN 2 WHEN 'semi' THEN 3 ELSE 4 END,table_number`,[id]);return r.rows;}
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
    if(this.pool){await this.pool.query(`UPDATE mm_tournament_stage_tables SET room_code=$4,room_state='lobby',claimed_at=NOW()
      WHERE tournament_id=$1 AND stage=$2 AND table_number=$3 AND room_code IS NULL`,[id,phase,number,roomCode]);return this.getBinding(id,phase,number);}
    this.reload();const row=(this.local[id]||[]).find(t=>t.stage===phase&&t.number===number);if(!row)throw fail('Mesa não encontrada.',404);
    if(!row.roomCode){row.roomCode=roomCode;row.roomState='lobby';row.claimedAt=Date.now();this.save();}return row;
  }
  async markStarted(id,phase,number,code){
    validate(id,phase,number);
    if(this.pool){const r=await this.pool.query(`UPDATE mm_tournament_stage_tables SET room_state='started'
      WHERE tournament_id=$1 AND stage=$2 AND table_number=$3 AND room_code=$4 AND room_state='lobby' AND result_json IS NULL RETURNING room_code`,[id,phase,number,code]);
      if(!r.rowCount)throw fail('Não foi possível confirmar o início desta mesa.');return true;}
    this.reload();const row=(this.local[id]||[]).find(t=>t.stage===phase&&t.number===number);
    if(!row||row.roomCode!==code||row.result||row.roomState!=='lobby')throw fail('Mesa alterada ou já encerrada.');
    row.roomState='started';this.save();return true;
  }
  async reclaimLobby(id,phase,number,oldCode,newCode){
    validate(id,phase,number);
    if(!oldCode||!newCode||oldCode===newCode)throw fail('Código de recuperação inválido.',400);
    if(this.pool){const r=await this.pool.query(`UPDATE mm_tournament_stage_tables
      SET room_code=$5,claimed_at=NOW() WHERE tournament_id=$1 AND stage=$2 AND table_number=$3
      AND room_code=$4 AND room_state='lobby' AND result_json IS NULL RETURNING room_code`,[id,phase,number,oldCode,newCode]);
      if(!r.rowCount)throw fail('A mesa mudou de estado durante a recuperação. Tente novamente.');return this.getBinding(id,phase,number);}
    this.reload();const row=(this.local[id]||[]).find(t=>t.stage===phase&&t.number===number);
    if(!row||row.roomCode!==oldCode||row.roomState!=='lobby'||row.result)throw fail('A mesa mudou de estado durante a recuperação.');
    row.roomCode=newCode;row.claimedAt=Date.now();this.save();return row;
  }
  // Reabertura EXCEPCIONAL sob autorização do organizador, após confirmar
  // ausência de sala ativa, snapshot e resultado. A mesa seguinte nasce vazia.
  async reopenUnrecoverable(id,phase,number,oldCode){
    validate(id,phase,number);
    if(phase!=='final'||!oldCode)throw fail('Recuperação disponível somente para a mesa final indisponível.',400);
    if(this.pool){
      const r=await this.pool.query(`UPDATE mm_tournament_stage_tables
        SET room_code=NULL,room_state='lobby',claimed_at=NULL
        WHERE tournament_id=$1 AND stage=$2 AND table_number=$3 AND room_code=$4
          AND result_json IS NULL AND room_state IN ('started','legacy') RETURNING table_number`,
        [id,phase,number,oldCode]);
      if(!r.rowCount)throw fail('O estado da final mudou. Atualize o painel antes de tentar novamente.');
      return true;
    }
    this.reload();
    const row=(this.local[id]||[]).find(t=>t.stage===phase&&t.number===number);
    if(!row||row.roomCode!==oldCode||row.result||!['started','legacy'].includes(row.roomState))
      throw fail('O estado da final mudou. Atualize o painel antes de tentar novamente.');
    row.roomCode=null;row.roomState='lobby';row.claimedAt=null;this.save();return true;
  }
  async recordResult({id,stage='qualifier',number,roomCode,result,players,client=null}){
    validate(id,stage,number);
    if(!roomCode||!Array.isArray(result?.results)||!result.results.length||!Array.isArray(players)||!players.length)throw fail('Resultado de torneio inválido.',400);
    const byKey=new Map(players.map(p=>[p.playerKey,p]));
    const mapped=result.results.map(p=>({playerKey:p.playerKey,name:String(p.name||'Jogador').slice(0,24),score:Number(p.score),position:Number(p.position),won:!!p.won&&!p.forfeited,forfeited:!!p.forfeited}));
    if(players.some(p=>!p.playerKey))throw fail('Participantes inválidos.',400);
    if(byKey.size!==players.length||mapped.length!==players.length||new Set(mapped.map(p=>p.playerKey)).size!==players.length||
       mapped.some(p=>!p.playerKey||!byKey.has(p.playerKey)||!Number.isFinite(p.score)||p.score<0||!Number.isInteger(p.position)||p.position<1))
      throw fail('A partida não tem o resultado completo dos jogadores sorteados. Avanço bloqueado.');
    const record={matchId:String(result.matchId||'').slice(0,160),finishedAt:String(result.finishedAt||new Date().toISOString()),results:mapped};
    const seats=players.map((p,i)=>({playerKey:p.playerKey,name:String(p.name||'Jogador').slice(0,24),seat:i+1}));
    assertTournamentTable(seats);
    const normalizedRows=rows=>rows.map(p=>({playerKey:p.playerKey,name:p.name,score:p.score,
      position:p.position,won:p.won,forfeited:p.forfeited})).sort((a,b)=>a.playerKey.localeCompare(b.playerKey));
    const same=(saved)=>!!saved && saved.matchId===record.matchId && Array.isArray(saved.results) &&
      JSON.stringify(normalizedRows(saved.results))===JSON.stringify(normalizedRows(record.results));
    const sameRoster=(stored)=>Array.isArray(stored)&&stored.length===seats.length&&
      stored.every(p=>byKey.has(p.playerKey))&&new Set(stored.map(p=>p.playerKey)).size===seats.length;
    if(this.pool){
      const query=client||this.pool;
      let saved;
      if(stage==='qualifier'){
        const inserted=await query.query(`INSERT INTO mm_tournament_stage_tables(tournament_id,stage,table_number,players_json,room_code,result_json)
          VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT(tournament_id,stage,table_number) DO NOTHING
          RETURNING result_json AS result`,[id,stage,number,JSON.stringify(seats),roomCode,JSON.stringify(record)]);
        if(inserted.rowCount)return inserted.rows[0].result;
      }else{
        // Verifica o roster persistido ANTES do UPDATE. Uma mesa com o mesmo
        // código, mas participantes divergentes, nunca pode receber resultado.
        const bound=await query.query(`SELECT players_json AS players,room_code AS "roomCode",result_json AS result
          FROM mm_tournament_stage_tables WHERE tournament_id=$1 AND stage=$2 AND table_number=$3 FOR UPDATE`,[id,stage,number]);
        const binding=bound.rows[0];
        if(!binding||binding.roomCode!==roomCode||!sameRoster(binding.players))
          throw fail('Participantes ou mesa incompatíveis com a fase sorteada.');
        if(binding.result){
          if(!same(binding.result))throw fail('Esta fase já possui resultado conflitante.');
          return binding.result;
        }
        const updated=await query.query(`UPDATE mm_tournament_stage_tables SET result_json=$5::jsonb
          WHERE tournament_id=$1 AND stage=$2 AND table_number=$3 AND room_code=$4 AND result_json IS NULL
          RETURNING result_json AS result`,[id,stage,number,roomCode,JSON.stringify(record)]);
        if(updated.rowCount)return updated.rows[0].result;
      }
      // ON CONFLICT DO NOTHING e UPDATE com 0 linhas não significam sucesso.
      const existing=await query.query(`SELECT players_json AS players,room_code AS "roomCode",result_json AS result
        FROM mm_tournament_stage_tables WHERE tournament_id=$1 AND stage=$2 AND table_number=$3`,[id,stage,number]);
      saved=existing.rows[0];
      if(!saved||saved.roomCode!==roomCode||!sameRoster(saved.players)||!same(saved.result))
        throw fail('O resultado da fase não foi gravado: mesa, participantes ou resultado divergentes.');
      return saved.result;
    }
    this.reload();const list=this.local[id]||[];let row=list.find(t=>t.stage===stage&&t.number===number);
    if(!row&&stage==='qualifier'){
      row={stage,number,players:seats,roomCode,result:record};list.push(row);this.local[id]=list;this.save();return record;
    }
    if(!row||row.roomCode!==roomCode||!sameRoster(row.players))throw fail('Mesa não encontrada ou diferente.',409);
    if(row.result){if(!same(row.result))throw fail('Resultado já registrado é diferente. A classificação foi bloqueada.');return row.result;}
    row.result=record;this.save();return record;
  }
  async advance(id,initialTables){
    if(!Array.isArray(initialTables)||!initialTables.length)return this.summary(id,initialTables);
    if(this.pool){
      const conn=await this.pool.connect();
      try{await conn.query('BEGIN');await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tournament:${id}`]);
        await this.advanceLocked(id,initialTables,conn);await conn.query('COMMIT');
      }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
    }else{
      // Concorrência de resultados simultâneos também no armazenamento local.
      const previous=this._localAdvances.get(id)||Promise.resolve();
      const task=previous.catch(()=>{}).then(()=>this.advanceLocked(id,initialTables,null));
      this._localAdvances.set(id,task);
      try{await task;}finally{if(this._localAdvances.get(id)===task)this._localAdvances.delete(id);}
    }
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
      const existing=rows.filter(x=>x.stage===move.phase);
      if(existing.length){
        // A fase já sorteada é imutável. Se estiver parcial ou divergente,
        // sinalizar erro em vez de reorganizar mesas e perder as vagas.
        assertExistingStageDraw(current,move.quota,existing);
        continue;
      }
      const qualified=candidatesFromStage(current,move.quota);
      const tables=planNextStageDraw(qualified);
      for(const table of tables)assertTournamentTable(table.players);
      if(move.phase==='final'&&tables.length!==1)
        throw fail('A grande final exige uma mesa única de dois a quatro classificados. Avanço bloqueado para proteger os resultados.');
      const createdAt=Date.now(),waitDeadlineAt=createdAt+TournamentWait.WAIT_MS;
      if(this.pool){for(const t of tables)await conn.query(`INSERT INTO mm_tournament_stage_tables(tournament_id,stage,table_number,players_json,wait_deadline_at)
        VALUES($1,$2,$3,$4::jsonb,$5::timestamptz) ON CONFLICT DO NOTHING`,[id,move.phase,t.number,JSON.stringify(t.players),new Date(waitDeadlineAt).toISOString()]);}
      else{const list=this.local[id]||[];for(const t of tables)list.push({stage:move.phase,number:t.number,players:t.players,roomCode:null,result:null,createdAt,waitDeadlineAt});this.local[id]=list;this.save();}
      rows=await this.rows(id,conn);
      assertExistingStageDraw(current,move.quota,rows.filter(x=>x.stage===move.phase));
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
    // Uma classificatória terminada NÃO declara campeão enquanto existirem outras mesas.
    // Somente a etapa terminal (final, ou classificatória única com todos os inscritos)
    // pode encerrar o torneio. Evita bloquear as mesas restantes pela checagem de champion.
    const completeInitial=latest?.stage!=='qualifier'||(
      Array.isArray(initialTables)&&initialTables.length===latest.tables.length
    );
    const terminalStage=latest&&!nextStage(latest.stage,latest.tables);
    if(terminalStage&&completeInitial&&latest.tables.length===1&&latest.tables[0].finished){
      const winners=latest.tables[0].result.results.filter(p=>p.won).map(p=>({name:p.name,score:p.score}));
      if(winners.length)champion={names:winners,stage:latest.stage,standings:latest.tables[0].result.results.map(p=>({name:p.name,position:p.position,score:p.score,forfeited:!!p.forfeited})).sort((a,b)=>a.position-b.position||a.score-b.score)};
    }
    // Partidas intermediárias com apenas uma mesa só são finais se não houver fase seguinte.
    return {stages,currentStage:latest?.stage||'qualifier',champion};
  }
  async clearLocal(id){if(this.pool)return;this.reload();delete this.local[id];this.save();}
}
module.exports={TournamentBracket,STAGES,LABELS,nextStage,candidatesFromStage};

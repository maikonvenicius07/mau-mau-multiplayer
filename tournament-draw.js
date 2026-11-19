'use strict';
// V51.3: sorteio de mesas, sem criar partidas, tocar nas cartas ou registrar resultados.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const TournamentWait=require('./tournament-wait');
const {MAX_TOURNAMENT_PLAYERS,assertTournamentTable}=require('./tournament-table-capacity');

function fail(message, status=409){return Object.assign(new Error(message),{status});}
function shuffled(rows, randomInt=crypto.randomInt){
  const out=rows.slice();
  for(let i=out.length-1;i>0;i--){const j=randomInt(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function distribute(rows, randomInt=crypto.randomInt){
  if(rows.length<2)throw fail('O sorteio exige pelo menos dois inscritos.');
  const keys=rows.map(p=>p?.playerKey);
  if(keys.some(k=>typeof k!=='string'||!k)||new Set(keys).size!==keys.length)
    throw fail('O sorteio foi bloqueado: há participante inválido ou duplicado.');
  const count=Math.ceil(rows.length/MAX_TOURNAMENT_PLAYERS);
  const base=Math.floor(rows.length/count),extra=rows.length%count;
  const groups=[],list=shuffled(rows,randomInt);let index=0;
  for(let t=0;t<count;t++){
    const size=base+(t<extra?1:0),players=[];
    for(let seat=1;seat<=size;seat++){
      const p=list[index++];players.push({playerKey:p.playerKey,name:p.name,seat});
    }
    assertTournamentTable(players);
    groups.push({number:t+1,players});
  }
  return groups;
}
function publicTables(groups){return groups.map(t=>({number:t.number,players:t.players.map(p=>({name:p.name,seat:p.seat}))}));}
class TournamentDraw{
  constructor({pool=null,databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-draws.json'),signupsFilePath=path.join(__dirname,'data','tournament-signups.json')}={}){
    this.filePath=filePath;this.signupsFilePath=signupsFilePath;this.pool=pool;
    if(!this.pool&&databaseUrl){const {createAppDatabasePool}=require('./database-pool');this.pool=createAppDatabasePool(databaseUrl);}
    this.local={};
  }
  async init(){
    if(this.pool){
      await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_table_seats (
        tournament_id VARCHAR(64) NOT NULL,
        player_key VARCHAR(80) NOT NULL,
        display_name VARCHAR(24) NOT NULL,
        table_number INTEGER NOT NULL CHECK(table_number>=1),
        seat_number INTEGER NOT NULL CHECK(seat_number BETWEEN 1 AND 4),
        drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        wait_deadline_at TIMESTAMPTZ,
        PRIMARY KEY(tournament_id,player_key),
        UNIQUE(tournament_id,table_number,seat_number)
      )`);
      // Nullable: torneios sorteados antes desta versão não devem ser
      // desclassificados retroativamente com base em um sorteio antigo.
      await this.pool.query('ALTER TABLE mm_tournament_table_seats ADD COLUMN IF NOT EXISTS wait_deadline_at TIMESTAMPTZ');
      // NOT VALID preserva registros antigos para auditoria, mas recusa novas
      // atribuições que ultrapassem quatro lugares mesmo em bases antigas.
      await this.pool.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mm_tournament_seat_max4'
          AND conrelid = 'mm_tournament_table_seats'::regclass) THEN
          ALTER TABLE mm_tournament_table_seats ADD CONSTRAINT mm_tournament_seat_max4
            CHECK (seat_number BETWEEN 1 AND 4) NOT VALID;
        END IF;
      END $$;`);
    }else{
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
      try{const data=JSON.parse(fs.readFileSync(this.filePath,'utf8'));this.local=data&&typeof data==='object'&&!Array.isArray(data)?data:{};}
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
  }
  reloadLocal(){
    if(this.pool)return;
    try{const data=JSON.parse(fs.readFileSync(this.filePath,'utf8'));this.local=data&&typeof data==='object'&&!Array.isArray(data)?data:{};}
    catch(e){if(e.code==='ENOENT')this.local={};else throw e;}
  }
  async get(id){
    if(typeof id!=='string'||!id||id.length>64)return [];
    if(!this.pool){this.reloadLocal();return publicTables(this.local[id]||[]);}
    const {rows}=await this.pool.query(`SELECT table_number AS "tableNumber", seat_number AS "seatNumber",display_name AS name
      FROM mm_tournament_table_seats WHERE tournament_id=$1 ORDER BY table_number,seat_number`,[id]);
    const groups=[];
    for(const x of rows){let group=groups.at(-1);if(!group||group.number!==x.tableNumber){group={number:x.tableNumber,players:[]};groups.push(group);}
      group.players.push({name:x.name,seat:x.seatNumber});}
    return groups;
  }
  // Apenas para o servidor: as identidades NÃO devem integrar publicTables/HTTP.
  // O sorteio define o marco único da espera, também após reinício do Render.
  async waitDeadlineAt(id,number){
    if(typeof id!=='string'||!Number.isInteger(number)||number<1)return null;
    if(this.pool){
      const r=await this.pool.query(`SELECT EXTRACT(EPOCH FROM MIN(wait_deadline_at))*1000 AS "deadlineAt"
        FROM mm_tournament_table_seats WHERE tournament_id=$1 AND table_number=$2`,[id,number]);
      return Number(r.rows[0]?.deadlineAt)||null;
    }
    this.reloadLocal();const t=(this.local[id]||[]).find(x=>x.number===number);
    return Number(t?.waitDeadlineAt)||null;
  }
  async waitStartedAt(id,number){
    if(typeof id!=='string'||!Number.isInteger(number)||number<1)return null;
    if(this.pool){
      const r=await this.pool.query(`SELECT EXTRACT(EPOCH FROM MIN(drawn_at))*1000 AS "startedAt"
        FROM mm_tournament_table_seats WHERE tournament_id=$1 AND table_number=$2`,[id,number]);
      return Number(r.rows[0]?.startedAt)||null;
    }
    this.reloadLocal();const t=(this.local[id]||[]).find(x=>x.number===number);
    return Number(t?.drawnAt)||null;
  }
  async seatAssignments(id){
    if(typeof id!=='string'||!id||id.length>64)return [];
    if(this.pool){
      const {rows}=await this.pool.query(`SELECT player_key AS "playerKey", table_number AS "tableNumber"
        FROM mm_tournament_table_seats WHERE tournament_id=$1 ORDER BY table_number,seat_number`,[id]);
      return rows;
    }
    this.reloadLocal();
    return (this.local[id]||[]).flatMap(table=>table.players.map(p=>({playerKey:p.playerKey,tableNumber:table.number})));
  }
  async assignedTableFor(id,playerKey){
    if(!playerKey)return null;
    const seats=await this.seatAssignments(id);
    return seats.find(p=>p.playerKey===playerKey)?.tableNumber||null;
  }
  // Retorna identidade privada apenas ao servidor; nunca expor chaves aos clientes.
  async seatFor(id,number,playerKey){
    if(typeof id!=='string'||!id||id.length>64||!Number.isInteger(number)||number<1||!playerKey)return null;
    if(this.pool){
      const {rows}=await this.pool.query(`SELECT player_key AS "playerKey", display_name AS name, seat_number AS seat
        FROM mm_tournament_table_seats WHERE tournament_id=$1 AND table_number=$2 ORDER BY seat_number`,[id,number]);
      return rows.some(p=>p.playerKey===playerKey)?{players:rows,number}:null;
    }
    this.reloadLocal();const group=(this.local[id]||[]).find(t=>t.number===number);
    return group?.players.some(p=>p.playerKey===playerKey)?{number,players:group.players}:null;
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
        // Uma única data absoluta para todas as mesas do sorteio.
        const waitDeadlineAt=new Date(Date.now()+TournamentWait.WAIT_MS).toISOString();
        for(const t of tables){for(const p of t.players){
          await client.query('INSERT INTO mm_tournament_table_seats(tournament_id,player_key,display_name,table_number,seat_number,wait_deadline_at) VALUES($1,$2,$3,$4,$5,$6::timestamptz)',[id,p.playerKey,p.name,t.number,p.seat,waitDeadlineAt]);
        }}
        await client.query('COMMIT');return publicTables(tables);
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }
    // Armazenamento JSON apenas para testes/desenvolvimento local.
    this.reloadLocal();
    if(this.local[id]?.length)throw fail('As mesas desse torneio já foram sorteadas.');
    const catalogPath=path.join(path.dirname(this.filePath),'tournaments.json');
    let events=[];try{events=JSON.parse(fs.readFileSync(catalogPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const event=events.find(t=>t.id===id);
    if(!event)throw fail('Torneio não encontrado.',404);
    if(event.status!=='closed')throw fail('Encerre as inscrições antes de sortear as mesas.');
    let signups=[];try{signups=JSON.parse(fs.readFileSync(this.signupsFilePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const tables=distribute(signups.filter(s=>s.tournamentId===id).map(s=>({playerKey:s.playerKey,name:s.name})));
    const drawnAt=Date.now(),waitDeadlineAt=drawnAt+TournamentWait.WAIT_MS;
    this.local[id]=tables.map(t=>({...t,drawnAt,waitDeadlineAt}));this.save();return publicTables(tables);
  }
}
module.exports={TournamentDraw,distribute,publicTables};

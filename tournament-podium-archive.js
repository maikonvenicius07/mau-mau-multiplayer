'use strict';
// V40.69.8.49: somente o podio e permanente. Nunca persistir cartas, chaves de
// jogador, convites, fases ou resultados intermediarios neste historico.
const fs=require('node:fs');
const path=require('node:path');

function podiumFromChampion(champion){
  if(!Array.isArray(champion?.names)||!champion.names.length||!Array.isArray(champion?.standings))
    throw new Error('Final sem campeao e classificacao confirmados; arquivo nao criado.');
  const standings=champion.standings.slice().sort((a,b)=>Number(a.position)-Number(b.position)||Number(a.score)-Number(b.score));
  const podium=standings.slice(0,3).map(p=>({position:Number(p.position),name:String(p.name||'').slice(0,24),score:Number(p.score),forfeited:!!p.forfeited}));
  if(podium.length<2||podium[0].position!==1||podium.some(p=>!Number.isInteger(p.position)||p.position<1||!p.name||!Number.isFinite(p.score)))
    throw new Error('Podio incompleto ou invalido; limpeza bloqueada.');
  const winners=champion.names.map(p=>String(p?.name||'')).filter(Boolean);
  if(!winners.length||!winners.every(n=>podium.some(p=>p.name===n&&p.position===1)))
    throw new Error('Campeao ausente da classificacao final; limpeza bloqueada.');
  return podium;
}
function publicCup(row){
  return {id:row.id,name:row.name,champion:{
    names:row.standings.filter(p=>p.position===1).map(p=>({name:p.name})),
    standings:row.standings.map(p=>({position:p.position,name:p.name,score:p.score,forfeited:!!p.forfeited}))
  }};
}
class TournamentPodiumArchive {
  constructor({pool=null,databaseUrl=process.env.DATABASE_URL,filePath=path.join(__dirname,'data','tournament-podium.json')}={}){
    this.pool=pool;this.filePath=filePath;this.local=[];
    if(!pool&&databaseUrl){const {createAppDatabasePool}=require('./database-pool');this.pool=createAppDatabasePool(databaseUrl);}
  }
  async init(){
    if(this.pool){await this.pool.query(`CREATE TABLE IF NOT EXISTS mm_tournament_podium (
      tournament_id VARCHAR(64) PRIMARY KEY,
      tournament_name VARCHAR(70) NOT NULL,
      standings_json JSONB NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cleaned_at TIMESTAMPTZ
    )`);}
    else{fs.mkdirSync(path.dirname(this.filePath),{recursive:true});this.reload();}
  }
  reload(){if(this.pool)return;try{const value=JSON.parse(fs.readFileSync(this.filePath,'utf8'));this.local=Array.isArray(value)?value:[];}catch(e){if(e.code==='ENOENT')this.local=[];else throw e;}}
  save(){const temp=this.filePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.local,null,2));fs.renameSync(temp,this.filePath);}
  async record({id,name,champion}){
    if(!/^[-a-z0-9]{3,64}$/i.test(id||'')||!String(name||'').trim())throw new Error('Identificacao do torneio invalida.');
    const standings=podiumFromChampion(champion),safeName=String(name).slice(0,70);
    if(this.pool){
      await this.pool.query(`INSERT INTO mm_tournament_podium(tournament_id,tournament_name,standings_json)
        VALUES($1,$2,$3::jsonb) ON CONFLICT(tournament_id) DO NOTHING`,[id,safeName,JSON.stringify(standings)]);
      const check=await this.pool.query('SELECT tournament_name AS name,standings_json AS standings FROM mm_tournament_podium WHERE tournament_id=$1',[id]);
      if(!check.rowCount||check.rows[0].name!==safeName||JSON.stringify(check.rows[0].standings.map(p=>[Number(p.position),p.name,Number(p.score),!!p.forfeited]))!==JSON.stringify(standings.map(p=>[p.position,p.name,p.score,p.forfeited])))
        throw new Error('Podio persistido diverge do resultado oficial; limpeza bloqueada.');
    }else{
      this.reload();const previous=this.local.find(row=>row.id===id);
      if(previous){if(previous.name!==safeName||JSON.stringify(previous.standings)!==JSON.stringify(standings))throw new Error('Podio existente e divergente; limpeza bloqueada.');return publicCup(previous);}
      const row={id,name:safeName,standings,finishedAt:new Date().toISOString(),cleanedAt:null};
      this.local.push(row);this.save();
    }
    return publicCup({id,name:safeName,standings});
  }
  async list(){
    if(this.pool){const {rows}=await this.pool.query(`SELECT tournament_id AS id,tournament_name AS name,standings_json AS standings
      FROM mm_tournament_podium ORDER BY finished_at DESC,tournament_id DESC`);return rows.map(publicCup);}
    this.reload();return this.local.slice().sort((a,b)=>String(b.finishedAt).localeCompare(String(a.finishedAt))).map(publicCup);
  }
  async pending(){
    if(this.pool){const {rows}=await this.pool.query('SELECT tournament_id AS id FROM mm_tournament_podium WHERE cleaned_at IS NULL');return rows.map(r=>r.id);}
    this.reload();return this.local.filter(r=>!r.cleanedAt).map(r=>r.id);
  }
  // O chamador certifica que NAO existe sala nem espectador em uso e que
  // snapshots antigos foram excluidos/tombstoned antes de apagar vinculos.
  async cleanup(id,{catalog,store,draw,games,bracket}){
    if(this.pool){
      const conn=await this.pool.connect();
      try{
        await conn.query('BEGIN');
        await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tournament:${id}`]);
        const archived=await conn.query('SELECT cleaned_at FROM mm_tournament_podium WHERE tournament_id=$1 FOR UPDATE',[id]);
        if(!archived.rowCount)throw new Error('Podio nao persistido: limpeza proibida.');
        if(archived.rows[0].cleaned_at){await conn.query('COMMIT');return false;}
        const event=await conn.query('SELECT status FROM mm_tournaments WHERE id=$1 FOR UPDATE',[id]);
        if(event.rowCount&&event.rows[0].status!=='closed')throw new Error('Torneio ainda nao encerrado; limpeza bloqueada.');
        const incomplete=await conn.query(`SELECT
          EXISTS(SELECT 1 FROM mm_tournament_table_games WHERE tournament_id=$1 AND (result_json IS NULL OR result_json->>'complete'='false'))
          OR EXISTS(SELECT 1 FROM mm_tournament_stage_tables WHERE tournament_id=$1 AND (result_json IS NULL OR result_json->>'complete'='false')) AS pending`,[id]);
        if(incomplete.rows[0]?.pending)throw new Error('Existem resultados operacionais pendentes; limpeza bloqueada.');
        await conn.query('DELETE FROM mm_tournament_table_games WHERE tournament_id=$1',[id]);
        await conn.query('DELETE FROM mm_tournament_stage_tables WHERE tournament_id=$1',[id]);
        await conn.query('DELETE FROM mm_tournament_table_seats WHERE tournament_id=$1',[id]);
        await conn.query('DELETE FROM mm_tournament_signups WHERE tournament_id=$1',[id]);
        await conn.query('DELETE FROM mm_tournaments WHERE id=$1',[id]);
        await conn.query('UPDATE mm_tournament_podium SET cleaned_at=NOW() WHERE tournament_id=$1',[id]);
        await conn.query('COMMIT');return true;
      }catch(e){try{await conn.query('ROLLBACK');}catch{}throw e;}
      finally{conn.release();}
    }
    this.reload();const row=this.local.find(x=>x.id===id);
    if(!row)throw new Error('Podio nao persistido: limpeza proibida.');
    if(row.cleanedAt)return false;
    const event=catalog.local.find(x=>x.id===id);
    if(event&&event.status!=='closed')throw new Error('Torneio ainda nao encerrado; limpeza bloqueada.');
    const unfinishedGames=Object.entries(JSON.parse(fs.readFileSync(games.filePath,'utf8'))).some(([key,game])=>key.startsWith(id+':')&&!game.result);
    const unfinishedStages=(await bracket.rows(id)).some(entry=>!entry.result);
    if(unfinishedGames||unfinishedStages)throw new Error('Existem partidas sem resultado confirmado; limpeza bloqueada.');
    // Armazenamento JSON sem transacoes: o podio permanece independente e
    // cada exclusao e repetivel apos uma queda, com o catalogo excluido por ultimo.
    await games.clearLocal(id);await bracket.clearLocal(id);
    draw.reloadLocal();delete draw.local[id];draw.save();
    store.reloadLocal();store.local=store.local.filter(x=>x.tournamentId!==id);
    const storeTemp=store.filePath+'.tmp';fs.writeFileSync(storeTemp,JSON.stringify(store.local,null,2));fs.renameSync(storeTemp,store.filePath);
    catalog.local=catalog.local.filter(x=>x.id!==id);catalog.save();
    this.reload();const archived=this.local.find(x=>x.id===id);
    archived.cleanedAt=new Date().toISOString();this.save();return true;
  }
}
module.exports={TournamentPodiumArchive,podiumFromChampion};

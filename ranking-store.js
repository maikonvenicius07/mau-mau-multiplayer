'use strict';

const fs = require('fs');
const path = require('path');

const RO_OFFSET_HOURS = -4;
const RANKING_GENERATION = 'v40.8-season1';
const CURRENT_SEASON_ID = 1;
const CURRENT_SEASON_NAME = 'Temporada 1';

function normalizePeriod(value) {
  const p = String(value || 'day').toLowerCase();
  if (p === 'all' || p === 'year') return 'season'; // compatibilidade com versões anteriores
  return ['day','week','month','season','history'].includes(p) ? p : 'day';
}
function normalizeMode(value) {
  const m = String(value || 'official').toLowerCase();
  if (['training','treino','bot'].includes(m)) return 'training';
  return 'official'; // inclui aliases antigos: human/pessoas
}
function periodStart(period, now = Date.now()) {
  const p = normalizePeriod(period);
  if (p === 'season' || p === 'history') return null;
  const offsetMs = RO_OFFSET_HOURS * 60 * 60 * 1000;
  const local = new Date(now + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  let localMidnight;
  if (p === 'day') {
    localMidnight = Date.UTC(y,m,d,0,0,0,0);
  } else if (p === 'week') {
    // Semana do ranking: segunda-feira 00:00 até domingo 23:59:59, horário de Rondônia.
    const dayOfWeek = local.getUTCDay(); // domingo=0
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    localMidnight = Date.UTC(y,m,d-daysSinceMonday,0,0,0,0);
  } else {
    localMidnight = Date.UTC(y,m,1,0,0,0,0);
  }
  return new Date(localMidnight - offsetMs).toISOString();
}
function denseRankByWins(rows) {
  const values=[...new Set(rows.map(r=>Number(r.wins)||0))].sort((a,b)=>b-a);
  return rows.map(r=>({...r,rank:values.indexOf(Number(r.wins)||0)+1}));
}

class JsonBackend {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version:2, rankingGeneration:RANKING_GENERATION, currentSeasonId:CURRENT_SEASON_ID, currentSeasonName:CURRENT_SEASON_NAME, matches:[] };
  }
  async init() {
    fs.mkdirSync(path.dirname(this.filePath), {recursive:true});
    let parsed=null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath,'utf8'));
    } catch(e) {
      if (e.code !== 'ENOENT') console.warn('[ranking] Não foi possível ler JSON:', e.message);
    }
    if (parsed && parsed.rankingGeneration === RANKING_GENERATION && Array.isArray(parsed.matches)) {
      this.data = {...this.data,...parsed};
    } else {
      // V40.8: o usuário optou por descartar integralmente o ranking anterior e iniciar a Temporada 1 do zero.
      this.data = { version:2, rankingGeneration:RANKING_GENERATION, currentSeasonId:CURRENT_SEASON_ID, currentSeasonName:CURRENT_SEASON_NAME, matches:[] };
      this.persist();
    }
  }
  persist() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data,null,2));
    fs.renameSync(tmp, this.filePath);
  }
  async recordMatch(match) {
    if (this.data.matches.some(m => m.matchId === match.matchId)) return false;
    this.data.matches.push({...match,seasonId:CURRENT_SEASON_ID});
    if (this.data.matches.length > 20000) this.data.matches.splice(0, this.data.matches.length - 20000);
    this.persist();
    return true;
  }
  filtered(period, mode, now) {
    period=normalizePeriod(period); mode=normalizeMode(mode);
    if (period === 'history') return []; // A Temporada 1 é a primeira; ainda não existe histórico encerrado.
    const start = periodStart(period, now);
    const startMs = start ? Date.parse(start) : null;
    return this.data.matches.filter(m =>
      Number(m.seasonId||CURRENT_SEASON_ID) === CURRENT_SEASON_ID &&
      normalizeMode(m.mode) === mode &&
      (!startMs || Date.parse(m.finishedAt) >= startMs)
    );
  }
  async getLeaderboard({period='day',mode='official',limit=50,now=Date.now()}={}) {
    period=normalizePeriod(period); mode=normalizeMode(mode);
    if(period==='history') return [];
    const byPlayer = new Map();
    for (const match of this.filtered(period,mode,now)) {
      for (const r of match.results || []) {
        if (!r.playerKey) continue;
        const s = byPlayer.get(r.playerKey) || {playerKey:r.playerKey,name:r.name,avatar:r.avatar,wins:0};
        // Nome/avatar são apenas visuais. A identidade e a soma permanecem vinculadas ao playerKey da Conta Google.
        s.name=r.name||s.name; s.avatar=r.avatar||s.avatar; s.wins += r.won ? 1 : 0;
        byPlayer.set(r.playerKey,s);
      }
    }
    const rows=[...byPlayer.values()].sort((a,b)=>b.wins-a.wins || String(a.name).localeCompare(String(b.name),'pt-BR'));
    const ranked=denseRankByWins(rows);
    return ranked.slice(0,Math.max(1,Math.min(100,Number(limit)||50)));
  }
  async getPlayerStats({playerKey,period='season',mode='official',now=Date.now()}={}) {
    if (!playerKey || normalizePeriod(period)==='history') return null;
    period=normalizePeriod(period); mode=normalizeMode(mode);
    const byPlayer = new Map();
    for (const match of this.filtered(period,mode,now)) {
      for (const r of match.results || []) {
        if (!r.playerKey) continue;
        const s=byPlayer.get(r.playerKey)||{playerKey:r.playerKey,name:r.name,avatar:r.avatar,wins:0};
        s.name=r.name||s.name; s.avatar=r.avatar||s.avatar; s.wins += r.won ? 1 : 0;
        byPlayer.set(r.playerKey,s);
      }
    }
    const rows=[...byPlayer.values()].sort((a,b)=>b.wins-a.wins || String(a.name).localeCompare(String(b.name),'pt-BR'));
    const ranked=denseRankByWins(rows);
    return ranked.find(r=>r.playerKey===playerKey)||null;
  }
}

class PostgresBackend {
  constructor(databaseUrl) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString:databaseUrl, ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false} });
  }
  async init() {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TABLE IF NOT EXISTS mm_players (
          player_key TEXT PRIMARY KEY,
          name VARCHAR(24) NOT NULL,
          avatar VARCHAR(40),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS mm_matches (
          match_id TEXT PRIMARY KEY,
          room_code VARCHAR(10),
          mode VARCHAR(10) NOT NULL,
          rounds INTEGER NOT NULL,
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS mm_match_results (
          match_id TEXT NOT NULL REFERENCES mm_matches(match_id) ON DELETE CASCADE,
          player_key TEXT NOT NULL REFERENCES mm_players(player_key) ON DELETE CASCADE,
          score INTEGER NOT NULL,
          position INTEGER NOT NULL,
          won BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY(match_id, player_key)
        );
        CREATE TABLE IF NOT EXISTS mm_ranking_meta (
          meta_key TEXT PRIMARY KEY,
          meta_value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS mm_seasons (
          season_id INTEGER PRIMARY KEY,
          name VARCHAR(40) NOT NULL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ,
          is_current BOOLEAN NOT NULL DEFAULT FALSE
        );
      `);
      await client.query(`ALTER TABLE mm_matches ADD COLUMN IF NOT EXISTS season_id INTEGER NOT NULL DEFAULT ${CURRENT_SEASON_ID}`);
      // Impede dois processos de executarem a migração/reset simultaneamente.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('mau-mau-ranking-v40.8-season1'))");
      const meta=await client.query(`SELECT meta_value FROM mm_ranking_meta WHERE meta_key='ranking_generation'`);
      const generation=meta.rows[0]?.meta_value;
      if(generation!==RANKING_GENERATION){
        // Reset ÚNICO da V40.8: descarta partidas/resultados antigos, preservando a identidade Google dos jogadores.
        await client.query('DELETE FROM mm_match_results');
        await client.query('DELETE FROM mm_matches');
        await client.query('DELETE FROM mm_seasons');
        await client.query(
          `INSERT INTO mm_seasons(season_id,name,started_at,is_current) VALUES($1,$2,NOW(),TRUE)`,
          [CURRENT_SEASON_ID,CURRENT_SEASON_NAME]
        );
        await client.query(
          `INSERT INTO mm_ranking_meta(meta_key,meta_value,updated_at) VALUES('ranking_generation',$1,NOW())
           ON CONFLICT(meta_key) DO UPDATE SET meta_value=EXCLUDED.meta_value,updated_at=NOW()`,
          [RANKING_GENERATION]
        );
        console.log('[ranking] V40.8: ranking anterior descartado; Temporada 1 iniciada do zero.');
      }else{
        await client.query(
          `INSERT INTO mm_seasons(season_id,name,is_current) VALUES($1,$2,TRUE)
           ON CONFLICT(season_id) DO UPDATE SET name=EXCLUDED.name,is_current=TRUE`,
          [CURRENT_SEASON_ID,CURRENT_SEASON_NAME]
        );
      }
      await client.query(`CREATE INDEX IF NOT EXISTS mm_matches_mode_finished_idx ON mm_matches(mode, finished_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS mm_matches_season_mode_finished_idx ON mm_matches(season_id, mode, finished_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS mm_results_player_idx ON mm_match_results(player_key)`);
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }
  async recordMatch(match) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO mm_matches(match_id,room_code,mode,rounds,started_at,finished_at,season_id)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(match_id) DO NOTHING RETURNING match_id`,
        [match.matchId,match.roomCode,normalizeMode(match.mode),match.rounds,match.startedAt,match.finishedAt,CURRENT_SEASON_ID]
      );
      if (!inserted.rowCount) { await client.query('ROLLBACK'); return false; }
      for (const r of match.results) {
        await client.query(
          `INSERT INTO mm_players(player_key,name,avatar,updated_at) VALUES($1,$2,$3,NOW())
           ON CONFLICT(player_key) DO UPDATE SET name=EXCLUDED.name,avatar=EXCLUDED.avatar,updated_at=NOW()`,
          [r.playerKey,r.name,r.avatar]
        );
        await client.query(
          `INSERT INTO mm_match_results(match_id,player_key,score,position,won) VALUES($1,$2,$3,$4,$5)`,
          [match.matchId,r.playerKey,r.score,r.position,!!r.won]
        );
      }
      await client.query('COMMIT');
      return true;
    } catch(e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }
  }
  async getLeaderboard({period='day',mode='official',limit=50,now=Date.now()}={}) {
    period=normalizePeriod(period); mode=normalizeMode(mode);
    if(period==='history') return [];
    const start=periodStart(period,now);
    const params=[mode,start,Math.max(1,Math.min(100,Number(limit)||50)),CURRENT_SEASON_ID];
    const {rows}=await this.pool.query(`
      WITH stats AS (
        SELECT r.player_key AS "playerKey", p.name, p.avatar,
               SUM(CASE WHEN r.won THEN 1 ELSE 0 END)::int AS wins
        FROM mm_match_results r
        JOIN mm_matches m ON m.match_id=r.match_id
        JOIN mm_players p ON p.player_key=r.player_key
        WHERE m.season_id=$4 AND m.mode=$1
          AND ($2::timestamptz IS NULL OR m.finished_at >= $2::timestamptz)
        GROUP BY r.player_key,p.name,p.avatar
      ), ranked AS (
        SELECT *, DENSE_RANK() OVER (ORDER BY wins DESC)::int AS rank
        FROM stats
      )
      SELECT * FROM ranked
      ORDER BY rank ASC, name ASC
      LIMIT $3`,params);
    return rows;
  }
  async getPlayerStats({playerKey,period='season',mode='official',now=Date.now()}={}) {
    if(!playerKey || normalizePeriod(period)==='history') return null;
    period=normalizePeriod(period); mode=normalizeMode(mode);
    const start=periodStart(period,now);
    const {rows}=await this.pool.query(`
      WITH stats AS (
        SELECT r.player_key AS "playerKey", p.name, p.avatar,
               SUM(CASE WHEN r.won THEN 1 ELSE 0 END)::int AS wins
        FROM mm_match_results r
        JOIN mm_matches m ON m.match_id=r.match_id
        JOIN mm_players p ON p.player_key=r.player_key
        WHERE m.season_id=$4 AND m.mode=$2
          AND ($3::timestamptz IS NULL OR m.finished_at >= $3::timestamptz)
        GROUP BY r.player_key,p.name,p.avatar
      ), ranked AS (
        SELECT *, DENSE_RANK() OVER (ORDER BY wins DESC)::int AS rank
        FROM stats
      )
      SELECT * FROM ranked WHERE "playerKey"=$1`,
      [playerKey,mode,start,CURRENT_SEASON_ID]
    );
    return rows[0]||null;
  }
}

class RankingStore {
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=process.env.RANKING_FILE||path.join(__dirname,'data','ranking.json')}={}) {
    this.kind = databaseUrl ? 'postgres' : 'json';
    this.backend = databaseUrl ? new PostgresBackend(databaseUrl) : new JsonBackend(filePath);
  }
  async init(){ return this.backend.init(); }
  async recordMatch(match){ return this.backend.recordMatch(match); }
  async getLeaderboard(opts){ return this.backend.getLeaderboard(opts); }
  async getPlayerStats(opts){ return this.backend.getPlayerStats(opts); }
}

function buildMatchRecord(room) {
  const humans=room.players.filter(p=>!p.isBot && p.playerKey);
  const allScores=[...new Set(room.players.map(p=>Number(p.score)||0))].sort((a,b)=>a-b);
  const positioned=humans.map(p=>({
    playerKey:p.playerKey,
    name:p.name,
    avatar:p.avatar,
    score:Number(p.score)||0,
    position:allScores.indexOf(Number(p.score)||0)+1,
  }));
  const minAll=allScores[0] ?? 0;
  const matchSerial=Math.max(1,Number(room.matchSerial)||1);
  return {
    // A revanche na mesma sala é outra partida e precisa de identificador próprio.
    matchId:`${room.code}-${room.createdAt}-${matchSerial}`,
    roomCode:room.code,
    mode:room.players.some(p=>p.isBot)?'training':'official',
    seasonId:CURRENT_SEASON_ID,
    rounds:room.rules?.rounds||5,
    startedAt:new Date(room.createdAt).toISOString(),
    finishedAt:new Date(room.finishedAt||Date.now()).toISOString(),
    results:positioned.map(p=>({...p,won:p.score===minAll})),
  };
}

module.exports={
  RankingStore,buildMatchRecord,periodStart,normalizePeriod,normalizeMode,
  RANKING_GENERATION,CURRENT_SEASON_ID,CURRENT_SEASON_NAME
};

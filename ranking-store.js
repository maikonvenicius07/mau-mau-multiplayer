'use strict';

const fs = require('fs');
const path = require('path');

const RO_OFFSET_HOURS = -4;

function normalizePeriod(value) {
  const p = String(value || 'day').toLowerCase();
  return ['day','month','year','all'].includes(p) ? p : 'day';
}
function normalizeMode(value) {
  return String(value || 'human').toLowerCase() === 'bot' ? 'bot' : 'human';
}
function periodStart(period, now = Date.now()) {
  const p = normalizePeriod(period);
  if (p === 'all') return null;
  const offsetMs = RO_OFFSET_HOURS * 60 * 60 * 1000;
  const local = new Date(now + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  let localMidnight;
  if (p === 'day') localMidnight = Date.UTC(y,m,d,0,0,0,0);
  else if (p === 'month') localMidnight = Date.UTC(y,m,1,0,0,0,0);
  else localMidnight = Date.UTC(y,0,1,0,0,0,0);
  return new Date(localMidnight - offsetMs).toISOString();
}
function densePositions(players) {
  const scores = [...new Set(players.map(p => Number(p.score) || 0))].sort((a,b)=>a-b);
  return players.map(p => ({...p, position:scores.indexOf(Number(p.score)||0)+1}));
}

class JsonBackend {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version:1, matches:[] };
  }
  async init() {
    fs.mkdirSync(path.dirname(this.filePath), {recursive:true});
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if (parsed && Array.isArray(parsed.matches)) this.data = parsed;
    } catch(e) {
      if (e.code !== 'ENOENT') console.warn('[ranking] Não foi possível ler JSON:', e.message);
    }
  }
  persist() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data,null,2));
    fs.renameSync(tmp, this.filePath);
  }
  async recordMatch(match) {
    if (this.data.matches.some(m => m.matchId === match.matchId)) return false;
    this.data.matches.push(match);
    // Evita crescimento ilimitado no fallback local: conserva até 20 mil partidas.
    if (this.data.matches.length > 20000) this.data.matches.splice(0, this.data.matches.length - 20000);
    this.persist();
    return true;
  }
  filtered(period, mode, now) {
    const start = periodStart(period, now);
    const startMs = start ? Date.parse(start) : null;
    return this.data.matches.filter(m => m.mode === mode && (!startMs || Date.parse(m.finishedAt) >= startMs));
  }
  async getLeaderboard({period='day',mode='human',limit=50,now=Date.now()}={}) {
    period=normalizePeriod(period); mode=normalizeMode(mode);
    const byPlayer = new Map();
    for (const match of this.filtered(period,mode,now)) {
      for (const r of match.results || []) {
        if (!r.playerKey) continue;
        const s = byPlayer.get(r.playerKey) || {playerKey:r.playerKey,name:r.name,avatar:r.avatar,games:0,wins:0,totalScore:0,bestScore:null};
        s.name=r.name||s.name; s.avatar=r.avatar||s.avatar; s.games++; s.wins += r.won ? 1 : 0; s.totalScore += Number(r.score)||0;
        s.bestScore = s.bestScore === null ? Number(r.score)||0 : Math.min(s.bestScore, Number(r.score)||0);
        byPlayer.set(r.playerKey,s);
      }
    }
    const rows=[...byPlayer.values()].map(s=>({...s,avgScore:s.games?Number((s.totalScore/s.games).toFixed(2)):0}));
    rows.sort((a,b)=>b.wins-a.wins || a.avgScore-b.avgScore || a.totalScore-b.totalScore || b.games-a.games || String(a.name).localeCompare(String(b.name),'pt-BR'));
    return rows.slice(0,Math.max(1,Math.min(100,Number(limit)||50))).map((r,i)=>({...r,rank:i+1}));
  }
  async getPlayerStats({playerKey,period='all',mode='human',now=Date.now()}={}) {
    if (!playerKey) return null;
    const leaderboard = await this.getLeaderboard({period,mode,limit:10000,now});
    return leaderboard.find(r=>r.playerKey===playerKey)||null;
  }
}

class PostgresBackend {
  constructor(databaseUrl) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString:databaseUrl, ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false} });
  }
  async init() {
    await this.pool.query(`
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
      CREATE INDEX IF NOT EXISTS mm_matches_mode_finished_idx ON mm_matches(mode, finished_at DESC);
      CREATE INDEX IF NOT EXISTS mm_results_player_idx ON mm_match_results(player_key);
    `);
  }
  async recordMatch(match) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO mm_matches(match_id,room_code,mode,rounds,started_at,finished_at)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(match_id) DO NOTHING RETURNING match_id`,
        [match.matchId,match.roomCode,match.mode,match.rounds,match.startedAt,match.finishedAt]
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
  async getLeaderboard({period='day',mode='human',limit=50,now=Date.now()}={}) {
    period=normalizePeriod(period); mode=normalizeMode(mode);
    const start=periodStart(period,now);
    const params=[mode,start,Math.max(1,Math.min(100,Number(limit)||50))];
    const {rows}=await this.pool.query(`
      SELECT r.player_key AS "playerKey", p.name, p.avatar,
             COUNT(*)::int AS games,
             SUM(CASE WHEN r.won THEN 1 ELSE 0 END)::int AS wins,
             ROUND(AVG(r.score)::numeric,2)::float AS "avgScore",
             SUM(r.score)::int AS "totalScore",
             MIN(r.score)::int AS "bestScore"
      FROM mm_match_results r
      JOIN mm_matches m ON m.match_id=r.match_id
      JOIN mm_players p ON p.player_key=r.player_key
      WHERE m.mode=$1 AND ($2::timestamptz IS NULL OR m.finished_at >= $2::timestamptz)
      GROUP BY r.player_key,p.name,p.avatar
      ORDER BY wins DESC, "avgScore" ASC, "totalScore" ASC, games DESC, p.name ASC
      LIMIT $3`,params);
    return rows.map((r,i)=>({...r,rank:i+1}));
  }
  async getPlayerStats({playerKey,period='all',mode='human',now=Date.now()}={}) {
    const list=await this.getLeaderboard({period,mode,limit:100,now});
    let found=list.find(r=>r.playerKey===playerKey);
    if(found) return found;
    // Caso o jogador esteja fora do top 100, calcula só as métricas dele.
    const start=periodStart(period,now);
    const {rows}=await this.pool.query(`
      SELECT r.player_key AS "playerKey", p.name, p.avatar,
             COUNT(*)::int AS games,
             SUM(CASE WHEN r.won THEN 1 ELSE 0 END)::int AS wins,
             ROUND(AVG(r.score)::numeric,2)::float AS "avgScore",
             SUM(r.score)::int AS "totalScore",
             MIN(r.score)::int AS "bestScore"
      FROM mm_match_results r
      JOIN mm_matches m ON m.match_id=r.match_id
      JOIN mm_players p ON p.player_key=r.player_key
      WHERE r.player_key=$1 AND m.mode=$2 AND ($3::timestamptz IS NULL OR m.finished_at >= $3::timestamptz)
      GROUP BY r.player_key,p.name,p.avatar`,[playerKey,normalizeMode(mode),start]);
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
  return {
    matchId:`${room.code}-${room.createdAt}`,
    roomCode:room.code,
    mode:room.players.some(p=>p.isBot)?'bot':'human',
    rounds:room.rules?.rounds||5,
    startedAt:new Date(room.createdAt).toISOString(),
    finishedAt:new Date(room.finishedAt||Date.now()).toISOString(),
    results:positioned.map(p=>({...p,won:p.score===minAll})),
  };
}

module.exports={RankingStore,buildMatchRecord,periodStart,normalizePeriod,normalizeMode};

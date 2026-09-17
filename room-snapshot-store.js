'use strict';

const fs = require('fs');
const path = require('path');

const SNAPSHOT_VERSION = 1;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_DEBOUNCE_MS = 250;

function plainRoomSnapshot(room) {
  if (!room || !room.code || !Array.isArray(room.players)) return null;
  const snapshot = {};
  const skip = new Set(['botTimer','inviteReservations','spectators','_presenceSignature']);
  for (const [key,value] of Object.entries(room)) {
    if (skip.has(key)) continue;
    if (key === 'rankingRecording') { snapshot[key] = false; continue; }
    snapshot[key] = value;
  }
  snapshot.snapshotVersion = SNAPSHOT_VERSION;
  snapshot.savedAt = Date.now();
  snapshot.players = room.players.map(p => ({...p, socketId:null}));
  // Espectadores são presença efêmera. Após deploy/restart eles apenas reconectam/entram novamente.
  snapshot.spectators = [];
  return JSON.parse(JSON.stringify(snapshot));
}

function restoreRoomSnapshot(snapshot, {now=Date.now(), reconnectGraceMs=60000}={}) {
  if (!snapshot || snapshot.snapshotVersion !== SNAPSHOT_VERSION) return null;
  if (!snapshot.code || !Array.isArray(snapshot.players) || !snapshot.players.length) return null;
  if (!['lobby','playing','between-rounds','finished'].includes(snapshot.status)) return null;
  if (snapshot.status === 'finished') return null;
  const room = JSON.parse(JSON.stringify(snapshot));
  delete room.snapshotVersion;
  delete room.savedAt;
  room.botTimer = null;
  room.inviteReservations = new Map();
  room.spectators = [];
  room._presenceSignature = null;
  room.rankingRecording = false;
  if (!Array.isArray(room.chat)) room.chat=[];
  if (!Array.isArray(room.log)) room.log=[];
  if (!Array.isArray(room.turnAudit)) room.turnAudit=[];
  if (!Array.isArray(room.replayReadyPlayerIds)) room.replayReadyPlayerIds=[];
  for (const p of room.players) {
    p.socketId = null;
    if (p.isBot) {
      p.connected = true;
      p.disconnectedAt = null;
      p.reconnectDeadlineAt = null;
      continue;
    }
    // Um restart invalida todos os socketIds. A vaga humana é preservada e recebe
    // uma nova janela de 60 s para o navegador fazer o joinRoom automático com token.
    p.connected = false;
    p.autoControlled = false;
    p.disconnectedAt = now;
    p.reconnectDeadlineAt = now + reconnectGraceMs;
  }
  return room;
}

class JsonSnapshotBackend {
  constructor(filePath){ this.filePath=filePath; this.data={version:SNAPSHOT_VERSION,rooms:{}}; }
  async init(){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    try {
      const parsed=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if(parsed?.version===SNAPSHOT_VERSION&&parsed.rooms&&typeof parsed.rooms==='object')this.data=parsed;
    } catch(e){ if(e.code!=='ENOENT')console.warn('[rooms] snapshot JSON inválido:',e.message); }
  }
  persist(){ const tmp=`${this.filePath}.tmp`;fs.writeFileSync(tmp,JSON.stringify(this.data));fs.renameSync(tmp,this.filePath); }
  async save(code,snapshot,expiresAt){ this.data.rooms[code]={snapshot,expiresAt};this.persist(); }
  async delete(code){ if(this.data.rooms[code]){delete this.data.rooms[code];this.persist();} }
  async loadActive(now){
    const out=[];let changed=false;
    for(const [code,row] of Object.entries(this.data.rooms)){
      if(!row||Number(row.expiresAt||0)<=now){delete this.data.rooms[code];changed=true;continue;}
      out.push(row.snapshot);
    }
    if(changed)this.persist();
    return out;
  }
  async close(){}
}

class PostgresSnapshotBackend {
  constructor(databaseUrl){
    const {Pool}=require('pg');
    this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});
  }
  async init(){
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS mm_room_snapshots (
        room_code VARCHAR(10) PRIMARY KEY,
        snapshot JSONB NOT NULL,
        status VARCHAR(24) NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mm_room_snapshots_expires_idx ON mm_room_snapshots(expires_at);
    `);
    await this.pool.query('DELETE FROM mm_room_snapshots WHERE expires_at <= NOW()');
  }
  async save(code,snapshot,expiresAt){
    await this.pool.query(`
      INSERT INTO mm_room_snapshots(room_code,snapshot,status,updated_at,expires_at)
      VALUES($1,$2::jsonb,$3,NOW(),$4)
      ON CONFLICT(room_code) DO UPDATE SET snapshot=EXCLUDED.snapshot,status=EXCLUDED.status,updated_at=NOW(),expires_at=EXCLUDED.expires_at
    `,[code,JSON.stringify(snapshot),String(snapshot.status||'lobby'),new Date(expiresAt).toISOString()]);
  }
  async delete(code){ await this.pool.query('DELETE FROM mm_room_snapshots WHERE room_code=$1',[code]); }
  async loadActive(){
    const {rows}=await this.pool.query('SELECT snapshot FROM mm_room_snapshots WHERE expires_at > NOW() ORDER BY updated_at DESC');
    return rows.map(r=>r.snapshot);
  }
  async close(){ await this.pool.end(); }
}

class RoomSnapshotStore {
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=process.env.ROOM_SNAPSHOT_FILE||path.join(__dirname,'data','room-snapshots.json'),ttlMs=Number(process.env.ROOM_SNAPSHOT_TTL_MS)||DEFAULT_TTL_MS,debounceMs=DEFAULT_DEBOUNCE_MS}={}){
    this.kind=databaseUrl?'postgres':'json';
    this.backend=databaseUrl?new PostgresSnapshotBackend(databaseUrl):new JsonSnapshotBackend(filePath);
    this.ttlMs=Math.max(5*60*1000,ttlMs);
    this.debounceMs=debounceMs;
    this.pending=new Map();
    this.closed=false;
  }
  async init(){return this.backend.init();}
  queueSave(room){
    if(this.closed||!room?.code)return;
    const code=room.code;
    const existing=this.pending.get(code);if(existing)clearTimeout(existing.timer);
    const snapshot=plainRoomSnapshot(room);if(!snapshot)return;
    const timer=setTimeout(()=>{
      this.pending.delete(code);
      this.backend.save(code,snapshot,Date.now()+this.ttlMs).catch(e=>console.error('[rooms] falha ao salvar snapshot',code,e?.message||e));
    },this.debounceMs);
    timer.unref?.();
    this.pending.set(code,{timer,snapshot});
  }
  async saveNow(room){
    if(!room?.code)return;
    const pending=this.pending.get(room.code);if(pending){clearTimeout(pending.timer);this.pending.delete(room.code);}
    const snapshot=plainRoomSnapshot(room);if(snapshot)await this.backend.save(room.code,snapshot,Date.now()+this.ttlMs);
  }
  async delete(code){
    const pending=this.pending.get(code);if(pending){clearTimeout(pending.timer);this.pending.delete(code);}
    await this.backend.delete(code);
  }
  async loadActive(){return this.backend.loadActive(Date.now());}
  async flushAll(rooms){
    const list=[...rooms.values()].filter(r=>r&&r.status!=='finished');
    await Promise.all(list.map(r=>this.saveNow(r)));
  }
  async close(){this.closed=true;for(const x of this.pending.values())clearTimeout(x.timer);this.pending.clear();await this.backend.close();}
}

module.exports={RoomSnapshotStore,plainRoomSnapshot,restoreRoomSnapshot,SNAPSHOT_VERSION};

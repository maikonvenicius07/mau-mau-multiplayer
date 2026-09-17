'use strict';

const fs = require('fs');
const path = require('path');
const AvatarWire = require('./avatar-wire');

const SNAPSHOT_VERSION = 1;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_DEBOUNCE_MS = 250;

function buildRoomSnapshot(room) {
  if (!room || !room.code || !Array.isArray(room.players)) return {snapshot:null,avatarAssets:new Map()};
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

  // V40.55 — Data URLs de figurinha não ficam mais dentro do JSON salvo a cada jogada.
  // Cada conteúdo vira uma referência por hash; os bytes são persistidos separadamente
  // e só são regravados se o conjunto de avatares da sala realmente mudar.
  const avatarAssets = new Map();
  const serialized = JSON.stringify(snapshot, (_key,value) => {
    if (typeof value === 'string' && AvatarWire.isCustomAvatarData(value)) {
      const ref = AvatarWire.avatarRefFor(value);
      if (ref) avatarAssets.set(ref,value);
      return ref || value;
    }
    return value;
  });
  return {snapshot:JSON.parse(serialized),avatarAssets};
}

function plainRoomSnapshot(room) {
  return buildRoomSnapshot(room).snapshot;
}

function hydrateSnapshotAvatars(snapshot, avatarAssets={}) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const assets = avatarAssets instanceof Map ? avatarAssets : new Map(Object.entries(avatarAssets || {}));
  if (!assets.size) return JSON.parse(JSON.stringify(snapshot));
  return JSON.parse(JSON.stringify(snapshot), (_key,value) => {
    if (typeof value === 'string' && AvatarWire.isCustomAvatarRef(value) && assets.has(value)) return assets.get(value);
    return value;
  });
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
    // Migração V40.59: versões 40.58.2-40.58.5 marcavam uma saída voluntária
    // mantendo a cadeira humana em AUTO. Ao restaurar esses snapshots antigos,
    // essa identidade NÃO pode recuperar a vaga automaticamente.
    if (!p.isBot && Number(p.voluntaryLeftAt || 0) > 0) {
      p.isBot = true;
      p.connected = true;
      p.autoControlled = false;
      p.disconnectedAt = null;
      p.reconnectDeadlineAt = null;
      p.reconnectEligible = false;
      p.playerKey = null;
      p.token = `legacy-bot-${p.id}`;
      p.host = false;
      p.name = 'Máquina';
      p.avatar = 'preta';
      continue;
    }
    if (p.isBot) {
      p.connected = true;
      p.disconnectedAt = null;
      p.reconnectDeadlineAt = null;
      p.reconnectEligible = false;
      continue;
    }
    // Um restart/deploy é uma interrupção involuntária: humanos que ainda pertencem
    // à sala recebem uma nova janela de 60 s e preservam a reserva após o AUTO.
    p.connected = false;
    p.autoControlled = false;
    p.disconnectedAt = now;
    p.reconnectDeadlineAt = now + reconnectGraceMs;
    p.reconnectEligible = true;
    p.voluntaryLeftAt = null;
  }
  // Uma sala restaurada composta somente por máquinas já não possui proprietário
  // humano e não deve voltar à memória apenas por causa de snapshot antigo.
  if (!room.players.some(p => !p.isBot)) return null;
  if (!room.players.some(p => !p.isBot && p.host)) {
    const firstHuman = room.players.find(p => !p.isBot);
    if (firstHuman) firstHuman.host = true;
  }
  return room;
}

function assetObject(assets){ return Object.fromEntries(assets instanceof Map ? assets : Object.entries(assets || {})); }
function assetSignature(assets){ return [...(assets instanceof Map ? assets.keys() : Object.keys(assets || {}))].sort().join('|'); }

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
  async save(code,snapshot,expiresAt,avatarAssets=null){
    const previous=this.data.rooms[code]||{};
    this.data.rooms[code]={snapshot,expiresAt,avatarAssets:avatarAssets===null?(previous.avatarAssets||{}):assetObject(avatarAssets)};
    this.persist();
  }
  async delete(code){ if(this.data.rooms[code]){delete this.data.rooms[code];this.persist();} }
  async loadActive(now){
    const out=[];let changed=false;
    for(const [code,row] of Object.entries(this.data.rooms)){
      if(!row||Number(row.expiresAt||0)<=now){delete this.data.rooms[code];changed=true;continue;}
      // Compatibilidade com snapshots V40.53/V40.54 que ainda não possuíam avatarAssets.
      out.push({snapshot:row.snapshot,avatarAssets:row.avatarAssets||{}});
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
      CREATE TABLE IF NOT EXISTS mm_room_avatar_assets (
        room_code VARCHAR(10) NOT NULL REFERENCES mm_room_snapshots(room_code) ON DELETE CASCADE,
        avatar_ref VARCHAR(64) NOT NULL,
        data_url TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(room_code, avatar_ref)
      );
      CREATE INDEX IF NOT EXISTS mm_room_avatar_assets_room_idx ON mm_room_avatar_assets(room_code);
    `);
    await this.pool.query('DELETE FROM mm_room_snapshots WHERE expires_at <= NOW()');
  }
  async save(code,snapshot,expiresAt,avatarAssets=null){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO mm_room_snapshots(room_code,snapshot,status,updated_at,expires_at)
        VALUES($1,$2::jsonb,$3,NOW(),$4)
        ON CONFLICT(room_code) DO UPDATE SET snapshot=EXCLUDED.snapshot,status=EXCLUDED.status,updated_at=NOW(),expires_at=EXCLUDED.expires_at
      `,[code,JSON.stringify(snapshot),String(snapshot.status||'lobby'),new Date(expiresAt).toISOString()]);
      if(avatarAssets!==null){
        const assets=avatarAssets instanceof Map?avatarAssets:new Map(Object.entries(avatarAssets||{}));
        const refs=[...assets.keys()];
        if(refs.length) await client.query('DELETE FROM mm_room_avatar_assets WHERE room_code=$1 AND NOT (avatar_ref = ANY($2::text[]))',[code,refs]);
        else await client.query('DELETE FROM mm_room_avatar_assets WHERE room_code=$1',[code]);
        for(const [ref,dataUrl] of assets){
          await client.query(`
            INSERT INTO mm_room_avatar_assets(room_code,avatar_ref,data_url,updated_at)
            VALUES($1,$2,$3,NOW())
            ON CONFLICT(room_code,avatar_ref) DO NOTHING
          `,[code,ref,dataUrl]);
        }
      }
      await client.query('COMMIT');
    }catch(e){
      try{await client.query('ROLLBACK');}catch{}
      throw e;
    }finally{client.release();}
  }
  async delete(code){ await this.pool.query('DELETE FROM mm_room_snapshots WHERE room_code=$1',[code]); }
  async loadActive(){
    const {rows}=await this.pool.query('SELECT room_code,snapshot FROM mm_room_snapshots WHERE expires_at > NOW() ORDER BY updated_at DESC');
    if(!rows.length)return [];
    const codes=rows.map(r=>r.room_code);
    const {rows:assetRows}=await this.pool.query('SELECT room_code,avatar_ref,data_url FROM mm_room_avatar_assets WHERE room_code = ANY($1::varchar[])',[codes]);
    const assetsByRoom=new Map();
    for(const row of assetRows){
      if(!assetsByRoom.has(row.room_code))assetsByRoom.set(row.room_code,{});
      assetsByRoom.get(row.room_code)[row.avatar_ref]=row.data_url;
    }
    return rows.map(r=>({snapshot:r.snapshot,avatarAssets:assetsByRoom.get(r.room_code)||{}}));
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
    this.persistedAssetSignatures=new Map();
    this.closed=false;
  }
  async init(){return this.backend.init();}
  snapshotParts(room){
    const built=buildRoomSnapshot(room);
    const signature=assetSignature(built.avatarAssets);
    const changed=this.persistedAssetSignatures.get(room.code)!==signature;
    return {...built,assetSignature:signature,avatarAssetsForSave:changed?built.avatarAssets:null};
  }
  queueSave(room){
    if(this.closed||!room?.code)return;
    const code=room.code;
    const existing=this.pending.get(code);if(existing)clearTimeout(existing.timer);
    const {snapshot,assetSignature,avatarAssetsForSave}=this.snapshotParts(room);if(!snapshot)return;
    const timer=setTimeout(()=>{
      this.pending.delete(code);
      this.backend.save(code,snapshot,Date.now()+this.ttlMs,avatarAssetsForSave).then(()=>{if(avatarAssetsForSave!==null)this.persistedAssetSignatures.set(code,assetSignature);}).catch(e=>console.error('[rooms] falha ao salvar snapshot',code,e?.message||e));
    },this.debounceMs);
    timer.unref?.();
    this.pending.set(code,{timer,snapshot});
  }
  async saveNow(room){
    if(!room?.code)return;
    const pending=this.pending.get(room.code);if(pending){clearTimeout(pending.timer);this.pending.delete(room.code);}
    const {snapshot,assetSignature,avatarAssetsForSave}=this.snapshotParts(room);
    if(snapshot){
      await this.backend.save(room.code,snapshot,Date.now()+this.ttlMs,avatarAssetsForSave);
      if(avatarAssetsForSave!==null)this.persistedAssetSignatures.set(room.code,assetSignature);
    }
  }
  async delete(code){
    const pending=this.pending.get(code);if(pending){clearTimeout(pending.timer);this.pending.delete(code);}
    this.persistedAssetSignatures.delete(code);
    await this.backend.delete(code);
  }
  async loadActive(){
    const rows=await this.backend.loadActive(Date.now());
    return rows.map(row=>{
      // Backends novos retornam snapshot + assets; o formato antigo retornava só o snapshot.
      if(row&&Object.prototype.hasOwnProperty.call(row,'snapshot'))return hydrateSnapshotAvatars(row.snapshot,row.avatarAssets||{});
      return row;
    });
  }
  async flushAll(rooms){
    const list=[...rooms.values()].filter(r=>r&&r.status!=='finished');
    await Promise.all(list.map(r=>this.saveNow(r)));
  }
  async close(){this.closed=true;for(const x of this.pending.values())clearTimeout(x.timer);this.pending.clear();this.persistedAssetSignatures.clear();await this.backend.close();}
}

module.exports={RoomSnapshotStore,plainRoomSnapshot,buildRoomSnapshot,hydrateSnapshotAvatars,restoreRoomSnapshot,SNAPSHOT_VERSION};

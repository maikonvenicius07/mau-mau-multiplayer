'use strict';

const fs = require('fs');
const path = require('path');
const AvatarWire = require('./avatar-wire');
const RankingMode = require('./ranking-mode');
const InputSafety = require('./input-safety');

const SNAPSHOT_VERSION = 1;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_DEBOUNCE_MS = 250;
const MIN_LIFECYCLE_TTL_MS = 24 * 60 * 60 * 1000;

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
  snapshot.spectators = [];

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
  // V40.62 — snapshots novos já carregam a categoria congelada. Para uma
  // partida antiga restaurada durante a atualização, inferimos sem considerar
  // como bot original uma cadeira humana convertida após abandono.
  if (Number(room.round||0)>0 && !RankingMode.validMode(room.rankingModeAtStart)) {
    room.rankingModeAtStart=RankingMode.inferLegacyMode(room);
  }
  if (!Array.isArray(room.chat)) room.chat=[];
  room.chat=room.chat.slice(-60).map(message=>({
    ...message,
    id:InputSafety.cleanOpaqueId(message?.id,96)||`chat-restored-${now}`,
    name:message?.system?'Mesa':InputSafety.cleanPresenceName(message?.name),
    avatar:InputSafety.cleanAvatar(message?.avatar,message?.system?'👁️':'macaco'),
    text:InputSafety.cleanChatText(message?.text),
  })).filter(message=>message.system||message.text);
  if (!Array.isArray(room.log)) room.log=[];
  if (!Array.isArray(room.turnAudit)) room.turnAudit=[];
  if (!Array.isArray(room.replayReadyPlayerIds)) room.replayReadyPlayerIds=[];
  for (const p of room.players) {
    p.socketId = null;
    p.name=InputSafety.cleanPresenceName(p.name,p.isBot?'Máquina':'Jogador');
    p.avatar=InputSafety.cleanAvatar(p.avatar,p.isBot?'preta':'macaco');
    if(p.token)p.token=InputSafety.cleanOpaqueId(p.token,160)||`restored-${p.id}`;
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
    if (!Number.isFinite(Number(p.membershipStartedAt))) p.membershipStartedAt = 0;
    p.connected = false;
    p.autoControlled = false;
    p.disconnectedAt = now;
    p.reconnectDeadlineAt = now + reconnectGraceMs;
    p.reconnectEligible = true;
    p.voluntaryLeftAt = null;
  }
  if (!room.players.some(p => !p.isBot)) return null;
  if (!room.players.some(p => !p.isBot && p.host)) {
    const firstHuman = room.players.find(p => !p.isBot);
    if (firstHuman) firstHuman.host = true;
  }
  return room;
}

function assetObject(assets){ return Object.fromEntries(assets instanceof Map ? assets : Object.entries(assets || {})); }
function assetSignature(assets){ return [...(assets instanceof Map ? assets.keys() : Object.keys(assets || {}))].sort().join('|'); }
function ensureJsonLifecycle(data){
  if(!data.lifecycle||typeof data.lifecycle!=='object')data.lifecycle={};
  if(!data.lifecycle.rooms||typeof data.lifecycle.rooms!=='object')data.lifecycle.rooms={};
  if(!data.lifecycle.players||typeof data.lifecycle.players!=='object')data.lifecycle.players={};
  return data.lifecycle;
}

class JsonSnapshotBackend {
  constructor(filePath){ this.filePath=filePath; this.data={version:SNAPSHOT_VERSION,rooms:{},lifecycle:{rooms:{},players:{}}}; }
  async init(){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    try {
      const parsed=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if(parsed?.version===SNAPSHOT_VERSION&&parsed.rooms&&typeof parsed.rooms==='object')this.data=parsed;
    } catch(e){ if(e.code!=='ENOENT')console.warn('[rooms] snapshot JSON inválido:',e.message); }
    ensureJsonLifecycle(this.data);
  }
  persist(){ const tmp=`${this.filePath}.tmp`;fs.writeFileSync(tmp,JSON.stringify(this.data));fs.renameSync(tmp,this.filePath); }
  async save(code,snapshot,expiresAt,avatarAssets=null){
    const previous=this.data.rooms[code]||{};
    this.data.rooms[code]={snapshot,expiresAt,avatarAssets:avatarAssets===null?(previous.avatarAssets||{}):assetObject(avatarAssets)};
    this.persist();
  }
  async delete(code){ if(this.data.rooms[code]){delete this.data.rooms[code];this.persist();} }
  async markPlayerAbandoned(code,playerKey,playerId,eventAt,expiresAt){
    const lifecycle=ensureJsonLifecycle(this.data);
    if(!lifecycle.players[code])lifecycle.players[code]={};
    lifecycle.players[code][playerKey]={playerId:String(playerId||''),eventAt,expiresAt};
    this.persist();
  }
  async markRoomDeleted(code,eventAt,expiresAt){
    const lifecycle=ensureJsonLifecycle(this.data);
    lifecycle.rooms[code]={eventAt,expiresAt};
    delete this.data.rooms[code];
    this.persist();
  }
  async loadLifecycle(now){
    const lifecycle=ensureJsonLifecycle(this.data);
    let changed=false;
    const rooms=[];
    const players=[];
    for(const [code,row] of Object.entries(lifecycle.rooms)){
      if(!row||Number(row.expiresAt||0)<=now){delete lifecycle.rooms[code];changed=true;continue;}
      rooms.push({roomCode:code,eventAt:Number(row.eventAt||0)});
    }
    for(const [code,map] of Object.entries(lifecycle.players)){
      if(!map||typeof map!=='object'){delete lifecycle.players[code];changed=true;continue;}
      for(const [playerKey,row] of Object.entries(map)){
        if(!row||Number(row.expiresAt||0)<=now){delete map[playerKey];changed=true;continue;}
        players.push({roomCode:code,playerKey,playerId:String(row.playerId||''),eventAt:Number(row.eventAt||0)});
      }
      if(!Object.keys(map).length){delete lifecycle.players[code];changed=true;}
    }
    if(changed)this.persist();
    return {rooms,players};
  }
  async loadActive(now){
    const out=[];let changed=false;
    for(const [code,row] of Object.entries(this.data.rooms)){
      if(!row||Number(row.expiresAt||0)<=now){delete this.data.rooms[code];changed=true;continue;}
      out.push({snapshot:row.snapshot,avatarAssets:row.avatarAssets||{}});
    }
    if(changed)this.persist();
    return out;
  }
  async healthCheck(){ return true; }
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
      CREATE TABLE IF NOT EXISTS mm_room_lifecycle_tombstones (
        room_code VARCHAR(10) NOT NULL,
        subject_key TEXT NOT NULL,
        kind VARCHAR(24) NOT NULL,
        player_id TEXT,
        event_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY(room_code, subject_key, kind)
      );
      ALTER TABLE mm_room_lifecycle_tombstones ADD COLUMN IF NOT EXISTS player_id TEXT;
      CREATE INDEX IF NOT EXISTS mm_room_lifecycle_expires_idx ON mm_room_lifecycle_tombstones(expires_at);
    `);
    await this.pool.query('DELETE FROM mm_room_snapshots WHERE expires_at <= NOW()');
    await this.pool.query('DELETE FROM mm_room_lifecycle_tombstones WHERE expires_at <= NOW()');
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
  async markPlayerAbandoned(code,playerKey,playerId,eventAt,expiresAt){
    await this.pool.query(`
      INSERT INTO mm_room_lifecycle_tombstones(room_code,subject_key,kind,player_id,event_at,expires_at)
      VALUES($1,$2,'player-abandoned',$3,$4,$5)
      ON CONFLICT(room_code,subject_key,kind)
      DO UPDATE SET player_id=EXCLUDED.player_id,event_at=GREATEST(mm_room_lifecycle_tombstones.event_at,EXCLUDED.event_at),expires_at=GREATEST(mm_room_lifecycle_tombstones.expires_at,EXCLUDED.expires_at)
    `,[code,playerKey,String(playerId||''),new Date(eventAt).toISOString(),new Date(expiresAt).toISOString()]);
  }
  async markRoomDeleted(code,eventAt,expiresAt){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO mm_room_lifecycle_tombstones(room_code,subject_key,kind,event_at,expires_at)
        VALUES($1,'*','room-deleted',$2,$3)
        ON CONFLICT(room_code,subject_key,kind)
        DO UPDATE SET event_at=GREATEST(mm_room_lifecycle_tombstones.event_at,EXCLUDED.event_at),expires_at=GREATEST(mm_room_lifecycle_tombstones.expires_at,EXCLUDED.expires_at)
      `,[code,new Date(eventAt).toISOString(),new Date(expiresAt).toISOString()]);
      await client.query('DELETE FROM mm_room_snapshots WHERE room_code=$1',[code]);
      await client.query('COMMIT');
    }catch(e){
      try{await client.query('ROLLBACK');}catch{}
      throw e;
    }finally{client.release();}
  }
  async loadLifecycle(){
    const {rows}=await this.pool.query(`
      SELECT room_code,subject_key,kind,player_id,EXTRACT(EPOCH FROM event_at)*1000 AS event_ms
      FROM mm_room_lifecycle_tombstones WHERE expires_at > NOW()
    `);
    const rooms=[];const players=[];
    for(const row of rows){
      const eventAt=Number(row.event_ms||0);
      if(row.kind==='room-deleted')rooms.push({roomCode:row.room_code,eventAt});
      else if(row.kind==='player-abandoned')players.push({roomCode:row.room_code,playerKey:row.subject_key,playerId:String(row.player_id||''),eventAt});
    }
    return {rooms,players};
  }
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
  async healthCheck(){
    const {rows}=await this.pool.query('SELECT 1 AS ok');
    return Number(rows?.[0]?.ok)===1;
  }
  async close(){ await this.pool.end(); }
}

function convertStaleMembershipToBot(player){
  const p={...player};
  p.isBot=true;
  p.connected=true;
  p.socketId=null;
  p.autoControlled=false;
  p.disconnectedAt=null;
  p.reconnectDeadlineAt=null;
  p.reconnectEligible=false;
  p.voluntaryLeftAt=Number(p.voluntaryLeftAt||0)||Date.now();
  p.playerKey=null;
  p.token=`tombstone-bot-${p.id}`;
  p.host=false;
  p.name='Máquina';
  p.avatar='preta';
  return p;
}

class RoomSnapshotStore {
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=process.env.ROOM_SNAPSHOT_FILE||path.join(__dirname,'data','room-snapshots.json'),ttlMs=Number(process.env.ROOM_SNAPSHOT_TTL_MS)||DEFAULT_TTL_MS,debounceMs=DEFAULT_DEBOUNCE_MS}={}){
    this.kind=databaseUrl?'postgres':'json';
    this.backend=databaseUrl?new PostgresSnapshotBackend(databaseUrl):new JsonSnapshotBackend(filePath);
    this.ttlMs=Math.max(5*60*1000,ttlMs);
    this.lifecycleTtlMs=Math.max(MIN_LIFECYCLE_TTL_MS,this.ttlMs*2);
    this.debounceMs=debounceMs;
    this.pending=new Map();
    this.persistedAssetSignatures=new Map();
    this.deletedRooms=new Map();
    this.abandonedPlayers=new Map();
    this.closed=false;
  }
  async init(){
    await this.backend.init();
    const lifecycle=await this.backend.loadLifecycle(Date.now());
    for(const row of lifecycle?.rooms||[])this.deletedRooms.set(String(row.roomCode),Number(row.eventAt||0));
    for(const row of lifecycle?.players||[]){
      const code=String(row.roomCode||''),key=String(row.playerKey||'');
      if(!code||!key)continue;
      if(!this.abandonedPlayers.has(code))this.abandonedPlayers.set(code,new Map());
      this.abandonedPlayers.get(code).set(key,{playerId:String(row.playerId||''),eventAt:Number(row.eventAt||0)});
    }
  }
  async healthCheck(){ return this.backend.healthCheck(); }
  isRoomDeleted(code){return this.deletedRooms.has(String(code||''));}
  playerAbandonTombstone(code,playerKey){return this.abandonedPlayers.get(String(code||''))?.get(String(playerKey||''))||null;}
  snapshotParts(room){
    const built=buildRoomSnapshot(room);
    const signature=assetSignature(built.avatarAssets);
    const changed=this.persistedAssetSignatures.get(room.code)!==signature;
    return {...built,assetSignature:signature,avatarAssetsForSave:changed?built.avatarAssets:null};
  }
  queueSave(room){
    if(this.closed||!room?.code||this.isRoomDeleted(room.code))return;
    const code=room.code;
    const existing=this.pending.get(code);if(existing)clearTimeout(existing.timer);
    const {snapshot,assetSignature,avatarAssetsForSave}=this.snapshotParts(room);if(!snapshot)return;
    const timer=setTimeout(()=>{
      this.pending.delete(code);
      if(this.isRoomDeleted(code))return;
      this.backend.save(code,snapshot,Date.now()+this.ttlMs,avatarAssetsForSave).then(()=>{if(avatarAssetsForSave!==null)this.persistedAssetSignatures.set(code,assetSignature);}).catch(e=>console.error('[rooms] falha ao salvar snapshot',code,e?.message||e));
    },this.debounceMs);
    timer.unref?.();
    this.pending.set(code,{timer,snapshot});
  }
  async saveNow(room){
    if(!room?.code||this.isRoomDeleted(room.code))return;
    const pending=this.pending.get(room.code);if(pending){clearTimeout(pending.timer);this.pending.delete(room.code);}
    const {snapshot,assetSignature,avatarAssetsForSave}=this.snapshotParts(room);
    if(snapshot){
      await this.backend.save(room.code,snapshot,Date.now()+this.ttlMs,avatarAssetsForSave);
      if(avatarAssetsForSave!==null)this.persistedAssetSignatures.set(room.code,assetSignature);
    }
  }
  async markPlayerAbandoned(code,playerKey,playerId,eventAt=Date.now()){
    code=String(code||'');playerKey=String(playerKey||'');playerId=String(playerId||'');
    if(!code||!playerKey)return;
    const expiresAt=Date.now()+this.lifecycleTtlMs;
    await this.backend.markPlayerAbandoned(code,playerKey,playerId,eventAt,expiresAt);
    if(!this.abandonedPlayers.has(code))this.abandonedPlayers.set(code,new Map());
    this.abandonedPlayers.get(code).set(playerKey,{playerId,eventAt:Number(eventAt||0)});
  }
  async markRoomDeleted(code,eventAt=Date.now()){
    code=String(code||'');if(!code)return;
    const pending=this.pending.get(code);if(pending){clearTimeout(pending.timer);this.pending.delete(code);}
    const expiresAt=Date.now()+this.lifecycleTtlMs;
    await this.backend.markRoomDeleted(code,eventAt,expiresAt);
    this.deletedRooms.set(code,Math.max(Number(this.deletedRooms.get(code)||0),Number(eventAt||0)));
    this.persistedAssetSignatures.delete(code);
  }
  async delete(code){
    const pending=this.pending.get(code);if(pending){clearTimeout(pending.timer);this.pending.delete(code);}
    this.persistedAssetSignatures.delete(code);
    await this.backend.delete(code);
  }
  applyLifecycle(snapshot){
    if(!snapshot?.code||this.isRoomDeleted(snapshot.code))return null;
    const map=this.abandonedPlayers.get(String(snapshot.code));
    if(!map?.size)return snapshot;
    const activeMatch=snapshot.status==='playing'||(snapshot.status==='between-rounds'&&Number(snapshot.round||0)>0);
    const players=[];
    for(const original of Array.isArray(snapshot.players)?snapshot.players:[]){
      if(original.isBot||!original.playerKey){players.push(original);continue;}
      const tombstone=map.get(String(original.playerKey))||null;
      const abandonedAt=Number(tombstone?.eventAt||0);
      const membershipStartedAt=Number(original.membershipStartedAt||0);
      const exactMembership=!!(tombstone?.playerId&&String(original.id||'')===String(tombstone.playerId));
      const legacyMembership=!tombstone?.playerId&&abandonedAt>0&&membershipStartedAt<=abandonedAt;
      if(exactMembership||legacyMembership){
        if(activeMatch)players.push(convertStaleMembershipToBot(original));
        continue;
      }
      players.push(original);
    }
    snapshot.players=players;
    if(!players.some(p=>!p.isBot))return null;
    return snapshot;
  }
  async loadActive(){
    const rows=await this.backend.loadActive(Date.now());
    const out=[];
    for(const row of rows){
      const raw=row&&Object.prototype.hasOwnProperty.call(row,'snapshot')?hydrateSnapshotAvatars(row.snapshot,row.avatarAssets||{}):row;
      const filtered=this.applyLifecycle(raw);
      if(filtered)out.push(filtered);
    }
    return out;
  }
  async flushAll(rooms){
    const list=[...rooms.values()].filter(r=>r&&r.status!=='finished'&&!this.isRoomDeleted(r.code));
    await Promise.all(list.map(r=>this.saveNow(r)));
  }
  async close(){this.closed=true;for(const x of this.pending.values())clearTimeout(x.timer);this.pending.clear();this.persistedAssetSignatures.clear();await this.backend.close();}
}

module.exports={RoomSnapshotStore,plainRoomSnapshot,buildRoomSnapshot,hydrateSnapshotAvatars,restoreRoomSnapshot,SNAPSHOT_VERSION};

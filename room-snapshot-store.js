'use strict';

const fs = require('fs');
const path = require('path');
const AvatarWire = require('./avatar-wire');
const RankingMode = require('./ranking-mode');
const InputSafety = require('./input-safety');
const RetentionPolicy = require('./retention-policy');
const BotDifficulty = require('./bot-difficulty');
const SpectatorSeatAdmission = require('./spectator-seat-admission');

const SNAPSHOT_VERSION = 1;
const DEFAULT_TTL_MS = RetentionPolicy.MULTIPLAYER_SNAPSHOT_TTL_MS;
// ROOM_SNAPSHOT_TTL_MS continua suportado em desenvolvimento/testes pela política central;
// em produção/Render a V40.67 fixa o prazo oficial em 8 horas.
const DEFAULT_DEBOUNCE_MS = 250;
const MIN_LIFECYCLE_TTL_MS = 24 * 60 * 60 * 1000;

function buildRoomSnapshot(room) {
  if (!room || !room.code || !Array.isArray(room.players)) return {snapshot:null,avatarAssets:new Map()};
  const snapshot = {};
  const skip = new Set(['botTimer','inviteReservations','spectators','spectatorSeatRequests','_presenceSignature']);
  for (const [key,value] of Object.entries(room)) {
    if (skip.has(key)) continue;
    if (key === 'rankingRecording') { snapshot[key] = false; continue; }
    snapshot[key] = value;
  }
  snapshot.snapshotVersion = SNAPSHOT_VERSION;
  snapshot.savedAt = Date.now();
  snapshot.players = room.players.map(p => ({...p, socketId:null}));
  snapshot.spectators = [];
  snapshot.pendingSpectatorSeatRequests = SpectatorSeatAdmission.persistableSeatRequests(room);

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
  // V40.69.8.6 — em sala comum, o resultado confirmado não encerra a
  // associação dos jogadores: eles podem voltar e pedir JOGAR NOVAMENTE.
  // Torneios finalizados continuam sem revanche (fluxo competitivo separado).
  // Resultados pendentes em ambos os modos seguem recuperáveis para retry.
  if (snapshot.status === 'finished' && snapshot.rankingRecorded && snapshot.tournament) return null;
  const room = JSON.parse(JSON.stringify(snapshot));
  delete room.snapshotVersion;
  delete room.savedAt;
  room.botDifficulty=BotDifficulty.normalize(room.botDifficulty);
  room.botTimer = null;
  room.inviteReservations = new Map();
  room.spectators = [];
  // Somente as intenções por conta são restauradas, sem token ou sessão de observador.
  room.spectatorSeatRequests = SpectatorSeatAdmission.restoreSeatRequests(room,snapshot,now);
  delete room.pendingSpectatorSeatRequests;
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
  async save(code,snapshot,expiresAt,avatarAssets=null,revision=0){
    const deleted=ensureJsonLifecycle(this.data).rooms[code];
    if(deleted && Number(deleted.expiresAt||0)>Date.now())return false;
    const previous=this.data.rooms[code]||{};
    if(Number(previous.revision||0)>=revision)return false;
    this.data.rooms[code]={snapshot,expiresAt,revision,avatarAssets:avatarAssets===null?(previous.avatarAssets||{}):assetObject(avatarAssets)};
    this.persist();
    return true;
  }
  async loadRevisions(){return Object.entries(this.data.rooms).map(([code,row])=>({code,revision:Number(row.revision||0)}));}
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
  constructor(databaseUrl,pool=null){
    if(pool){this.pool=pool;this.ownsPool=false;}
    else{const {createAppDatabasePool}=require('./database-pool');this.pool=createAppDatabasePool(databaseUrl);this.ownsPool=true;}
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
      ALTER TABLE mm_room_snapshots ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
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
  async save(code,snapshot,expiresAt,avatarAssets=null,revision=0){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      // Serializa transações da mesma sala inclusive entre processos/instâncias.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('mm_room_snapshots'),hashtext($1))",[code]);
      const {rows}=await client.query(`
        INSERT INTO mm_room_snapshots(room_code,snapshot,status,updated_at,expires_at,revision)
        -- $1 aparece em SELECT (room_code VARCHAR) e em comparacao com outra coluna.
        -- O cast explicito elimina a inferencia conflitante text/varchar pelo PostgreSQL.
        SELECT $1::text,$2::jsonb,$3,NOW(),$4,$5
        WHERE NOT EXISTS (
          SELECT 1 FROM mm_room_lifecycle_tombstones
          WHERE room_code=$1::text AND subject_key='*' AND kind='room-deleted' AND expires_at>NOW()
        )
        ON CONFLICT(room_code) DO UPDATE
        SET snapshot=EXCLUDED.snapshot,status=EXCLUDED.status,
            updated_at=NOW(),expires_at=EXCLUDED.expires_at,revision=EXCLUDED.revision
        WHERE mm_room_snapshots.revision<EXCLUDED.revision
        RETURNING revision
      `,[code,JSON.stringify(snapshot),String(snapshot.status||'lobby'),new Date(expiresAt).toISOString(),revision]);
      const saved=rows.length>0;
      if(saved&&avatarAssets!==null){
        const assets=avatarAssets instanceof Map?avatarAssets:new Map(Object.entries(avatarAssets||{}));
        const refs=[...assets.keys()];
        if(refs.length)await client.query('DELETE FROM mm_room_avatar_assets WHERE room_code=$1 AND NOT (avatar_ref = ANY($2::text[]))',[code,refs]);
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
      return saved;
    }catch(e){
      try{await client.query('ROLLBACK');}catch{}
      throw e;
    }finally{client.release();}
  }
  async loadRevisions(){
    const {rows}=await this.pool.query('SELECT room_code AS code,revision FROM mm_room_snapshots WHERE expires_at>NOW()');
    return rows.map(row=>({code:String(row.code),revision:Number(row.revision||0)}));
  }
  async delete(code){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('mm_room_snapshots'),hashtext($1))",[code]);
      await client.query('DELETE FROM mm_room_snapshots WHERE room_code=$1',[code]);
      await client.query('COMMIT');
    }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}
    finally{client.release();}
  }
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
      await client.query("SELECT pg_advisory_xact_lock(hashtext('mm_room_snapshots'),hashtext($1))",[code]);
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
  async close(){ if(this.ownsPool)await this.pool.end(); }
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
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=process.env.ROOM_SNAPSHOT_FILE||path.join(__dirname,'data','room-snapshots.json'),ttlMs=RetentionPolicy.snapshotTtlMs(process.env),debounceMs=DEFAULT_DEBOUNCE_MS,pool=null}={}){
    this.kind=(pool||databaseUrl)?'postgres':'json';
    this.backend=(pool||databaseUrl)?new PostgresSnapshotBackend(databaseUrl,pool):new JsonSnapshotBackend(filePath);
    this.ttlMs=Math.max(5*60*1000,ttlMs);
    this.lifecycleTtlMs=Math.max(MIN_LIFECYCLE_TTL_MS,this.ttlMs*2);
    this.debounceMs=debounceMs;
    this.pending=new Map();
    this.roomWriteQueues=new Map();
    this.revisions=new Map();
    this.persistedAssetSignatures=new Map();
    this.deletedRooms=new Map();
    this.deletingRooms=new Map();
    this.abandonedPlayers=new Map();
    this.closed=false;
  }
  async init(){
    await this.backend.init();
    const [lifecycle,revisions]=await Promise.all([
      this.backend.loadLifecycle(Date.now()),this.backend.loadRevisions()
    ]);
    for(const row of lifecycle?.rooms||[])this.deletedRooms.set(String(row.roomCode),Number(row.eventAt||0));
    for(const row of revisions||[])this.revisions.set(String(row.code),Number(row.revision||0));
    for(const row of lifecycle?.players||[]){
      const code=String(row.roomCode||''),key=String(row.playerKey||'');
      if(!code||!key)continue;
      if(!this.abandonedPlayers.has(code))this.abandonedPlayers.set(code,new Map());
      this.abandonedPlayers.get(code).set(key,{playerId:String(row.playerId||''),eventAt:Number(row.eventAt||0)});
    }
  }
  async healthCheck(){return this.backend.healthCheck();}
  isRoomDeleted(code){return this.deletedRooms.has(String(code||''))||this.deletingRooms.has(String(code||''));}
  playerAbandonTombstone(code,playerKey){return this.abandonedPlayers.get(String(code||''))?.get(String(playerKey||''))||null;}
  snapshotParts(room){
    const built=buildRoomSnapshot(room);
    return {...built,assetSignature:assetSignature(built.avatarAssets)};
  }
  // Uma operação falha não cancela as próximas. Cada código de sala possui
  // sua própria fila: salas diferentes continuam persistindo em paralelo.
  enqueueRoomWrite(code,operation){
    const previous=this.roomWriteQueues.get(code)||Promise.resolve();
    const task=previous.catch(()=>{}).then(operation);
    this.roomWriteQueues.set(code,task);
    void task.finally(()=>{
      if(this.roomWriteQueues.get(code)===task)this.roomWriteQueues.delete(code);
    }).catch(()=>{});
    return task;
  }
  nextRevision(code){
    const revision=(this.revisions.get(code)||0)+1;
    this.revisions.set(code,revision);
    return revision;
  }
  async writeSnapshot(code,parts,revision){
    if(this.isRoomDeleted(code))return false;
    const assetsForSave=this.persistedAssetSignatures.get(code)===parts.assetSignature?null:parts.avatarAssets;
    const saved=await this.backend.save(code,parts.snapshot,Date.now()+this.ttlMs,assetsForSave,revision);
    if(saved!==false&&assetsForSave!==null)this.persistedAssetSignatures.set(code,parts.assetSignature);
    return saved!==false;
  }
  queueSave(room){
    if(this.closed||!room?.code||this.isRoomDeleted(room.code))return;
    const code=room.code;
    const existing=this.pending.get(code);if(existing)clearTimeout(existing.timer);
    const parts=this.snapshotParts(room);if(!parts.snapshot)return;
    const entry={timer:null,parts};
    entry.timer=setTimeout(()=>{
      if(this.pending.get(code)!==entry)return;
      this.pending.delete(code);
      if(this.isRoomDeleted(code))return;
      const revision=this.nextRevision(code);
      this.enqueueRoomWrite(code,()=>this.writeSnapshot(code,parts,revision))
        .catch(e=>console.error('[rooms] falha ao salvar snapshot',code,e?.message||e));
    },this.debounceMs);
    entry.timer.unref?.();
    this.pending.set(code,entry);
  }
  async saveNow(room){
    if(this.closed||!room?.code||this.isRoomDeleted(room.code))return false;
    const code=room.code;
    const pending=this.pending.get(code);
    if(pending){clearTimeout(pending.timer);this.pending.delete(code);}
    const parts=this.snapshotParts(room);
    if(!parts.snapshot)return false;
    const revision=this.nextRevision(code);
    return this.enqueueRoomWrite(code,()=>this.writeSnapshot(code,parts,revision));
  }
  async markPlayerAbandoned(code,playerKey,playerId,eventAt=Date.now()){
    code=String(code||'');playerKey=String(playerKey||'');playerId=String(playerId||'');
    if(!code||!playerKey)return;
    const expiresAt=Date.now()+this.lifecycleTtlMs;
    return this.enqueueRoomWrite(code,async()=>{
      await this.backend.markPlayerAbandoned(code,playerKey,playerId,eventAt,expiresAt);
      if(!this.abandonedPlayers.has(code))this.abandonedPlayers.set(code,new Map());
      this.abandonedPlayers.get(code).set(playerKey,{playerId,eventAt:Number(eventAt||0)});
    });
  }
  async markRoomDeleted(code,eventAt=Date.now()){
    code=String(code||'');if(!code)return;
    const pending=this.pending.get(code);if(pending){clearTimeout(pending.timer);this.pending.delete(code);}
    // Bloqueia novas gravações ANTES de aguardar uma escrita já em andamento.
    const intent=Symbol('markRoomDeleted');
    this.deletingRooms.set(code,intent);
    const expiresAt=Date.now()+this.lifecycleTtlMs;
    try{
      await this.enqueueRoomWrite(code,async()=>{
        await this.backend.markRoomDeleted(code,eventAt,expiresAt);
        this.deletedRooms.set(code,Math.max(Number(this.deletedRooms.get(code)||0),Number(eventAt||0)));
        this.persistedAssetSignatures.delete(code);
      });
    }catch(error){
      // Se o banco rejeitar a exclusão, a sala ainda poderá tentar persistir
      // novamente; uma solicitação de exclusão posterior não é desbloqueada.
      if(this.deletingRooms.get(code)===intent&&!this.deletedRooms.has(code))this.deletingRooms.delete(code);
      throw error;
    }
  }
  async delete(code){
    code=String(code||'');if(!code)return;
    const pending=this.pending.get(code);if(pending){clearTimeout(pending.timer);this.pending.delete(code);}
    // Exclusão simples (fim de partida): impede que um callback tardio salve
    // novamente o estado, sem introduzir um novo tombstone persistido.
    const intent=Symbol('delete');
    this.deletingRooms.set(code,intent);
    try{
      await this.enqueueRoomWrite(code,async()=>{
        await this.backend.delete(code);
        this.persistedAssetSignatures.delete(code);
      });
    }catch(error){
      if(this.deletingRooms.get(code)===intent&&!this.deletedRooms.has(code))this.deletingRooms.delete(code);
      throw error;
    }
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
    // SIGTERM/deploy também precisa confirmar o último voto de revanche de
    // salas finalizadas. Sem isso, apenas snapshots antigos eram mantidos.
    const list=[...rooms.values()].filter(r=>r&&!this.isRoomDeleted(r.code)&&!(r.status==='finished'&&r.tournament&&r.rankingRecorded));
    await Promise.all(list.map(r=>this.saveNow(r)));
  }
  async close(){
    this.closed=true;
    for(const x of this.pending.values())clearTimeout(x.timer);
    this.pending.clear();
    // O pool compartilhado só pode ser encerrado após todas as escritas iniciadas.
    const operations=[...this.roomWriteQueues.values()];
    await Promise.allSettled(operations);
    this.persistedAssetSignatures.clear();
    await this.backend.close();
  }
}

module.exports={RoomSnapshotStore,plainRoomSnapshot,buildRoomSnapshot,hydrateSnapshotAvatars,restoreRoomSnapshot,SNAPSHOT_VERSION};

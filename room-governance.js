'use strict';

const DEFAULT_MAX_ROOMS = 10;
const MIN_MAX_ROOMS = 10;
const MAX_MAX_ROOMS = 500;

function maxRooms(env=process.env) {
  const raw = env?.MAX_ROOMS ?? env?.MAUMAU_MAX_ROOMS;
  if(raw===undefined || raw===null || String(raw).trim()==='') return DEFAULT_MAX_ROOMS;
  const value = Number(raw);
  if(!Number.isFinite(value)) return DEFAULT_MAX_ROOMS;
  return Math.max(MIN_MAX_ROOMS, Math.min(MAX_MAX_ROOMS, Math.floor(value)));
}

function atCapacity(roomCount, limit=DEFAULT_MAX_ROOMS, pending=0, reclaimable=0) {
  const projected = Math.max(0, Number(roomCount)||0) + Math.max(0, Number(pending)||0) - Math.max(0, Number(reclaimable)||0);
  return projected >= Math.max(1, Number(limit)||DEFAULT_MAX_ROOMS);
}

function hasHumanMembers(room) {
  return !!(room && Array.isArray(room.players) && room.players.some(p=>p && !p.isBot));
}

function shouldCleanupRoom(room) {
  if(!room || !Array.isArray(room.players)) return true;
  return !hasHumanMembers(room);
}

function summarizeRooms(iterable, limit=DEFAULT_MAX_ROOMS, pending=0) {
  const stats={
    total:0,
    limit:Number(limit)||DEFAULT_MAX_ROOMS,
    pendingCreations:Math.max(0,Number(pending)||0),
    atCapacity:false,
    availableSlots:0,
    lobby:0,
    playing:0,
    betweenRounds:0,
    finished:0,
    reconnecting:0,
    soloExpiry:0,
    offlineExpiry:0,
    botOnly:0,
    humanSeats:0,
    connectedHumans:0,
    autoControlledHumans:0,
    bots:0,
    spectators:0,
    connectedSpectators:0,
  };
  for(const room of iterable||[]){
    if(!room)continue;
    stats.total++;
    if(room.status==='lobby')stats.lobby++;
    else if(room.status==='playing')stats.playing++;
    else if(room.status==='between-rounds')stats.betweenRounds++;
    else if(room.status==='finished')stats.finished++;
    const players=Array.isArray(room.players)?room.players:[];
    const humans=players.filter(p=>p&&!p.isBot);
    const bots=players.filter(p=>p&&p.isBot);
    stats.humanSeats+=humans.length;
    stats.connectedHumans+=humans.filter(p=>p.connected).length;
    stats.autoControlledHumans+=humans.filter(p=>p.autoControlled).length;
    stats.bots+=bots.length;
    if(!humans.length)stats.botOnly++;
    if(humans.some(p=>!p.connected&&p.reconnectEligible))stats.reconnecting++;
    if(Number(room.soloDisconnectStartedAt||0)>0)stats.soloExpiry++;
    if(Number(room.allHumansOfflineStartedAt||room.soloDisconnectStartedAt||0)>0)stats.offlineExpiry++;
    const spectators=Array.isArray(room.spectators)?room.spectators:[];
    stats.spectators+=spectators.length;
    stats.connectedSpectators+=spectators.filter(s=>s&&s.connected).length;
  }
  const used=stats.total+stats.pendingCreations;
  stats.atCapacity=used>=stats.limit;
  stats.availableSlots=Math.max(0,stats.limit-used);
  return stats;
}

module.exports={
  DEFAULT_MAX_ROOMS,
  maxRooms,
  atCapacity,
  hasHumanMembers,
  shouldCleanupRoom,
  summarizeRooms,
};

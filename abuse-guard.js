'use strict';

const DEFAULT_MAX_SPECTATORS_PER_ROOM = 5;
const MIN_MAX_SPECTATORS_PER_ROOM = 1;
const MAX_MAX_SPECTATORS_PER_ROOM = 50;

const DEFAULT_ACTION_RULES = Object.freeze({
  createRoom: Object.freeze({limit:4, windowMs:60*1000}),
  joinRoom: Object.freeze({limit:20, windowMs:60*1000}),
  joinSpectator: Object.freeze({limit:10, windowMs:60*1000}),
  startMatchmaking: Object.freeze({limit:10, windowMs:60*1000}),
});

function maxSpectatorsPerRoom(env=process.env) {
  const raw=env?.MAX_SPECTATORS_PER_ROOM ?? env?.MAUMAU_MAX_SPECTATORS_PER_ROOM;
  if(raw===undefined||raw===null||String(raw).trim()==='')return DEFAULT_MAX_SPECTATORS_PER_ROOM;
  const value=Number(raw);
  if(!Number.isFinite(value))return DEFAULT_MAX_SPECTATORS_PER_ROOM;
  return Math.max(MIN_MAX_SPECTATORS_PER_ROOM,Math.min(MAX_MAX_SPECTATORS_PER_ROOM,Math.floor(value)));
}

function spectatorSlotsUsed(room) {
  return Array.isArray(room?.spectators)?room.spectators.length:0;
}

function spectatorAtCapacity(room,limit=DEFAULT_MAX_SPECTATORS_PER_ROOM,pending=0) {
  return spectatorSlotsUsed(room)+Math.max(0,Number(pending)||0)>=Math.max(1,Number(limit)||DEFAULT_MAX_SPECTATORS_PER_ROOM);
}

class ActionRateLimiter {
  constructor(rules=DEFAULT_ACTION_RULES){
    this.rules=rules;
    this.entries=new Map();
  }
  consume(subject,action,now=Date.now()){
    const rule=this.rules?.[action];
    if(!rule)return {allowed:true,remaining:Infinity,retryAfterMs:0};
    const key=`${String(subject||'anonymous').slice(0,160)}:${action}`;
    const limit=Math.max(1,Number(rule.limit)||1);
    const windowMs=Math.max(1000,Number(rule.windowMs)||60000);
    let entry=this.entries.get(key);
    if(!entry||now-entry.startedAt>=windowMs){
      entry={startedAt:now,count:0};
      this.entries.set(key,entry);
    }
    if(entry.count>=limit){
      return {allowed:false,remaining:0,retryAfterMs:Math.max(1,entry.startedAt+windowMs-now)};
    }
    entry.count++;
    return {allowed:true,remaining:Math.max(0,limit-entry.count),retryAfterMs:0};
  }
  prune(now=Date.now()){
    for(const [key,entry] of this.entries){
      const action=String(key).slice(String(key).lastIndexOf(':')+1);
      const windowMs=Math.max(1000,Number(this.rules?.[action]?.windowMs)||60000);
      if(!entry||now-entry.startedAt>=windowMs)this.entries.delete(key);
    }
    return this.entries.size;
  }
}

module.exports={
  DEFAULT_MAX_SPECTATORS_PER_ROOM,
  DEFAULT_ACTION_RULES,
  maxSpectatorsPerRoom,
  spectatorSlotsUsed,
  spectatorAtCapacity,
  ActionRateLimiter,
};

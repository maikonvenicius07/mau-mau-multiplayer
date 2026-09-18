'use strict';
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const snapshots=fs.readFileSync(path.join(root,'room-snapshot-store.js'),'utf8');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};
assert(pkg.version==='40.65','package.json não está na V40.54.1');
for(const key of ['DATABASE_URL=','ROOM_SNAPSHOT_TTL_MS=28800000','AUTH_SESSION_SECRET=','VOICE_TURN_URLS=','VOICE_TURN_USERNAME=','VOICE_TURN_CREDENTIAL=','VOICE_TURN_SECRET=','VOICE_TURN_TTL_SECONDS=3600']){
  assert(env.includes(key),`.env.example sem ${key}`);
}
assert(server.includes('VOICE_TURN_SECRET'),'servidor perdeu suporte ao TURN temporário');
assert(snapshots.includes('ROOM_SNAPSHOT_TTL_MS'),'armazenamento perdeu configuração de TTL dos snapshots');
console.log('✓ V40.54.1: configuração TURN/snapshots documentada e protegida por teste.');

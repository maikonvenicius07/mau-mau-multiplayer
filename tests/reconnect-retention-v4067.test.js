'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Retention = require('../retention-policy');
const { RoomSnapshotStore } = require('../room-snapshot-store');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const server = fs.readFileSync(path.join(root,'server.js'),'utf8');
const envExample = fs.readFileSync(path.join(root,'.env.example'),'utf8');

assert.strictEqual(pkg.version,'40.68','package.json deve identificar V40.67');
assert.strictEqual(Retention.RECONNECT_GRACE_MS,60*1000,'AUTO deve continuar aguardando 60 segundos');
assert.strictEqual(Retention.SOLO_ROOM_EXPIRY_MS,5*60*1000,'sala solo deve continuar expirando em 5 minutos');
assert.strictEqual(Retention.MULTIPLAYER_SNAPSHOT_TTL_MS,8*60*60*1000,'snapshot multiplayer deve durar exatamente 8 horas');
assert.strictEqual(Retention.snapshotTtlMs({NODE_ENV:'production',ROOM_SNAPSHOT_TTL_MS:'3600000'}),8*60*60*1000,'produção deve manter 8 horas mesmo com variável antiga/divergente');
assert.strictEqual(Retention.snapshotTtlMs({NODE_ENV:'development',ROOM_SNAPSHOT_TTL_MS:'3600000'}),60*60*1000,'desenvolvimento/testes podem usar TTL reduzido explicitamente');
assert.ok(server.includes('RetentionPolicy.RECONNECT_GRACE_MS'),'server deve usar a política central para os 60 s');
assert.ok(server.includes('RetentionPolicy.SOLO_ROOM_EXPIRY_MS'),'server deve usar a política central para os 5 min');
assert.ok(envExample.includes('ROOM_SNAPSHOT_TTL_MS=28800000'),'exemplo deve documentar 8 horas em milissegundos');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-v4067-'));
  const file=path.join(dir,'rooms.json');
  const store=new RoomSnapshotStore({databaseUrl:'',filePath:file,debounceMs:5});
  assert.strictEqual(store.ttlMs,8*60*60*1000,'store padrão deve herdar 8 horas');
  await store.init();
  await store.close();
  fs.rmSync(dir,{recursive:true,force:true});
  console.log('✓ V40.67: 60 s para AUTO, 5 min para sala solo e 8 h de snapshot multiplayer formalizados e protegidos por teste.');
})().catch(err=>{console.error(err);process.exit(1);});

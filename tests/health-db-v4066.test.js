'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {evaluateReadiness,databaseRequired}=require('../service-readiness');

const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json'));

assert.strictEqual(pkg.version,'40.67','package.json deve identificar V40.67');
assert.ok(pkg.scripts.verify.includes('node --check service-readiness.js'),'verify deve validar o módulo de readiness');
assert.ok(read('render.yaml').includes('healthCheckPath: /ready'),'Render deve usar /ready, não apenas /health');
assert.ok(read('server.js').includes("app.get('/health'"),'liveness /health deve continuar disponível');
assert.ok(read('server.js').includes("app.get('/ready'"),'readiness /ready deve existir');
assert.ok(read('server.js').includes('evaluateReadiness'),'servidor deve executar prova ativa de readiness');
assert.ok(read('ranking-store.js').includes("SELECT 1 AS ok"),'ranking PostgreSQL deve possuir ping ativo');
assert.ok(read('room-snapshot-store.js').includes("SELECT 1 AS ok"),'snapshots PostgreSQL devem possuir ping ativo');

function fakeStore(kind,result=true){
  return {kind,async healthCheck(){if(result instanceof Error)throw result;return result;}};
}
(async()=>{
  assert.strictEqual(databaseRequired({NODE_ENV:'development'}),false,'desenvolvimento local pode usar JSON');
  assert.strictEqual(databaseRequired({RENDER:'true'}),true,'Render deve exigir banco');
  let r=await evaluateReadiness({
    rankingStore:fakeStore('json'),roomSnapshotStore:fakeStore('json'),rankingReady:Promise.resolve(true),roomSnapshotsReady:Promise.resolve(true),env:{NODE_ENV:'development'},timeoutMs:500,
  });
  assert.strictEqual(r.ok,true,'JSON local deve ser aceito em desenvolvimento');
  r=await evaluateReadiness({
    rankingStore:fakeStore('json'),roomSnapshotStore:fakeStore('json'),rankingReady:Promise.resolve(true),roomSnapshotsReady:Promise.resolve(true),env:{RENDER:'true'},timeoutMs:500,
  });
  assert.strictEqual(r.ok,false,'produção não pode ficar ready usando JSON local');
  assert.strictEqual(r.reason,'database-required');
  r=await evaluateReadiness({
    rankingStore:fakeStore('postgres'),roomSnapshotStore:fakeStore('postgres'),rankingReady:Promise.resolve(true),roomSnapshotsReady:Promise.resolve(true),env:{RENDER:'true'},timeoutMs:500,
  });
  assert.strictEqual(r.ok,true,'produção com PostgreSQL respondendo deve ficar ready');
  r=await evaluateReadiness({
    rankingStore:fakeStore('postgres',new Error('db down')),roomSnapshotStore:fakeStore('postgres'),rankingReady:Promise.resolve(true),roomSnapshotsReady:Promise.resolve(true),env:{RENDER:'true'},timeoutMs:500,
  });
  assert.strictEqual(r.ok,false,'falha real do PostgreSQL deve degradar readiness');
  assert.strictEqual(r.reason,'ranking-unavailable');
  console.log('✓ V40.67: /ready prova PostgreSQL ativo, Render exige banco e /health continua apenas como liveness.');
})().catch(err=>{console.error(err);process.exit(1);});

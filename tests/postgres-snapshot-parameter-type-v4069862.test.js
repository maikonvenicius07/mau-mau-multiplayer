'use strict';
// Regressao para PostgreSQL 42P08: parametro $1 com inferencia text/varchar conflitante.
// O cliente e simulado aqui; a verificacao em PostgreSQL real permanece necessaria.
const assert = require('node:assert/strict');
const {RoomSnapshotStore} = require('../room-snapshot-store');

async function exercise({saved}) {
  const statements=[];
  const client={
    async query(sql,params){
      statements.push({sql:String(sql),params});
      if(String(sql).includes('INSERT INTO mm_room_snapshots'))return {rows:saved?[{revision:9}]:[]};
      return {rows:[]};
    },
    release(){}
  };
  const pool={connect:async()=>client,query:async()=>({rows:[]})};
  const store=new RoomSnapshotStore({pool});
  const snapshot={status:'finished',round:5,players:[{id:'a'}]};
  const result=await store.backend.save('AB123',snapshot,Date.now()+60000,null,9);
  assert.equal(result,saved);
  const insertion=statements.find(s=>s.sql.includes('INSERT INTO mm_room_snapshots'));
  assert.ok(insertion,'UPSERT de snapshot ausente');
  assert.match(insertion.sql,/SELECT\s+\$1::text\s*,\s*\$2::jsonb/i);
  assert.match(insertion.sql,/WHERE\s+room_code\s*=\s*\$1::text\b/i);
  assert.equal(insertion.params[0],'AB123');
  assert.equal(insertion.params[4],9);
  assert.ok(statements.some(s=>s.sql==='BEGIN'),'transacao ausente');
  assert.ok(statements.some(s=>s.sql==='COMMIT'),'commit ausente');
  assert.ok(!statements.some(s=>s.sql==='ROLLBACK'),'rollback inesperado');
}
(async()=>{
  await exercise({saved:true});
  await exercise({saved:false});
  console.log('✓ Snapshot PostgreSQL: $1 tipado consistentemente e protecoes de persistencia preservadas (pool simulado).');
})().catch(e=>{console.error(e);process.exitCode=1;});

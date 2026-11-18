'use strict';
// V40.69.8.32 — sorteio independente, idempotência, simultaneidade e integridade.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {planNextStageDraw,assertExistingStageDraw}=require('../tournament-next-stage-draw');
const {TournamentBracket}=require('../tournament-bracket');
const {distribute}=require('../tournament-draw');

const participants=n=>Array.from({length:n},(_,i)=>({playerKey:'j'+i,name:'Jogador '+i}));
function keys(tables){return tables.flatMap(t=>t.players.map(p=>p.playerKey));}
for(const n of [2,3,4,5,6,7,8,9,10,12,20,25,50,100]){
  const players=participants(n);
  const tables=planNextStageDraw(players,()=>0);
  assert.equal(tables.length,Math.ceil(n/5));
  assert.equal(keys(tables).length,n);
  assert.equal(new Set(keys(tables)).size,n);
  assert.deepEqual(new Set(keys(tables)),new Set(players.map(p=>p.playerKey)));
  assert(tables.every(t=>t.players.length>=2&&t.players.length<=5));
  if(n<=5)assert.deepEqual(keys(tables),players.map(p=>p.playerKey),'mesa única dispensa novo sorteio');
  if(n>5)assert.notDeepEqual(keys(tables),players.map(p=>p.playerKey),'sorteio embaralha entre mesas');
}
assert.throws(()=>planNextStageDraw([{playerKey:'a',name:'A'},{playerKey:'a',name:'A'}]),/duplicada/);
assert.throws(()=>planNextStageDraw([{playerKey:'a',name:'A'}]),/dois classificados/);

async function stageRace(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mm-v32-'));
 try{
  const filePath=path.join(temp,'bracket.json');
  const bracket=new TournamentBracket({databaseUrl:'',filePath});await bracket.init();
  const id='copa-sorteio-v32';
  const initial=distribute(participants(20),()=>0);
  const source=[];
  for(const table of initial){
    const roster=table.players;
    const result={matchId:`m-${table.number}`,results:roster.map((p,i)=>({
      playerKey:p.playerKey,name:p.name,score:i===1||i===2?20:i*10,position:i+1,won:i===0
    }))};
    await bracket.recordResult({id,stage:'qualifier',number:table.number,
      roomCode:'R'+table.number,result,players:roster});
    source.push(table);
  }
  // Em paralelo, a mesma fase NÃO pode gerar duas distribuições em JSON local.
  await Promise.all(Array.from({length:6},()=>bracket.advance(id,initial)));
  let rows=await bracket.rows(id);
  let semifinals=rows.filter(r=>r.stage==='semi');
  assert.equal(semifinals.length,2,'oito classificados formam duas mesas de quatro');
  assert.deepEqual(semifinals.map(t=>t.players.length),[4,4]);
  assert.equal(new Set(keys(semifinals)).size,8);
  assertExistingStageDraw(rows.filter(r=>r.stage==='qualifier'),2,semifinals);
  const firstDraw=JSON.stringify(semifinals);
  // Simula reinício: reabrir outro objeto a partir do MESMO estado gravado.
  const recovered=new TournamentBracket({databaseUrl:'',filePath});await recovered.init();
  await Promise.all([bracket.advance(id,initial),recovered.advance(id,initial)]);
  rows=await recovered.rows(id);semifinals=rows.filter(r=>r.stage==='semi');
  assert.equal(JSON.stringify(semifinals),firstDraw,'F5, reconexão e recuperação não refazem o sorteio');
  // Final de mesa única: os quatro elegíveis estão juntos, com vaga única.
  for(const table of semifinals){
    await recovered.claim(id,'semi',table.number,'S'+table.number);
    await recovered.recordResult({id,stage:'semi',number:table.number,roomCode:'S'+table.number,
      players:table.players,result:{matchId:'semi'+table.number,results:table.players.map((p,i)=>({
        playerKey:p.playerKey,name:p.name,score:i*8,position:i+1,won:i===0
      }))}});
  }
  await recovered.advance(id,initial);
  const finals=(await recovered.rows(id)).filter(r=>r.stage==='final');
  assert.equal(finals.length,1);assert.equal(finals[0].players.length,4);
  assert.equal(new Set(keys(finals)).size,4);
  // Fase existente corrompida: detectar, não sortear outra vez nem substituir.
  const disk=JSON.parse(fs.readFileSync(filePath,'utf8'));
  disk[id]=disk[id].filter(r=>!(r.stage==='semi'&&r.number===2));
  fs.writeFileSync(filePath,JSON.stringify(disk));
  await assert.rejects(recovered.advance(id,initial),/parcialmente|incompatível|quantidade de mesas/i);
  assert.equal((await recovered.rows(id)).filter(r=>r.stage==='semi').length,1,
    'Não recriar ou redistribuir fase parcialmente persistida sem auditoria');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
(async()=>{
 await stageRace();
 const ui=fs.readFileSync(path.join(__dirname,'../public/tournament-ui.js'),'utf8');
 const client=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(ui.includes('🎲 Novo sorteio'));
 assert(ui.includes('ENTRAR NA MINHA MESA'));
 assert(client.includes('// V40.69.8.31 — ingresso automático SOMENTE'));
 assert(server.includes("if(phase!=='qualifier')throw new Error('Entre manualmente"));
 assert(!ui.includes("socket.emit('startRound'"));
 console.log('✓ V40.69.8.32: sorteio em todas as fases, 8 em 2 mesas, persistência, recuperação, simultaneidade, final única, bloqueio de corrupção e acesso manual.');
})().catch(e=>{console.error(e);process.exitCode=1;});

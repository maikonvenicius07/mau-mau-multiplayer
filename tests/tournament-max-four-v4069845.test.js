'use strict';
// V40.69.8.45 — testes das funções efetivas de sorteio, motor e walkover do servidor.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const Engine=require('../game-engine');
const Wait=require('../tournament-wait');
const Forfeit=require('../tournament-forfeit');
const {distribute}=require('../tournament-draw');
const {planNextStageDraw,assertDrawIntegrity}=require('../tournament-next-stage-draw');
const {TournamentBracket}=require('../tournament-bracket');
const {TournamentGames}=require('../tournament-games');
const {buildMatchRecord}=require('../ranking-store');
const {recordTournamentResult}=require('../tournament-result-commit');
const {assertTournamentTable,MAX_TOURNAMENT_PLAYERS}=require('../tournament-table-capacity');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const people=n=>Array.from({length:n},(_,i)=>({playerKey:'p'+i,name:'Pessoa '+i}));
assert.equal(MAX_TOURNAMENT_PLAYERS,4);
const expected=new Map([[2,[2]],[3,[3]],[4,[4]],[5,[3,2]],[6,[3,3]],[7,[4,3]],[8,[4,4]],[9,[3,3,3]],[10,[4,3,3]],[12,[4,4,4]]]);
for(const [n,sizes] of expected){
  for(const fn of [distribute,planNextStageDraw]){
    const tables=fn(people(n),()=>0);
    assert.deepEqual(tables.map(t=>t.players.length),sizes,`${n} jogadores: distribuição de ${fn.name}`);
    assert.equal(new Set(tables.flatMap(t=>t.players.map(p=>p.playerKey))).size,n);
    tables.forEach(t=>assertTournamentTable(t.players));
  }
}
assert.throws(()=>distribute([people(2)[0],people(2)[0]]),/duplicado/);
assert.throws(()=>assertTournamentTable(people(5)),/2 a 4/);
assert.throws(()=>assertDrawIntegrity([{number:1,players:people(5).map((p,i)=>({...p,seat:i+1}))}],people(5)),/quantidade de mesas/i);
// O motor é guardião mesmo que outra rota do servidor tente admitir um quinto.
const room=Engine.createRoom('M4TEST',{name:'Pessoa 0',playerKey:'p0',token:'t0'});
room.tournament={id:'cup-c4',phase:'qualifier',tableNumber:1,rosterKeys:people(4).map(p=>p.playerKey)};
for(const p of people(4).slice(1))Engine.addPlayer(room,{...p,token:p.playerKey});
assert.equal(room.players.length,4);
assert.throws(()=>Engine.addPlayer(room,{playerKey:'p4',name:'Quinto'}),/quatro|completa|válida/i);
assert.throws(()=>Engine.addPlayer(room,{playerKey:'p3',name:'Duplicado'}),/completa|ocupa/);
assert.equal(room.players.length,4);
// Salas normais não têm capacidade reduzida.
const normal=Engine.createRoom('N5TEST',{name:'Pessoa 0',playerKey:'p0'});
for(const p of people(5).slice(1))Engine.addPlayer(normal,p);
assert.equal(normal.players.length,5);

// Executar a função de resolução de walkover que está no server.js,
// isolando os serviços externos sem reimplementar a regra testada.
const begin=server.indexOf('function maybeResolveTournamentLobbyWalkover(');
const finish=server.indexOf('\n// Fase 4A:',begin);
assert(begin>=0&&finish>begin,'função real de vitória por ausência precisa existir');
const functionSource=server.slice(begin,finish);
function getWalkover(){
  const context={TournamentWait:Wait,TournamentForfeit:Forfeit,Engine,
    tournamentLobbyWalkoverLocks:new Set(),console,Date};
  vm.runInNewContext(functionSource+'\nthis.resolve=maybeResolveTournamentLobbyWalkover;',context);
  return context.resolve;
}
const win=getWalkover();
function lobby(roster,attendees,deadline=10000){
  const persons=roster.map(p=>({...p}));
  const initial=Engine.createRoom('W'+roster.length+attendees.length,{name:persons[0].name,playerKey:persons[0].playerKey});
  initial.tournament={id:'cup-walkover',phase:'qualifier',tableNumber:1,
    rosterKeys:roster.map(p=>p.playerKey),rosterNames:persons,waitDeadlineAt:deadline,forfeits:[]};
  for(const p of persons.slice(1))Engine.addPlayer(initial,p);
  const seen=new Set(attendees);
  for(const p of initial.players)p.connected=seen.has(p.playerKey);
  initial.spectators=[{id:'spectator1',playerKey:'spectator',connected:true}];
  return initial;
}
const roster=people(4);
const one=lobby(roster,['p0']);
assert.equal(win(one,{now:9999}),false,'antes de dois minutos não pode haver vitória automática');
assert.equal(one.status,'lobby');
assert.equal(win(one,{now:10001}),true,'após dois minutos deve haver vitória automática');
assert.equal(one.status,'finished');assert.equal(one.players.length,1);
assert.equal(one.players[0].playerKey,'p0');
assert.equal(one.tournament.forfeits.length,3);
assert.equal(win(one,{now:10002}),false,'não pode registrar vitória duplicada');
const result=Forfeit.tournamentMatchRecord(one,buildMatchRecord(one));
assert.equal(result.results.length,4);
assert.equal(result.results.filter(p=>p.won).length,1);
assert.equal(result.results.filter(p=>p.forfeited).length,3);
assert.equal(result.results.find(p=>p.won).playerKey,'p0');
for(const n of [2,3,4]){
  const count=lobby(roster,people(n).map(p=>p.playerKey));
  assert.equal(win(count,{now:10001}),false,'com 2+ presentes não há vitória por ausência');
  assert.equal(count.status,'lobby','início continua manual');
}
const zero=lobby(roster,[]);
assert.equal(win(zero,{now:10001}),false,'sem presença não existe vencedor');
assert.equal(zero.status,'lobby');
assert.equal(Wait.decide({roster,present:[],deadline:10000,now:10001}).present,0);
assert.equal(Wait.WAIT_MS,2*60*1000);
assert(server.includes('await startTournamentLobbyOnRequest(room,p,socket.id)'), 'início manual preservado');
assert(server.includes('assertTournamentTable(seat.players)'), 'servidor deve validar o roster');
assert(server.includes('if(room.tournament && !room.tournament.rosterKeys.includes(key))'), 'acesso restrito aos sorteados');

async function walkoverAdvances(){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'mm-four-walkover-'));
  try{
    const id='cup-four-walkover';
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(folder,'bracket.json')});
    const games=new TournamentGames({databaseUrl:'',filePath:path.join(folder,'games.json')});
    await bracket.init();await games.init();
    const initial=distribute(people(5),()=>0);
    const winningTable=initial.find(t=>t.players.length===3);
    const rest=initial.find(t=>t.players.length===2);
    const winnerKey=winningTable.players[0].playerKey;
    const tableLobby=lobby(winningTable.players,[winnerKey]);
    tableLobby.tournament.id=id;
    tableLobby.tournament.tableNumber=winningTable.number;
    assert.equal(win(tableLobby,{now:10001}),true);
    const winRecord=Forfeit.tournamentMatchRecord(tableLobby,buildMatchRecord(tableLobby));
    await games.claim(id,winningTable.number,tableLobby.code);
    await recordTournamentResult({bracket,games,id,phase:'qualifier',number:winningTable.number,
      roomCode:tableLobby.code,record:winRecord,roster:winningTable.players});
    const otherRoom=Engine.createRoom('OTHER2',{name:rest.players[0].name,playerKey:rest.players[0].playerKey});
    otherRoom.tournament={id,phase:'qualifier',tableNumber:rest.number,rosterKeys:rest.players.map(p=>p.playerKey)};
    Engine.addPlayer(otherRoom,rest.players[1]);
    otherRoom.players[0].score=0;otherRoom.players[1].score=10;
    otherRoom.status='finished';otherRoom.finishedAt=Date.now();
    await games.claim(id,rest.number,otherRoom.code);
    await recordTournamentResult({bracket,games,id,phase:'qualifier',number:rest.number,
      roomCode:otherRoom.code,record:buildMatchRecord(otherRoom),roster:rest.players});
    await bracket.advance(id,initial);
    const advanced=(await bracket.rows(id)).filter(t=>t.stage==='final');
    assert.equal(advanced.length,1,'avança para uma única final');
    assert.equal(advanced[0].players.length,3,'apenas classificados elegíveis disputam a final');
    assert(advanced[0].players.some(p=>p.playerKey===winnerKey),'vencedor por ausência classificou');
    await bracket.claim(id,'final',1,'FINAL001');
    const final=advanced[0];
    await bracket.recordResult({id,stage:'final',number:1,roomCode:'FINAL001',players:final.players,
      result:{matchId:'grand-final',results:final.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))}});
    const summary=await bracket.summary(id,initial);
    assert(summary.champion,'final produziu campeão');
    assert.equal(summary.champion.standings.length,3);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
async function supportLargeProgression(n){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-four-too-large-'));
  try{
    const id='cup-too-large-'+n;
    const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(dir,'stages.json')});await bracket.init();
    const initial=distribute(people(n),()=>0);
    assert(initial.every(t=>t.players.length<=4));
    for(const t of initial){
      const code='Q'+t.number;
      await bracket.recordResult({id,stage:'qualifier',number:t.number,roomCode:code,players:t.players,
        result:{matchId:'q-'+t.number,results:t.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))}});
    }
    await bracket.advance(id,initial);
    const quarters=(await bracket.rows(id)).filter(t=>t.stage==='quarter');
    assert(quarters.length>=5);
    for(const t of quarters){
      await bracket.claim(id,'quarter',t.number,'QR'+t.number);
      await bracket.recordResult({id,stage:'quarter',number:t.number,roomCode:'QR'+t.number,players:t.players,
        result:{matchId:'qr-'+t.number,results:t.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))}});
    }
    await bracket.advance(id,initial);
    const additional=(await bracket.rows(id)).filter(t=>t.stage==='extra');
    assert(additional.length>=3&&additional.length<=4,'a fase adicional é criada para torneios grandes');
    assert(additional.every(t=>t.players.length>=2&&t.players.length<=4));
    assert.equal(additional.flatMap(t=>t.players).length,quarters.length*2);
    for(const t of additional){
      await bracket.claim(id,'extra',t.number,'EX'+t.number);
      await bracket.recordResult({id,stage:'extra',number:t.number,roomCode:'EX'+t.number,players:t.players,
        result:{matchId:'ex-'+t.number,results:t.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))}});
    }
    await bracket.advance(id,initial);
    const semifinal=(await bracket.rows(id)).filter(t=>t.stage==='semi');
    assert.equal(semifinal.length,2);
    for(const t of semifinal){
      await bracket.claim(id,'semi',t.number,'SM'+t.number);
      await bracket.recordResult({id,stage:'semi',number:t.number,roomCode:'SM'+t.number,players:t.players,
        result:{matchId:'sm-'+t.number,results:t.players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))}});
    }
    await bracket.advance(id,initial);
    const final=(await bracket.rows(id)).filter(t=>t.stage==='final');
    assert.equal(final.length,1);
    assert.equal(final[0].players.length,4);
    await bracket.claim(id,'final',1,'FIN'+n);
    await bracket.recordResult({id,stage:'final',number:1,roomCode:'FIN'+n,players:final[0].players,
      result:{matchId:'fin-'+n,results:final[0].players.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:i*10,position:i+1,won:i===0}))}});
    assert((await bracket.summary(id,initial)).champion,'torneio grande chega ao campeão');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{
  await walkoverAdvances();
  for(const n of [65,100])await supportLargeProgression(n);
  console.log('✓ V40.69.8.56: 2–4 vagas, ausências, e torneios de 65/100 jogadores até final única e campeão.');
})()
  .catch(error=>{console.error(error);process.exitCode=1;});

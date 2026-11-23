'use strict';
// V40.69.8.55 — o erro de um torneio nao pode bloquear os demais no mesmo ciclo.
// Exercita a funcao REAL extraida do server.js, com dependencias controladas.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const start=server.indexOf('let tournamentReconcileRunning=false;');
const end=server.indexOf('const tournamentProgressTimer=',start);
assert(start>=0&&end>start,'Rotina de reconciliacao encontrada no servidor');
const actualRoutine=server.slice(start,end);

function scenario(failStep){
  const errors=[];
  const notifications=[];
  const advances=[];
  const first=[{number:1,players:[{playerKey:'p1'},{playerKey:'p2'}]}];
  const context=vm.createContext({
    snapshotsRestored:true,
    ensureTournamentBracketReady:async()=>true,
    ensureTournamentPodiumReady:async()=>true,
    tournamentCatalog:{list:async()=>[
      {id:'falhou',status:'closed'},
      {id:'saudavel',status:'closed'},
      {id:'rascunho',status:'open'}
    ]},
    tournamentDraw:{get:async(id)=>{
      if(failStep==='draw'&&id==='falhou')throw new Error('FALHA_SIMULADA_SORTEIO');
      return first;
    }},
    tournamentBracket:{advance:async(id)=>{
      advances.push(id);
      if(failStep==='advance'&&id==='falhou')throw new Error('FALHA_SIMULADA_PROGRESSAO');
      return {champion:null,currentStage:'qualifier',stages:[]};
    }},
    tournamentGames:{get:async(id)=>{
      if(failStep==='binding'&&id==='falhou')throw new Error('FALHA_SIMULADA_VINCULO');
      return {roomCode:null};
    }},
    tournamentPodiumArchive:{record:async()=>{}},
    rooms:new Map(),
    maybeResolveTournamentLobbyWalkover:()=>false,
    emitRoom:()=>{},
    notifyTournamentSeats:async(id,stage,tables)=>{
      if(failStep==='notify'&&id==='falhou')throw new Error('FALHA_SIMULADA_AVISO');
      notifications.push({id,stage,n:tables.length});
    },
    console:{error:(...values)=>errors.push(values.map(String).join(' '))},
    Date,
    Map,
    Set
  });
  vm.runInContext(actualRoutine,context);
  return {context,errors,notifications,advances};
}

(async()=>{
  for(const failStep of ['draw','advance','binding','notify']){
    const {context,errors,notifications,advances}=scenario(failStep);
    await vm.runInContext('reconcileTournamentProgress()',context);
    assert.equal(errors.length,1,`Falha (${failStep}) gera um log individual`);
    assert.match(errors[0],/falhou/,`Identificador do torneio que falhou (${failStep})`);
    assert.match(errors[0],/FALHA_SIMULADA_/,`Motivo da falha (${failStep})`);
    assert.deepEqual(notifications,[{id:'saudavel',stage:'qualifier',n:1}],
      `Torneio saudavel continua reconciliando apos falha (${failStep})`);
    assert(!advances.includes('rascunho'),'Torneio aberto nao deve ser processado');
    assert.equal(vm.runInContext('tournamentReconcileRunning',context),false,
      'Trava do ciclo liberada ao terminar');
  }
  // O erro de infraestrutura geral continua tratado no catch externo e nao deixa trava presa.
  const {context,errors}=scenario('advance');
  vm.runInContext('tournamentCatalog.list=async()=>{throw new Error("FALHA_CATALOGO")}',context);
  await vm.runInContext('reconcileTournamentProgress()',context);
  assert.equal(vm.runInContext('tournamentReconcileRunning',context),false);
  assert(errors.some(value=>value.includes('FALHA_CATALOGO')));
  console.log('✓ V40.69.8.55: falhas isoladas de sorteio, progressao, vinculo e aviso; outro torneio continua no mesmo ciclo.');
})().catch(error=>{console.error(error);process.exitCode=1;});

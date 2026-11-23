'use strict';
// Benchmark SINTÉTICO e sem banco: compara o custo da listagem anterior
// (todos os torneios) com a seleção necessária ao reconciliador (closed).
// NÃO representa latência PostgreSQL, Render, rede ou celulares reais.
const {performance}=require('node:perf_hooks');
const {TournamentCatalog}=require('../tournament-catalog');
const TOTAL=10000,REPETITIONS=30;
const row=(i)=>({id:`tor-${i}`,name:'Torneio '+i,capacity:5,rounds:5,
  startAt:null,status:i%20===0?'closed':i%3===0?'open':'draft',
  createdBy:'owner',createdAt:new Date(1700000000000+i*60000).toISOString()});
const catalog=new TournamentCatalog({databaseUrl:'',pool:null});
catalog.local=Array.from({length:TOTAL},(_,i)=>row(i));
function median(arr){const copy=[...arr].sort((a,b)=>a-b);return Number(((copy[14]+copy[15])/2).toFixed(3));}
(async()=>{
  const all=[],filtered=[];
  // Alternar ordem para reduzir viés de JIT e variações de clock.
  for(let i=0;i<REPETITIONS;i++){
    for(const [status,measure] of (i%2?
      [[null,all],['closed',filtered]]:[['closed',filtered],[null,all]])){
      const before=performance.now();
      const result=await catalog.list(status?{status}:{});
      measure.push(performance.now()-before);
      if(result.length!==(status?TOTAL/20:TOTAL))throw Error('Resultado inconsistente');
    }
  }
  console.log(JSON.stringify({kind:'synthetic-local',events:TOTAL,closed:TOTAL/20,
    repetitions:REPETITIONS,medianMs:{previousAll:median(all),filteredClosed:median(filtered)},
    caution:'Not a Render/PostgreSQL or end-to-end performance measurement.'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});

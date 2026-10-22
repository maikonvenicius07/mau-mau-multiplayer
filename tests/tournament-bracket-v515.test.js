'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {TournamentBracket}=require('../tournament-bracket');
const {TournamentDraw,distribute}=require('../tournament-draw');
async function run(size){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'mm-v515-'));
 try{
  const id='cup-v515-'+size;
  const bracket=new TournamentBracket({databaseUrl:'',filePath:path.join(folder,'bracket.json')});await bracket.init();
  const participants=Array.from({length:size},(_,i)=>({playerKey:'key'+i,name:i===0?'Nome repetido':'Jogador '+i}));
  if(size>4)participants[4].name='Nome repetido';
  const initial=distribute(participants);
  const stageCount={qualifier:0,quarter:0,semi:0,final:0};
  let currentStage='qualifier';let stageTables=initial;
  for(let round=0;round<4;round++){
   for(const table of stageTables){
     const roster=table.players;
     const game={matchId:id+':'+currentStage+':'+table.number,finishedAt:new Date().toISOString(),results:roster.map((p,j)=>({playerKey:p.playerKey,name:p.name,position:j+1,score:10+j*10,won:j===0}))};
     if(currentStage!=='qualifier')await bracket.claim(id,currentStage,table.number,'C'+round+'T'+table.number);
     await bracket.recordResult({id,stage:currentStage,number:table.number,roomCode:'C'+round+'T'+table.number,result:game,players:roster});
     stageCount[currentStage]++;
   }
   await bracket.advance(id,initial);
   const data=await bracket.summary(id,initial);
   assert(!JSON.stringify(data).includes('playerKey'),'chaves privadas não podem ser retornadas ao público');
   if(data.champion){assert.equal(data.champion.names.length,1);break;}
   if(data.currentStage===currentStage)console.log('NO ADVANCE',size,currentStage,JSON.stringify((await bracket.rows(id)).map(t=>({stage:t.stage,num:t.number,players:t.players.length,results:t.result?.results.length}))));
   assert.notEqual(data.currentStage,currentStage,'a próxima fase deve aparecer');
   currentStage=data.currentStage;
   const priv=await bracket.rows(id);stageTables=priv.filter(x=>x.stage===currentStage);
   assert(stageTables.length>=1);
   assert(stageTables.every(t=>t.players.length>=2&&t.players.length<=5));
   assert.equal(new Set(stageTables.flatMap(t=>t.players.map(p=>p.playerKey))).size,stageTables.reduce((a,t)=>a+t.players.length,0));
   const former=priv.filter(x=>x.stage==='qualifier');
   assert(former.every(x=>x.result&&x.result.results.length===x.players.length));
   const before=JSON.stringify(priv);
   await bracket.advance(id,initial);assert.equal(JSON.stringify(await bracket.rows(id)),before,'sorteio não pode ser repetido');
  }
  const last=await bracket.summary(id,initial);assert(last.champion,'precisa declarar campeão ao concluir todas as fases');
  if(size===20){assert.equal(stageCount.qualifier,4);assert.equal(stageCount.semi,2);assert.equal(stageCount.final,1);}
  if(size===100){assert.equal(stageCount.qualifier,20);assert.equal(stageCount.quarter,4);assert.equal(stageCount.semi,2);assert.equal(stageCount.final,1);}
  if(size<=5){assert.equal(stageCount.qualifier,1);assert.equal(stageCount.final,0);}
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
(async()=>{
 for(const n of [2,3,4,5,6,7,8,10,11,20,25,26,50,51,100])await run(n);
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(source.includes("socket.emit('joined',{code,playerId:p.id,token:p.token,role:ROLE_PLAYER,source:'tournament'});"));
 assert(source.includes('tournamentBracket.recordResult('));
 assert(source.includes('tournamentBracket.advance('));
 console.log('✓ V51.5: 15 tamanhos de torneio, classificação, campeão, fases persistentes e nenhuma identidade privada divulgada.');
})().catch(e=>{console.error(e);process.exitCode=1});

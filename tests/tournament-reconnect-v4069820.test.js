'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const {memberForResume}=require('../tournament-seat-recovery');

// A mesa sorteada mantém a mesma cadeira; uma reconexão jamais cria outro jogador.
const original={id:'seat-1',playerKey:'player-a',token:'private-token',isBot:false,connected:false,reconnectEligible:true};
const match={status:'playing',tournament:{rosterKeys:['player-a','player-b'],forfeits:[]},players:[original,
  {id:'seat-2',playerKey:'player-b',isBot:false,connected:true}]};
assert.strictEqual(memberForResume(match,'player-a'),original);
assert.equal(memberForResume(match,'player-c'),null,'Conta não sorteada jamais entra');
assert.equal(memberForResume(match,''),null,'Identidade vazia não é suficiente');
assert.equal(memberForResume({...match,status:'lobby'},'player-a'),null);
assert.equal(memberForResume({...match,status:'finished'},'player-a'),null);
assert.equal(memberForResume({...match,players:[{...original,isBot:true}]},'player-a'),null,'Máquinas não podem reassumir');
assert.equal(memberForResume({...match,tournament:{...match.tournament,forfeits:[{playerKey:'player-a'}]}},'player-a'),null,'Desistente nunca retorna');
assert.equal(memberForResume({...match,players:[{...original,voluntaryLeftAt:1234}]},'player-a'),null,'Saída voluntária invalida retomada');
assert.strictEqual(memberForResume({...match,status:'between-rounds'},'player-a'),original,'Entre rodadas preserva a mesma vaga');

// Executa o ramo real do servidor para uma mesa já iniciada, com substitutos
// controlados: confirma a retomada e a recusa de nova cadeira no mesmo caminho.
const branchStart=server.indexOf("          if(room.status!=='lobby'){");
const branchEnd=server.indexOf("          await joinSocketIntoRoom(socket,room,{source:'tournament'});",branchStart);
assert(branchStart>0&&branchEnd>branchStart);
const branch=server.slice(branchStart,branchEnd);
assert(!branch.includes("socket.emit('tournamentTableResume'"),'Não pode enviar evento que o navegador não atende');
async function runBranch(room,authKey){
  const calls=[];
  const context={room,socket:{data:{auth:{playerKey:authKey}}},TournamentSeatRecovery:{memberForResume},
    resumeReservedPlayerSeat:async(s,r,p,opts)=>{calls.push({socket:s,room:r,player:p,source:opts.source})}};
  await vm.runInNewContext(`(async()=>{${branch}})()`,context);
  return calls;
}
async function verify(){
  const calls=await runBranch(match,'player-a');
  assert.equal(calls.length,1);
  assert.strictEqual(calls[0].player,original);
  assert.equal(calls[0].source,'tournament-resume');
  await assert.rejects(()=>runBranch(match,'player-c'),/cadeira não está disponível/);
  await assert.rejects(()=>runBranch({...match,tournament:{...match.tournament,forfeits:[{playerKey:'player-a'}]}},'player-a'),/cadeira não está disponível/);

  // O servidor aguarda a restauração antes de concluir incorretamente que
  // o jogador não possui cadeira, em especial após deploy no Render.
  const boot=server.indexOf("socket.on('resumeActiveSeat', async () => {");
  const search=server.indexOf('const seat=recoverablePlayerSeatForKey',boot);
  const ready=server.indexOf('if(!snapshotsRestored)await requireRoomPersistenceReady();',boot);
  assert(boot>0&&ready>boot&&search>ready,'Busca autenticada só pode acontecer depois do restore');

  // Client: falhas temporárias de restore são retentadas com limite e sem
  // promover espectadores nem ignorar saída voluntária.
  const begin=app.indexOf("socket.on('resumeActiveSeatResult',info=>{");
  const end=app.indexOf("socket.on('sessionReplaced'",begin);
  assert(begin>0&&end>begin);
  function simulate(info,{attempt=0,role='PLAYER',voluntary=false}={}){
    const timers=[],toasts=[],locations=[];
    const context={socket:{connected:true,on:(event,cb)=>{assert.equal(event,'resumeActiveSeatResult');context.run=cb}},
      accountSeatResumePending:true,accountSeatResumeAttempts:attempt,
      accountSeatResumeRetryTimer:null,accountSeatResumeAttemptsMax:0,
      state:null,pendingRoomSwitch:null,leaveRoomPending:false,
      pendingVoluntaryLeave:()=>voluntary?{code:'XYZ'}:null,saved:()=>({role}),
      clearAccountSeatResumeRetry:()=>{},requestAccountSeatResume:n=>locations.push(n),
      requestTournamentSeatLocation:()=>locations.push('locate'),
      setTimeout:(fn,ms)=>{timers.push({fn,ms});return 1},toast:m=>toasts.push(m)};
    vm.runInNewContext(app.slice(begin,end),context);
    context.run(info);
    return {timers,locations,toasts};
  }
  const restoring={ok:false,reason:'error',message:'As salas anteriores ainda não puderam ser restauradas.'};
  const recovery=simulate(restoring);
  assert.equal(recovery.timers.length,1,'Retentar falha temporária de snapshots');
  assert(recovery.timers[0].ms>=1200);
  recovery.timers[0].fn();assert.deepEqual(recovery.locations,[1]);
  assert.equal(simulate(restoring,{attempt:6}).timers.length,0,'Tentativas são limitadas');
  assert.equal(simulate(restoring,{role:'SPECTATOR'}).timers.length,0,'Observador nunca entra pelo fluxo de jogador');
  assert.equal(simulate(restoring,{voluntary:true}).timers.length,0,'SAIR não é reconexão');
  assert.equal(simulate({ok:false,reason:'none'}).timers.length,1,'Compatibilidade: a primeira busca sem cadeira recebe a pequena tolerância já existente');
  assert.equal(simulate({ok:false,reason:'none'},{attempt:2}).timers.length,0,'Busca vazia não fica em loop');
  console.log('✓ V40.69.8.20: retomada autenticada após partida iniciada, veto a desistentes/duplicidade e recuperação após deploy.');
}
verify().catch(e=>{console.error(e);process.exitCode=1});

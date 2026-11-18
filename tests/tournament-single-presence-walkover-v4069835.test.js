'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Wait=require('../tournament-wait');
const Forfeit=require('../tournament-forfeit');
const Engine=require('../game-engine');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const page=fs.readFileSync(path.join(root,'public/index.html'),'utf8');

assert(page.includes('id="tournamentWaitClock"'),'banner mínimo preserva o relógio');
assert(!page.includes('AGUARDANDO JOGADORES · ESPERA DA MESA'),'banner antigo foi removido');
assert(!page.includes('id="tournamentLobbySchedule"'),'programação textual foi removida da mesa');

const start=server.indexOf('function maybeResolveTournamentLobbyWalkover(room,{now=Date.now()}={}){');
const end=server.indexOf('// Fase 4A: cada cliente mantém',start);
assert(start>0&&end>start,'helper de vitória automática por ausência deve existir');
const helper=server.slice(start,end);
assert(server.includes('maybeResolveTournamentLobbyWalkover(room);'),'emitRoom deve aplicar a vitória automática antes de emitir estado');
assert(server.includes('if(room&&maybeResolveTournamentLobbyWalkover(room))emitRoom(room);'),'reconciliação também precisa resolver W.O. sem novos cliques');

function buildRoom({deadlineOffset=0,present=1,expected=2}={}){
  const roster=Array.from({length:expected},(_,i)=>({playerKey:`p${i}`,name:`Pessoa ${i}`}));
  const players=roster.slice(0,present).map((p,i)=>({
    ...p,id:`id${i}`,isBot:false,connected:true,host:i===0,score:0,hand:[]
  }));
  return {
    code:'CUP123',status:'lobby',round:0,players,log:[],
    tournament:{id:'cup',phase:'final',tableNumber:1,rosterKeys:roster.map(p=>p.playerKey),rosterNames:roster,forfeits:[],waitDeadlineAt:Date.now()+deadlineOffset},
  };
}

const sandbox={
  TournamentWait:Wait,TournamentForfeit:Forfeit,Engine,
  tournamentLobbyWalkoverLocks:new Set(),console,
};
vm.runInNewContext(`${helper};this.resolve=maybeResolveTournamentLobbyWalkover;`,sandbox);

{
  const room=buildRoom({deadlineOffset:-1000,present:1,expected:2});
  const changed=sandbox.resolve(room,{now:Date.now()});
  assert.equal(changed,true,'um único presente após o prazo vira vencedor');
  assert.equal(room.status,'finished');
  assert.equal(room.players.length,1,'apenas o vencedor permanece na mesa');
  assert.equal(room.winnerId,room.players[0].id);
  assert.equal(room.tournament.forfeits.length,1,'ausente vira desistente');
}
{
  const room=buildRoom({deadlineOffset:-1000,present:0,expected:2});
  const changed=sandbox.resolve(room,{now:Date.now()});
  assert.equal(changed,false,'sem presentes não há vencedor automático');
  assert.equal(room.status,'lobby');
}
{
  const room=buildRoom({deadlineOffset:60000,present:1,expected:2});
  const changed=sandbox.resolve(room,{now:Date.now()});
  assert.equal(changed,false,'antes do prazo não decide vencedor');
  assert.equal(room.status,'lobby');
}
console.log('✓ V40.69.8.35: banner reduzido ao relógio e W.O. automático com um único jogador presente após o prazo.');

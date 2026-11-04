'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const E=require('../game-engine');
const Bot=require('../bot-player');
const Difficulty=require('../bot-difficulty');
const {plainRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');

const room=E.createRoom('LVL123',{name:'Pessoa',socketId:'s1',token:'t1'});
const human=room.players[0];
const bot=E.addPlayer(room,{name:'Máquina',isBot:true});
assert.strictEqual(room.botDifficulty,'normal','salas novas devem preservar o comportamento anterior');
assert.strictEqual(E.roomPublicState(room,human.id).botDifficulty,'normal');
assert.strictEqual(Difficulty.forPlayer(room,bot),'normal');
assert.strictEqual(Difficulty.forPlayer(room,{...human,autoControlled:true}),'normal','AUTO segue no Normal');

room.botDifficulty='easy';
assert.strictEqual(E.roomPublicState(room,human.id).botDifficulty,'easy');
let snapshot=plainRoomSnapshot(room);
assert.strictEqual(restoreRoomSnapshot(snapshot).botDifficulty,'easy','dificuldade sobrevive ao restart');
delete snapshot.botDifficulty;
assert.strictEqual(restoreRoomSnapshot(snapshot).botDifficulty,'normal','snapshots anteriores mantêm Normal');
snapshot.botDifficulty='unknown';
assert.strictEqual(restoreRoomSnapshot(snapshot).botDifficulty,'normal','níveis inválidos retornam ao Normal');

const ten={id:'ten',rank:'10',suit:'hearts'}, jack={id:'jack',rank:'J',suit:'clubs'};
bot.hand=[ten,jack, ...[2,3,4,5,6].map(n=>({id:`h${n}`,rank:String(n),suit:'hearts'}))];
human.hand=[2,3,4,5,6].map(n=>({id:`op${n}`,rank:String(n),suit:'spades'}));
room.botDifficulty='easy';
assert.strictEqual(Bot.selectLegalCard(room,bot,E,[ten,jack]),ten,'Fácil segue a primeira opção legal');
room.botDifficulty='normal';
assert.strictEqual(Bot.selectLegalCard(room,bot,E,[ten,jack]),jack,'Normal preserva a prioridade anterior do Valete');
room.botDifficulty='hard';
assert.strictEqual(Bot.selectLegalCard(room,bot,E,[ten,jack]),ten,'Difícil preserva o Valete quando há outras cartas compatíveis');
assert.strictEqual(Difficulty.forPlayer(room,{...human,autoControlled:true}),'normal','AUTO não herda dificuldade da sala');
room.pendingSeven=7;
assert.strictEqual(Bot.selectLegalCard(room,bot,E,[ten,jack]),null,'sem 7 válido não deve escolher carta ilegal');

// Testa partidas completas com as regras reais da Engine, sem atalhos.
let stepsTotal=0;
for(const level of ['easy','normal','hard']){
  for(let game=0;game<12;game++){
    const sim=E.createRoom(`LV${level}${game}`,{name:'Máquina 1',socketId:'1',isBot:true});
    sim.players[0].isBot=true;
    for(let p=2;p<=4;p++)E.addPlayer(sim,{name:`Máquina ${p}`,isBot:true});
    sim.botDifficulty=level;
    let steps=0;
    while(sim.status!=='finished'&&steps<20000){
      if(['lobby','between-rounds'].includes(sim.status)){E.startRound(sim);steps++;continue;}
      const burn=sim.players.find(p=>!p.finishedRound&&E.canBurnMatch(sim,p).length>0);
      if(burn){Bot.takeBurnOpportunity(sim,burn,E);steps++;continue;}
      const quick=sim.players.find(p=>!p.finishedRound&&E.canQuickAction(sim,p).length>0);
      if(quick){Bot.takeQuickActionOpportunity(sim,quick,E);steps++;continue;}
      const active=sim.players[sim.currentPlayer];
      assert(active&&active.isBot,'jogador ativo deve ser bot');
      Bot.takeTurn(sim,active,E);
      steps++;
    }
    assert.strictEqual(sim.status,'finished',`Partida ${level}/${game} deve terminar`);
    assert.strictEqual(sim.round,sim.rules.rounds,'todas as rodadas foram realizadas');
    stepsTotal+=steps;
  }
}

const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
assert(server.includes("socket.on('setBotDifficulty'"));
assert(server.includes('if(!p.host)throw new Error('),'somente anfitrião pode alterar');
assert(server.includes("!['lobby','between-rounds'].includes(room.status)"),'mudança bloqueada durante rodada');
assert(server.includes('BotDifficulty.LEVELS.includes(level)'),'validação de enum no servidor');
console.log(`✓ Níveis Fácil/Normal/Difícil: 36 partidas completas, ${stepsTotal} ações, snapshots e segurança validados.`);

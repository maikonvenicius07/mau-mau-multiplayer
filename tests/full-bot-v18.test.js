'use strict';
const assert=require('assert');
const E=require('../game-engine');
const Bot=require('../bot-player');

let totalSteps=0;
for(let g=0;g<50;g++){
  const r=E.createRoom(`SIM${g}`,{name:'Bot 1',socketId:'s1',token:`t1-${g}`,isBot:true});
  r.players[0].isBot=true;
  E.addPlayer(r,{name:'Bot 2',socketId:'s2',token:`t2-${g}`,isBot:true});
  E.addPlayer(r,{name:'Bot 3',socketId:'s3',token:`t3-${g}`,isBot:true});
  E.addPlayer(r,{name:'Bot 4',socketId:'s4',token:`t4-${g}`,isBot:true});

  let steps=0;
  while(r.status!=='finished' && steps<20000){
    if(r.status==='lobby'||r.status==='between-rounds'){
      E.startRound(r);steps++;continue;
    }

    const burn=r.players.find(p=>p.isBot&&!p.finishedRound&&E.canBurnMatch(r,p).length>0);
    if(burn){Bot.takeBurnOpportunity(r,burn,E);steps++;continue;}

    const quick=r.players.find(p=>p.isBot&&!p.finishedRound&&E.canQuickAction(r,p).length>0);
    if(quick){Bot.takeQuickActionOpportunity(r,quick,E);steps++;continue;}

    const turn=r.players[r.currentPlayer];
    assert(turn,'deve existir jogador atual durante a rodada');
    Bot.takeTurn(r,turn,E);steps++;
  }

  assert.equal(r.status,'finished',`partida ${g} deve terminar sem travamento`);
  assert(steps<20000,`partida ${g} excedeu o limite de ações`);
  totalSteps+=steps;
}

console.log(`✓ V18 integração: 50 partidas completas entre 4 bots terminaram (${totalSteps} ações).`);

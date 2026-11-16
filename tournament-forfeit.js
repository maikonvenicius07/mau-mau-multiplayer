'use strict';
// Desistencia em torneios: nenhuma cadeira vira bot. Preservamos o roster
// competitivo em tournament.forfeits, sem armazenar cartas dos participantes.
const Engine = require('./game-engine');

function validScore(value){const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;}
function recordForfeit(room,player,now=Date.now()){
  if(!room?.tournament || !player?.playerKey || player.isBot ||
      !room.tournament.rosterKeys?.includes(player.playerKey)){
    throw new Error('Desistencia de torneio sem identidade sorteada.');
  }
  if(!Array.isArray(room.tournament.forfeits))room.tournament.forfeits=[];
  if(room.tournament.forfeits.some(p=>p.playerKey===player.playerKey))
    throw new Error('A desistencia deste participante ja foi registrada.');
  const entry={playerKey:player.playerKey,name:player.name,score:validScore(player.score),at:now};
  room.tournament.forfeits.push(entry);
  return entry;
}

function forfeitActiveSeat(room,player,{now=Date.now()}={}){
  if(!room?.tournament || !['playing','between-rounds'].includes(room.status) ||
      (room.status==='between-rounds' && !(Number(room.round)>0)))
    throw new Error('A desistência competitiva exige uma partida de torneio iniciada.');
  const index=room.players.findIndex(p=>p.id===player?.id);
  if(index<0 || room.players.length<2)throw new Error('Cadeira do torneio não encontrada.');
  const formerStatus=room.status;
  recordForfeit(room,player,now);
  const currentId=room.players[room.currentPlayer]?.id;
  const direction=room.direction===1?1:-1;
  let successorId=null;
  if(currentId===player.id && formerStatus==='playing'){
    for(let step=1;step<room.players.length;step++){
      const candidate=room.players[(index+step*direction+room.players.length*2)%room.players.length];
      if(candidate.id!==player.id&&!candidate.finishedRound){successorId=candidate.id;break;}
    }
  }
  // As cartas da mão de quem desistiu não devem continuar no jogo como
  // mão de um robô. Elas retornam embaralhadas ao estoque da rodada.
  if(formerStatus==='playing' && player.hand?.length)
    room.deck=Engine.shuffle([...(room.deck||[]),...player.hand]);
  room.players.splice(index,1);
  const next=room.players.length;
  if(room.pendingSeven>0 && currentId===player.id)room.pendingSeven=0;
  if(room.continuationPlayerId===player.id)room.continuationPlayerId=null;
  if(room.lastPlayedById===player.id)room.lastPlayedById=null;
  if(room.reactionSourcePlayerId===player.id)room.reactionSourcePlayerId=null;
  if(room.reactionNextPlayerId===player.id)room.reactionNextPlayerId=successorId;
  if(room.lastPass?.playerId===player.id)room.lastPass=null;
  room.openingReaction=false;
  room.burnTopCardId=null;
  room.reactionTopCardId=null;

  if(next===1){
    // Quando resta um único concorrente real, ele vence por desistência;
    // não há necessidade de uma máquina jogar até a quinta rodada.
    room.status='finished';room.finishedAt=now;room.currentPlayer=-1;
    room.winnerId=room.players[0].id;
    room.pendingSeven=0;room.finishPendingSeven=false;room.requestedSuit=null;
    room.continuationPlayerId=null;room.lastWinnerCard=null;
    room.reactionNextPlayerId=null;
    Engine.appendLog(room,`🏆 ${room.players[0].name} venceu a mesa por desistência de ${player.name}.`,'system');
  }else if(formerStatus==='playing'){
    if(room.winnerId===player.id){
      // Caso raro: vencedor provisório de um 7 desiste enquanto a cadeia
      // ainda estava pendente. Fecha a rodada atual com o menor somatório
      // de cartas entre quem continua, sem declarar o desistente vencedor.
      const nextWinner=[...room.players].sort((a,b)=>
        a.hand.reduce((s,c)=>s+Engine.cardPoints(c),0)-b.hand.reduce((s,c)=>s+Engine.cardPoints(c),0))[0];
      room.winnerId=nextWinner.id;
      room.lastWinnerCard=null;
      room.pendingSeven=0;
      room.finishPendingSeven=false;
      Engine.finalizeRound(room);
    }else if(currentId===player.id){
      const resolved=room.players.findIndex(p=>p.id===successorId);
      room.currentPlayer=resolved>=0?resolved:room.players.findIndex(p=>!p.finishedRound);
      if(room.currentPlayer<0)throw new Error('Torneio sem próximo jogador disponível.');
    }else{
      room.currentPlayer=room.players.findIndex(p=>p.id===currentId);
      if(room.currentPlayer<0)throw new Error('Turno do torneio perdido após desistência.');
    }
  }
  if(next>1)Engine.appendLog(room,`🚫 ${player.name} desistiu do torneio e foi desclassificado. A mesa continua sem máquina.`,'system');
  return {forfeited:true,remaining:next,finished:room.status==='finished'};
}

function tournamentMatchRecord(room,ordinaryRecord){
  if(!room?.tournament)return ordinaryRecord;
  const forfeits=Array.isArray(room.tournament.forfeits)?room.tournament.forfeits:[];
  const disqualified=new Set(forfeits.map(p=>p.playerKey));
  const survivors=(ordinaryRecord?.results||[]).filter(p=>!disqualified.has(p.playerKey));
  const activeScores=[...new Set(survivors.map(p=>validScore(p.score)))].sort((a,b)=>a-b);
  const sortedSurvivors=survivors.sort((a,b)=>validScore(a.score)-validScore(b.score));
  const rankedSurvivors=sortedSurvivors.map(p=>({...p,won:validScore(p.score)===activeScores[0],
    position:activeScores.indexOf(validScore(p.score))+1}));
  const forfeitedRows=forfeits.map((p,i)=>({playerKey:p.playerKey,name:p.name,
    score:validScore(p.score),position:rankedSurvivors.length+i+1,won:false,forfeited:true}));
  const rows=[...rankedSurvivors,...forfeitedRows];
  const keys=room.tournament.rosterKeys||[];
  if(!rankedSurvivors.length || rows.length!==keys.length ||
     new Set(rows.map(p=>p.playerKey)).size!==keys.length ||
     rows.some(p=>!keys.includes(p.playerKey)))
    throw new Error('Resultado de torneio incompleto: participantes sorteados divergentes.');
  return {...ordinaryRecord,results:rows};
}
module.exports={forfeitActiveSeat,tournamentMatchRecord};

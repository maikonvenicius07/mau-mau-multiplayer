'use strict';
// Apenas para torneios. Salas normais continuam com até cinco participantes.
const MAX_TOURNAMENT_PLAYERS=4;
function assertTournamentTable(players,{allowSingle=false}={}){
  if(!Array.isArray(players) || players.length>MAX_TOURNAMENT_PLAYERS ||
      players.length<(allowSingle?1:2)){
    throw new Error('Mesa de torneio inválida: são permitidos de 2 a 4 jogadores sorteados.');
  }
  const keys=players.map(p=>p?.playerKey);
  if(keys.some(k=>typeof k!=='string'||!k) || new Set(keys).size!==keys.length)
    throw new Error('Mesa de torneio inválida: jogador ausente ou duplicado.');
  return true;
}
module.exports={MAX_TOURNAMENT_PLAYERS,assertTournamentTable};

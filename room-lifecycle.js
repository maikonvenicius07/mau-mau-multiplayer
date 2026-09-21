'use strict';

function isActiveMatch(room) {
  return !!(room && (room.status === 'playing' || (room.status === 'between-rounds' && Number(room.round || 0) > 0)));
}

function markInvoluntaryDisconnect(player,{now=Date.now(),graceMs=60000}={}) {
  if(!player || player.isBot) return false;
  player.connected=false;
  player.socketId=null;
  player.disconnectedAt=now;
  player.autoControlled=false;
  player.reconnectEligible=true;
  player.reconnectDeadlineAt=now+graceMs;
  player.voluntaryLeftAt=null;
  return true;
}

function canAutoReconnect(player) {
  return !!(player && !player.isBot && player.playerKey && player.reconnectEligible && !player.connected);
}

// V40.60 — uma reserva de reconexão involuntária não bloqueia o jogador
// de entrar na fila. A reserva só é cancelada se o matchmaking realmente
// formar uma nova sala para essa Conta Google.
function blocksMatchmaking(player) {
  if(!player || player.isBot) return false;
  return !canAutoReconnect(player);
}

function markAutoTakeover(player) {
  if(!canAutoReconnect(player)) return false;
  player.autoControlled=true;
  player.reconnectDeadlineAt=null;
  return true;
}

function clearReconnectReservation(player) {
  if(!player) return false;
  player.reconnectEligible=false;
  player.reconnectDeadlineAt=null;
  return true;
}

function convertHumanSeatToPermanentBot(player,botInfo,{now=Date.now(),token='bot-token'}={}) {
  if(!player || player.isBot) return false;
  player.isBot=true;
  player.connected=true;
  player.socketId=null;
  player.autoControlled=false;
  player.disconnectedAt=null;
  player.reconnectDeadlineAt=null;
  player.reconnectEligible=false;
  player.voluntaryLeftAt=now;
  player.playerKey=null;
  player.token=token;
  player.host=false;
  if(botInfo?.name)player.name=botInfo.name;
  if(botInfo?.avatar)player.avatar=botInfo.avatar;
  return true;
}

function removeHumanSeat(room,playerId) {
  if(!room || !Array.isArray(room.players)) return null;
  const idx=room.players.findIndex(p=>p.id===playerId && !p.isBot);
  if(idx<0)return null;
  return room.players.splice(idx,1)[0]||null;
}



// V40.68.1 — uma partida ativa entra no prazo de 5 minutos somente quando
// não existe nenhum humano conectado. Não importa se há 1, 2, 3, 4 ou 5
// cadeiras humanas reservadas; basta um humano conectado para a sala continuar ativa.
function allHumansDisconnected(room) {
  if(!isActiveMatch(room) || !Array.isArray(room.players)) return false;
  const humans=room.players.filter(p=>p && !p.isBot);
  return humans.length>0 && humans.every(p=>!p.connected);
}


// V40.61.1 — sala solo contra máquinas: se o único humano perder a conexão
// involuntariamente, a sala pode permanecer reservada por uma janela curta.
// SAIR/troca de sala não entram aqui, pois removem a associação humana antes.
function soloDisconnectedHuman(room) {
  if(!isActiveMatch(room) || !Array.isArray(room.players)) return null;
  const humans=room.players.filter(p=>!p.isBot);
  const bots=room.players.filter(p=>p.isBot);
  if(humans.length!==1 || bots.length<1) return null;
  const human=humans[0];
  if(human.connected || !human.reconnectEligible || !human.playerKey) return null;
  return human;
}

function hasHumanMembers(room) {
  return !!(room && Array.isArray(room.players) && room.players.some(p=>!p.isBot));
}

module.exports={
  isActiveMatch,
  markInvoluntaryDisconnect,
  canAutoReconnect,
  blocksMatchmaking,
  markAutoTakeover,
  clearReconnectReservation,
  convertHumanSeatToPermanentBot,
  removeHumanSeat,
  allHumansDisconnected,
  soloDisconnectedHuman,
  hasHumanMembers,
};

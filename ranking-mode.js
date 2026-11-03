'use strict';

const OFFICIAL='official';
const TRAINING='training';

function validMode(value){
  return value===OFFICIAL || value===TRAINING;
}

// V40.62 — a categoria é decidida no início da PRIMEIRA rodada da partida.
// AUTO temporário representa um humano e não transforma a partida em TREINO.
function modeForNewMatch(room){
  return room?.players?.some(p=>p?.isBot) ? TRAINING : OFFICIAL;
}

// Compatibilidade para snapshots iniciados antes da V40.62. Uma cadeira que
// virou Máquina por abandono voluntário possui voluntaryLeftAt; ela era humana
// quando a partida começou e, portanto, não deve reclassificar a partida.
function inferLegacyMode(room){
  const hadOriginalBot=!!room?.players?.some(p=>p?.isBot && !(Number(p?.voluntaryLeftAt||0)>0));
  return hadOriginalBot ? TRAINING : OFFICIAL;
}

function freezeForMatchStart(room){
  if(!room) return OFFICIAL;
  if(!validMode(room.rankingModeAtStart)) room.rankingModeAtStart=modeForNewMatch(room);
  return room.rankingModeAtStart;
}

function resolveRoomMode(room){
  if(validMode(room?.rankingModeAtStart)) return room.rankingModeAtStart;
  return inferLegacyMode(room);
}

module.exports={
  OFFICIAL,TRAINING,validMode,modeForNewMatch,inferLegacyMode,freezeForMatchStart,resolveRoomMode,
};

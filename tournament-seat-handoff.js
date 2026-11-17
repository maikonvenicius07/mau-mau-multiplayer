'use strict';
// V40.69.8.24 — entrada automática em uma mesa de torneio somente pode
// substituir uma sala COMUM ainda não iniciada. Partidas em andamento, mesas
// de torneio e observadores permanecem protegidos pela autorização existente.
function canAutoSwitchFrom(room){
  return !!room&&!room.tournament&&room.status==='lobby'&&Number(room.round||0)===0;
}
module.exports={canAutoSwitchFrom};

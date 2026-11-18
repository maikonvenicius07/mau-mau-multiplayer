'use strict';
// Só restaura o snapshot ORIGINAL de lobby que NUNCA iniciou; não inventa
// participantes nem reconstrói uma partida competitiva com cartas/pontos.
function canRestore(snapshot,binding,seat,{id,phase,number}={}){
  if(!snapshot||!binding||!seat||!Array.isArray(seat.players))return false;
  if(binding.result||binding.roomState!=='lobby'||!binding.roomCode||snapshot.code!==binding.roomCode)return false;
  if(snapshot.snapshotVersion!==1||snapshot.status!=='lobby'||Number(snapshot.round||0)!==0)return false;
  if(!snapshot.tournament||snapshot.tournament.id!==id||snapshot.tournament.phase!==phase||
    Number(snapshot.tournament.tableNumber)!==Number(number))return false;
  const expected=seat.players.map(p=>p.playerKey);
  const roster=snapshot.tournament.rosterKeys;
  if(!expected.length||!Array.isArray(roster)||expected.length!==new Set(expected).size||
    roster.length!==expected.length||new Set(roster).size!==expected.length||
    !expected.every(k=>roster.includes(k)))return false;
  if(!Array.isArray(snapshot.players)||!snapshot.players.length||snapshot.players.length>expected.length)return false;
  if(new Set(snapshot.players.map(p=>p.playerKey)).size!==snapshot.players.length)return false;
  if(snapshot.players.some(p=>!p||p.isBot||p.autoControlled||p.voluntaryLeftAt||
    !p.playerKey||!expected.includes(p.playerKey)||!p.id))return false;
  if(Array.isArray(snapshot.tournament.forfeits)&&snapshot.tournament.forfeits.length)return false;
  return true;
}
module.exports={canRestore};

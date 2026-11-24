'use strict';
const {assertTournamentTable}=require('./tournament-table-capacity');
const {canRecoverMissingLobby}=require('./tournament-lobby-recovery');
const {timestamp}=require('./tournament-wait');

// A zero-presence result is explicitly distinct from a played match or a W.O.
// Preserve the entire official roster, but do not award any winner or qualification.
function absenceRecord({id,phase,number,roster,deadline}){
  assertTournamentTable(roster);
  const end=timestamp(deadline);
  if(!end)throw new Error('Mesa sem prazo persistido.');
  return {noShow:true,matchId:`absence:${id}:${phase}:${number}`,finishedAt:new Date(end).toISOString(),
    results:roster.map((p,i)=>({playerKey:p.playerKey,name:p.name,score:0,position:i+1,won:false,forfeited:true}))};
}
function isAbsenceRecord(result){
  return result?.noShow===true&&Array.isArray(result.results)&&result.results.length>=2&&
    result.results.every(p=>p.forfeited===true&&p.won===false&&p.score===0);
}
function canCloseEmpty({binding,room,deadline,now=Date.now(),snapshot=false,deleted=false,snapshotsReady=true}){
  if(!snapshotsReady||!timestamp(deadline)||now<timestamp(deadline)||binding?.result)return false;
  if(room){
    if(!binding?.roomCode||room.code!==binding.roomCode||binding.roomState!=='lobby'||room.status!=='lobby'||Number(room.round||0)!==0)return false;
    if(room.players.some(p=>p.isBot||p.connected|| (p.reconnectEligible&&Number(p.reconnectDeadlineAt)>now)))return false;
    return true;
  }
  if(!binding?.roomCode)return !binding||(!binding.roomState||binding.roomState==='legacy'||binding.roomState==='lobby');
  return canRecoverMissingLobby(binding,{snapshotsReady,activeSnapshot:snapshot,deleted,now});
}
module.exports={absenceRecord,isAbsenceRecord,canCloseEmpty};

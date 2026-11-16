'use strict';

// V40.69.8.20 — nunca criar jogadores numa mesa de torneio já iniciada.
// A retomada só é autorizada para a identidade sorteada que ainda ocupa
// uma cadeira humana válida e que não foi desclassificada por desistência.
function memberForResume(room,playerKey){
  const key=String(playerKey||'');
  if(!room?.tournament||!key||!['playing','between-rounds'].includes(room.status))return null;
  const tournament=room.tournament;
  if(!Array.isArray(tournament.rosterKeys)||!tournament.rosterKeys.includes(key))return null;
  if(tournament.forfeits?.some(f=>f.playerKey===key))return null;
  const member=room.players?.find(p=>p&&!p.isBot&&p.playerKey===key);
  if(!member)return null;
  // A saída voluntária invalida a reserva. Uma transferência entre sockets
  // conectados é examinada novamente pelo fluxo de recuperação no servidor.
  if(member.voluntaryLeftAt)return null;
  return member;
}
module.exports={memberForResume};

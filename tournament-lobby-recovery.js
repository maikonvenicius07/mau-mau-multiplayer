'use strict';
// Recuperação SOMENTE de lobbies nunca iniciados. O vínculo permanece no banco
// e é trocado por compare-and-swap: a sala velha não deve ser reativada.
const MIN_MISSING_LOBBY_AGE_MS = 60 * 1000;
function canRecoverMissingLobby(binding,{snapshotsReady=false,roomExists=false,
  activeSnapshot=false,deleted=false,now=Date.now()}={}){
  if(!snapshotsReady)return false;
  if(!binding || !binding.roomCode || binding.result || roomExists || activeSnapshot)return false;
  // Vínculos anteriores a este protocolo são desconhecidos. Não há prova de
  // que a partida não começou: manter bloqueado é mais seguro que zerar pontos.
  if(binding.roomState!=='lobby')return false;
  const claimedAt=Number(binding.claimedAt);
  // Um tombstone persistente permite recuperação imediata após sair do lobby;
  // ausência de snapshot só permite recovery passado o prazo de segurança.
  return deleted || (Number.isFinite(claimedAt) && claimedAt>0 &&
    Number.isFinite(Number(now)) && Number(now)-claimedAt >= MIN_MISSING_LOBBY_AGE_MS);
}
module.exports={canRecoverMissingLobby,MIN_MISSING_LOBBY_AGE_MS};

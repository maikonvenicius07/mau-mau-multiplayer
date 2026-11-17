'use strict';
// Estado público de uma mesa competitiva: não expõe código, identidade ou cartas.
const {canRecoverMissingLobby}=require('./tournament-lobby-recovery');
function classify(binding,{room=null,snapshotsReady=true,activeSnapshot=false,deleted=false,now=Date.now()}={}){
  if(binding?.result)return 'finished';
  if(room)return room.status==='lobby'?'waiting-players':'playing';
  if(!binding?.roomCode)return 'not-created';
  if(canRecoverMissingLobby(binding,{snapshotsReady,activeSnapshot,deleted,now}))return 'recoverable-lobby';
  if(binding.roomState==='lobby')return 'restoring-lobby';
  return 'recovery-required';
}
function message(status){
  const notes={
    finished:'Mesa concluída.',
    playing:'Partida em andamento.',
    'waiting-players':'Aguardando os jogadores entrarem na mesa do torneio.',
    'not-created':'Mesa da fase pronta. A entrada do primeiro classificado cria a sala automaticamente.',
    'recoverable-lobby':'Sala anterior não iniciou e pode ser recuperada quando um classificado entrar.',
    'restoring-lobby':'Sala em recuperação. Aguarde a sincronização e tente entrar novamente.',
    'snapshot-review':'O estado anterior da partida ainda está guardado. A recuperação exige análise para não perder cartas e pontos.',
    'recovery-required':'A mesa foi registrada anteriormente, mas o estado da partida não está disponível. É necessária verificação do organizador antes de qualquer reinício.'
  };
  return notes[status]||'Verifique o andamento da mesa.';
}
module.exports={classify,message};

'use strict';
// Autoriza troca apenas de uma sessão observadora de torneio reconhecida pelo
// servidor para a fase SEGUINTE da mesma competição. Não atribui vaga:
// o servidor ainda revalida sorteio, desistência e estado da partida.
function canHandoffObserver({role,watchTournamentId,watchStage,tournamentId,stage,automatic}){
  return role==='SPECTATOR'&&automatic===true&&
    !!watchTournamentId&&watchTournamentId===tournamentId&&
    ['qualifier','quarter','extra','semi','final'].includes(watchStage)&&
    ['qualifier','quarter','extra','semi','final'].includes(stage)&&
    ['qualifier','quarter','extra','semi','final'].indexOf(stage)>
      ['qualifier','quarter','extra','semi','final'].indexOf(watchStage);
}
module.exports={canHandoffObserver};

'use strict';

// V40.69.8.5.1 — estado único de confirmação para a revanche. A sala, o
// código público e as sessões Socket.IO permanecem os mesmos; somente o motor
// reinicia os dados de partida depois da confirmação do ranking.
function replayInfo(room, viewerId=null) {
  const players=Array.isArray(room?.players)?room.players:[];
  const humans=players.filter(p=>!p.isBot);
  const ready=new Set(Array.isArray(room?.replayReadyPlayerIds)?room.replayReadyPlayerIds:[]);
  return {
    eligible:room?.status==='finished'&&!room.tournament&&players.length>=2&&humans.length>=1,
    requiredCount:humans.length,
    readyCount:humans.filter(p=>ready.has(p.id)).length,
    meReady:!!(viewerId&&ready.has(viewerId)),
    waitingForReconnect:humans.filter(p=>!p.connected).length,
    waitingForRanking:!!(room?.status==='finished'&&!room.rankingRecorded),
    rankingRetrying:!!(room?.status==='finished'&&!room.rankingRecorded&&Number(room.rankingLastFailureAt||0)>0),
    rankingRetrySeconds:Math.max(0,Math.ceil((Number(room?.rankingRetryAt||0)-Date.now())/1000)),
    participantCount:players.length,
  };
}

function confirmReplay(room,player) {
  if(!replayInfo(room,player?.id).eligible)throw new Error('Jogar novamente só está disponível depois que a partida terminar.');
  if(!player||player.isBot||!player.connected||!room.players.some(p=>p.id===player.id))
    throw new Error('Somente jogadores humanos conectados podem confirmar a revanche.');
  if(!Array.isArray(room.replayReadyPlayerIds))room.replayReadyPlayerIds=[];
  if(room.replayReadyPlayerIds.includes(player.id))return false;
  room.replayReadyPlayerIds.push(player.id);
  return true;
}

function canStartReplay(room) {
  const info=replayInfo(room);
  if(!info.eligible||info.waitingForRanking||info.waitingForReconnect)return false;
  if(info.participantCount<2||info.requiredCount<1)return false;
  return info.readyCount===info.requiredCount;
}

module.exports={replayInfo,confirmReplay,canStartReplay};

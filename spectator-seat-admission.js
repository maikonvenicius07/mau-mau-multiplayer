'use strict';

// Somente metadados da fila: nunca inclui cartas, tokens ou identificadores
// de outras pessoas no estado enviado ao Observador.
const MAX_SEATS = 5;

function countAvailableSeats(room, playerKey = null) {
  if (!room || room.status === 'finished') return 0;
  const participants = Array.isArray(room.players) ? room.players.length : 0;
  const reservations = room.inviteReservations instanceof Map
    ? [...room.inviteReservations.entries()].filter(([key, reservation]) =>
      key !== playerKey && reservation && Number(reservation.expiresAt) > Date.now()).length
    : 0;
  return Math.max(0, MAX_SEATS - participants - reservations);
}

function seatRequests(room) {
  return Array.isArray(room?.spectatorSeatRequests) ? room.spectatorSeatRequests : [];
}

function isEligibleRound(room) {
  const rounds = Number(room?.rules?.rounds || 5);
  return !!room && !room.tournament
    && ['playing', 'between-rounds'].includes(room.status)
    && Number(room.round) > 0 && Number(room.round) < rounds;
}

function seatStatus(room, spectator) {
  const queue = seatRequests(room);
  const positionIndex = spectator ? queue.findIndex(r =>
    r.spectatorId === spectator.id && r.playerKey === spectator.playerKey) : -1;
  const queuePosition = positionIndex >= 0 ? positionIndex + 1 : null;
  const eligible = isEligibleRound(room);
  const availableSeats = countAvailableSeats(room, spectator?.playerKey || null);
  const connected = !!spectator?.connected;
  const canRequest = eligible && connected && availableSeats > 0 && queuePosition === null;
  let message = '';
  if (queuePosition !== null) {
    message = `${queuePosition}º na fila. Pedido mantido até o intervalo, sujeito à confirmação de vaga.`;
  } else if (!eligible) {
    message = room?.tournament ? 'Entradas externas indisponíveis em torneios.' :
      'A entrada está disponível somente durante as rodadas 1 a 4 e seus intervalos.';
  } else if (!availableSeats) {
    message = 'Sem vagas livres: cadeiras ocupadas e convites reservados são respeitados.';
  } else {
    message = `${availableSeats} vaga${availableSeats === 1 ? '' : 's'} disponível${availableSeats === 1 ? '' : 'is'}. Entrada no intervalo entre rodadas.`;
  }
  return {
    eligible,
    canRequest,
    availableSeats,
    queuePosition,
    queueLength: queue.length,
    status: queuePosition !== null ? 'queued' : 'idle',
    message,
  };
}

function removeRequestForSpectator(room, spectatorId) {
  if (!Array.isArray(room?.spectatorSeatRequests)) return;
  room.spectatorSeatRequests = room.spectatorSeatRequests.filter(x => x.spectatorId !== spectatorId);
}

// A fila fica vinculada à conta autenticada, nunca ao socket nem ao token.
// Durante um restart, não são restaurados espectadores nem credenciais; o pedido
// pode ser reivindicado somente depois de a conta voltar à mesma sala.
const RESTORED_REQUEST_GRACE_MS = 2 * 60 * 1000;
function persistableSeatRequests(room, now=Date.now()) {
  if (!isEligibleRound(room)) return [];
  const seen=new Set();
  return seatRequests(room).filter(r=>{
    if (!r || typeof r.playerKey!=='string' || !r.playerKey || r.playerKey.length>256) return false;
    if(seen.has(r.playerKey))return false;
    if(room.players.some(p=>!p.isBot&&p.playerKey===r.playerKey))return false;
    if(Number(r.recoveryExpiresAt||0)>0 && r.recoveryExpiresAt<=now)return false;
    seen.add(r.playerKey);return true;
  }).slice(0,MAX_SEATS).map(r=>({
    playerKey:r.playerKey,
    at:Number.isFinite(Number(r.at)) ? Number(r.at) : now,
    expiresAt:Number(r.recoveryExpiresAt||0)>0 ? Number(r.recoveryExpiresAt) : now+RESTORED_REQUEST_GRACE_MS,
  }));
}
function restoreSeatRequests(room, snapshot, now=Date.now()) {
  if(!isEligibleRound(room))return [];
  const savedAt=Number(snapshot?.savedAt||0);
  if(savedAt<=0 || now-savedAt>RESTORED_REQUEST_GRACE_MS || savedAt-now>60000)return [];
  const seen=new Set();
  return (Array.isArray(snapshot.pendingSpectatorSeatRequests)?snapshot.pendingSpectatorSeatRequests:[])
    .filter(r=>{
      if(!r || typeof r.playerKey!=='string' || !r.playerKey || r.playerKey.length>256)return false;
      if(seen.has(r.playerKey) || room.players.some(p=>!p.isBot&&p.playerKey===r.playerKey))return false;
      if(!Number.isFinite(Number(r.expiresAt))||Number(r.expiresAt)<=now)return false;
      seen.add(r.playerKey);return true;
    }).slice(0,MAX_SEATS).map(r=>({
      spectatorId:null,playerKey:r.playerKey,
      at:Number.isFinite(Number(r.at))?Number(r.at):now,
      recoveryExpiresAt:Math.min(Number(r.expiresAt),now+RESTORED_REQUEST_GRACE_MS),
    }));
}
function pruneRestoredSeatRequests(room,now=Date.now()){
  if(!Array.isArray(room?.spectatorSeatRequests))return 0;
  const before=room.spectatorSeatRequests.length;
  room.spectatorSeatRequests=room.spectatorSeatRequests.filter(r=>
    r && (!r.recoveryExpiresAt || Number(r.recoveryExpiresAt)>now));
  return before-room.spectatorSeatRequests.length;
}
function claimRestoredSeatRequest(room,spectator,now=Date.now()){
  if(!isEligibleRound(room)||!spectator?.id||!spectator?.playerKey)return false;
  pruneRestoredSeatRequests(room,now);
  const req=seatRequests(room).find(r=>
    r.spectatorId===null && r.playerKey===spectator.playerKey &&
    Number(r.recoveryExpiresAt||0)>now);
  if(!req)return false;
  req.spectatorId=spectator.id;
  delete req.recoveryExpiresAt;
  return true;
}

module.exports = {
  MAX_SEATS, countAvailableSeats, seatRequests, isEligibleRound, seatStatus, removeRequestForSpectator,
  RESTORED_REQUEST_GRACE_MS,persistableSeatRequests,restoreSeatRequests,
  pruneRestoredSeatRequests,claimRestoredSeatRequest,
};

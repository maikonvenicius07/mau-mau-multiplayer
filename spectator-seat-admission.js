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

module.exports = { MAX_SEATS, countAvailableSeats, seatRequests, isEligibleRound, seatStatus, removeRequestForSpectator };

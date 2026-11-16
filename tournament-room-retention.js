'use strict';

// V40.69.8.17 — o encerramento de uma mesa de torneio nao implica que
// o resultado ja tenha sido confirmado no historico da competicao.
// Proteger esse estado em TODOS os caminhos de limpeza e na persistencia.
const PENDING_RESULT_SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hasPendingTournamentResult(room) {
  return !!(room && room.tournament && room.rankingRecorded !== true &&
    (room.status === 'finished' || !!room.pendingRankingRecord));
}

function mayRemoveRoom(room) {
  return !hasPendingTournamentResult(room);
}

function snapshotTtlMs(roomOrSnapshot,normalTtlMs) {
  const normal = Math.max(5 * 60 * 1000, Number(normalTtlMs) || 0);
  return hasPendingTournamentResult(roomOrSnapshot)
    ? Math.max(normal, PENDING_RESULT_SNAPSHOT_TTL_MS)
    : normal;
}

module.exports={hasPendingTournamentResult,mayRemoveRoom,snapshotTtlMs,PENDING_RESULT_SNAPSHOT_TTL_MS};

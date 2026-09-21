'use strict';

// V40.68.1 — política oficial de retenção/reconexão.
// Estes relógios têm finalidades diferentes:
// 1) 60 s: uma cadeira humana aguarda antes do AUTO temporário;
// 2) 5 min: qualquer partida ativa sem NENHUM humano conectado expira;
// 3) 8 h: TTL técnico máximo do snapshot no armazenamento persistente.
// A constante SOLO_ROOM_EXPIRY_MS é mantida como alias de compatibilidade
// com testes/snapshots históricos da V40.61.1.
const RECONNECT_GRACE_MS = 60 * 1000;
const ALL_HUMANS_OFFLINE_EXPIRY_MS = 5 * 60 * 1000;
const SOLO_ROOM_EXPIRY_MS = ALL_HUMANS_OFFLINE_EXPIRY_MS;
const MULTIPLAYER_SNAPSHOT_TTL_MS = 8 * 60 * 60 * 1000;

function productionLike(env=process.env) {
  const nodeEnv=String(env.NODE_ENV||'').toLowerCase();
  return nodeEnv==='production' || String(env.RENDER||'').toLowerCase()==='true' || !!env.RENDER_SERVICE_ID;
}

function snapshotTtlMs(env=process.env) {
  // Em produção a regra aprovada é fixa: 8 horas. Isso evita que uma variável
  // antiga ou digitada incorretamente altere silenciosamente a política do jogo.
  if (productionLike(env)) return MULTIPLAYER_SNAPSHOT_TTL_MS;
  const requested=Number(env.ROOM_SNAPSHOT_TTL_MS||0);
  if (Number.isFinite(requested) && requested >= 5 * 60 * 1000) return requested;
  return MULTIPLAYER_SNAPSHOT_TTL_MS;
}

module.exports={
  RECONNECT_GRACE_MS,
  ALL_HUMANS_OFFLINE_EXPIRY_MS,
  SOLO_ROOM_EXPIRY_MS,
  MULTIPLAYER_SNAPSHOT_TTL_MS,
  productionLike,
  snapshotTtlMs,
};

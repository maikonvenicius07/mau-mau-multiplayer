'use strict';

// V40.67 — política oficial de retenção/reconexão.
// Estes três relógios têm finalidades diferentes e não devem ser misturados:
// 1) 60 s: cadeira humana aguarda antes do AUTO temporário;
// 2) 5 min: sala solo (1 humano + robôs) expira se o único humano não voltar;
// 3) 8 h: snapshot de sala multiplayer pode sobreviver a reinícios do servidor.
const RECONNECT_GRACE_MS = 60 * 1000;
const SOLO_ROOM_EXPIRY_MS = 5 * 60 * 1000;
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
  SOLO_ROOM_EXPIRY_MS,
  MULTIPLAYER_SNAPSHOT_TTL_MS,
  productionLike,
  snapshotTtlMs,
};

'use strict';

// Fase 4A: suprime apenas estados byte-a-byte equivalentes após serialização
// JSON, separados por conexão, sala, papel e participante.
// WeakMap libera o cache quando o socket é descartado; o hash SHA-256 impede
// reter cartas privadas, histórico e outros dados do estado na memória extra.
const crypto = require('crypto');
const lastBySocket = new WeakMap();

function emitState(target, scope, payload) {
  if (!target || typeof target.emit !== 'function') return false;
  let fingerprint = null;
  try {
    const json = JSON.stringify(payload);
    if (typeof json === 'string') {
      fingerprint = crypto.createHash('sha256').update(json).digest('hex');
    }
  } catch {
    // Caso uma estrutura futura não seja serializável, NÃO suprimimos o envio.
    // A compatibilidade do protocolo existente continua a cargo do Socket.IO.
  }
  const previous = lastBySocket.get(target);
  if (fingerprint !== null && previous?.scope === scope && previous.fingerprint === fingerprint) {
    return false;
  }
  target.emit('state', payload);
  if (fingerprint !== null) lastBySocket.set(target, {scope, fingerprint});
  else lastBySocket.delete(target);
  return true;
}

function invalidate(target) {
  if (target) lastBySocket.delete(target);
}

module.exports = {emitState, invalidate};

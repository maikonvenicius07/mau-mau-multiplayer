'use strict';

// Fase 4C — evita reenviar o mesmo matchmakingState para a MESMA conexão.
// O WeakMap não retém sockets após a desconexão. Cada socket possui sua
// assinatura; novos acessos e consultas explícitas sempre podem obter resposta.
// Não interfere em joined, matchmakingMatched, convites, reservas nem state.
const lastBySocket = new WeakMap();

function emitIfChanged(socket, payload, {force = false} = {}) {
  if (!socket || typeof socket.emit !== 'function') return false;
  let signature = null;
  try {
    const json = JSON.stringify(payload);
    if (typeof json === 'string') signature = json;
  } catch {
    // Falha aberta: payloads futuros não serializáveis continuam sendo enviados.
  }
  if (!force && signature !== null && lastBySocket.get(socket) === signature) return false;
  socket.emit('matchmakingState', payload);
  if (signature !== null) lastBySocket.set(socket, signature);
  else lastBySocket.delete(socket);
  return true;
}

module.exports = {emitIfChanged};

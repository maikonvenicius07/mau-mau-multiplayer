'use strict';

// Fase 4B — snapshots globais (apenas presença e salas públicas).
// Os estados privados da partida usam state-delivery.js; não passam por este filtro.
// O horário de criação do snapshot (`at`) muda a cada consulta, mas não representa
// uma mudança nas listas exibidas. Ignorá-lo evita broadcasts e renders idênticos.
function createBroadcastGate() {
  const signatures = new Map();

  function emitIfChanged(io, event, payload) {
    if (!io || typeof io.emit !== 'function') return false;
    let signature = null;
    try {
      const {at, ...meaningful} = payload;
      signature = JSON.stringify(meaningful);
    } catch {
      // Falha aberta: nunca impedir o envio por erro de serialização.
    }
    if (signature !== null && signatures.get(event) === signature) return false;
    io.emit(event, payload);
    if (signature !== null) signatures.set(event, signature);
    else signatures.delete(event);
    return true;
  }

  return {emitIfChanged};
}

module.exports = {createBroadcastGate};

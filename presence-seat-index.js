'use strict';

// Índice efêmero para um snapshot de presença. Não modifica salas nem persiste dados.
// Preserva a prioridade histórica da roomSeatForKey e a ordem de inserção de rooms.
function seatPriority(room, player) {
  return (player.connected ? 100 : 0)
    + (room.status === 'playing' ? 40 : room.status === 'between-rounds' ? 30 : room.status === 'lobby' ? 20 : 10)
    + (room.round > 0 ? 5 : 0);
}

function indexPresenceSeats(rooms, now = Date.now()) {
  const seats = new Map();
  const reconnectingKeys = new Set();
  for (const room of rooms.values()) {
    const players = room?.players;
    if (!Array.isArray(players)) continue;
    // A busca original com Array.find() selecionava a PRIMEIRA cadeira por chave
    // dentro de uma mesma sala. Preservamos essa escolha até com estado legado duplicado.
    const firstInRoom = new Set();
    for (const player of players) {
      if (!player || player.isBot || !player.playerKey) continue;
      const key = player.playerKey;
      if (!player.connected && !player.autoControlled && player.reconnectDeadlineAt > now) {
        reconnectingKeys.add(key);
      }
      if (firstInRoom.has(key)) continue;
      firstInRoom.add(key);
      const score = seatPriority(room, player);
      const best = seats.get(key);
      if (!best || score > best.score) seats.set(key, { room, player, score });
    }
  }
  return { seats, reconnectingKeys };
}

module.exports = { seatPriority, indexPresenceSeats };

'use strict';

// Índice efêmero para montar o snapshot de presença em uma única passagem.
// A ordem das salas e o desempate pelo primeiro assento encontrado seguem
// exatamente a mesma regra de roomSeatForKey do servidor.
function buildBestSeatIndex(rooms) {
  const best = new Map();
  for (const room of rooms.values()) {
    const seenInRoom = new Set();
    for (const player of room.players) {
      if (player.isBot || !player.playerKey || seenInRoom.has(player.playerKey)) continue;
      seenInRoom.add(player.playerKey);
      const score = (player.connected ? 100 : 0)
        + (room.status === 'playing' ? 40 : room.status === 'between-rounds' ? 30 : room.status === 'lobby' ? 20 : 10)
        + (room.round > 0 ? 5 : 0);
      const previous = best.get(player.playerKey);
      if (!previous || score > previous.score) best.set(player.playerKey, {room, player, score});
    }
  }
  return best;
}

module.exports = {buildBestSeatIndex};

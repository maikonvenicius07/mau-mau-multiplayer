'use strict';

const crypto = require('crypto');

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SPECIAL_RANKS = new Set(['A','7','8','J','Q','K']);
const DEFAULT_RULES = {
  rounds: 5,
  cardsPerPlayer: 6,
  mauMauPenalty: 2,
  safeStarter: true,
  allowLateJoinUntilRound: 3,
  burnEnabled: true,
};

function id(prefix='id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function createDeck() {
  const deck = [];
  for (let copy = 1; copy <= 2; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: id('c'), suit, rank, copy });
      }
    }
  }
  return deck;
}

function shuffle(arr, rng=Math.random) {
  const a = arr.slice();
  for (let i=a.length-1; i>0; i--) {
    const j = Math.floor(rng()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardPoints(card) {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return Number(card.rank);
}

function isSpecial(card) {
  return SPECIAL_RANKS.has(card.rank);
}

function sameCard(a,b) {
  return !!a && !!b && a.rank === b.rank && a.suit === b.suit;
}

function nextIndex(room, idx, steps=1, skipFinished=true) {
  const n = room.players.length;
  if (!n) return -1;
  let cursor = idx;
  let moved = 0;
  let guard = 0;
  while (moved < steps && guard < n*5) {
    cursor = (cursor + room.direction + n) % n;
    guard++;
    const p = room.players[cursor];
    if (!skipFinished || !p.finishedRound) moved++;
  }
  return cursor;
}

function previousIndex(room, idx) {
  const n = room.players.length;
  let cursor = (idx - room.direction + n) % n;
  let guard = 0;
  while (room.players[cursor]?.finishedRound && guard < n) {
    cursor = (cursor - room.direction + n) % n;
    guard++;
  }
  return cursor;
}

function activePlayers(room) {
  return room.players.filter(p => !p.finishedRound);
}

function log(room, message, kind='info') {
  room.log.push({ id:id('log'), ts:Date.now(), message, kind });
  if (room.log.length > 80) room.log.splice(0, room.log.length-80);
}

function makePlayer({socketId, token, name, avatar, isBot=false}) {
  return {
    id: id('p'),
    socketId: socketId || null,
    token: token || id('t'),
    name: String(name || 'Jogador').slice(0,24),
    avatar: avatar || '🂡',
    hand: [],
    score: 0,
    roundScore: 0,
    roundHistory: [],
    connected: true,
    isBot,
    host: false,
    finishedRound: false,
    declaration: null,
  };
}

function createRoom(code, hostInfo) {
  const host = makePlayer(hostInfo);
  host.host = true;
  return {
    code,
    status: 'lobby', // lobby, playing, between-rounds, finished
    round: 0,
    rules: {...DEFAULT_RULES},
    players: [host],
    deck: [],
    discard: [],
    direction: -1, // anti-horário
    currentPlayer: 0,
    requestedSuit: null,
    pendingSeven: 0,
    winnerId: null,
    lastWinnerCard: null,
    continuationPlayerId: null,
    lastPlayedById: null,
    burnTopCardId: null,
    finishPendingSeven: false,
    lastPass: null,
    roundRoles: null,
    log: [],
    createdAt: Date.now(),
  };
}

function addPlayer(room, info) {
  if (room.players.length >= 5) throw new Error('A sala já possui 5 jogadores.');
  if (room.status === 'playing') throw new Error('Não é permitido entrar durante uma rodada.');
  if (room.status === 'finished') throw new Error('A partida já terminou.');
  if (room.round >= room.rules.allowLateJoinUntilRound && room.status === 'between-rounds') {
    throw new Error('Novos jogadores só podem entrar até o início da 3ª rodada.');
  }
  const p = makePlayer(info);
  if (room.round > 0) {
    p.score = Math.max(0, ...room.players.map(x => x.score));
    p.roundHistory = Array(room.round).fill(null);
    log(room, `${p.name} entrou na partida com ${p.score} ponto(s), igual à maior pontuação acumulada das rodadas anteriores.`, 'system');
  }
  room.players.push(p);
  return p;
}

function reconnectPlayer(room, token, socketId) {
  const p = room.players.find(x => x.token === token);
  if (!p) return null;
  p.socketId = socketId;
  p.connected = true;
  return p;
}

function startRound(room) {
  // Antes da 1ª rodada, remove participantes que ficaram como "fantasmas"
  // após fechar/atualizar uma aba. Isso evita iniciar a partida já pausada.
  if (room.status === 'lobby') {
    const removed = room.players.filter(p => !p.connected);
    if (removed.length) {
      room.players = room.players.filter(p => p.connected);
      log(room, `${removed.length} jogador(es) desconectado(s) removido(s) da sala antes do início.`, 'system');
      if (room.players.length && !room.players.some(p => p.host)) room.players[0].host = true;
    }
  }

  const connectedCount = room.players.filter(p => p.connected).length;
  if (connectedCount < 2) throw new Error('São necessários pelo menos 2 jogadores conectados.');
  if (room.players.some(p => !p.connected)) throw new Error('Há jogador desconectado. Aguarde a reconexão antes de iniciar a próxima rodada.');
  if (room.round >= room.rules.rounds) throw new Error('As 5 rodadas já foram concluídas.');
  room.round += 1;
  room.status = 'playing';
  room.direction = -1;
  room.requestedSuit = null;
  room.pendingSeven = 0;
  room.winnerId = null;
  room.lastWinnerCard = null;
  room.continuationPlayerId = null;
  room.lastPlayedById = null;
  room.burnTopCardId = null;
  room.finishPendingSeven = false;
  room.discard = [];
  room.deck = shuffle(createDeck());

  room.players.forEach(p => {
    p.hand = [];
    p.roundScore = 0;
    p.finishedRound = false;
    p.declaration = null;
  });

  // Papéis simbólicos da rodada: embaralha -> distribui -> vira.
  const shuffler = (room.round - 1) % room.players.length;
  const dealer = (shuffler - 1 + room.players.length) % room.players.length; // anti-horário
  const flipper = (dealer - 1 + room.players.length) % room.players.length;
  room.roundRoles = {
    shufflerId: room.players[shuffler].id,
    dealerId: room.players[dealer].id,
    flipperId: room.players[flipper].id,
  };

  for (let c=0; c<room.rules.cardsPerPlayer; c++) {
    for (let i=0; i<room.players.length; i++) {
      room.players[i].hand.push(drawOne(room));
    }
  }

  let starter = drawOne(room);
  if (room.rules.safeStarter) {
    const deferred = [];
    while (isSpecial(starter) && room.deck.length) {
      deferred.push(starter);
      starter = drawOne(room);
    }
    room.deck.push(...shuffle(deferred));
  }
  room.discard.push(starter);

  // Começa o jogador seguinte a quem virou a carta, no sentido anti-horário.
  room.currentPlayer = (flipper - 1 + room.players.length) % room.players.length;
  log(room, `Rodada ${room.round}: ${room.players[dealer].name} distribuiu 6 cartas e ${room.players[flipper].name} virou ${cardLabel(starter)}.`, 'round');
  log(room, `${room.players[room.currentPlayer].name} começa no sentido anti-horário.`, 'turn');
}

function drawOne(room) {
  if (!room.deck.length) recycleDiscard(room);
  if (!room.deck.length) throw new Error('Não há cartas disponíveis para compra.');
  return room.deck.pop();
}

function recycleDiscard(room) {
  if (room.discard.length <= 1) return;
  const top = room.discard.pop();
  room.deck = shuffle(room.discard);
  room.discard = [top];
  log(room, 'O monte de descarte foi reembaralhado para formar um novo monte de compra.', 'system');
}

function drawCards(room, player, count) {
  const cards = [];
  for (let i=0; i<count; i++) cards.push(drawOne(room));
  player.hand.push(...cards);
  return cards;
}

function topCard(room) {
  return room.discard[room.discard.length-1] || null;
}

function legalCard(room, card, player) {
  if (!card || !player) return false;
  if (room.pendingSeven > 0) return card.rank === '7';
  if (room.requestedSuit) return card.rank === 'J' || card.suit === room.requestedSuit;
  const top = topCard(room);
  if (!top) return true;
  return card.rank === 'J' || card.rank === top.rank || card.suit === top.suit;
}

function ensureTurn(room, playerId) {
  if (room.status === 'playing' && room.players.some(p => !p.connected)) throw new Error('A partida está pausada até todos os jogadores reconectarem.');
  if (room.status !== 'playing') throw new Error('A rodada não está em andamento.');
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) throw new Error('Jogador não encontrado.');
  if (idx !== room.currentPlayer) throw new Error('Não é a sua vez.');
  return idx;
}

function declare(room, playerId, type) {
  if (room.status === 'playing' && room.players.some(p => !p.connected)) throw new Error('A partida está pausada até todos os jogadores reconectarem.');
  if (room.status !== 'playing') throw new Error('A rodada não está em andamento.');
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) throw new Error('Jogador não encontrado.');
  const p = room.players[idx];
  if (!['mau-mau','batendo'].includes(type)) throw new Error('Declaração inválida.');

  // Na V11, a queima pode ser feita fora da vez. Por isso também permitimos
  // o anúncio imediatamente antes de uma queima válida, mesmo fora da vez.
  const isTurn = room.players[room.currentPlayer]?.id === p.id;
  const hasBurnOpportunity = canBurnMatch(room,p).length > 0;
  if (!isTurn && !hasBurnOpportunity) throw new Error('Não é a sua vez.');

  if (type === 'mau-mau') {
    const canReachOneByBurn = p.hand.length === 3 && hasBurnOpportunity;
    if (p.hand.length !== 2 && !canReachOneByBurn) {
      throw new Error('O aviso Mau-Mau deve ser feito antes de uma jogada que deixe você com apenas uma carta.');
    }
  }
  if (type === 'batendo') {
    if (p.hand.length !== 2 || !hasBurnOpportunity) {
      throw new Error('Mau-Mau batendo exige duas cartas que possam encerrar a rodada pela queima: uma igual à mesa e outra compatível.');
    }
  }
  p.declaration = type;
  log(room, `${p.name} anunciou ${type === 'batendo' ? '“Mau-Mau batendo/queimando!”' : '“Mau-Mau!”'}`, 'mau');
}

function removeCard(player, cardId) {
  const idx = player.hand.findIndex(c => c.id === cardId);
  if (idx < 0) throw new Error('Carta não encontrada na mão.');
  return player.hand.splice(idx,1)[0];
}

function applyMauMauPenaltyIfNeeded(room, player, beforeCount, afterCount) {
  if (beforeCount === 2 && afterCount === 1) {
    if (player.declaration !== 'mau-mau') {
      const n = room.rules.mauMauPenalty;
      drawCards(room, player, n);
      log(room, `${player.name} esqueceu de anunciar Mau-Mau e comprou ${n} carta(s) de penalidade.`, 'penalty');
    }
  }
  player.declaration = null;
}

function playCard(room, playerId, cardId, chosenSuit=null, opts={}) {
  const idx = ensureTurn(room, playerId);
  const player = room.players[idx];
  const card = player.hand.find(c => c.id === cardId);
  if (!card) throw new Error('Carta não encontrada.');
  if (!legalCard(room, card, player)) throw new Error('Essa carta não pode ser jogada agora.');

  if (card.rank === 'J' && player.hand.length > 1 && !SUITS.includes(chosenSuit)) {
    throw new Error('Escolha um naipe ao jogar o Valete.');
  }
  const before = player.hand.length;
  const played = removeCard(player, cardId);
  room.discard.push(played);
  room.requestedSuit = null;
  // Toda carta jogada normalmente abre uma oportunidade de queima para OUTRO jogador.
  // A própria pessoa que baixou a carta não pode queimar a sua própria jogada.
  room.lastPlayedById = player.id;
  room.burnTopCardId = played.id;
  log(room, `${player.name} jogou ${cardLabel(played)}.`, isSpecial(played) ? 'special' : 'play');

  if (played.rank === 'J' && player.hand.length > 0) {
    room.requestedSuit = chosenSuit;
    log(room, `${player.name} escolheu ${suitLabel(chosenSuit)}.`, 'special');
  }

  // Se a carta for usada como continuação de uma queima, esta jogada encerra o turno.
  const wasContinuation = room.continuationPlayerId === player.id;
  if (wasContinuation) room.continuationPlayerId = null;

  // Efeitos especiais. O 7 tem precedência e é resolvido como cadeia.
  if (played.rank === '7') {
    room.pendingSeven += 2;
    if (player.hand.length === 0) {
      // Se já existe um vencedor, este 7 faz apenas parte da resolução da penalidade final.
      if (room.finishPendingSeven && room.winnerId) {
        player.finishedRound = true;
        log(room, `${player.name} rebateu o 7 durante a resolução final e ficou sem cartas.`, 'special');
        const target = nextEligiblePenaltyTarget(room, idx);
        if (target < 0) {
          room.finishPendingSeven = false;
          finalizeRound(room);
        } else {
          room.currentPlayer = target;
        }
        return;
      }
      room.winnerId = player.id;
      room.lastWinnerCard = played;
      player.finishedRound = true;
      room.finishPendingSeven = true;
      log(room, `${player.name} bateu com um 7. A penalidade de ${room.pendingSeven} carta(s) ainda precisa ser resolvida.`, 'winner');
      const target = nextEligiblePenaltyTarget(room, idx);
      if (target < 0) {
        room.finishPendingSeven = false;
        finalizeRound(room);
      } else {
        room.currentPlayer = target;
      }
      return;
    }
    room.currentPlayer = nextIndex(room, idx, 1);
    applyMauMauPenaltyIfNeeded(room, player, before, player.hand.length);
    return;
  }

  if (player.hand.length === 0) {
    room.winnerId = player.id;
    room.lastWinnerCard = played;
    player.finishedRound = true;
    applyMauMauPenaltyIfNeeded(room, player, before, 0);
    finalizeRound(room);
    return;
  }

  applyMauMauPenaltyIfNeeded(room, player, before, player.hand.length);

  if (played.rank === 'A') {
    const skipped = nextIndex(room, idx, 1);
    const next = nextIndex(room, idx, 2);
    log(room, `${room.players[skipped].name} perdeu a vez por causa do Ás.`, 'special');
    room.currentPlayer = next;
  } else if (played.rank === 'Q') {
    room.direction *= -1;
    const ativos = activePlayers(room);
    if (ativos.length === 2) {
      // Regra do Mau-Mau desta versão: com apenas dois jogadores, inverter o
      // sentido equivale a devolver a vez a quem jogou a Dama.
      room.currentPlayer = idx;
      log(room, `A Dama inverteu o sentido para ${room.direction === 1 ? 'horário' : 'anti-horário'} e, com 2 jogadores, ${player.name} joga novamente.`, 'special');
    } else {
      room.currentPlayer = nextIndex(room, idx, 1);
      log(room, `A Dama inverteu o sentido para ${room.direction === 1 ? 'horário' : 'anti-horário'}.`, 'special');
    }
  } else if (played.rank === 'K') {
    const target = previousIndex(room, idx);
    drawCards(room, room.players[target], 1);
    log(room, `${room.players[target].name} comprou 1 carta por causa do Rei.`, 'penalty');
    room.currentPlayer = nextIndex(room, idx, 1);
  } else if (played.rank === '8') {
    const target = previousIndex(room, idx);
    drawCards(room, room.players[target], 2);
    log(room, `${room.players[target].name} comprou 2 cartas por causa do Oito.`, 'penalty');
    room.currentPlayer = nextIndex(room, idx, 1);
  } else {
    room.currentPlayer = nextIndex(room, idx, 1);
  }
}

function burnFollowUpLegal(baseCard, nextCard) {
  if (!baseCard || !nextCard) return false;
  return nextCard.rank === 'J' || nextCard.rank === baseCard.rank || nextCard.suit === baseCard.suit;
}

// V11 — QUEIMA DINÂMICA
// Quando OUTRO jogador coloca uma carta na mesa e você possui exatamente a
// mesma carta (mesmo valor + mesmo naipe), pode interromper a ordem normal,
// baixar a sua carta igual e, obrigatoriamente, baixar mais UMA carta compatível.
// A segunda carta pode ter o mesmo valor, o mesmo naipe ou ser um Valete.
function burnMatch(room, playerId, cardId) {
  if (room.status === 'playing' && room.players.some(p => !p.connected)) throw new Error('A partida está pausada até todos os jogadores reconectarem.');
  if (room.status !== 'playing') throw new Error('A rodada não está em andamento.');
  if (!room.rules.burnEnabled) throw new Error('A regra de queimar cartas está desativada.');
  if (room.pendingSeven > 0) throw new Error('Não é permitido queimar durante uma penalidade de 7.');
  if (room.continuationPlayerId) throw new Error('Aguarde a queima atual ser concluída.');

  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) throw new Error('Jogador não encontrado.');
  const player = room.players[idx];
  if (!player.connected || player.finishedRound) throw new Error('Jogador não pode realizar a queima agora.');

  const top = topCard(room);
  const first = player.hand.find(c => c.id === cardId);
  if (!first) throw new Error('Carta não encontrada na mão.');
  if (!top || room.burnTopCardId !== top.id || !room.lastPlayedById) {
    throw new Error('Não há uma carta recém-jogada disponível para queima.');
  }
  if (room.lastPlayedById === player.id) throw new Error('Você não pode queimar a carta que acabou de jogar.');
  if (isSpecial(first)) throw new Error('Não é permitido queimar Ás, Dama, Valete, Rei, Oito ou Sete.');
  if (!sameCard(first, top)) throw new Error('Para queimar, sua primeira carta deve ser exatamente igual à carta da mesa: mesmo valor e mesmo naipe.');

  const followUps = player.hand.filter(c => c.id !== first.id && burnFollowUpLegal(first, c));
  if (!followUps.length) {
    throw new Error('Para queimar, você precisa ter também uma segunda carta do mesmo valor, do mesmo naipe ou um Valete.');
  }

  if (player.hand.length === 2 && player.declaration !== 'batendo') {
    throw new Error('Para encerrar com duas cartas na queima, anuncie “Mau-Mau batendo/queimando” antes.');
  }

  const interrupted = room.players[room.currentPlayer];
  removeCard(player, first.id);
  room.discard.push(first);
  room.requestedSuit = null;
  player.justDrawnCardId = null;

  // A queima toma a vez para quem queimou. Durante a continuação ninguém mais
  // pode atravessar a jogada. A segunda carta é obrigatória.
  room.currentPlayer = idx;
  room.continuationPlayerId = player.id;
  room.lastPlayedById = player.id;
  room.burnTopCardId = null;

  const interruptedText = interrupted && interrupted.id !== player.id
    ? ` e interrompeu a vez de ${interrupted.name}`
    : '';
  log(room, `${player.name} QUEIMOU ${cardLabel(first)}${interruptedText}. Agora deve jogar mais uma carta do mesmo valor/naipe ou um Valete.`, 'burn');
}

// Mantido como alias para não quebrar clientes antigos durante a atualização.
function burnPair(room, playerId, cardId) {
  return burnMatch(room, playerId, cardId);
}

function endBurnContinuation(room, playerId) {
  const idx = ensureTurn(room, playerId);
  const p = room.players[idx];
  if (room.continuationPlayerId !== p.id) throw new Error('Você não está em uma continuação de queima.');
  throw new Error('Nesta regra de queima, a segunda carta é obrigatória. Jogue uma carta do mesmo valor, do mesmo naipe ou um Valete.');
}

function nextEligiblePenaltyTarget(room, fromIdx) {
  const candidates = room.players.filter(p => !p.finishedRound);
  if (!candidates.length) return -1;
  return nextIndex(room, fromIdx, 1, true);
}

function drawAction(room, playerId) {
  const idx = ensureTurn(room, playerId);
  const p = room.players[idx];
  // Ao iniciar uma compra, encerra-se a janela de queima da jogada anterior.
  room.burnTopCardId = null;
  if (room.continuationPlayerId === p.id) {
    throw new Error('Após uma queima, jogue uma carta adicional ou encerre a continuação; não é permitido comprar.');
  }

  if (room.pendingSeven > 0) {
    const count = room.pendingSeven;
    drawCards(room, p, count);
    room.pendingSeven = 0;
    log(room, `${p.name} comprou ${count} carta(s) pela cadeia de 7 e perdeu a vez.`, 'penalty');

    if (room.finishPendingSeven && room.winnerId) {
      room.finishPendingSeven = false;
      finalizeRound(room);
    } else {
      room.currentPlayer = nextIndex(room, idx, 1);
    }
    return;
  }

  // V13: o jogador pode optar por comprar mesmo tendo carta válida na mão.
  // Porém, só pode comprar UMA carta na jogada normal. A compra é o requisito
  // para habilitar o botão "Passar a vez".
  if (p.justDrawnCardId) {
    throw new Error('Você já comprou uma carta nesta vez. Jogue a carta comprada, se possível, ou passe a vez.');
  }

  const drawn = drawOne(room);
  p.hand.push(drawn);
  p.justDrawnCardId = drawn.id;
  log(room, `${p.name} comprou 1 carta. Agora pode jogar a carta comprada, se ela for válida, ou passar a vez.`, 'draw');

  if (legalCard(room, drawn, p)) {
    log(room, `A carta comprada por ${p.name} pode ser jogada ou o jogador pode passar a vez.`, 'turn');
  } else {
    log(room, `A carta comprada por ${p.name} não pode ser jogada. O jogador deve passar a vez.`, 'turn');
  }
}

// V13 — COMPRA OBRIGATÓRIA PARA PASSAR
// O jogador pode optar por passar a vez, mas somente DEPOIS de comprar uma carta
// naquela jogada normal. Isso vale inclusive quando ele já possuía carta válida.
// Exceções: não pode usar Passar para escapar da penalidade do 7 nem durante a
// segunda carta obrigatória de uma queima dinâmica.
function passTurn(room, playerId) {
  const idx = ensureTurn(room, playerId);
  const p = room.players[idx];

  if (room.pendingSeven > 0) {
    throw new Error('Não é possível passar a vez durante uma cadeia de 7. Rebate com outro 7 ou compre a penalidade.');
  }
  if (room.continuationPlayerId === p.id) {
    throw new Error('Não é possível passar a vez durante a continuação de uma queima. Jogue a segunda carta obrigatória.');
  }
  if (!p.justDrawnCardId) {
    throw new Error('Para passar a vez, primeiro compre 1 carta do monte.');
  }

  room.burnTopCardId = null;
  const keptCardId = p.justDrawnCardId;
  p.justDrawnCardId = null;
  p.declaration = null;

  const next = nextIndex(room, idx, 1);
  room.currentPlayer = next;
  room.lastPass = {
    playerId: p.id,
    keptCardId,
    nextPlayerId: room.players[next]?.id || null,
    at: Date.now(),
  };

  log(room, `${p.name} passou a vez. A carta comprada permaneceu na mão e agora é a vez de ${room.players[next]?.name || 'outro jogador'}.`, 'turn');
}

function passAfterDraw(room, playerId) {
  return passTurn(room, playerId);
}

function playDrawnCard(room, playerId, cardId, chosenSuit=null) {
  const idx = ensureTurn(room, playerId);
  const p = room.players[idx];
  if (p.justDrawnCardId !== cardId) throw new Error('Depois da compra, apenas a carta que acabou de ser comprada pode ser jogada.');
  p.justDrawnCardId = null;
  playCard(room, playerId, cardId, chosenSuit);
}

function finalizeRound(room) {
  const winner = room.players.find(p => p.id === room.winnerId);
  if (!winner) throw new Error('Vencedor da rodada não encontrado.');
  const double = room.lastWinnerCard?.rank === 'J';
  for (const p of room.players) {
    let points = p.id === winner.id ? 0 : p.hand.reduce((sum,c) => sum + cardPoints(c), 0);
    if (double && p.id !== winner.id) points *= 2;
    p.roundScore = points;
    p.roundHistory.push(points);
    p.score += points;
  }
  log(room, `${winner.name} venceu a rodada${double ? ' com Valete: os pontos dos demais foram dobrados' : ''}.`, 'winner');
  room.status = room.round >= room.rules.rounds ? 'finished' : 'between-rounds';
  room.currentPlayer = -1;
  room.pendingSeven = 0;
  room.requestedSuit = null;
  room.continuationPlayerId = null;
  room.lastPlayedById = null;
  room.burnTopCardId = null;
  room.finishPendingSeven = false;

  if (room.status === 'finished') {
    const min = Math.min(...room.players.map(p => p.score));
    const winners = room.players.filter(p => p.score === min);
    log(room, `Fim das 5 rodadas. ${winners.map(p=>p.name).join(' e ')} ${winners.length>1?'empataram':'venceu'} com ${min} ponto(s).`, 'champion');
  }
}

function canBurnMatch(room, player) {
  if (!room.rules.burnEnabled || room.status !== 'playing' || room.pendingSeven > 0 || room.continuationPlayerId) return [];
  if (!player || !player.connected || player.finishedRound) return [];
  const top = topCard(room);
  if (!top || room.burnTopCardId !== top.id || !room.lastPlayedById || room.lastPlayedById === player.id) return [];
  if (isSpecial(top)) return [];

  return player.hand.filter(first => {
    if (isSpecial(first) || !sameCard(first, top)) return false;
    return player.hand.some(second => second.id !== first.id && burnFollowUpLegal(first, second));
  });
}

function roomPublicState(room, viewerId) {
  const viewer = room.players.find(p => p.id === viewerId);
  const top = topCard(room);
  return {
    code: room.code,
    status: room.status,
    round: room.round,
    rounds: room.rules.rounds,
    direction: room.direction,
    requestedSuit: room.requestedSuit,
    pendingSeven: room.pendingSeven,
    currentPlayerId: room.currentPlayer >= 0 ? room.players[room.currentPlayer]?.id : null,
    topCard: top,
    deckCount: room.deck.length,
    rules: room.rules,
    connectedCount: room.players.filter(p => p.connected).length,
    paused: room.status === 'playing' && room.players.some(p => !p.connected),
    winnerId: room.winnerId,
    lastWinnerCard: room.lastWinnerCard,
    continuationPlayerId: room.continuationPlayerId,
    lastPass: room.lastPass,
    roundRoles: room.roundRoles,
    players: room.players.map(p => ({
      id:p.id,
      name:p.name,
      avatar:p.avatar,
      cardCount:p.hand.length,
      score:p.score,
      roundScore:p.roundScore,
      roundHistory:p.roundHistory,
      connected:p.connected,
      host:p.host,
      finishedRound:p.finishedRound,
      isBot:p.isBot,
    })),
    me: viewer ? {
      id: viewer.id,
      name: viewer.name,
      avatar: viewer.avatar,
      hand: viewer.hand,
      score: viewer.score,
      roundScore: viewer.roundScore,
      declaration: viewer.declaration,
      justDrawnCardId: viewer.justDrawnCardId || null,
      legalCardIds: room.status === 'playing' && room.players[room.currentPlayer]?.id === viewer.id
        ? (viewer.justDrawnCardId ? viewer.hand.filter(c => c.id === viewer.justDrawnCardId && legalCard(room,c,viewer)).map(c=>c.id) : viewer.hand.filter(c => legalCard(room,c,viewer)).map(c=>c.id))
        : [],
      burnableCardIds: room.status === 'playing'
        ? canBurnMatch(room,viewer).map(c=>c.id)
        : [],
      burnSecondRequired: room.continuationPlayerId === viewer.id,
    } : null,
    log: room.log.slice(-30),
  };
}

function cardLabel(card) {
  return `${rankLabel(card.rank)} de ${suitLabel(card.suit)}`;
}
function rankLabel(rank) {
  return ({A:'Ás',J:'Valete',Q:'Dama',K:'Rei'})[rank] || rank;
}
function suitLabel(suit) {
  return ({hearts:'Copas',diamonds:'Ouros',clubs:'Paus',spades:'Espadas'})[suit] || suit;
}

module.exports = {
  SUITS,RANKS,SPECIAL_RANKS,DEFAULT_RULES,
  createDeck,shuffle,cardPoints,isSpecial,sameCard,
  createRoom,addPlayer,reconnectPlayer,startRound,
  legalCard,declare,playCard,burnMatch,burnPair,endBurnContinuation,canBurnMatch,
  drawAction,passTurn,passAfterDraw,playDrawnCard,finalizeRound,
  roomPublicState,cardLabel,suitLabel,rankLabel,
  appendLog: log,
};

'use strict';

// Jogador automático do Mau-Mau.
// V11: entende a QUEIMA DINÂMICA — se outro jogador baixar uma carta exatamente
// igual a uma carta da máquina, e a máquina tiver uma segunda carta compatível,
// ela pode interromper a ordem, queimar a carta igual e completar com mais uma.
// V17: também entende CARTA DUPLA na própria vez, somente com cartas normais,
// e AÇÃO RÁPIDA quando a máquina não seria a próxima da vez.

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

function chooseSuit(hand) {
  const counts = Object.fromEntries(SUITS.map(s => [s, 0]));
  for (const c of hand || []) {
    if (c.rank !== 'J' && counts[c.suit] !== undefined) counts[c.suit] += 1;
  }
  return SUITS.slice().sort((a,b) => counts[b] - counts[a] || SUITS.indexOf(a) - SUITS.indexOf(b))[0];
}

function cardPriority(card, room, bot) {
  const opponents = room.players.filter(p => p.id !== bot.id && !p.finishedRound);
  const danger = opponents.some(p => p.hand.length <= 2);
  const base = ({A:25,'7':danger?80:38,'8':danger?65:32,K:danger?58:30,Q:28,J:12})[card.rank]
    ?? (Number(card.rank) || 0);
  return base;
}

function selectLegalCard(room, bot, Engine, legal) {
  if (!legal.length) return null;
  if (room.pendingSeven > 0) return legal.find(c => c.rank === '7') || null;
  if (bot.hand.length === 1) return legal[0];

  return legal.slice().sort((a,b) => {
    const pa = cardPriority(a, room, bot);
    const pb = cardPriority(b, room, bot);
    if (pb !== pa) return pb - pa;
    const suit = chooseSuit(bot.hand);
    return Number(b.suit === suit) - Number(a.suit === suit);
  })[0];
}

function declareIfNeeded(room, bot, Engine, cardsToRemove=1) {
  const after = bot.hand.length - cardsToRemove;
  if (after === 1) Engine.declare(room, bot.id, 'mau-mau');
}


function playDoubleChosen(room, bot, Engine, pair) {
  if (!pair?.cardIds?.length) return false;
  if (bot.hand.length === 2) Engine.declare(room, bot.id, 'batendo');
  else if (bot.hand.length === 3) Engine.declare(room, bot.id, 'mau-mau');

  const first = bot.hand.find(c => c.id === pair.cardIds[0]);
  const remaining = bot.hand.filter(c => !pair.cardIds.includes(c.id));
  const chosenSuit = first?.rank === 'J' && remaining.length > 0 ? chooseSuit(remaining) : null;
  Engine.playDoubleCard(room, bot.id, pair.cardIds[0], pair.cardIds[1], chosenSuit);
  return true;
}

function playChosen(room, bot, Engine, card, drawn=false) {
  declareIfNeeded(room, bot, Engine, 1);
  const chosenSuit = card.rank === 'J' && bot.hand.length > 1
    ? chooseSuit(bot.hand.filter(c => c.id !== card.id))
    : null;
  if (drawn) Engine.playDrawnCard(room, bot.id, card.id, chosenSuit);
  else Engine.playCard(room, bot.id, card.id, chosenSuit);
}

// Pode ser chamada mesmo quando NÃO é a vez do bot.
function takeBurnOpportunity(room, bot, Engine) {
  if (!room || !bot || room.status !== 'playing') return {action:'none'};
  const burnable = Engine.canBurnMatch(room, bot);
  if (!burnable.length) return {action:'none'};

  // Com apenas duas cartas, a queima + segunda carta encerra a mão.
  if (bot.hand.length === 2) Engine.declare(room, bot.id, 'batendo');

  const first = burnable[0];
  Engine.burnMatch(room, bot.id, first.id);
  return {action:'burn-match', card:first};
}


// Ação Rápida: uma única carta exatamente igual à recém-jogada, sem tomar a vez.
// O servidor usa atraso para dar aos jogadores humanos a chance de reagir primeiro.
function takeQuickActionOpportunity(room, bot, Engine) {
  if (!room || !bot || room.status !== 'playing') return {action:'none'};
  const quick = Engine.canQuickAction(room, bot);
  if (!quick.length) return {action:'none'};
  if (bot.hand.length === 2) Engine.declare(room, bot.id, 'mau-mau');
  const card = quick[0];
  Engine.quickAction(room, bot.id, card.id);
  return {action:'quick-action', card};
}

function takeTurn(room, bot, Engine) {
  if (!room || !bot || room.status !== 'playing') return {action:'none'};
  if (room.players[room.currentPlayer]?.id !== bot.id) return {action:'none'};

  // Segunda carta da queima dinâmica: é OBRIGATÓRIA.
  if (room.continuationPlayerId === bot.id) {
    const legal = bot.hand.filter(c => Engine.legalCard(room,c,bot));
    if (!legal.length) throw new Error('Máquina iniciou uma queima sem segunda carta compatível.');
    const card = selectLegalCard(room,bot,Engine,legal);
    playChosen(room,bot,Engine,card);
    return {action:'burn-second-card',card};
  }

  if (bot.justDrawnCardId) {
    const card = bot.hand.find(c => c.id === bot.justDrawnCardId);
    if (card && Engine.legalCard(room,card,bot)) {
      playChosen(room,bot,Engine,card,true);
      return {action:'play-drawn',card};
    }
    Engine.passAfterDraw(room,bot.id);
    return {action:'pass-drawn'};
  }

  if (room.pendingSeven > 0) {
    const seven = bot.hand.find(c => c.rank === '7');
    if (seven) {
      playChosen(room,bot,Engine,seven);
      return {action:'counter-seven',card:seven};
    }
    Engine.drawAction(room,bot.id);
    return {action:'draw-seven'};
  }

  const doubles = Engine.canPlayDouble(room, bot);
  if (doubles.length) {
    const pair = doubles.slice().sort((a,b) => {
      const ca = bot.hand.find(c => c.id === a.cardIds[0]);
      const cb = bot.hand.find(c => c.id === b.cardIds[0]);
      return cardPriority(cb,room,bot) - cardPriority(ca,room,bot);
    })[0];
    playDoubleChosen(room, bot, Engine, pair);
    return {action:'double',pair};
  }

  const legal = bot.hand.filter(c => Engine.legalCard(room,c,bot));
  if (!legal.length) {
    Engine.drawAction(room,bot.id);
    return {action:'draw'};
  }

  const card = selectLegalCard(room,bot,Engine,legal);
  playChosen(room,bot,Engine,card);
  return {action:'play',card};
}

module.exports = { chooseSuit, selectLegalCard, takeBurnOpportunity, takeQuickActionOpportunity, takeTurn };

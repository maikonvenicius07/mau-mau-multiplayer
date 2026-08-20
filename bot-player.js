'use strict';

// Jogador automático do Mau-Mau.
// Toda a decisão é tomada no servidor para que a mão dos outros jogadores
// continue protegida e para que o bot siga exatamente as mesmas regras.

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

function chooseSuit(hand) {
  const counts = Object.fromEntries(SUITS.map(s => [s, 0]));
  for (const c of hand || []) {
    if (c.rank !== 'J' && counts[c.suit] !== undefined) counts[c.suit] += 1;
  }
  return SUITS.slice().sort((a,b) => counts[b] - counts[a] || SUITS.indexOf(a) - SUITS.indexOf(b))[0];
}

function cardPriority(card, room, bot) {
  // Quanto maior, mais cedo o bot tenta usar a carta.
  // Ele guarda o Valete quando há alternativas, usa cartas de ataque quando
  // os adversários estão perto de bater e prefere descarregar cartas altas.
  const opponents = room.players.filter(p => p.id !== bot.id && !p.finishedRound);
  const danger = opponents.some(p => p.hand.length <= 2);
  const base = ({A:25,'7':danger?80:38,'8':danger?65:32,K:danger?58:30,Q:28,J:12})[card.rank]
    ?? (Number(card.rank) || 0);
  return base;
}

function selectLegalCard(room, bot, Engine, legal) {
  if (!legal.length) return null;

  // Em uma cadeia de 7 só existe uma escolha válida: outro 7.
  if (room.pendingSeven > 0) return legal.find(c => c.rank === '7') || null;

  // Se restar uma carta depois desta jogada, qualquer carta válida encerra a mão;
  // fora disso, o bot preserva J quando possível.
  if (bot.hand.length === 1) return legal[0];

  return legal.slice().sort((a,b) => {
    const pa = cardPriority(a, room, bot);
    const pb = cardPriority(b, room, bot);
    if (pb !== pa) return pb - pa;

    // Critério de desempate: favorece o naipe mais frequente na própria mão.
    const suit = chooseSuit(bot.hand);
    return Number(b.suit === suit) - Number(a.suit === suit);
  })[0];
}

function burnableCards(room, bot, Engine) {
  if (!room.rules.burnEnabled || room.pendingSeven > 0) return [];
  const specials = new Set(['A','7','8','J','Q','K']);
  return bot.hand.filter((c,i) => {
    if (specials.has(c.rank) || !Engine.legalCard(room,c,bot)) return false;
    return bot.hand.some((d,j) => j !== i && d.rank === c.rank && d.suit === c.suit);
  }).filter((c,i,arr) => arr.findIndex(x => x.rank === c.rank && x.suit === c.suit) === i);
}

function declareIfNeeded(room, bot, Engine, cardsToRemove=1, burning=false) {
  const after = bot.hand.length - cardsToRemove;
  if (burning && bot.hand.length === 2 && after === 0) {
    Engine.declare(room, bot.id, 'batendo');
    return;
  }
  if (after === 1) Engine.declare(room, bot.id, 'mau-mau');
}

function playChosen(room, bot, Engine, card, drawn=false) {
  declareIfNeeded(room, bot, Engine, 1, false);
  const chosenSuit = card.rank === 'J' && bot.hand.length > 1
    ? chooseSuit(bot.hand.filter(c => c.id !== card.id))
    : null;
  if (drawn) Engine.playDrawnCard(room, bot.id, card.id, chosenSuit);
  else Engine.playCard(room, bot.id, card.id, chosenSuit);
}

function takeTurn(room, bot, Engine) {
  if (!room || !bot || room.status !== 'playing') return {action:'none'};
  if (room.players[room.currentPlayer]?.id !== bot.id) return {action:'none'};

  // Continuação após uma queima: o bot pode baixar UMA carta compatível ou encerrar.
  if (room.continuationPlayerId === bot.id) {
    const legal = bot.hand.filter(c => Engine.legalCard(room,c,bot));
    if (!legal.length) {
      Engine.endBurnContinuation(room,bot.id);
      return {action:'end-burn'};
    }
    const card = selectLegalCard(room,bot,Engine,legal);
    playChosen(room,bot,Engine,card);
    return {action:'play-continuation',card};
  }

  // Se acabou de comprar uma carta jogável, joga a carta comprada.
  if (bot.justDrawnCardId) {
    const card = bot.hand.find(c => c.id === bot.justDrawnCardId);
    if (card && Engine.legalCard(room,card,bot)) {
      playChosen(room,bot,Engine,card,true);
      return {action:'play-drawn',card};
    }
    Engine.passAfterDraw(room,bot.id);
    return {action:'pass-drawn'};
  }

  // Cadeia de 7: rebate se tiver outro 7; caso contrário, compra a penalidade.
  if (room.pendingSeven > 0) {
    const seven = bot.hand.find(c => c.rank === '7');
    if (seven) {
      playChosen(room,bot,Engine,seven);
      return {action:'counter-seven',card:seven};
    }
    Engine.drawAction(room,bot.id);
    return {action:'draw-seven'};
  }

  // Queima é priorizada porque descarrega duas cartas. Com duas cartas iguais,
  // o bot anuncia "Mau-Mau batendo" e encerra a rodada corretamente.
  const burnable = burnableCards(room,bot,Engine);
  if (burnable.length) {
    const card = selectLegalCard(room,bot,Engine,burnable);
    declareIfNeeded(room,bot,Engine,2,true);
    Engine.burnPair(room,bot.id,card.id);
    return {action:'burn',card};
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

module.exports = { chooseSuit, selectLegalCard, takeTurn };

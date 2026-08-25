'use strict';

// Jogador automático do Mau-Mau.
// V18: entende a QUEIMA FLEXÍVEL — se outro jogador baixar uma carta exatamente
// igual a uma carta da máquina, ela pode queimar mesmo sem possuir previamente
// uma segunda carta compatível. Depois escolhe entre continuar ou passar; se não
// houver continuação possível, compra uma carta e pode jogá-la ou guardá-la.
// Também entende CARTA DUPLA e AÇÃO RÁPIDA.

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

  const first = burnable[0];
  const finishable = Engine.canFinishBurn(room, bot).some(c => c.id === first.id);

  // Com duas cartas, se houver continuação válida a máquina tenta bater.
  // Se não houver, anuncia Mau-Mau, queima uma e depois terá de comprar.
  if (bot.hand.length === 2) {
    Engine.declare(room, bot.id, finishable ? 'batendo' : 'mau-mau');
  }

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

  // V18: após a queima, continuar é opcional.
  if (room.continuationPlayerId === bot.id) {
    if (bot.justDrawnCardId) {
      const drawn = bot.hand.find(c => c.id === bot.justDrawnCardId);
      // Estratégia simples: preserve o Valete comprado quando houver outras cartas,
      // demonstrando a mesma opção oferecida ao jogador humano.
      if (drawn && Engine.legalCard(room,drawn,bot) && !(drawn.rank === 'J' && bot.hand.length > 1)) {
        playChosen(room,bot,Engine,drawn,true);
        return {action:'burn-play-drawn',card:drawn};
      }
      Engine.passTurn(room,bot.id);
      return {action:'burn-pass-drawn',card:drawn||null};
    }

    const legal = bot.hand.filter(c => Engine.legalCard(room,c,bot));
    if (!legal.length) {
      Engine.drawAction(room,bot.id);
      return {action:'burn-draw'};
    }

    // Se a melhor continuação for um Valete e a máquina ainda tiver outras cartas,
    // ela prefere guardar o Valete e passar. Caso contrário, continua a queima.
    const card = selectLegalCard(room,bot,Engine,legal);
    if (card?.rank === 'J' && bot.hand.length > 1) {
      Engine.passTurn(room,bot.id);
      return {action:'burn-pass-keep-j',card};
    }
    playChosen(room,bot,Engine,card);
    return {action:'burn-second-card',card};
  }

  if (bot.justDrawnCardId) {
    const drawn = bot.hand.find(c => c.id === bot.justDrawnCardId);
    const legal = bot.hand.filter(c => Engine.legalCard(room,c,bot));

    // V29: o bot também pode escolher qualquer carta válida depois da compra.
    // Se comprou um Valete e tiver outra opção válida, preserva o J para tentar
    // uma batida futura com pontuação dobrada.
    const alternatives = legal.filter(c => c.id !== drawn?.id);
    if (drawn?.rank === 'J' && bot.hand.length > 1) {
      if (alternatives.length) {
        const card = selectLegalCard(room,bot,Engine,alternatives);
        playChosen(room,bot,Engine,card,false);
        return {action:'play-other-after-draw',card,kept:drawn};
      }
      Engine.passAfterDraw(room,bot.id);
      return {action:'pass-keep-drawn-j',card:drawn};
    }

    if (legal.length) {
      const card = selectLegalCard(room,bot,Engine,legal);
      playChosen(room,bot,Engine,card,false);
      return {action:card.id===drawn?.id?'play-drawn':'play-other-after-draw',card};
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

'use strict';
// V53.2: o autor da carta do topo também pode usar Ação Rápida DEPOIS que
// terminar sua vez, enquanto o topo não mudar, mesmo após o próximo comprar.
const assert = require('node:assert/strict');
const E = require('../game-engine');
const card = (rank, suit, id) => ({ rank, suit, id, copy: 1 });

function scenario({ extraForA = false, withThird = false } = {}) {
  const r = E.createRoom('V532', { name: 'Jogador A', socketId: 'sA', token: 'tA' });
  E.addPlayer(r, { name: 'Jogador B', socketId: 'sB', token: 'tB' });
  if (withThird) E.addPlayer(r, { name: 'Jogador C', socketId: 'sC', token: 'tC' });
  const [a, b, c] = r.players;
  r.status = 'playing'; r.round = 1; r.direction = -1;
  r.currentPlayer = 1; // Jogador B encerra uma jogada anterior com 6 de Copas.
  r.discard = [card('5', 'hearts', 'prev-five')];
  r.deck = [card('8', 'spades', 'reserve'), card('3', 'diamonds', 'drawn-by-B')];
  for (const p of r.players) {
    p.connected = true; p.hand = []; p.finishedRound = false;
    p.declaration = null; p.justDrawnCardId = null;
  }
  b.hand = [card('6', 'hearts', 'prior-six'), card('9', 'hearts', 'b-can-play'), card('2', 'clubs', 'b-rest')];
  a.hand = [card('6', 'hearts', 'burn-six'), card('4', 'hearts', 'first-four'), card('4', 'hearts', 'second-four')];
  if (c) c.hand = [card('9', 'clubs', 'c-one'), card('2', 'diamonds', 'c-two')];
  if (extraForA) a.hand.push(card('3', 'clubs', 'a-rest'));

  E.playCard(r, b.id, 'prior-six');
  assert.equal(r.players[r.currentPlayer].id, a.id);
  E.burnMatch(r, a.id, 'burn-six');
  assert.equal(r.continuationPlayerId, a.id);
  if (!extraForA) E.declare(r, a.id, 'mau-mau'); // 2 -> 1: anúncio exigido pela regra.
  E.playCard(r, a.id, 'first-four');
  assert.equal(r.players[r.currentPlayer].id, c ? c.id : b.id, 'a vez normal passa ao próximo jogador');
  assert.equal(r.discard.at(-1).id, 'first-four');
  assert.equal(r.reactionSourcePlayerId, a.id, 'A é autor do 4 de Copas no topo');
  assert.equal(a.hand.some(x => x.id === 'second-four'), true);
  return { r, a, b, c };
}

(async () => {
  // 1. Reproduz exatamente o exemplo, com B comprando e demorando para jogar.
  {
    const { r, a, b } = scenario();
    assert.equal(E.canQuickAction(r, b).length, 0, 'B está na vez, não pode usar Ação Rápida');
    E.drawAction(r, b.id);
    const topId = r.discard.at(-1).id;
    const bTurn = r.currentPlayer;
    assert.equal(topId, 'first-four', 'a compra não substituiu o topo');
    assert.equal(b.justDrawnCardId, 'drawn-by-B', 'B ainda deve decidir jogar ou passar');
    await new Promise(resolve => setTimeout(resolve, 65));
    assert.deepEqual(E.canQuickAction(r, a).map(c => c.id), ['second-four'], 'A deve poder reagir ao seu próprio 4 de Copas depois de terminar a vez');
    assert.deepEqual(E.roomPublicState(r, a.id).me.quickActionCardIds, ['second-four'], 'o cliente deve receber o ID para habilitar o botão ⚡');
    E.quickAction(r, a.id, 'second-four');
    assert.equal(r.discard.at(-1).id, 'second-four');
    assert.equal(r.winnerId, a.id, 'o último 4 de Copas encerra a rodada, conforme a regra atual');
    assert.notEqual(r.status, 'playing', 'a rodada termina quando A fica sem cartas');
    assert.throws(() => E.quickAction(r, a.id, 'second-four'), /rodada não está em andamento/i, 'a carta não pode ser enviada duas vezes');
    assert.equal(r.discard.filter(c => c.id === 'second-four').length, 1, 'sem duplicidade no descarte');
    assert.equal(bTurn, 1);
  }
  // 2. Ação Rápida sem encerrar a rodada: B permanece na vez após a compra.
  {
    const { r, a, b } = scenario({ extraForA: true });
    E.drawAction(r, b.id);
    const current = r.currentPlayer;
    const decision = b.justDrawnCardId;
    E.quickAction(r, a.id, 'second-four');
    assert.equal(r.currentPlayer, current, 'Jogada Rápida não rouba a vez de B');
    assert.equal(b.justDrawnCardId, decision, 'compra de B permanece pendente para jogar/passar');
    assert.equal(r.reactionTopCardId, null, 'primeira reação fecha a janela do topo anterior');
    assert.throws(() => E.quickAction(r, a.id, 'second-four'), /indisponível/i, 'reação duplicada deve ser rejeitada');
    E.playCard(r, b.id, 'b-can-play');
    assert.equal(r.discard.at(-1).id, 'b-can-play', 'B pode concluir sua jogada válida após a reação');
  }
  // 3. Corrida B primeiro: carta nova toma o topo, a reação atrasada é recusada.
  {
    const { r, a, b } = scenario();
    E.drawAction(r, b.id);
    E.playCard(r, b.id, 'b-can-play');
    assert.equal(r.discard.at(-1).id, 'b-can-play');
    assert.deepEqual(E.canQuickAction(r, a), []);
    assert.throws(() => E.quickAction(r, a.id, 'second-four'), /indisponível/i);
    assert.equal(a.hand.some(c => c.id === 'second-four'), true, 'a carta de A não pode desaparecer');
  }
  // 4. Corrida A primeiro: se A bate, o clique atrasado de B é recusado.
  {
    const { r, a, b } = scenario();
    E.drawAction(r, b.id);
    E.quickAction(r, a.id, 'second-four');
    assert.throws(() => E.playCard(r, b.id, 'b-can-play'), /rodada não está em andamento/i);
    assert.equal(r.discard.at(-1).id, 'second-four');
    assert.equal(r.discard.filter(c => c.id === 'second-four').length, 1);
  }
  // 5. Eventos de dois sockets chegando quase juntos são validados em ordem:
  // a segunda ação sempre vê a carta do topo/estado já atualizado.
  for (let i = 0; i < 30; i++) {
    const { r, a, b } = scenario();
    E.drawAction(r, b.id);
    const results = [];
    const aJob = () => new Promise(resolve => setImmediate(() => {
      try { E.quickAction(r, a.id, 'second-four'); results.push('A:ok'); }
      catch (e) { results.push('A:erro'); }
      resolve();
    }));
    const bJob = () => new Promise(resolve => setImmediate(() => {
      try { E.playCard(r, b.id, 'b-can-play'); results.push('B:ok'); }
      catch (e) { results.push('B:erro'); }
      resolve();
    }));
    if (i % 2 === 0) await Promise.all([aJob(), bJob()]);
    else await Promise.all([bJob(), aJob()]);
    assert.equal(results.filter(x => x.endsWith(':ok')).length, 1, 'apenas ação ainda válida deve ser aplicada');
    assert.equal(r.discard.filter(c => c.id === 'second-four').length <= 1, true);
    const aHasCard = a.hand.some(c => c.id === 'second-four');
    const discarded = r.discard.some(c => c.id === 'second-four');
    assert.notEqual(aHasCard, discarded, 'o segundo 4♥ está em exatamente um lugar');
  }
  // 6. Mesmo A tendo a carta idêntica, não pode usar Ação Rápida DURANTE sua vez.
  {
    const { r, a, b } = scenario();
    E.drawAction(r, b.id); E.passTurn(r, b.id);
    assert.equal(r.players[r.currentPlayer].id, a.id);
    assert.deepEqual(E.canQuickAction(r, a), [], 'jogador da vez usa apenas ações normais');
    assert.equal(r.reactionTopCardId, 'first-four', 'o passe não altera o topo');
  }
  // 7. Com três jogadores, após comprar/passar sem descartar, o autor
  // continua habilitado se ainda estiver fora da vez.
  {
    const { r, a, b, c } = scenario({ withThird: true });
    assert.equal(r.players[r.currentPlayer].id, c.id);
    E.drawAction(r, c.id);
    E.passTurn(r, c.id);
    assert.equal(r.players[r.currentPlayer].id, b.id);
    assert.equal(r.discard.at(-1).id, 'first-four');
    assert.deepEqual(E.canQuickAction(r, a).map(c => c.id), ['second-four']);
    E.quickAction(r, a.id, 'second-four');
    assert.equal(r.winnerId, a.id);
  }
  // 8. Na cadeia de 7 e na continuação de Queima, Ação Rápida segue proibida.
  {
    const { r, a } = scenario();
    r.pendingSeven = 2;
    assert.deepEqual(E.canQuickAction(r, a), []);
    r.pendingSeven = 0; r.continuationPlayerId = r.players[r.currentPlayer].id;
    assert.deepEqual(E.canQuickAction(r, a), []);
  }
  console.log('✓ V53.2: autor do topo, compra com atraso, turno preservado, corridas de ações e restrições.');
})().catch(e => { console.error(e); process.exitCode = 1; });

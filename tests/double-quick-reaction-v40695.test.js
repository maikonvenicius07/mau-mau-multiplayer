'use strict';
// V40.69.5 — Uma Carta Dupla rejeitada não pode fechar a janela de Ação Rápida.
const assert = require('node:assert/strict');
const E = require('../game-engine');
const card = (rank, suit, id) => ({ rank, suit, id, copy: 1 });

function room(size=3, { opening=false }={}) {
  const r = E.createRoom('V40695', { name: 'Jogador 0', token: 't0', socketId: 's0' });
  for (let i=1;i<size;i++) E.addPlayer(r, { name: `Jogador ${i}`, token: `t${i}`, socketId: `s${i}` });
  r.status = 'playing';
  r.round = 1;
  r.currentPlayer = 0;
  r.direction = -1;
  r.discard = [card('5', 'hearts', 'top-before')];
  r.deck = [card('3','clubs','draw-a'),card('4','clubs','draw-b'),card('6','clubs','draw-c')];
  r.players.forEach(p=>{p.hand=[card('3','spades', `other-${p.id}`)];p.connected=true;p.finishedRound=false;p.declaration=null;p.justDrawnCardId=null;});
  const active = r.players[0];
  const reactor = r.players[1];
  active.hand = [card('5','hearts','pair-a'),card('5','hearts','pair-b')];
  reactor.hand = [card('5','hearts','quick-5'),card('7','clubs','keep-7')];
  r.reactionTopCardId = r.discard.at(-1).id;
  r.burnTopCardId = r.reactionTopCardId;
  r.reactionSourcePlayerId = opening ? null : r.players[size-1].id;
  r.openingReaction = opening;
  r.reactionNextPlayerId = active.id;
  assert.deepEqual(E.canQuickAction(r,reactor).map(c=>c.id),['quick-5']);
  return {r, active, reactor};
}

function assertRejectedWithoutChange(r, op, expected, label) {
  const state = JSON.stringify(r);
  assert.throws(op, expected, label);
  assert.equal(JSON.stringify(r), state, `${label}: jogada rejeitada não pode alterar descarte, turno, reação, log, mãos, pontuação ou contadores`);
  assert.deepEqual(E.canQuickAction(r, r.players[1]).map(c=>c.id), ['quick-5'], `${label}: a Ação Rápida deve continuar habilitada no cliente`);
  assert.deepEqual(E.roomPublicState(r,r.players[1].id).me.quickActionCardIds,['quick-5'], `${label}: o estado enviado pelo servidor deve manter o botão de Ação Rápida`);
}

let cases = 0;
// Provar que a falha ocorre sem depender da quantidade de participantes.
for (const n of [2,3,4,5]) {
  const {r, active, reactor} = room(n);
  assertRejectedWithoutChange(r, ()=>E.playDoubleCard(r,active.id,'pair-a','pair-b'), /anuncie antes/i, `sem anúncio (${n} jogadores)`);
  E.quickAction(r, reactor.id, 'quick-5');
  assert.equal(r.discard.at(-1).id, 'quick-5', 'o outro participante deve conseguir executar a Ação Rápida');
  assert.equal(r.status, 'playing', 'o reator ainda tem outra carta');
  assert.equal(r.currentPlayer, 0, 'a Ação Rápida preserva o turno original');
  cases++;
}

// Durante a abertura, sem autor da carta virada, o mesmo contrato deve valer.
{
  const {r,active,reactor} = room(3,{opening:true});
  assertRejectedWithoutChange(r, ()=>E.playDoubleCard(r,active.id,'pair-a','pair-b'), /anuncie antes/i, 'dupla rejeitada na abertura');
  assert.equal(r.openingReaction, true);
  E.quickAction(r,reactor.id,'quick-5');
  assert.equal(r.discard.at(-1).id,'quick-5');
  cases++;
}

// Comprar não altera o topo; clique inválido em ×2 após a compra também não pode fechar a reação.
{
  const {r,active,reactor} = room(3);
  E.drawAction(r, active.id);
  // A mão agora tem 3 cartas, portanto o ×2 seria válido e cobraria Mau-Mau. Forçamos
  // escassez controlada após a compra para testar o segundo motivo de rejeição.
  r.deck = [];
  r.rules.mauMauPenalty = 3; // apenas duas cartas da dupla seriam recicláveis
  assertRejectedWithoutChange(r, ()=>E.playDoubleCard(r,active.id,'pair-a','pair-b'), /Não há cartas suficientes/i, 'dupla rejeitada por escassez depois da compra');
  assert.deepEqual(E.canQuickAction(r,reactor).map(c=>c.id),['quick-5']);
  // A reação continua habilitada, mas sua execução exigiria cartas suficientes
  // para a penalidade configurada; não alteramos essa regra nesta versão.
  cases++;
}

// Passes sem substituição do topo também não anulam a reação. Após passar, quem
// assumiu o turno não pode executar Ação Rápida fora da vez.
{
  const {r,active,reactor} = room(4);
  E.drawAction(r,active.id);
  E.passTurn(r,active.id);
  assert.equal(r.currentPlayer,3);
  assert.deepEqual(E.canQuickAction(r,reactor).map(c=>c.id),['quick-5']);
  assert.equal(r.reactionTopCardId,'top-before');
  E.quickAction(r,reactor.id,'quick-5');
  assert.equal(r.currentPlayer,3);
  cases++;
}

// Outras tentativas rejeitadas não podem consumir a oportunidade: cartas não
// idênticas, especiais, par incorreto, jogador sem vez ou regra desabilitada.
for (const [label, mutate, error] of [
  ['pares diferentes', r=>{r.players[0].hand[1]=card('6','hearts','pair-b');}, /cartas idênticas/i],
  ['carta especial', r=>{r.players[0].hand=[card('A','hearts','pair-a'),card('A','hearts','pair-b')];}, /cartas especiais/i],
  ['regra desativada', r=>{r.rules.doubleCardEnabled=false;}, /desativada/i],
  ['carta inexistente', ()=>{}, /Selecione duas cartas/i],
]) {
  const {r,active} = room(3);
  mutate(r);
  const first=label==='carta inexistente'?'nao-existe':'pair-a';
  assertRejectedWithoutChange(r,()=>E.playDoubleCard(r,active.id,first,'pair-b'),error,label);
  cases++;
}

// Com anúncio correto, uma dupla válida deve ser aceita e encerrar a reação antiga.
{
  const {r,active} = room(3);
  E.declare(r,active.id,'batendo');
  E.playDoubleCard(r,active.id,'pair-a','pair-b');
  assert.equal(r.status,'between-rounds');
  assert.equal(r.discard.at(-1).id,'pair-b');
  assert.equal(r.reactionTopCardId,null);
  assert.deepEqual(E.canQuickAction(r,r.players[1]),[]);
  cases++;
}

// Com uma carta remanescente, a dupla aceita deve atualizar a janela para o
// NOVO topo, avançar o turno normal e não manter a janela anterior por engano.
{
  const {r,active} = room(3);
  active.hand.push(card('2','spades','remaining'));
  E.declare(r,active.id,'mau-mau');
  E.playDoubleCard(r,active.id,'pair-a','pair-b');
  assert.equal(r.status,'playing');
  assert.equal(r.discard.at(-1).id,'pair-b');
  assert.equal(r.reactionTopCardId,'pair-b');
  assert.equal(r.reactionSourcePlayerId,active.id);
  assert.equal(r.currentPlayer,2,'turno normal anti-horário não deve ser modificado pela correção');
  assert.equal(r.players[0].hand.length,1);
  cases++;
}

// Queima na própria vez também deve continuar com suas restrições: durante a
// continuação, a regra proíbe a Carta Dupla e a Ação Rápida fica suspensa.
{
  const {r,active,reactor} = room(3);
  r.continuationPlayerId=active.id;
  const before=JSON.stringify(r);
  assert.throws(()=>E.playDoubleCard(r,active.id,'pair-a','pair-b'),/Resolva primeiro a Queima/i);
  assert.equal(JSON.stringify(r),before);
  assert.deepEqual(E.canQuickAction(r,reactor),[]);
  cases++;
}

console.log(`✓ V40.69.5: ${cases} cenários — reação preservada em ×2 rejeitado, abertura, compra/passe, anúncio, Queima e múltiplos jogadores.`);

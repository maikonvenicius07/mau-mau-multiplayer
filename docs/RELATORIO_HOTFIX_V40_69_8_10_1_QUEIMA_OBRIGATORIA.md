# Relatório técnico — MAU-MAU CANDEIAS V40.69.8.10.1

**Objeto:** impedir que o clique direto em uma carta normal idêntica ao topo contorne a obrigação de Queima, quando ela é a única opção legal na mão.

**Base:** ZIP enviado em 11/11/2026, pacote interno `40.69.8-rank.10` (V40.69.8.10).

## 1. Causa identificada no projeto

O cliente (`public/app.js`, `renderHand()` / `play()`) encaminha o clique direto na carta ao evento Socket.IO `playCard`. O botão Queima encaminha a ação ao evento `burnMatch`. O servidor (`server.js`) direciona esses eventos, respectivamente, a `Engine.playCard` e `Engine.burnMatch`.

No motor anterior (`game-engine.js`), `playCard()` apenas conferia se a carta era jogável por valor/naipe e fazia o descarte comum. Ele não identificava a situação em que uma carta normal **exatamente igual** à mesa era **a única jogável** da mão. Assim, o turno avançava e a regra existente de `burnMatch()` — continuar ou comprar uma carta antes de passar — deixava de ser aplicada.

O problema **não** era um erro do cálculo do ranking, de conexão Socket.IO ou da quantidade de cartas compradas. Era uma divergência na validação de duas portas de entrada para o mesmo tipo de jogada.

## 2. Regra preservada e condição estabelecida nesta correção

- **Queima obrigatória pelo clique direto:** somente na própria vez, regra `burnEnabled` ativa, sem cadeia de 7, sem outra continuação em curso, carta **normal** de mesmo valor e naipe do topo e **nenhuma outra carta legal** na mão.
- **Queima opcional:** há outra carta legal na mão (inclusive carta do mesmo valor, mesmo naipe ou Valete). O clique direto continua sendo jogada comum; o botão Queima continua explícito.
- **Não é Queima:** carta especial A/7/8/J/Q/K, regra desativada, jogada fora da vez, resposta a 7 ou continuação já ativa. Ação Rápida e ×2 Dupla continuam com seus próprios validadores.
- **Consequência existente da Queima:** mantém a vez com quem queimou para possibilitar uma segunda carta. Caso o jogador prefira **passar** sem jogar segunda carta, deve comprar **exatamente uma** carta antes. A compra não é automática no ato do descarte; fazer isso modificaria a regra atual.
- **Mau-Mau:** se a Queima reduzir a mão de 2 para 1 carta, continua exigido o anúncio prévio; tentativa irregular é rejeitada sem alterar cartas/turno.
- **Batida:** quando a Queima elimina a última carta, a rotina antiga de encerramento da rodada permanece válida.

## 3. Correção de código

Em `game-engine.js`:

- `playCard(room, playerId, cardId, ...)`: após validar a carta, verifica `mustBurnOnNormalPlay()`. Quando obrigatório, encaminha à própria `burnMatch()` **antes de modificar o estado**, evitando duplicações e divergências.
- `mustBurnOnNormalPlay(room, player, card)`: reutiliza `canBurnMatch()` e `legalCard()` para verificar se a carta idêntica é a única opção jogável. Não confia em sinalização enviada pelo navegador.
- `burnMatch()`/`drawAction()`/`passTurn()`: **sem alterações**; preservadas exatamente as regras de continuação, compra, passe e anúncio.
- O evento `socket.on('playCard')` em `server.js` continua chamando `Engine.playCard`. Assim, mesmo um cliente antigo ou uma chamada Socket.IO direta recebe a validação corrigida.

Outros arquivos:

- `public/index.html` e `docs/REGRAS.md`: esclarecem a condição de Queima obrigatória e o dever de comprar antes de passar.
- `tests/burn-direct-mandatory-v40698101.test.js`: novo teste de regressão dos dois caminhos, com 112 combinações de 2 a 5 jogadores / cartas / naipes e casos de exceção.
- `tests/opening-burn.test.js` e `tests/turn-integrity-v4042.test.js`: dados de testes antigos ajustados para manter **outra opção legal** quando pretendem validar descarte normal de carta idêntica. Não foi enfraquecida a verificação de turnos ou de reação.
- `CHANGELOG.md`: registro do hotfix.
- `docs/test-summary-v40698101.txt`: relação de todos os testes locais.

## 4. Testes realizados

| Verificação | Resultado |
|---|---|
| Caso 6♥, clique direto e botão Queima, mesmo resultado de cartas/turno | **Aprovado** |
| Compra obrigatória antes de PASSAR, uma única vez | **Aprovado** |
| Queima opcional com outra carta válida de mesmo valor/naipe ou Valete | **Aprovado** |
| 7 valores normais × 4 naipes × 4 quantidades de jogadores (112 cenários) | **Aprovado** |
| Exigência Mau-Mau, sem alteração do estado quando não anunciado | **Aprovado** |
| ×2 Dupla, cadeia de 7, segunda carta da Queima e Jogada Rápida | **Aprovado** |
| Estado do servidor apresentado a ambos os jogadores com turno sincronizado | **Aprovado (teste do motor)** |
| Mapeamento dos eventos `playCard` e `burnMatch` do Socket.IO | **Aprovado (verificação estática)** |
| Suíte completa executável | **182 aprovados; 0 falhas** |
| Checagem de sintaxe dos arquivos JS | **227 sem erro** |
| Integridade do `package-lock.json` | **Aprovada** |
| Integração real Socket.IO / PostgreSQL no Render / dispositivos físicos | **Não executada neste ambiente** |

O teste `tests/socketio-integration-v4063.test.js` ficou sem execução por ausência da dependência `socket.io-client` no ambiente local. **Não** foi homologado com sessões reais de clientes simultâneos nem no Render.

## 5. Homologação sugerida no Render

1. Com três jogadores, deixar no topo 6♥ e, na mão do jogador da vez, 6♥ + cartas incompatíveis.
2. Tocar diretamente em 6♥. Esperado: registro **QUEIMOU** no log, jogador permanece na vez e a compra fica exigida para passar.
3. Tentar PASSAR sem comprar. Esperado: bloqueio. Comprar uma carta; passar. Esperado: próximo jogador recebe a vez e carta comprada permanece na mão.
4. Repetir com o botão Queima e conferir o mesmo efeito.
5. Repetir quando existir outra carta válida; confirmar que toque direto permite jogada comum.
6. Jogar com ×2 Dupla, Ação Rápida e cadeia de 7. Finalizar a partida e conferir ranking e revanche.

**Banco e ranking:** não há migração nem alterações em `server.js`, `ranking-store.js` ou `room-snapshot-store.js`.

**Identificador de entrega:** V40.69.8.10.1. O `package.json` permanece em `40.69.8-rank.10`, pois dezenas de testes legados exigem esse texto exato. Isso não altera o comportamento nem as correções incluídas no ZIP.

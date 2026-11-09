# MAU-MAU CANDEIAS — Relatório técnico V40.69.5

**Data:** 09/11/2026  
**Base:** ZIP completo V40.69.4  
**Escopo:** Jogada Rápida, Queima e ×2 Dupla — correção pontual de ação rejeitada sem mudar as regras.

## 1. Problema confirmado

Em `game-engine.js`, função `playDoubleCard()`, `closeReaction(room)` era chamada após a validação do par e da carta legal, **mas antes** de verificar:

- se as duas últimas cartas exigiam o anúncio `mau-mau` ou `batendo`; e
- se havia cartas suficientes para a penalidade de Mau-Mau quando a dupla deixaria uma carta.

A chamada prematura apagava `reactionTopCardId`, `reactionSourcePlayerId`, `reactionNextPlayerId`, `burnTopCardId` e `openingReaction`. Quando o método lançava uma exceção por anúncio ausente, a carta no descarte não era alterada, mas a oportunidade de Ação Rápida de terceiros era cancelada, inclusive no estado enviado ao cliente.

O novo teste `tests/double-quick-reaction-v40695.test.js` **falhou antes da correção**, com o primeiro caso de dupla rejeitada com dois jogadores. A comparação do estado confirmou reação apagada, apesar de descarte e mãos inalterados.

## 2. Correção implementada

Em `game-engine.js`, `playDoubleCard()`:

1. Mantidas todas as verificações já existentes de turno, cartas, identidade do par, exclusão das especiais e legalidade sobre o topo.
2. Mantida a validação do anúncio obrigatório ao tentar bater com as duas últimas cartas.
3. Mantido `requireDrawCapacity(room, doubleMauMauDraw, 2)`, introduzido na V40.69.4 para impedir penalidades parcialmente aplicadas.
4. **Movido `closeReaction(room)` para depois das validações de anúncio e estoque e imediatamente antes da primeira alteração efetiva de mão/descarte.**
5. Preservados `openReaction()` após uma dupla aceita, `canQuickAction()`, `drawAction()`, `passTurn()`, `burnMatch()` e a ordem dos turnos.

A correção não altera o comportamento de uma Carta Dupla válida, a pontuação, os efeitos das cartas especiais nem a regra de não permitir Jogada Rápida durante continuação de Queima ou cadeia de Sete.

## 3. Verificações realizadas

- Teste novo com **14 cenários**: tentativas de dupla sem anúncio com 2, 3, 4 e 5 jogadores; abertura; compra com escassez de cartas para penalidade; passe após compra; par inválido; cartas especiais; regra desativada; carta ausente; dupla válida com batida; dupla válida deixando uma carta; restrição durante continuação de Queima.
- Os cenários verificam estado integral antes/depois de rejeição, preservação de `reactionTopCardId`, oportunidade exposta em `roomPublicState(...).me.quickActionCardIds`, turno, descarte, mãos, placar e log.
- Quando existe estoque válido para penalidades, a reação preservada ainda pode ser executada efetivamente por outro participante sem roubar o turno.
- Suíte de regressão: **163 arquivos de teste JavaScript executados e aprovados; 0 falhas**.
- **1 teste não executado**: `tests/socketio-integration-v4063.test.js`, porque `socket.io-client` não está instalado neste ambiente de execução. O pacote continua declarado no `package.json` e no `package-lock.json`.
- `node --check` nos arquivos de JavaScript modificados e `node scripts/check-lockfile.js`: aprovados.
- Node local usado: **22.16.0**; a configuração do projeto solicita Node **22.22.0**. Homologar no ambiente de implantação.

## 4. Arquivos alterados

- `game-engine.js` — mudança funcional pontual em `playDoubleCard()`.
- `tests/double-quick-reaction-v40695.test.js` — teste de regressão novo.
- `package.json`, `package-lock.json` — identificação da V40.69.5.
- `CHANGELOG.md` — registro desta versão.
- `docs/RELATORIO_V40.69.5_JOGADA_RAPIDA.md` — relatório incluído no projeto.
- 30 testes anteriores — somente atualização da constante `pkg.version` (`40.69.4` → `40.69.5`); nenhuma regra ou cenário de teste alterado.

**Fora do escopo:** `server.js`, `public/`, autenticação, WebRTC, ranking, persistência e novas regras de esgotamento do baralho. Os aprimoramentos da V40.69.3 e V40.69.4 foram preservados.

## 5. Limites de validação e homologação no Render

A aprovação local não confirma comportamento em produção. Recomenda-se:

1. Fazer backup e implantar o ZIP incremental sobre a **V40.69.4**, preservando os caminhos.
2. Confirmar deploy e executar `npm ci` e `npm run verify` no Node configurado no projeto (com as dependências disponíveis).
3. Com 2 e com 3+ jogadores, produzir uma carta normal idêntica no topo; deixar um participante fora da vez com uma cópia para Ação Rápida.
4. Tentar usar duas últimas cartas idênticas **sem** anunciar Mau-Mau: a tentativa deve ser rejeitada e o botão de Ação Rápida deve continuar disponível para o outro jogador.
5. Executar a Ação Rápida do outro jogador e confirmar a alteração efetiva do topo sem mudança indevida de turno.
6. Repetir após compra/passe, na abertura da rodada e durante várias rodadas. Verificar também que uma dupla válida funciona após o anúncio e que a Queima segue com as restrições originais.
7. Observar os logs do Render para eventuais exceções inesperadas e confirmar a ausência de regressões de reconexão/salvamento.

**Pendente:** teste de integração Socket.IO, teste com navegadores/aparelhos reais e validação após deploy no Render. A regra para esgotamento completo do monte continua sem decisão e não foi modificada nesta versão.

**Próxima versão planejada (não implementada):** V40.69.6 — Segurança do servidor.

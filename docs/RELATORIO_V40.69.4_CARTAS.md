# MAU-MAU CANDEIAS — Relatório técnico V40.69.4

**Data:** 09/11/2026  
**Base:** ZIP V40.69.3 entregue no ciclo anterior  
**Escopo:** integridade das compras e das penalidades — sem alterações nas regras oficiais do jogo, interface, mídia, autenticação ou Socket.IO.

## 1. Causa e reprodução

No `game-engine.js`, a implementação anterior de `drawCards(room, player, count)` retirava as cartas do monte, uma a uma, acumulando-as em um vetor temporário, e somente **após a última retirada** as transferia para a mão. Se o monte e o descarte reciclável não comportassem toda a penalidade, `drawOne()` lançava uma exceção após retiradas anteriores, deixando cartas fora de qualquer monte ou mão.

O defeito foi reproduzido antes da correção com **penalidade de 3 cartas, monte com apenas 1 carta e descarte contendo somente o topo**. Após a exceção, o monte havia perdido a carta sem que ela fosse entregue ao jogador.

Também havia risco de estado parcialmente aplicado nos seguintes caminhos: `playCard()` (Mau-Mau, Rei, Oito e suas combinações), `playDoubleCard()` (Mau-Mau) e `quickAction()` (Mau-Mau). Nesses casos, o motor podia descartar e alterar reação/turno antes de descobrir que não havia cartas suficientes para a compra.

## 2. Correções realizadas

Arquivo funcional modificado: `game-engine.js`.

1. **Pré-validação de estoque:** introduzida `requireDrawCapacity(room, count, futureDiscards)` para avaliar cartas do monte **mais** as cartas recicláveis do descarte, preservando a carta que ficará no topo. O parâmetro `futureDiscards` permite verificar efeitos futuros de uma jogada sem alterar o estado real.
2. **Compra múltipla protegida:** `drawCards()` agora confirma a disponibilidade de toda a quantidade exigida antes da primeira retirada. Se insuficiente, não move cartas, não reembaralha, não registra log e não altera a mão.
3. **Jogada comum protegida:** `playCard()` calcula previamente as cartas exigidas por Mau-Mau, Rei e Oito, inclusive **soma de penalidades simultâneas**, antes de descartar a carta ou mexer em reação, turno e resultado da rodada. Foi mantida a distinção original quando o vencedor é o único jogador-alvo do efeito especial.
4. **Carta Dupla protegida:** `playDoubleCard()` valida o estoque para a penalidade Mau-Mau antes de retirar qualquer das duas cartas.
5. **Jogada Rápida protegida:** `quickAction()` valida a capacidade para Mau-Mau antes de alterar mão, topo ou janela de reação.

As funções existentes que efetivamente reciclam o descarte **não foram alteradas**: continuam reembaralhando as cartas abaixo do topo e preservando a última carta jogada. A operação normal de compra continua limitada a uma carta por vez.

## 3. Política de baralho completamente esgotado: decisão pendente

**Não foi criada uma regra nova.** Quando a compra obrigatória é impossível até após o reaproveitamento permitido do descarte, o motor rejeita **integralmente** a operação com a mensagem “Não há cartas suficientes… A jogada não foi aplicada.” Isso protege a integridade das cartas e da pontuação, mas a partida pode ficar sem saída quando todas as cartas restantes já estão nas mãos e existe uma penalidade não pagável. A regra atual não define como resolver esse impasse.

Alternativas para uma versão futura, **somente após aprovação expressa**:

- **A:** reduzir a cobrança à quantidade efetivamente disponível; muda a exigência original de penalidade.
- **B:** não cobrar a parte faltante e resolver o turno por uma regra especial; também muda a penalidade.
- **C:** encerrar a rodada ou estabelecer um estado de empate técnico quando não houver cartas; exige nova regra de pontuação.

A V40.69.4 **não escolhe nenhuma dessas alternativas**. Também não corrige o bloqueio da Jogada Rápida na tentativa inválida de ×2 Dupla descrito na auditoria: esse ponto está reservado à V40.69.5.

## 4. Testes realizados

### Antes da alteração

O teste novo `tests/atomic-card-draw-v40694.test.js` falhou no primeiro cenário: a penalidade de Sete retirou parcialmente a carta do monte e lançou erro, comprovando a causa identificada.

### Depois da alteração

- **162 arquivos de testes JavaScript concluídos com sucesso; 0 falhas entre os executados.**
- **1 teste não executado:** `tests/socketio-integration-v4063.test.js`, por ausência de `socket.io-client` no ambiente de execução. O projeto mantém essa dependência declarada em `package.json` e `package-lock.json`.
- Arquivos `game-engine.js` e teste novo passaram em `node --check`.
- `node scripts/check-lockfile.js` confirmou coerência entre versões e dependências.
- Novo teste cobriu: cadeia de Sete com escassez antes e após reciclagem; cadeia final; compra normal com e sem monte; Rei e Oito na batida; penalidades combinadas de Mau-Mau + Rei/Oito; Carta Dupla; Jogada Rápida; preservação de topo, turno, mãos, descarte, status, logs e pontuação nas operações rejeitadas; distribuição normal de 104 cartas; **175 combinações** de monte/descarte/penalidade verificadas por contagem de identificadores.

### Não executados / limites

- Integração Socket.IO com servidor real, testes de bots em produção e partidas reais no Render.
- Testes de concorrência sob carga real ou testes automatizados com PostgreSQL ativo: **fora do escopo de V40.69.4**; a V40.69.3 permanece como base de persistência.
- A aprovação dos testes locais não substitui a homologação funcional no ambiente de implantação.

## 5. Arquivos alterados e adicionados

- `game-engine.js` — correção funcional.
- `tests/atomic-card-draw-v40694.test.js` — novo teste de regressão.
- `package.json`, `package-lock.json` — número da versão 40.69.4.
- `CHANGELOG.md` — histórico da versão.
- `docs/RELATORIO_V40.69.4_CARTAS.md` — este relatório.
- **30 testes preexistentes** — alterado *apenas* o número da versão exigido em suas asserções (`40.69.3` → `40.69.4`), sem mudança em regras, cenários ou resultados esperados.

**Nenhuma alteração feita em `server.js`, `public/`, WebRTC, autenticação, salas, ranking, regras de turno ou tabelas de banco.**

## 6. Homologação recomendada após atualizar o GitHub

1. Faça backup da versão V40.69.3 e atualize os arquivos do ZIP incremental preservando a estrutura de pastas.
2. Aguarde o deploy do Render e verifique a inicialização do aplicativo sem erros.
3. Jogue uma rodada com dois jogadores e outra com três ou mais; confira compra comum, Rei, Oito, Mau-Mau, Carta Dupla e cadeia de Sete, observando que carta alguma desaparece.
4. Teste uma rodada de muitas cartas, se possível em homologação isolada, para verificar o reaproveitamento do descarte sem mover o topo.
5. Verifique reinício e reconexão preservados pela V40.69.3.
6. Se houver erro “Não há cartas suficientes”, registre o estado e escolha a política de esgotamento antes de alterar as regras.

**Próxima versão planejada (não implementada):** V40.69.5 — Jogada Rápida, Queima e ×2 Dupla.

# MAU-MAU CANDEIAS — Relatório técnico da Ação/Jogada Rápida (V53.1)

**Base:** arquivo `mau-mau-multiplayer-main (21).zip`, que contém a V53.0 (níveis da Máquina).  
**Escopo:** corrigir a duração da oportunidade de Ação Rápida sem alterar cartas especiais, pontuação, ordenação de jogadores, modos de jogo ou outros serviços.

## 1. Reprodução e diagnóstico

A falha foi reproduzida com quatro jogadores, uma carta 5♥ no topo, outro 5♥ na mão de um jogador fora da vez e compra pelo jogador que estava com o turno. A compra **não** alterou o topo, porém `canQuickAction()` passou a retornar lista vazia. O teste de regressão falhava antes da correção e passou depois.

| Local | Comportamento anterior | Efeito | Correção |
|---|---|---|---|
| `game-engine.js` → `drawAction()` | `closeReaction(room)` era executado na entrada da compra | Compra apagava `reactionTopCardId` e a janela, mesmo com topo inalterado | A compra não fecha a oportunidade |
| `game-engine.js` → `passTurn()` (passe normal) | `closeReaction(room)` apagava a janela | Mesmo depois de comprar, passar encerrava a oportunidade sem descarte novo | Preservar janela se o topo não mudou |
| `game-engine.js` → `reactionNextPlayerId` | Referência ficava congelada no início da reação | Se mantivéssemos a janela após passar, uma Ação Rápida poderia devolver a vez a quem já passou | `syncReactionTurnAfterPass()` acompanha o novo jogador da vez |
| `public/app.js` → aviso do turno | Texto sugeria que a reação só poderia ocorrer "antes do próximo" | Instrução ambígua depois da compra | Texto atualizado |
| `public/index.html`, `docs/REGRAS.md` | Descrição antiga da janela de reação | Dúvida do jogador | Texto atualizado |

## 2. Comportamento esperado e implementado

Uma oportunidade é associada à **carta física do topo** (`reactionTopCardId`), e não à última ação de compra ou passe.

- **Jogar uma carta nova:** o topo muda, a oportunidade anterior é encerrada e as possibilidades são reavaliadas para a carta nova.
- **Comprar uma carta normalmente:** o topo não muda; a oportunidade permanece.
- **Passar após comprar:** o topo não muda; a oportunidade permanece e a vez passa ao próximo jogador. O sistema atualiza `reactionNextPlayerId` sem alterar a origem da última carta.
- **Realizar Ação Rápida:** a primeira reação aceita pelo servidor descarta uma carta, mantém a vez com o jogador atual e fecha aquela oportunidade; não existe encadeamento de Ação Rápida.
- **Carta inicial da rodada:** permanece reagível após compra e passe, até uma carta substituí-la ou outra condição aplicável encerrar a oportunidade.

## 3. Restrições preservadas

1. A carta de Ação Rápida deve ter o **mesmo valor e o mesmo naipe** da carta do topo e ser normal (2, 3, 4, 5, 6, 9 ou 10).
2. Cartas A, 7, 8, J, Q e K não podem ser usadas em Ação Rápida.
3. A reação é fora da vez; não pode ser feita por quem jogou a carta do topo nem por quem está com a vez, conforme a regra vigente.
4. Cadeia ativa de 7 e continuação de Queima impedem a Ação Rápida.
5. O jogador precisa estar disponível, não ter encerrado a rodada e a partida precisa estar em andamento; as proteções de reconexão e validação do servidor permanecem.
6. A Ação Rápida não muda o sentido, não permite uma segunda carta e não rouba a vez.
7. A primeira Ação Rápida válida fecha a oportunidade. A regra de anúncio Mau-Mau e sua penalidade permanece.
8. **Dois jogadores:** as exclusões de origem e jogador da vez permanecem; esta correção não cria uma reação fora da vez que antes não era válida.

## 4. Arquivos modificados

- `game-engine.js`: correção do ciclo de vida da janela e sincronização após passe.
- `public/app.js`: aviso didático em tela.
- `public/index.html`: explicação nas regras da interface.
- `docs/REGRAS.md`: manual técnico atualizado.
- `tests/engine.test.js`: expectativa da regra antiga corrigida.
- `tests/quick-action-after-draw-v53-1.test.js`: teste novo para compra, passe, abertura, turno, invalidade e troca do topo.
- `CHANGELOG.md`, `INSTALAR_CORRECAO_JOGADA_RAPIDA_V53_1.md`, `VALIDACAO_JOGADA_RAPIDA_V53_1.md`: documentação.

**Não houve alteração em** `server.js`, WebSocket/Socket.IO, estratégias dos robôs, WebRTC, câmera, ranking, banco de dados ou CSS. A validação final da jogada continua no servidor.

## 5. Roteiro de validação no Render

1. Crie sala com **3 ou 4 jogadores**; o jogador fora da vez possui uma carta normal idêntica à carta jogada no topo.
2. Faça o jogador da vez **comprar uma carta**, sem descartá-la. Confirme que o botão ⚡ e a carta destacada continuam disponíveis para o outro jogador.
3. Use a Ação Rápida: somente **uma carta** é descartada; o jogador que comprou continua com a vez.
4. Repita o cenário, mas faça o jogador da vez **passar após a compra**. Confirme que o botão ⚡ permanece para quem continua fora da vez e que a reação preserva o **novo** turno.
5. Substitua a carta do topo por outra carta jogada normalmente. Confirme que não é possível reagir usando a carta correspondente ao topo anterior.
6. Confira situações com carta especial no topo, cadeia de 7, Queima em andamento, reconexão e início da rodada.
7. Teste celular e computador, inclusive com bots: quem tiver a vez nunca deve receber controle de Ação Rápida fora da vez.

## 6. Limites da validação

A suíte local passou em todos os testes executados. O teste de integração Socket.IO não pôde executar por ausência da dependência `socket.io-client` neste ambiente. Não foi realizada partida real multicelular no Render; os testes do roteiro precisam ser feitos após o deploy.

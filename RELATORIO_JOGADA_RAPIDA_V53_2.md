# MAU-MAU CANDEIAS — Auditoria e correção da Jogada Rápida V53.2

**Base analisada:** V53.1, projeto `MAU-MAU-CANDEIAS_COMPLETO_V53_1_JOGADA_RAPIDA_APOS_COMPRA.zip` (derivado do ZIP 21 enviado).  
**Data:** 04/11/2026.  
**Escopo:** motor da partida, compra, passe, estado enviado ao cliente, botão ⚡ e processamento de eventos do servidor.

## 1. Falha confirmada

Em `game-engine.js`, `canQuickAction()` rejeitava a ação quando `room.reactionSourcePlayerId === player.id`. Essa verificação proibia **o próprio autor da carta do topo**, mesmo depois do fim da sua vez. A V53.1 já havia resolvido o fechamento indevido da janela em `drawAction()` e `passTurn()`, mas manteve essa exclusão por autoria.

A falha foi reproduzida antes da correção: Jogador A queimou 6♥, continuou com 4♥, ficou com outro 4♥; Jogador B comprou e permaneceu na vez. O topo não mudou, mas `canQuickAction(room,A)` retornou `[]`. O cliente recebia `quickActionCardIds: []` e não habilitava o botão ⚡.

## 2. Solução mínima

- Remover a exclusão por `reactionSourcePlayerId` em `canQuickAction()`.
- Impedir a ação do **jogador da vez** tanto pela comparação direta com `room.currentPlayer` quanto pela referência `reactionNextPlayerId`, preservando compatibilidade com estados restaurados.
- Manter a exigência de topo físico inalterado (`reactionTopCardId === topCard.id`), carta normal idêntica, jogador disponível, status `playing`, ausência de cadeia de 7 e de continuação de Queima.
- Preservar `quickAction()`, `drawAction()`, `passTurn()` e `server.js` sem alterações na lógica de processamento.
- Corrigir a documentação no jogo e em `docs/REGRAS.md`, que também excluíam indevidamente o autor.

## 3. Caso reproduzido

1. B descarta 6♥.
2. A, com **6♥ + 4♥ + 4♥**, queima 6♥ durante sua própria vez.
3. A declara **Mau-Mau** e continua com um 4♥, pois passará de duas para uma carta (essa declaração é obrigatória na regra atual para evitar a penalidade de +2).
4. A vez normal passa para B. O topo é **4♥** e A conserva outro **4♥**.
5. B compra 1 carta; o teste espera e verifica que B não passou e ainda pode decidir jogar ou passar.
6. A recebe `quickActionCardIds` com o ID do segundo 4♥ e joga a carta usando Ação Rápida.
7. A, ao usar sua última carta, **encerra a rodada**; não há transferência indevida do turno para A e nenhum descarte duplicado.

## 4. Ações quase simultâneas e consistência

Os handlers `socket.on('quickAction')` e `socket.on('playCard')` chamam `withRoom()`, que aplica as mudanças ao motor **sincronamente** no evento recebido. O Node.js processa esses callbacks de forma sequencial; não são duas escritas simultâneas sobre a sala.

- **B é processado primeiro:** B joga 9♥, o topo muda; a Jogada Rápida atrasada com 4♥ é rejeitada.
- **A é processado primeiro:** A descarta o último 4♥, termina a rodada; o clique atrasado de B é rejeitado por não existir rodada em andamento.
- **A tem cartas restantes:** A faz Jogada Rápida, B **continua na vez** e pode concluir uma jogada posterior que ainda seja legal contra o novo topo. O `justDrawnCardId` de B permanece inalterado.
- Uma segunda tentativa de descartar a mesma carta é rejeitada. As cartas não são duplicadas nem desaparecem.

O teste executou também **30 simulações com eventos de A e B enfileirados no mesmo ciclo do Node**, alternando a ordem de chegada, verificando que só a ação ainda válida é aplicada.

## 5. Testes e escopo

- Teste direcionado **falhou na V53.1 e passou após o ajuste**.
- Regressão local: **152 testes aprovados, 0 falhas, 1 integração Socket.IO pendente** por falta do pacote `socket.io-client` neste ambiente.
- Testados: atraso após compra, estado para o botão ⚡, dois e três jogadores, passe sem trocar topo, bloqueio durante a própria vez, condições de 7 e Queima, troca do topo, duplicidade e duas ordens de chegada.
- Nenhuma mudança no servidor, banco, áudio, câmera, robôs ou ranking.

## 6. Validação ainda necessária no Render

Em dois celulares ou navegadores autenticados, testar o cenário exato; verificar ⚡ depois da compra de B, a conclusão da rodada quando A usa o último 4♥, uma corrida de cliques entre A e B e a indicação correta do vencedor. A integração Socket.IO real com dois clientes não foi executada neste ambiente. Se a V53.1 ainda não estiver instalada em produção, publique a V53.2 **completa**, não apenas os arquivos diferenciais.

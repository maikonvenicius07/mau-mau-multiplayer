# MAU-MAU CANDEIAS — Relatório técnico V40.69.8.6

**Data:** 11/11/2026  
**Base auditada:** `MAU_MAU_CANDEIAS_V40_69_8_5_1_PROJETO_COMPLETO.zip` (V40.69.8.5.1)  
**Nova versão interna:** `40.69.8-rank.6`  
**Escopo:** continuidade de partidas concluídas após reinício/deploy e regressão integrada de revanche + ranking.

## 1. Diagnóstico antes da correção

| Nº | Situação | Evidência real | Consequência | Prioridade | Complexidade |
|---|---|---|---|---|---|
| 1 | **Confirmado:** snapshot de sala comum `finished` com `rankingRecorded=true` era descartado na restauração | `room-snapshot-store.js`, `restoreRoomSnapshot()` | grupo perdia a sala de revanche após reinício do Render | Alta | Baixa |
| 2 | **Confirmado:** `flushAll()` ignorava todas as salas finalizadas | `room-snapshot-store.js`, `RoomSnapshotStore.flushAll()` | votos finais e outros estados podiam não ser confirmados no desligamento gracioso | Alta | Baixa |
| 3 | **Confirmado:** timer de reconexão após restart ignorava `finished` | `server.js`, `scheduleRestoredPlayerGrace()` | ausência de jogador podia bloquear o quórum da revanche após reinício | Alta | Baixa |
| 4 | **Confirmado:** recuperação automática por conta ignorava `finished` | `server.js`, `recoverablePlayerSeatForKey()` | jogador sem código/token salvo não encontrava sua vaga na revanche restaurada | Alta | Baixa |
| 5 | **Limitação de ambiente:** não foi possível executar integração com Socket.IO | `tests/socketio-integration-v4063.test.js` | teste ponta a ponta com sockets reais não homologado | Alta para homologação | Média |
| 6 | **Dependente de produção:** persistência real PostgreSQL, mídia entre celulares e deploy no Render não foram acessados nesta execução | `server.js`, módulos de mídia/banco | continuidade real ainda requer testes operacionais | Alta para homologação | Média |

**Reprodução:** o teste novo falhou na V40.69.8.5.1 na verificação de que `restoreRoomSnapshot()` deveria devolver a sala comum confirmada. Após as alterações, passou.

## 2. Correções implementadas

1. **Restauração de resultado confirmado em sala comum:** `restoreRoomSnapshot()` agora aceita estado `finished` mesmo quando o ranking já gravou a partida. **Exceção:** torneio `finished` já registrado continua sem revanche; torneio com resultado pendente mantém o caminho de recuperação para finalizar a gravação.
2. **Persistência no desligamento gracioso:** `RoomSnapshotStore.flushAll()` também grava salas comuns já finalizadas. Não altera TTL nem abre autorização para criar uma sala excluída.
3. **Liberação de vaga após ausência:** `scheduleRestoredPlayerGrace()` inclui `finished` no prazo de reconexão existente. A vaga que não for recuperada é removida; com zero humanos, a sala é encerrada pelo fluxo existente. Há verificação de identidade da instância da sala para evitar timer obsoleto.
4. **Busca da vaga por conta:** `recoverablePlayerSeatForKey()` permite retomar sala comum finalizada, mas continua exigindo que a conta autenticada seja proprietária da vaga e tenha uma reserva válida (ou transferência legítima de socket). Mesas finalizadas de torneio continuam excluídas.
5. **Identificação da versão:** `package.json` e `package-lock.json` atualizados para `40.69.8-rank.6`; testes de contrato com versão exata atualizados, sem alterações de lógica.
6. **Novo teste integrado simulado:** `tests/replay-after-render-restart-v406986.test.js` valida gravação, desligamento/restauração com JSON local, votos, troca de processo, identidade, nova partida, prevenção de ranking duplicado, torneios, retomada por conta e expiração de vagas.

Nenhuma alteração no motor de regras das cartas, em pontuação, na UI, nas APIs de ranking ou nos módulos de câmera/microfone. O código público da sala e o chat permanecem na revanche.

## 3. Testes executados

| Verificação | Resultado |
|---|---|
| Teste novo falhando na versão anterior (regressão reproduzida) | Confirmado |
| Teste novo após correção (snapshot JSON, recuperação e revanche) | Aprovado |
| Duas partidas consecutivas na mesma sala, `matchId`s diferentes, duas vitórias e retry idempotente | Aprovado no armazenamento local simulado |
| Sala de torneio finalizada não recupera revanche; resultado de torneio pendente ainda é restaurável | Aprovado |
| Reconexão com e sem código/token local, usando identidade autenticada | Aprovado em função isolada com estados de teste |
| Expiração do jogador ausente, quórum restante e encerramento de sala vazia | Aprovado com temporizadores simulados |
| Regressão dos arquivos `tests/*.test.js` executáveis | **175 aprovados, 0 falhas** |
| Verificação `package-lock.json` e sintaxe JavaScript dos módulos principais | Aprovada |
| Teste de integração real `socketio-integration-v4063.test.js` | **Não executado:** `MODULE_NOT_FOUND: socket.io-client` |
| PostgreSQL real, Render, Android/iOS, mídia entre dispositivos | **Não executados** |

**Atenção:** “175 testes aprovados” significa 175 **arquivos de teste** executados individualmente (cada um pode conter várias asserções); não comprova homologação com navegador real.

## 4. Riscos e limitações restantes

- A restauração depende da existência de um snapshot **efetivamente persistido** e ainda dentro da retenção. Um desligamento abrupto antes do commit de uma escrita pendente ainda pode perder o último estado. Esta versão não cria uma transação distribuída entre ranking e snapshots.
- O resultado de uma partida pode ter sido registrado no PostgreSQL sem que todos os votos de revanche tenham sido persistidos; nesses casos os jogadores podem confirmar novamente após voltar.
- O prazo de reconexão permanece o já configurado no jogo. Após expirar, um jogador ausente pode perder a vaga, inclusive em partida encerrada.
- Torneios não receberam revanche; espectadores de torneio seguem em modo somente assistir.
- Não foi alterada a política dos jogadores já ausentes há muito tempo, nem o prazo de inatividade do Render Free.

## 5. Roteiro de homologação no Render

1. Faça backup do PostgreSQL e confira a contagem de partidas/vitórias antes do deploy.
2. Envie o ZIP incremental sobre a V40.69.8.5.1, garantindo que a pasta `.github` e os testes estejam nos caminhos corretos. Configure `DATABASE_URL`/`PGSSLMODE` conforme a conexão PostgreSQL interna existente, sem revelar senhas.
3. Verifique `npm run verify`, `Build successful`, inicialização do PostgreSQL e `Your service is live`.
4. Com **dois celulares**, conclua uma partida OFICIAL e confirme a vitória. Na tela do resultado, clique **JOGAR NOVAMENTE** apenas em um dos aparelhos.
5. Inicie um deploy/restart controlado do serviço e reabra a página dentro do prazo de reconexão. Os jogadores devem recuperar a mesma sala, as suas cadeiras, resultado e os votos já salvos. O segundo voto deve liberar a nova partida.
6. Conclua a segunda partida. Confira que são **dois `matchId`s** e que o ranking acrescentou **uma vitória por partida concluída**, sem duplicação.
7. Repita o restart com uma pessoa que não retorna: após o prazo, a ausência não deve bloquear os remanescentes; se todos saírem, não deve permanecer sala zumbi.
8. Verifique que torneios encerrados não oferecem revanche, observadores não veem mãos privadas e seguem sem chat/câmera/microfone no torneio.
9. Faça teste de F5, câmera/microfone e conexões em rede móvel. Isso **não foi testado localmente** nesta versão.

## 6. Próxima etapa recomendada

A V40.69.8.7 poderá focar em **durabilidade após desligamento abrupto** e validação ponta a ponta em ambiente de homologação: medir perda máxima do estado, conferir transações PostgreSQL e executar o teste Socket.IO de verdade com dependências instaladas. Priorizar resultados reais antes de mudar layouts ou regras do motor.

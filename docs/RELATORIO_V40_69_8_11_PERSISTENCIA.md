# MAU-MAU CANDEIAS — Relatório técnico da V40.69.8.11

**Foco:** persistência sem bloqueio, recuperação das salas e integridade do ranking.  
**Base:** V40.69.8.10.1, que contém a correção anterior da Queima.  
**Identificador interno:** `40.69.8-rank.11`.  
**Data:** 11/11/2026.  
**Status:** implementado e aprovado nos testes locais; requer homologação no Render.

## 1. Causa confirmada do bloqueio

No arquivo `room-snapshot-store.js`, `RoomSnapshotStore.enqueueRoomWrite()` encadeava operações de cada sala como `previous.catch(...).then(operation)`. Se a primeira chamada `backend.save()` nunca retornasse, a `Promise` anterior permaneceria pendente e **todas as operações seguintes da mesma sala ficariam bloqueadas**, inclusive `saveNow()` usado pelo registro da vitória.

O prazo de 30 segundos adicionado anteriormente ao `ranking-finalization.js` liberava o aviso de espera do ranking, mas **não liberava a fila do snapshot**, porque seu `Promise.race` envolvia o fluxo do ranking sem interromper a operação que continuava pendente dentro da fila. O resultado era a possibilidade de novas tentativas de ranking repetirem o bloqueio: **3/3 confirmações, resultado ainda não confirmado, revanche sem iniciar**.

A falha foi reproduzida com a classe `RoomSnapshotStore` e operações simuladas que nunca resolvem. Não foi possível verificar se essa foi a causa exata de algum incidente histórico no PostgreSQL do Render.

## 2. Correções implementadas

| Arquivo / função | Alteração | Proteção de integridade |
|---|---|---|
| `room-snapshot-store.js` / `enqueueRoomWrite` | Limite de 15 segundos para cada **gravação de snapshot**; libera a fila ao exceder o prazo, com erro `ROOM_SNAPSHOT_WRITE_TIMEOUT`. | Gravações antigas que concluírem tarde não podem reverter revisões mais recentes. |
| `room-snapshot-store.js` / `writeSnapshot`, `scheduleSnapshotRetry` | Retenta automaticamente o **estado mais recente**, até seis vezes por falha transitória. Não cancela o retry do estado novo quando uma escrita antiga terminar atrasada. | Reutiliza controle de revisão e tombstones já existentes. |
| `room-snapshot-store.js` / `PostgresSnapshotBackend.save/delete/markRoomDeleted` | `SET LOCAL statement_timeout = 12000` nas transações de snapshot e exclusão. | O PostgreSQL cancela consultas que ficam esperando indefinidamente, antes do prazo de fila JS quando já existe conexão. |
| `room-snapshot-store.js` / `enqueueRoomWrite` | Mantém a espera **sem timeout JS de liberação antecipada** para abandono, tombstones e exclusão. | Operações irreversíveis não são consideradas canceladas sem confirmação. |
| `database-pool.js` / `createDatabasePoolConfig` | Define `connectionTimeoutMillis = 8000`, `statement_timeout = 55000` e `query_timeout = 60000` para o pool compartilhado. | Evita esperas infinitas de aquisição e consulta sem alterar SSL, a capacidade do pool ou a estrutura das tabelas. |
| `server.js` / `ensureRoomSnapshotsInitialized` e `requireRoomPersistenceReady` | Permite nova tentativa de inicialização depois de falha transitória; exige restaurar salas anteriores antes de criar novas. | Impede novas salas quando o estado anterior ainda não pôde ser recuperado. |
| `server.js` / `restorePersistedRooms` | Evita restauração duplicada e reexecuta automaticamente a recuperação após falha, com verificação periódica. | Mantém códigos, cadeiras e snapshots existentes; não zera partidas. |
| `server.js` / `maybeRecordFinished` | Resultado sem nenhuma conta elegível continua **pendente** e gera aviso/log; não marca `rankingRecorded=true` sem registro. | Não fabrica vitórias e não libera revanche baseada em confirmação inexistente. |
| `tests/snapshot-stalled-queue-v4069811.test.js` | Testes de cenário travado, segunda gravação, ordem, exceção, exclusão, retry, restauração e fluxo de 3/3. | Regressões detectáveis. |
| `package.json`, `package-lock.json`, `.env.example`, `CHANGELOG.md` e testes de contrato | Identificação da versão, parâmetros e documentação. | Dependências e regras existentes preservadas. |

### Parâmetros e limites

- **Gravação de snapshot:** 15.000 ms por padrão (`ROOM_SNAPSHOT_WRITE_TIMEOUT_MS` opcional).
- **Transação SQL de snapshot:** 12.000 ms de `statement_timeout`, depois que a transação começa.
- **Aquisição de conexão:** 8.000 ms; consultas gerais do pool: 55 s no servidor e 60 s no cliente.
- **Retentativas de snapshot:** 500 ms, 1 s, 2 s, 4 s, 8 s e 15 s, com limite e logs de esgotamento.
- **Recuperação de inicialização e salas:** intervalo de 15 s para novas verificações enquanto não recuperadas; o inicializador respeita cooldown de 10 s.
- **Ranking:** continua exigindo confirmação de persistência; o `matchId` e a idempotência do banco continuam inalterados.

**Ponto essencial:** `Promise.race` não cancela a operação SQL antiga. A integridade depende também de revisão monotônica (`mm_room_snapshots.revision < EXCLUDED.revision`), trava transacional por sala, tombstones e timeout de comando do PostgreSQL. Esses controles foram preservados. Operações de tombstone/abandono não podem ser liberadas apenas por `Promise.race` por serem irreversíveis.

## 3. Testes executados

| Verificação | Resultado |
|---|---|
| Arquivos de teste `.test.js` executáveis | **183 aprovados, 0 falhas** |
| Integração Socket.IO com servidor real | **1 não executado**: `socket.io-client` não estava disponível no ambiente local |
| Sintaxe de 228 arquivos JavaScript | **228 aprovados, 0 falhas** |
| Consistência de `package-lock.json` | **Aprovado** |
| Primeira operação de snapshot eternamente pendente e segunda operação posterior | **Aprovado** |
| Gravação tardia tentando sobrescrever turno e pontuação novos | **Aprovado**: revisão velha descartada |
| Retentativa automática sem novas ações do jogador | **Aprovado** |
| Exclusão de sala durante snapshot bloqueado | **Aprovado**: tombstone impede ressuscitar a sala |
| Persistência de sala independente enquanto outra trava | **Aprovado** |
| Erro de recuperação inicial e segunda tentativa bem-sucedida | **Aprovado** |
| Ranking sem contas elegíveis não ser falsamente registrado | **Aprovado** |
| Fluxo simulado com **3/3 votos**, snapshot travado, recuperação, ranking idempotente e início da revanche | **Aprovado** |
| PostgreSQL real do Render, vários clientes Socket.IO e dispositivos reais | **Não executados** |

**Método de contagem:** 183 significa 183 **arquivos de teste** aprovados; cada arquivo pode conter várias afirmações/cenários. O teste Socket.IO não foi contado como aprovado. As simulações não substituem validação do PostgreSQL do Render.

## 4. O que não foi modificado

- Regras da Queima V40.69.8.10.1, ×2 Dupla, Jogada Rápida, 7, Ás e Dama.
- Fórmulas e registros existentes de Vitórias, Aproveitamento e Habilidade (Glicko-2).
- Estrutura e dados históricos das tabelas `mm_matches` e `mm_match_results`.
- Senhas, autenticação, controles de chat, câmeras, microfone, avatares e layout das cartas.
- Regras de acesso ao torneio e de observadores.

Nenhuma operação foi executada no banco de dados de produção e nenhuma migração destrutiva foi criada.

## 5. Riscos remanescentes e homologação

1. **Queda abrupta antes do commit:** uma jogada ocorrida antes de qualquer gravação bem-sucedida ainda pode ser perdida num encerramento imediato do processo. Isso não é corrigido apenas com retry.
2. **Falha prolongada do PostgreSQL:** após seis retentativas sem sucesso, o snapshot pode continuar sem confirmação; o servidor registra a falha. A revanche não deve avançar sem resultado confirmado.
3. **Operação SQL atrasada:** o driver e a rede podem finalizar uma operação após o timeout JS. A proteção de revisão/tombstone evita sobrescrita de snapshots, mas o desempenho real precisa ser observado em produção.
4. **Ranking sem participantes autenticados:** a partida permanece pendente com aviso; não é considerado um resultado registrado, e depende da correção da origem de identidades inválidas.
5. **Autenticação e serviços de torneio:** recuperações de inicialização independentes não foram modificadas nesta versão.
6. **Compatibilidade real:** falta testar PostgreSQL real, reconexões Socket.IO, câmeras Android/iPhone e quedas longas de rede.

**Roteiro prioritário no Render:** publicar primeiro o pacote incremental sobre a V40.69.8.10.1; concluir uma partida OFICIAL com três pessoas; confirmar `JOGAR NOVAMENTE` com 3/3 votos; verificar a vitória no ranking; iniciar outra partida na mesma sala; conferir que não aparecem mensagens recorrentes `[rooms] prazo excedido para persistência` em condições normais. Se aparecerem, coletar logs com horário, código da sala e a etapa da persistência (sem divulgar dados privados).

## 6. Publicação

Os ZIPs entregues preservam a raiz `mau-mau-multiplayer-main/`.

- **Incremental:** somente arquivos novos ou com conteúdo alterado em relação ao projeto completo da V40.69.8.10.1.
- **Completo:** projeto atualizado com todas as versões anteriores.

Não substituir um projeto de versão anterior à V40.69.8.10.1 usando somente o ZIP incremental sem incorporar primeiro a correção da Queima.

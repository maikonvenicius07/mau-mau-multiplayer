# MAU-MAU CANDEIAS — Relatório técnico V40.69.8.7

**Base:** V40.69.8.6.2 (correção do tipo `$1::text` no PostgreSQL).  
**Nova versão:** V40.69.8.7 (`40.69.8-rank.7` no `package.json`).  
**Escopo:** recuperar gravações de snapshots que falham temporariamente, sem alterar partidas, ranking, interface, mídia ou torneios.

## 1. Diagnóstico confirmado

No arquivo `room-snapshot-store.js`, a função `queueSave()` fazia a gravação com debounce de 250 ms. Se `backend.save()` rejeitasse a gravação (por exemplo, uma indisponibilidade breve do PostgreSQL), o erro era apenas registrado no log. O snapshot não era agendado novamente se não ocorresse outra ação na sala.

O mesmo problema existia para `saveNow()`: o erro chegava corretamente ao chamador, mas, após a falha, não havia recuperação automática da gravação pendente.

**Consequência possível:** após uma queda temporária do banco, o último estado de cartas, turno, placar ou votos de revanche poderia não estar atualizado no snapshot persistido. Isso podia reduzir a qualidade da recuperação após reinício do Render. Esse risco foi confirmado pela inspeção do código; não foi possível medir sua frequência no PostgreSQL real.

## 2. Correção implementada

Arquivo funcional alterado: `room-snapshot-store.js`.

- Mantém a versão mais recente do snapshot em memória enquanto a gravação não é confirmada.
- Reagenda a gravação após uma falha, sem depender de nova jogada ou mensagem Socket.IO.
- Limita a seis novas tentativas, com intervalos de 0,5; 1; 2; 4; 8 e 15 segundos, evitando loops infinitos.
- Usa a fila de escrita e revisões já existentes para impedir sobrescrever um estado mais recente com um snapshot antigo.
- Não agenda vários temporizadores de recuperação para a mesma sala.
- Cancela a recuperação ao excluir ou encerrar uma sala, impedindo que uma tentativa tardia recrie um snapshot eliminado.
- Cancela timers no fechamento do armazenamento; uma gravação que permanecer indisponível após o limite é registrada explicitamente como não confirmada.
- Não oculta a falha para `saveNow()`: o chamador, inclusive o fluxo de ranking, continua recebendo o erro e pode tratar a persistência crítica.

O SQL do PostgreSQL introduzido na V40.69.8.6.2 foi preservado, inclusive os casts `$1::text`, a revisão monotônica e os tombstones.

## 3. Arquivos alterados

- `room-snapshot-store.js` — retentativa segura e limitada de snapshots.
- `tests/snapshot-transient-retry-v406987.test.js` — novo teste do mecanismo de recuperação.
- `package.json`, `package-lock.json` — identificação da versão, sem alteração de dependências.
- `CHANGELOG.md` — histórico da versão.
- `docs/RELATORIO_V40_69_8_7_PERSISTENCIA.md` — este relatório.
- 30 testes antigos — apenas atualização da identificação da versão de `40.69.8-rank.6` para `40.69.8-rank.7`; nenhuma mudança nas regras de validação.

## 4. Testes executados

Suíte local: **178 testes executados e aprovados**, **zero falhas**, **um não executado** (`tests/socketio-integration-v4063.test.js`, dependência `socket.io-client` ausente do ambiente de teste). Total de arquivos de teste: 179.

O teste novo cobriu:

1. Falha simulada em `saveNow()` seguida de recuperação automática sem outra ação.
2. Falha no salvamento debounced seguida de jogada mais recente: restauração mantém turno, pontuação e cartas mais recentes.
3. Tombstone após falha: retentativa cancelada; nenhuma ressurreição da sala.
4. Escrita de outra sala preservada mesmo com uma sala falhando.

Também passaram os testes de recuperação/revanche, ranking, integridade das cartas e o teste da tipagem SQL da V40.69.8.6.2. A verificação do `package-lock.json` e a sintaxe JavaScript passaram.

### Testes não realizados

- Integração Socket.IO real, com clientes conectados ao mesmo servidor.
- Interrupção abrupta do processo durante COMMIT PostgreSQL real.
- Carga e latência no Render com vários jogos em paralelo.
- Validação real em dispositivos Android e iOS.

**Limitação importante:** a correção protege contra falhas transitórias de gravação, mas não estabelece durabilidade síncrona de cada jogada. Uma interrupção fatal antes da gravação de um snapshot (inclusive na janela de debounce de 250 ms) ainda pode descartar a última alteração. A eliminação dessa janela exigiria uma etapa posterior de persistência por ação/confirmada por commit, com avaliação de latência.

## 5. Orientações para publicação no Render

1. Confirme que a V40.69.8.6.2, com o SQL corrigido, está aplicada e que o ranking contabiliza as vitórias.
2. Faça backup do PostgreSQL antes de atualizar.
3. Use o ZIP incremental sobre a V40.69.8.6.2; preserve os caminhos internos das pastas.
4. Confira GitHub Actions e os Logs do Render; procure erros `[rooms] falha ao salvar snapshot`, `[rooms] retentativa de snapshot falhou` e `[rooms] snapshot sem confirmação após retentativas limitadas`.
5. Conclua uma partida OFICIAL com dois ou mais jogadores, realize JOGAR NOVAMENTE na mesma sala e confirme que as duas vitórias foram registradas.
6. Faça um deploy controlado durante uma partida em teste e confira a recuperação da sala e dos participantes.

Não limpar tabelas, apagar ranking, reiniciar vitórias nem desabilitar a verificação SSL para resolver erros não relacionados.

## 6. Próxima versão sugerida

**V40.69.8.8 — Otimização mensurada de CPU, memória e transmissão Socket.IO**, preservando a renderização seletiva já existente. Antes de alterar a frequência de snapshots, medir o uso real no Render e validar o comportamento do ranking e da revanche.

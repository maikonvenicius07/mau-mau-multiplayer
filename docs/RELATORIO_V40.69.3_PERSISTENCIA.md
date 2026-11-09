# MAU-MAU CANDEIAS — V40.69.3

**Escopo:** fase 1 do plano de correções: integridade e recuperação dos snapshots de salas.  
**Base:** ZIP `mau-mau-multiplayer-main (18)(5).zip` (versão 40.69.2).  
**Data:** 09/11/2026.

## Diagnóstico confirmado

1. **Gravações fora de ordem:** `queueSave()` e `saveNow()` disparavam `backend.save()` de forma independente. Uma gravação mais antiga que terminasse depois de outra poderia sobrescrever cartas, turno e pontuação atualizados.
2. **Exclusão concorrente:** `markRoomDeleted()` e `delete()` podiam executar enquanto outra gravação estava ativa. Uma operação anterior poderia ressuscitar um snapshot apagado.
3. **Durabilidade parcial já existente:** as jogadas comuns usam debounce de 250 ms; transições estruturais chamam `saveNow()`, sem sempre aguardar o banco antes de responder ao jogador. Uma interrupção abrupta no intervalo de gravação ainda pode perder a última ação; essa garantia exigiria mudanças transacionais nos eventos do servidor, fora do escopo seguro desta versão.

## Alterações implementadas

**Arquivo `room-snapshot-store.js`:**

- Incluída **fila assíncrona por código de sala**, sem bloquear gravações de outras salas. Erros em uma tarefa não interrompem as seguintes.
- Cada snapshot recebe **revisão monotônica** atribuída ao ser efetivamente agendado para gravação; a revisão é recuperada do armazenamento após restart.
- `queueSave()` preserva o debounce; `saveNow()` cancela o debounce pendente da sala e entra na mesma fila.
- A assinatura dos avatares é conferida no momento da gravação, não apenas quando a tarefa é agendada, evitando perder atualizações de assets entre operações enfileiradas.
- `markRoomDeleted()` e `delete()` bloqueiam imediatamente novas gravações e esperam as anteriores terminarem. Exclusão durável mantém o tombstone do ciclo de vida. Em falha da exclusão, a sala poderá tentar persistir novamente.
- `close()` aguarda as operações já iniciadas antes de encerrar o backend.
- **PostgreSQL:** migração aditiva `ALTER TABLE mm_room_snapshots ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0`. `INSERT ... ON CONFLICT ... WHERE revision < EXCLUDED.revision` impede escrita com revisão antiga. Advisory lock transacional por código de sala coordena gravação/exclusão entre transações concorrentes; escrita confere tombstone ativo antes de inserir. A mesma transação protege os assets associados.
- **JSON local:** revisão e tombstone também são respeitados, preservando compatibilidade com registros antigos sem campo `revision`.

**Sem mudanças** em `game-engine.js`, `server.js`, Socket.IO, login, WebRTC, câmera, microfone, interface, ranking e regras do jogo. Atualizada a versão do pacote para 40.69.3; testes antigos com assertivas da versão 40.69.2 foram ajustados apenas na identificação da versão (não na lógica dos testes).

## Arquivos envolvidos

- `room-snapshot-store.js` — implementação.
- `tests/snapshot-ordering-v40693.test.js` — novos testes de regressão.
- `package.json`, `package-lock.json` — identificação da nova versão.
- `tests/*.test.js` (30 arquivos) — ajuste pontual de assertivas de versão do pacote.
- `CHANGELOG.md` — histórico da versão.
- `docs/RELATORIO_V40.69.3_PERSISTENCIA.md` — este relatório.

## Testes automatizados

Novo teste `snapshot-ordering-v40693.test.js` valida com armazenamento JSON temporário e atraso controlado:

1. Duas gravações simultâneas da mesma sala e ordenação das revisões.
2. Snapshot capturado não muda se o objeto da sala mudar enquanto a gravação aguarda.
3. Reinício e recuperação de mão, turno, rodada e placar mais recentes.
4. Exclusão durável durante gravação em andamento e tentativa tardia de salvamento.
5. Exclusão simples durante gravação em andamento.
6. Continuidade da fila depois de um erro de gravação.
7. Persistência independente de salas diferentes; `close()` espera operação pendente.
8. Debounce conserva somente a última atualização.
9. Inspeção dos mecanismos SQL de revisão, lock e verificação de tombstone.

**Resultados locais:** 161 arquivos de testes executados e aprovados (todos os existentes executáveis sem bibliotecas externas de integração, mais o teste novo). A sintaxe JavaScript e `scripts/check-lockfile.js` também passaram.

**Não executado:** `tests/socketio-integration-v4063.test.js` — `socket.io-client` não está instalado no ambiente. A tentativa de `npm ci --offline` falhou com `ENOTCACHED` em dependência transitiva `xtend`. Os testes também não foram executados contra uma instância PostgreSQL real, no Render ou em partidas reais com celulares. O Node local era 22.16.0, enquanto o projeto exige 22.22.0. Não confundir inspeção do SQL com homologação de banco.

## Implantação e homologação no Render

1. Faça backup/snapshot do banco PostgreSQL e prepare deploy em homologação quando disponível.
2. Envie o ZIP **somente dos arquivos modificados** para o repositório, preservando os caminhos. Não exclua arquivos que não estejam no ZIP.
3. Confirme a variável `DATABASE_URL` e mantenha o backend PostgreSQL obrigatório em produção.
4. Execute em Node 22.22.0: `npm ci --no-audit --no-fund` e `npm run verify`. O CI deve executar a integração Socket.IO que faltou localmente.
5. Verifique nos logs a inicialização dos snapshots e a aplicação da migração da coluna `revision`. Erros de permissão para `ALTER TABLE` impedem o boot do armazenamento; resolva no banco antes de liberar o deploy.
6. Em ambiente de homologação, inicie uma sala com dois jogadores, distribua cartas, realize várias ações rapidamente e confira turno, mãos e placar. Reinicie a instância e faça ambos reconectarem. Verifique os mesmos dados.
7. Encerre a sala com gravações recentes e reinicie o serviço: ela não deve reaparecer. Confirme persistência de exclusão e ausência de erros SQL.
8. Acompanhe latência, pool de conexões e erros de persistência em salas simultâneas. A fila trabalha por sala e transações curtas, mas a latência real depende do banco.

## Riscos e limitações remanescentes

- **A migração de esquema é aditiva**; não exclui os snapshots existentes. A revisão de um registro antigo inicia em 0 e aumenta a cada nova gravação.
- A fila de operações protege o processo atual; advisory lock + revisão + tombstone reforçam transações PostgreSQL concorrentes. Ainda assim, servidores que mantivessem **duas cópias ativas da mesma sala** exigiriam autoridade única sobre jogadas e turnos, fora do escopo desta versão.
- Em falha instantânea do servidor antes de um debounce ou antes do commit, não há promessa de recuperar a última jogada. O shutdown gracioso já chama `flushAll()`, mas não cobre `SIGKILL`, perda de energia ou término forçado.
- Não foi alterada a lógica de jogada rápida, compras de cartas, ×2 Dupla, espectadores, câmera ou microfone. Esses itens permanecem nas fases próprias do plano.

## Próxima fase prevista (não implementada)

V40.69.4 — Integridade das cartas e penalidades. Executar somente após homologar a V40.69.3.

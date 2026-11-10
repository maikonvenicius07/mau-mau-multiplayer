# MAU-MAU CANDEIAS — V40.69.8.1 (Hotfix de ranking)

**Origem:** ZIP fornecido em 10/11/2026, comparado byte a byte com o ZIP completo V40.69.8 entregue anteriormente. Todos os 306 arquivos originais eram idênticos.

## Diagnóstico verificável no código

1. `server.js`, inicialização anterior de `rankingReady`: a Promise convertia uma falha transitória de `RankingStore.init()` em `false` definitivo. As chamadas posteriores continuavam lendo o mesmo resultado, mesmo após o PostgreSQL voltar. **Falha confirmada por leitura do fluxo.**
2. `server.js`, `maybeRecordFinished`: após erro na gravação, a flag `rankingRecording` era liberada, mas a próxima tentativa dependia de outro `emitRoom`. Uma sala terminada e parada poderia ficar sem nova tentativa. **Falha confirmada por leitura do fluxo.**
3. `server.js`, `maybeStartReplay`: uma revanche podia ser iniciada antes de `rankingRecorded=true`; o resultado final antigo poderia deixar de ser recuperável pelo estado da sala. **Risco confirmado no fluxo, sem reprodução no PostgreSQL real.**
4. `server.js`, pós-commit: o método `roomSnapshotStore.delete(room.code)` desabilitava novas gravações com aquele código na instância (`RoomSnapshotStore.deletingRooms`) — relevante porque a revanche reutiliza a sala. **Falha de persistência confirmada no código.**
5. O problema TLS `DEPTH_ZERO_SELF_SIGNED_CERT` foi registrado nos logs do Render em 09/11/2026. Essa indisponibilidade **pode ter contribuído**, mas o código sozinho não comprova quais partidas não constam no banco.
6. `ranking-store.js`: `recordMatch()` usa `match_id` como chave primária e executa `INSERT ... ON CONFLICT DO NOTHING`. O comportamento de idempotência foi preservado para evitar vitórias duplicadas.

## Correções nesta versão

- Inicialização retryable em `ranking-init-retry.js`: uma tentativa por vez, cooldown de 10 s quando a inicialização falhar e estado pronto persistente após sucesso.
- `server.js`: API do ranking, perfis e `/ready` consultam o estado recuperável da inicialização.
- `server.js`: revisão a cada 15 s das salas com partidas completas ainda não registradas, respeitando `rankingRecording` e o `matchId` idempotente.
- `server.js`: não permite começar a revanche enquanto o resultado anterior ainda estiver pendente de confirmação, evitando substituição prematura do estado final.
- `server.js`: preservação temporária do registro original da partida (`pendingRankingRecord`) para que saída de jogadores não recalcule resultados em tentativas futuras.
- `game-engine.js`: limpa `pendingRankingRecord` somente ao iniciar nova partida.
- `server.js`: depois do COMMIT, confirma o snapshot final em vez de deletar a chave de persistência, para que a revanche na mesma sala continue podendo ser salva.
- Atualização da versão npm para `40.69.8-rank.1` (SemVer válido para o hotfix rotulado V40.69.8.1) em `package.json`, `package-lock.json` e contratos de versão da suíte. Sem alteração da lógica de cartas, placar de rodadas, mídia ou interface.

## Testes executados

- **167 arquivos de teste encontrados; 166 executados e aprovados, 1 não executável neste ambiente**: `tests/socketio-integration-v4063.test.js` precisa de `socket.io-client`, declarado no `package.json` mas ausente neste ambiente.
- Teste novo `tests/ranking-recovery-v406981.test.js`: inicialização falha e recupera após 10 segundos simulados, limita chamadas concorrentes, snapshot em revanche, resultado congelado, `recordMatch` idempotente.
- `node --check` em arquivos alterados e `node scripts/check-lockfile.js`: aprovados.
- `npm run verify` interrompeu no teste Socket.IO ausente; os demais foram executados individualmente, excluindo somente essa integração.
- Não foram executados teste real com PostgreSQL do Render, recuperação de vitórias históricas ou deploy de produção.

## Limitações relevantes

- **Vitórias já ausentes do PostgreSQL não reaparecem magicamente.** Para confirmar ou corrigir histórico é necessário confrontar o banco de produção com registros independentes verificáveis. Nunca inserir vitórias presumidas.
- O retry periódico funciona enquanto a sala finalizada permanece no servidor. Se todos saírem e a sala for excluída durante indisponibilidade do banco, o resultado pode perder seu caminho de recuperação. A indisponibilidade simultânea de banco e reinício do Render também não é integralmente solucionada por esta alteração.
- O sistema de ranking continua contabilizando vitória apenas de partida completa, na modalidade congelada no início: **OFICIAL** versus **TREINO**. Os filtros HOJE, SEMANA, MÊS e TEMPORADA têm janelas diferentes.
- Torneios continuam registrando resultados nos módulos próprios e não no ranking oficial.

## Diagnóstico das vitórias desde 09/11/2026

Execute as consultas **somente SELECT** de `scripts/diagnosticar-ranking-v406981.sql` no PostgreSQL correto. Elas verificam partidas por dia/modo, horário da última partida, partidas sem vencedor humano registrado, snapshots finais pendentes e geração da temporada. Não há acesso ao PostgreSQL de produção a partir deste ambiente; não foi possível confirmar quantas vitórias estão faltando.

## Implantação

1. Faça backup do repositório e aplique o ZIP incremental somente sobre a V40.69.8 enviada, mantendo os caminhos.
2. Confirme GitHub Actions e Render com `npm run verify` e `PGSSLMODE` já homologado; não altere as variáveis do banco nem execute SQL de escrita.
3. Homologue uma partida completa OFICIAL com dois humanos, confira a mensagem `Vitória registrada no ranking`, o resultado em TEMPORADA e HOJE, faça a revanche na mesma sala e confirme que a segunda vitória aparece uma única vez.
4. Repita o teste em TREINO e confira que a modalidade não muda ao haver desconexão/AUTO temporário.
5. Simule indisponibilidade de PostgreSQL apenas em ambiente de testes; confira recuperação após retorno e ausência de duplicação.

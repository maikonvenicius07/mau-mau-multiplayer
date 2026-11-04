# Relatório técnico — Fase 6A: Pool PostgreSQL

## Constatações

1. `ranking-store.js`, classe `PostgresBackend`: cria `new Pool()` para ranking. **Impacto potencial:** conexões ociosas extras; **risco da alteração:** médio, por compartilhar capacidade de conexão; **ação:** receber pool injetado.
2. `auth-identity-store.js`, classe `PostgresBackend`: cria outro pool, encerrado por `close()`. **Risco:** fechamento prematuro quando compartilhado; **ação:** flag de propriedade e fechamento condicionado.
3. `room-snapshot-store.js`, classe `PostgresSnapshotBackend`: cria outro pool, encerrado por `close()`. **Risco:** encerrar pool antes de outros módulos; **ação:** idem.
4. `tournament-store.js`, `TournamentStore`: cria pool para inscrições. Catálogo, sorteios e demais módulos já recebiam essa referência via `server.js`. **Ação:** injetar pool comum, preservando o compartilhamento existente.
5. `server.js`: cria armazenamentos separadamente e encerra dois pools no shutdown. **Ação:** criar pool único por processo e encerrar uma vez após os snapshots finais.

## Limites de escopo

- Nenhuma alteração em tabelas, SQL ou dados.
- Não altera a lógica dos jogos, convites, torneios ou observadores.
- Não altera arquitetura do servidor nem aumenta número de workers.
- Sem `DATABASE_URL`, mantém o armazenamento JSON.

## Considerações sobre desempenho

Com quatro pools independentes e `max=10` implícito no `pg`, havia potencial teórico de até 40 conexões concorrentes no processo principal. Com um pool, esse teto passa a 10. A biblioteca abre conexões sob demanda, então isso **não prova** queda de 40 para 10 conexões reais. Sob concorrência elevada, o pool compartilhado pode criar espera por disponibilidade; é necessário observar latência e métricas no Render e PostgreSQL antes de considerar a mudança validada em produção.

## Roteiro de validação

Consulte `INSTALAR_OTIMIZACAO_FASE6A.md` e `VALIDACAO_OTIMIZACAO_FASE6A.md`.

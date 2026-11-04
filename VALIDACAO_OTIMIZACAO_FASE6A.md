# Validação — MAU-MAU CANDEIAS, Fase 6A

## Inventário de pools (comparação estática)

| Componente | Antes | Após Fase 6A |
| --- | --- | --- |
| Autenticação | Pool próprio | Pool compartilhado do servidor |
| Ranking | Pool próprio | Mesmo pool |
| Snapshots | Pool próprio | Mesmo pool |
| Inscrições de torneio | Pool próprio | Mesmo pool |
| Catálogo/sorteios/jogos/tabelas de torneio | Compartilhavam inscrições | Mantidos no mesmo pool |

O limite padrão de **até 10 conexões por pool** da biblioteca `pg` não foi alterado; o teto teórico do processo, para os quatro pools principais, passa de até **40 para 10** conexões simultâneas, **não é** medição de conexões reais.

## Testes realizados neste ambiente

- **148 de 149** testes existentes e novos executados: **148 aprovados, zero falhas**.
- Um teste de integração Socket.IO não executado: falta `socket.io-client` instalado no ambiente.
- Teste novo `database-shared-pool-phase6a.test.js` aprovado:
  - somente uma instância do pool criada;
  - ranking, identidade, snapshots e módulos de torneio usam o mesmo pool;
  - transações chamam `release()`;
  - encerrar um armazenamento não encerra o pool compartilhado;
  - encerramento explícito do pool uma única vez;
  - modo sem `DATABASE_URL` não abre pool.
- `node --check` dos arquivos alterados: aprovado.
- `npm run verify:lock`: aprovado, lockfile inalterado.

## O que não foi possível comprovar

- Comportamento sob carga com PostgreSQL real, conexões concorrentes e latência no Render.
- Integração real Socket.IO, reconexão entre celulares, partida completa, vídeo e microfone.
- Ganho efetivo de CPU, RAM e conexões abertas; requer comparação em produção.

Não houve mudanças nas regras, dados, consultas SQL, CSS, WebRTC nem contrato de Socket.IO.

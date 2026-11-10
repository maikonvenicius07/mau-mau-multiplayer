# MAU-MAU CANDEIAS — V40.69.8.2 — Proteção do histórico do ranking

Data: 10/11/2026

## Base utilizada

Projeto V40.69.8.1 (`package.json`: `40.69.8-rank.1`), idêntico ao ZIP `mau-mau-multiplayer-main (18)(7).zip` enviado anteriormente. A versão de pacote desta entrega é `40.69.8-rank.2`. Nenhuma conexão com banco de dados de produção foi efetuada.

## Defeitos confirmados no código original

1. `ranking-store.js`, `PostgresBackend.init()`: se `ranking_generation` fosse diferente de `v40.8-season1`, executava `DELETE` nas tabelas `mm_match_results`, `mm_matches` e `mm_seasons`. Alterar a geração no futuro poderia apagar resultados historicamente válidos.
2. `ranking-store.js`, `JsonBackend.init()`: arquivo JSON com geração diferente, ou estrutura inválida, era substituído por um ranking vazio.
3. `ranking-store.js`, `JsonBackend.recordMatch()`: após exceder 20.000 registros, partidas mais antigas eram excluídas automaticamente do histórico JSON.
4. `ranking-store.js`, `JsonBackend.recordMatch()`: erro de escrita deixava resultado na memória, e nova tentativa com `matchId` idêntico podia ser ignorada sem persistência.

## Correções da versão

- Banco PostgreSQL: inicialização aditiva, sem exclusão de partidas, participações ou temporadas. Adiciona apenas as estruturas ausentes, preserva o valor anterior do marcador em `ranking_generation_before_v406982` e normaliza `ranking_generation` para a geração esperada pelo código legado. Isso evita que um rollback para o código anterior interprete equivocadamente o marcador e apague resultados. A migração permanece protegida pelo lock transacional preexistente. As temporadas existentes não têm nome/datas sobrescritos.
- JSON: carrega partidas independentemente da geração, sem zerar o histórico. Antes de normalizar metadados, salva uma cópia integral do arquivo anterior com sufixo `.pre-v406982.bak`. Arquivo existente inválido causa erro explícito, preservando os bytes originais.
- JSON: elimina o corte automático de 20 mil partidas. Uma falha de escrita desfaz a inserção na memória, permitindo retry idempotente.
- Ambos os backends rejeitam registros sem participantes (`results` vazio) sem produzir partidas fantasmas.
- Não altera OFICIAL/TREINO, pontuações, empates, regras das cartas, placar, interface, salas ou a identificação `playerKey`.

## Testes

- Teste novo `tests/ranking-history-preservation-v406982.test.js`: migração JSON com dados legados, cópia de segurança, idempotência, restart, isolamento OFICIAL, falha de escrita e reenvio, arquivo danificado, mais de 20 mil partidas, consulta PostgreSQL simulada em duas inicializações, detecção de SQL destrutivo e registro vazio.
- Teste atualizado `tests/ranking-store.test.js`: substitui a expectativa antiga de reset pela preservação de partidas legadas.
- Testes antigos de versão do pacote atualizados para `40.69.8-rank.2` (somente identificação; sem mudança de cenários).
- Rodada de regressão local: **167 testes aprovados; 0 falhas; 1 integração Socket.IO não executada por ausência de `socket.io-client` no ambiente**. `node --check` e verificação do lock aprovados.
- PostgreSQL real, Render, partidas reais, backup de produção e recuperação retroativa de vitórias não foram testados/executados.

## Antes de atualizar a produção

1. Faça backup verificável do PostgreSQL no Render. Preserve também qualquer arquivo JSON de ranking se usado.
2. Execute `scripts/diagnosticar-historico-ranking-v406982.sql` usando cliente SQL conectado ao PostgreSQL do serviço. Registre as contagens; o arquivo contém somente consultas `SELECT`.
3. Faça deploy incremental a partir da V40.69.8.1. Evite implantar simultaneamente instâncias muito antigas que ainda contenham a rotina destrutiva; versões antigas podem causar o reset antes de o novo código assumir a migração.
4. Depois do deploy, compare totais e partidas já existentes. Totais históricos **não devem diminuir** pela atualização. Faça uma partida OFICIAL e uma TREINO completas, confira ambas, faça revanche e confira que não há contagem em duplicidade.
5. Se a verificação falhar, interrompa novas implantações e investigue logs e backup antes de qualquer restauração.

## Pendências deliberadas (fases seguintes)

- O novo ranking de Aproveitamento ainda não foi implementado (previsto V40.69.8.3).
- Glicko-2 multiplayer ainda não foi implementado (previsto V40.69.8.4).
- Quando alguém abandona e sua cadeira vira bot, `buildMatchRecord(room)` ainda pode registrar um elenco humano incompleto; definir regra de elegibilidade futura, sem atribuir vitórias arbitrárias.
- Retry de ranking ainda depende de snapshots e disponibilidade do banco; não há garantia de recuperar partidas que nunca foram gravadas.
- Não foi feito acesso ao PostgreSQL real; não é possível garantir recuperação de vitórias ausentes.
- O backend JSON agora preserva todo o histórico, mas o arquivo pode crescer. Em produção, PostgreSQL continua sendo a opção recomendada.

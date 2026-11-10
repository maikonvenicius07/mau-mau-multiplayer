# MAU-MAU CANDEIAS — Relatório técnico V40.69.8.4

**Módulo:** ranking de Habilidade, motor Glicko-2 adaptado a mesas multiplayer.
**Base:** projeto completo V40.69.8.3 (`40.69.8-rank.3`).
**Novo pacote:** `40.69.8-rank.4`.
**Escopo:** motor estatístico e API para consulta; a terceira aba visual e os títulos pertencem à V40.69.8.5.

## 1. O que foi implementado

- Novo módulo `ranking-skill.js`, com as equações de atualização Glicko-2 (rating, RD, volatilidade e parâmetro τ).
- Adaptador multiplayer para **2 a 5 participantes humanos registrados**. O desempenho é obtido pela posição final: vitória contra uma posição inferior, derrota contra uma superior e empate quando as posições são iguais. Dentro de cada mesa, cada confronto recebe peso `1/(N-1)` para que ela contribua uma observação por pessoa.
- Os confrontos de uma mesma mesa são **correlacionados**: a normalização limita o peso agregado mas **não torna a adaptação equivalente ao Glicko-2 oficialmente validado para duelos**. A calibração estatística (simulações, simetria, estabilidade e abuso de combinações) deve ser acompanhada em produção antes de títulos competitivos.
- Atualizações simultâneas: calcula o resultado de todos os participantes usando as classificações **anteriores** à mesa; a ordem no vetor de jogadores não influencia o resultado.
- Resultados calculados a partir das partidas persistidas (`mm_matches`, `mm_match_results`, `mm_players` ou arquivo JSON), sem criar/alterar tabelas. Não se reescrevem conquistas históricas.
- Ordenação por `finishedAt` e `matchId` para reprodução determinística após reinício. `matchId` repetido é ignorado para habilidade. Partidas com um único humano, dados ausentes, posições inválidas ou jogadores duplicados não são avaliadas.
- Modalidades OFICIAL e TREINO calculadas separadamente. TREINO com apenas um humano e bots não produz rating; não se atribui arbitrariamente uma habilidade a bots.
- Cache de 20 segundos por modalidade; invalidada imediatamente em um `recordMatch` confirmado.
- Proteção contra histórico grande: `RANK_SKILL_MAX_HISTORY_ROWS`, padrão 200.000 linhas de resultados. Se excedido, a consulta falha explicitamente em vez de publicar classificação incompleta.
- Corte opcional com data ISO `RANK_SKILL_START_AT`. **Por padrão, não há corte**: todas as partidas completas armazenadas podem contribuir para o rating. A configuração só deve ser adotada após verificar o histórico em produção e comunicar o marco aos jogadores.

## 2. Fórmula e interpretação

Valores iniciais para jogador sem rating: **rating=1500**, **RD=350**, **volatilidade=0,06**; `τ=0,5` (configurável).

Cada jogo ajusta `rating`, `RD`, e `volatilidade` com as equações Glicko-2. Para uma mesa de N jogadores, a soma dos pesos de confrontos de cada jogador é 1, não N−1. A classificação **conservadora** usa `rating − 2×RD`; quanto menor a certeza, maior a penalização. A API também retorna o rating nominal e a incerteza separadamente.

As datas **HOJE, SEMANA, MÊS, TEMPORADA e HISTÓRICO** limitam a participação elegível e mostram a **evolução do rating no período** (`periodDelta`). O rating é global dentro da modalidade, **não é zerado** ao trocar de período. `HISTÓRICO` na API de habilidade significa todos os resultados válidos disponíveis; os rankings antigos seguem com sua semântica existente.

Um jogador fica **PROVISÓRIO** se não cumprir o mínimo do período (3/5/10/20/30 partidas, configuráveis com `RANK_MIN_*`) ou se RD ultrapassar 200, por padrão. Provisórios aparecem sem ocupar a liderança oficial.

## 3. API — pronta para a fase da interface

- `GET /api/ranking?category=skill&mode=official&period=month`
- `GET /api/profile?playerKey=<chave>&category=skill&mode=official&period=month`

Retorno: `rating`, `rd`, `volatility`, `conservative`, `games`, `wins`, `totalGames`, `totalWins`, `periodDelta`, `provisional`, `minimumGames`, `gamesNeeded`, `uncertain`, `rank`. O endpoint de ranking também informa `skillSettings`. Não há acesso a cartas ou mãos privadas.

**V40.69.8.4 não adiciona o botão HABILIDADE na tela**. Ele será apresentado na V40.69.8.5 juntamente com critérios de títulos, sem misturar as duas etapas.

## 4. Preservação do passado

A gravação original (`recordMatch`) continua intacta; o novo motor é apenas de leitura. Em PostgreSQL, a consulta seleciona exclusivamente resultados existentes e não executa DDL/DML. No JSON, nenhuma gravação adicional é feita durante cálculos. Os métodos `getLeaderboard` e `getPerformanceLeaderboard` existentes permanecem intactos.

**Limite do histórico:** um registro com dois participantes não garante, por si só, que todos os jogadores da mesa original tenham sido registrados corretamente. Não foi possível inspecionar o PostgreSQL de produção; portanto, os ratings históricos derivados devem ser considerados **provisórios até auditoria de cobertura**. Partidas antigas que não foram gravadas não podem ser reconstruídas automaticamente.

## 5. Arquivos alterados

- `ranking-skill.js` (novo): motor matemático e agregação.
- `ranking-store.js`: leitura das partidas e métodos públicos do ranking de habilidade.
- `server.js`: `category=skill` nos endpoints existentes.
- `.env.example`: parâmetros opcionais.
- `package.json`, `package-lock.json`: versão `40.69.8-rank.4` e verificação de sintaxe.
- `tests/ranking-skill-v406984.test.js` (novo): matemática, multiplayer, deduplicação, persistência, modalidade e API.
- Trinta testes de contrato: apenas identificação da versão atualizada; comportamento testado inalterado.
- `docs/RELATORIO_TECNICO_V40_69_8_4_GLICKO2.md` (este relatório).

Não foram modificadas regras das cartas, interface, CSS, WebRTC, reconexão, placar acumulado, torneios ou autenticação.

## 6. Testes executados

- **169 arquivos de testes aprovados** individualmente com `DATABASE_URL` vazio, protegendo o banco real.
- **0 falhas** entre os testes executados.
- **1 arquivo de integração Socket.IO não executado** (`tests/socketio-integration-v4063.test.js`) porque a dependência `socket.io-client` não está instalada neste ambiente. Está declarada no `package.json` para instalação via `npm ci` no Render.
- Sintaxe de `ranking-skill.js`, `ranking-store.js`, `server.js`: aprovada.
- Lockfile validado com `node scripts/check-lockfile.js`.
- Glicko-2 reproduziu o exemplo numérico de referência: rating ~1464,06; RD ~151,52; sigma ~0,059996 para 3 oponentes de teste.
- Testes de mesas 2 e 4 participantes, empate, ordem dos participantes, revancha, ID duplicado, registro inválido, PROVISÓRIO, períodos, modalidade e persistência JSON/reinício.
- Consulta PostgreSQL testada **com pool simulado**; PostgreSQL real e Render **não homologados**.

## 7. Implantação e validação

1. Confirmar que o repositório está na V40.69.8.3 antes de aplicar o ZIP incremental. Se não estiver, preferir conferir as diferenças com o ZIP completo.
2. Realizar backup PostgreSQL antes do deploy (prática de segurança, apesar de não haver migração de dados nesta versão).
3. Publicar a atualização no GitHub e acompanhar `npm ci` / `npm run verify` no Render.
4. Conferir as respostas dos endpoints acima (com contas de teste e dados reais); verificar que OFICIAL e TREINO estão separados.
5. Comparar o ranking antigo de Vitórias e Aproveitamento antes/depois; não devem mudar.
6. Verificar que uma partida completa e sua revanche aumentam `totalGames` uma vez cada; recarga ou repetição do mesmo `matchId` não aumenta.
7. Monitorar CPU, memória e latência de `/api/ranking?category=skill`, especialmente quando houver muitos resultados. Se o limite de segurança for atingido, não aumentá-lo sem medição e planejamento.
8. Definir o marco de início do Glicko-2 após auditoria do histórico. Alterar `RANK_SKILL_START_AT` muda os ratings, mas **nunca as vitórias**.

## 8. Pendências / próximas fases

**V40.69.8.5:** aba visual HABILIDADE no desktop/mobile, exibição de rating/RD/evolução, premiações, critérios de Rei do Mês e Rei do Ano (estes títulos exigem definição explícita de desempates e pontuação do período).

**V40.69.8.6:** integração ponta a ponta com PostgreSQL real e navegadores, carga, concorrência, migrações futuras, auditoria de cobertura histórica e calibração da aproximação multiplayer.

> **Status:** motor implementado e validado localmente; não declarar ranking de habilidade homologado em produção antes dos testes acima.

# MAU-MAU CANDEIAS — V40.69.8.3: Ranking de Aproveitamento

## Versão e escopo

- **Base de atualização:** V40.69.8.2 (`package.json` 40.69.8-rank.2).
- **Nova versão:** V40.69.8.3 (`package.json` 40.69.8-rank.3).
- **Escopo exclusivo:** ranking de Aproveitamento; o ranking de Vitórias, os dados históricos, a identificação dos jogadores, as regras de cartas e a contabilização de partidas permanecem inalterados.
- **Arquivos de código principais:** `ranking-performance.js` (novo), `ranking-store.js`, `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`.
- **Suporte:** `.env.example`, `package.json`, `package-lock.json`, novo teste `tests/ranking-performance-v406983.test.js`, atualização dos testes legados que verificam a versão do pacote. A lógica dos testes legados não foi alterada.

## Como funciona

**Vitórias:** a rota `/api/ranking` preserva `category=wins` como padrão. O ranking antigo é calculado exatamente como antes; `mm_matches` e `mm_match_results` não são modificadas por esta atualização.

**Aproveitamento:** `category=performance` seleciona agregações somente de leitura. A mesma categoria é aceita em `/api/profile`. A aba de aproveitamento e os filtros HOJE, SEMANA, MÊS, TEMPORADA e HISTÓRICO usam as mesmas identidades de jogadores e segregação OFICIAL/TREINO.

Para cada jogador em cada período e modalidade:

- `N`: número de partidas concluídas presentes nos resultados registrados;
- `W`: número de vitórias registradas; taxa real = `100 × W / N`;
- `C`: crédito por vitórias, dividindo cada vitória entre vencedores no caso de empate;
- `E`: soma dos valores `1 / n_mesa` de cada partida, em que `n_mesa` é a quantidade de participantes efetivamente registrados na partida;
- `p0 = E / N`: expectativa de vitórias para as composições das mesas registradas;
- `k=10` (configurável): partidas virtuais de suavização;
- **Taxa suavizada** `p = (C + k × p0) / (N + k)`;
- **Índice relativo (0 a 100):** se `p >= p0`, `50 + 50 × (p-p0)/(1-p0)`; caso contrário, `50 × p/p0`.

O índice relativo usa **50 pontos para o resultado estatisticamente esperado**, qualquer que seja o tamanho da mesa, e recompensa rendimento comprovadamente acima do esperado em mesas com mais participantes. **Não é a probabilidade de vitória:** ela é mostrada separadamente como taxa real e taxa suavizada. Não é Glicko-2, que será a próxima fase estatística.

**Empates** recebem frações de crédito no índice, enquanto o Ranking tradicional continua reconhecendo todas as vitórias (`won=true`) normalmente, sem alterar a contagem histórica.

**Provisórios:** mínimos por período: HOJE 3, SEMANA 5, MÊS 10, TEMPORADA 20, HISTÓRICO 30. O jogador aparece após os classificados, com aviso e quantidade de partidas faltantes, mas sem posição na liderança oficial. Os mínimos podem ser alterados via `RANK_MIN_DAY`, `RANK_MIN_WEEK`, `RANK_MIN_MONTH`, `RANK_MIN_SEASON` e `RANK_MIN_HISTORY`. A suavização é configurável via `RANK_PERFORMANCE_PRIOR_GAMES` (padrão 10).

**Importante para históricos parciais:** registros antigos que incluem menos de dois participantes geram uma expectativa conservadora de 50%, com `uncertainGames` e indicação de composição parcial no ranking. Isso também pode ocorrer com partidas contra robôs ou substituições por bots; não é possível reconstruir nomes ou o tamanho original de mesas que não foram registrados. O cálculo não inventa resultados. **HISTÓRICO permanece vazio enquanto não houver temporada encerrada**, respeitando o contrato atual. O filtro anual independente fica para outra etapa.

## Exemplo ilustrativo

| Jogador | Partidas | Vitórias | Taxa real | Taxa suavizada | Índice relativo | Classificação (mês) |
|---|---:|---:|---:|---:|---:|---|
| Maria (mesas de 4) | 20 | 15 | 75% | 58,33% | 72,22 | Classificada |
| João (mesas de 4) | 50 | 30 | 60% | 54,17% | 69,44 | Classificado |
| Carlos (duelos) | 200 | 60 | 30% | 30,95% | 30,95 | Classificado |
| Jogador com 1 vitória em 1 duelo | 1 | 1 | 100% | 54,55% | 54,55 | Provisório |

## Correções e riscos que NÃO foram abrangidos

- Esta etapa não implementa Glicko-2, títulos competitivos ou uma classificação anual independente.
- Nenhuma migração ou alteração em tabelas é necessária.
- Não atribui nem recupera automaticamente vitórias ausentes do banco; dados históricos podem conter registros incompletos, o que exige auditoria em produção.
- A query agregada de PostgreSQL adiciona trabalho somente quando o usuário consulta a aba de Aproveitamento; recomendamos observar latência no Render com volume real, especialmente durante horários de pico.
- Não foi realizada implantação, migração em PostgreSQL real, nem teste visual em aparelhos reais neste ambiente.

## Verificação realizada

- **168 arquivos de teste automatizados aprovados**, **0 falhas entre os executados**, **1 não executado**, num total de 169 arquivos `.test.js`.
- O teste não executado é `tests/socketio-integration-v4063.test.js`; a dependência `socket.io-client` não está instalada neste ambiente. Ela está declarada no projeto e deverá ser instalada pelo `npm ci` no pipeline.
- Foram validados exemplos com 2 e 4 jogadores, empate, 1 participante registrado, participantes provisórios, limites configuráveis, isolação OFICIAL/TREINO, JSON e PostgreSQL simulado, leitura do perfil fora do Top 50, não alteração do ranking de Vitórias, e código/contratos da interface.
- Verificações de sintaxe (`node --check`) passaram para os arquivos alterados, e `scripts/check-lockfile.js` passou.
- O teste de banco compartilhado passou com `PGSSLMODE=disable`, preservando a configuração anterior do Render.

## Orientações para implantação e conferência

1. **Backup:** faça uma cópia de segurança do PostgreSQL e confira o histórico da V40.69.8.2 antes de atualizar. Embora esta atualização não escreva nas tabelas por causa da nova categoria, o sistema possui gravações de vitórias durante partidas.
2. Aplique o ZIP incremental exclusivamente **sobre V40.69.8.2**; mantenha os caminhos relativos desde `mau-mau-multiplayer-main/`. O ZIP completo também contém as correções anteriores.
3. Confirme em GitHub Actions `npm ci`, `npm run verify`, inicialização e logs sem erro. **Não mude `PGSSLMODE`/TLS do Render** por causa desta versão.
4. No ranking, compare VITÓRIAS e APROVEITAMENTO em HOJE/SEMANA/MÊS/TEMPORADA; confira OFICIAL e TREINO separadamente e o campo PROVISÓRIO abaixo dos mínimos.
5. Teste dois jogadores e uma mesa com 4/5 jogadores, empate e revanche. Confirme que a vitória conta uma única vez no Ranking de Vitórias e que as partidas aumentam em Aproveitamento.
6. Verifique o ranking em celular com várias linhas, nome extenso, troca rápida de filtros e abertura de perfil de jogador. Valide o layout em iPhone e Android reais.
7. Confirme que `mm_matches` e `mm_match_results` mantêm as mesmas contagens históricas antes/depois do deploy (fora das novas partidas legítimas).

**Próxima fase:** V40.69.8.4 — Glicko-2 multiplayer, com metodologia e calibração próprias, sem reprocessar resultados sem suporte histórico.

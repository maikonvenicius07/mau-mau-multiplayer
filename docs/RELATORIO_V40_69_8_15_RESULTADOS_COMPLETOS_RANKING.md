# MAU-MAU CANDEIAS — V40.69.8.15 — Classificação completa dos torneios no Ranking

Data: 16/11/2026

## Pedido atendido

Mostrar no Ranking os resultados dos torneios concluídos, incluindo a posição e a pontuação dos demais jogadores, em vez de destacar apenas o campeão.

## Problema confirmado

A interface `public/tournament-ui.js` anteriormente mostrava o campeão em uma linha e a classificação reduzida a um texto pequeno com `.slice(0,5)`. Essa limitação tornava o resultado difícil de ler e ocultava finalistas além do quinto lugar. O retorno da API já possuía os resultados da mesa decisiva, mas não disponibilizava o histórico público das fases para consulta nessa seção.

## Alterações efetuadas

1. `public/tournament-ui.js`: renderização de um cartão para cada campeonato concluído, com tabela de **Posição / Jogador / Pontos**, medalhas para 1º, 2º e 3º lugares, e exibição de todos os finalistas. Desistentes, quando informados, aparecem como desclassificados. Para torneios com múltiplas fases, um bloco recolhível mostra os resultados por mesa das fases anteriores.
2. `public/styles.css`: estilos responsivos para os cartões e tabelas, mantendo o visual verde/dourado do jogo, legibilidade no celular e sem alterar o layout da mesa de cartas.
3. `public/index.html`: texto de ajuda do Ranking e versão do CSS/JS atualizadas para invalidar cache do navegador.
4. `server.js`: a rota `GET /api/tournaments/champions` passa a entregar `stages` (dados públicos já tratados por `TournamentBracket.summary`), além do resultado final que já retornava.
5. `tournament-bracket.js`: inclui o indicador público `forfeited` nos classificados da mesa decisiva, sem modificar as regras, a pontuação ou o critério de classificação.
6. `tests/tournament-ranking-results-v4069815.test.js`: teste novo para mais de 5 finalistas, posições, notas, histórico por fase, segurança contra HTML em nomes, dados públicos da API e compatibilidade com o histórico antigo.

## Importante sobre a interpretação dos resultados

- Em torneios com várias mesas, as colocações da tabela principal correspondem **à mesa decisiva**, não a uma posição geral inferida entre todas as fases. Os demais participantes podem ser consultados em **Ver resultados das outras fases**, por mesa e fase.
- Os pontos são exatamente os do resultado gravado em cada mesa, **sem ajuste**, recálculo, inversão de posição ou nova premiação.
- Essa melhoria é **somente de exibição**: não altera a contagem de vitórias, aproveitamento, habilidade, ranking oficial/treino ou histórico do PostgreSQL.
- Torneios legados sem classificação detalhada não recebem resultados inventados.

## Testes e validação

- 189 testes locais passaram.
- 1 teste de integração Socket.IO não foi executado: dependência `socket.io-client` indisponível no ambiente de teste (`MODULE_NOT_FOUND`).
- `node --check` passou em `server.js`, `tournament-bracket.js` e `public/tournament-ui.js`.
- `node scripts/check-lockfile.js` passou.
- ZIPs de atualização e projeto completo serão validados quanto à integridade e correspondência dos arquivos.

## Como atualizar

1. Faça backup da versão atual no GitHub.
2. Extraia o pacote **somente arquivos alterados** e substitua os arquivos nos mesmos caminhos (sem copiar a pasta raiz duplicada).
3. Faça commit na branch usada pelo Render e acompanhe o deploy até ficar disponível.
4. Abra o Ranking, expanda **Resultados dos torneios** e confirme o cartão da **Copa Teste** com 1º `maikon2` (37), 2º `Joel` (93), 3º `Maikon Gianizelli` (0), desde que esses dados estejam presentes no banco do Render.
5. Em um torneio com mais de uma mesa, abra **Ver resultados das outras fases** e confira os participantes por fase.

**Limitação:** testes de integração no Render e com PostgreSQL real não foram executados neste ambiente.

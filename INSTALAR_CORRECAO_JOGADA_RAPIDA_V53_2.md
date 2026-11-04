# Instalação — MAU-MAU CANDEIAS V53.2

**Base:** projeto completo V53.1 — Ação Rápida após compra. 

1. Abra o ZIP de **ATUALIZAÇÃO** e substitua os caminhos correspondentes no GitHub.
2. Substitua `game-engine.js`, `public/index.html`, `docs/REGRAS.md` e `CHANGELOG.md`.
3. Adicione o teste `tests/quick-action-own-top-after-draw-v53-2.test.js` e o relatório `RELATORIO_JOGADA_RAPIDA_V53_2.md`.
4. Faça commit e confirme o deploy no Render. Não é necessária alteração do banco, `.env` ou dependências.
5. Em dois celulares, deixe A com 6♥ + 4♥ + 4♥, o outro jogador com 6♥ no topo. A, na própria vez, Queima 6♥, anuncia Mau-Mau antes de ficar com uma carta e joga 4♥. B compra e demora; A deve visualizar ⚡ e poder jogar o segundo 4♥.
6. Refaça o caso com B jogando 9♥ antes da reação de A: a reação antiga deve ser recusada.
7. Teste novamente Queima, Carta Dupla, Cadeia de 7, observador, bot e reconexão.

**Importante:** o servidor continua processando eventos um por vez; a validação da Ação Rápida é refeita no momento de processar o evento. Se o primeiro clique encerrar a rodada, o segundo será recusado.

**Rollback:** restaure `game-engine.js`, `public/index.html`, `docs/REGRAS.md` e `CHANGELOG.md` da V53.1.

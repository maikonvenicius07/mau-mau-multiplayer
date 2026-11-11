# MAU-MAU CANDEIAS — Auditoria técnica e correção V40.69.8.4.3

**Data:** 11/11/2026  
**Fonte:** arquivo completo `mau-mau-multiplayer-main (17)(8).zip` recebido do usuário.  
**Identificação no package.json:** `40.69.8-rank.4` (base contendo o motor Glicko-2, hotfixes visuais e modo observador de torneio).  
**Versão de entrega:** V40.69.8.4.3, hotfix incremental de estabilidade mobile.  
**Escopo:** sem mudanças de servidor, persistência, banco, motor das cartas, pontuação ou regras.

## 1. Conclusões da auditoria e evidências

A revisão abrangeu `server.js`, `game-engine.js`, `ranking-store.js`, `ranking-performance.js`, `ranking-skill.js`, `room-snapshot-store.js`, `public/app.js`, `public/index.html`, `public/styles.css`, `public/camera-video.js`, `public/media-session.js`, `public/tournament-ui.js`, `package.json`, `render.yaml` e a suíte de 173 testes. Os pontos abaixo distinguem **CONFIRMADO**, **RISCO** e **JÁ EXISTENTE/VALIDADO POR INSPEÇÃO**; sem supor falhas de produção sem evidência.

| Nº | Área | Problema / observação | Evidência no código-base | Consequência | Solução / decisão | Prioridade | Complexidade | Status |
|---|---|---|---|---|---|---|---|---|
| 01 | CSS mobile | Mostrar `#sevenPenalty` aumentava a altura da mesa em três blocos de CSS, inclusive `height: max(510px,130vw)` | `public/styles.css`: seletores `.felt:has(#sevenPenalty:not(.hidden))` nas regiões ~3619, ~3637 e ~4238 da base | Mão desce 61,5–108px nos quatro cenários verificados | Remover crescimento do feltro; compactar o padding da zona central quando a penalidade aparece | **Alta** | Baixa | **CONFIRMADO E CORRIGIDO** |
| 02 | JS mobile | Foco automático de Queima/×2 usava `scrollIntoView` | `public/app.js`, `renderHand`, chamadas originais próximas de 4097/4110 | A API pode deslocar também a página, não só a mão | Substituir por ajuste horizontal delimitado em `#hand` | **Alta** | Baixa | **CONFIRMADO NO CÓDIGO / CORRIGIDO PREVENTIVAMENTE** |
| 03 | CSS mobile | Em situações com três ou mais controles do host, regras `:has(#hostControls > :nth-child(3))` ainda expandem a mesa | `public/styles.css`, regiões ~3622, ~3640 e ~4241 | Possível salto vertical no lobby ou fim de rodada | Avaliar somente com reprodução do cenário; não alterar nesta versão | Média | Média | **RISCO, ADIADO** |
| 04 | Mobile | Em aparelho muito baixo (ex.: 320×568) a mão pode exigir rolagem mesmo sem carta 7; a mesa e as cartas ocupam o espaço disponível | Layout flex de `table-shell` e `hand-panel` e altura do feltro; Chromium com fixture 320×568 | Necessidade de scroll vertical em telas particularmente baixas | Redesenho adaptativo futuro, sem diminuir cartas sem autorização | Média | Média | **LIMITAÇÃO CONHECIDA** |
| 05 | Ranking | Motor de habilidade Glicko-2 existe no backend, mas o seletor visual ainda exibe apenas Vitórias e Aproveitamento | `ranking-store.js`, funções `_skillHistory/_skillRows`; `public/index.html` `data-rank-category`; `public/app.js` `loadRanking` | Classificação de habilidade não acessível pelo painel atual | Implementar UI e títulos na próxima fase dedicada | Média | Média | **FUNCIONALIDADE PENDENTE, NÃO BUG NOVO** |
| 06 | Ajuda | Texto de ajuda do ranking ainda afirma “conta somente vitórias”, apesar da aba Aproveitamento | `public/index.html`, região ~702 | Confusão dos jogadores | Atualizar ajuda junto da interface completa de ranking | Baixa | Baixa | **CONFIRMADO, ADIADO** |
| 07 | CSS | Diversas regras sobrepostas para placar e mão mobile ao longo do arquivo | `public/styles.css`, blocos V52.8, V53.3, V53.8 e V53.11 | Maior risco de regressões | Consolidar de forma gradual, com comparação visual, não reescrever | Média | Média | **DÍVIDA TÉCNICA** |
| 08 | Controles | Queima, Dupla e Rápida já aparecem antes de distribuir e mantêm posição salva no dispositivo | `public/app.js`, `isPredealPositioningPhase`, `updateFloatingGameActions`, `restoreFloatingActionPosition` | Recurso solicitado já implementado | Preservar | — | — | **JÁ IMPLEMENTADO** |
| 09 | Espectadores | Modo de torneio somente assistir possui validação no servidor e estado sem mão privada | `server.js`, `watchTournamentTable/joinSpectatorSocket`; `game-engine.js`, `roomSpectatorState` | Garante isolamento da mesa; requer homologação integrada | Preservar, testar no Render | — | — | **JÁ IMPLEMENTADO / NÃO TESTADO EM PRODUÇÃO NESTA SESSÃO** |
| 10 | Mídia | Recuperação de áudio e vídeo tem vários caminhos e depende de permissões e rede reais | `public/app.js`, `public/media-session.js`, `public/camera-video.js` | Risco de falhas em navegadores específicos | Testar com Android/iOS e outro participante recebendo mídia | Média | Média | **VALIDAÇÃO PENDENTE** |
| 11 | Ranking | Finais de partidas são persistidos e possuem mecanismo de resultado pendente | `server.js`, `maybeRecordFinished`, `roomSnapshotStore.saveNow` | Relevante para preservar vitórias | Sem alterações no hotfix; conferir contabilização no banco real | Alta (se falhar) | Média | **SEM NOVA FALHA REPRODUZIDA** |

## 2. Correção realmente implementada

1. **`public/styles.css`** — retiradas três regras que aumentavam a altura da mesa com o aviso da cadeia de 7. O aviso permanece visível com redução apenas do espaçamento interno, mantendo as dimensões das cartas. Acrescentado `overflow-anchor: none` ao contêiner mobile.
2. **`public/app.js`** — função `focusCardWithinHandHorizontally` calcula a menor rolagem horizontal necessária e usa somente `hand.scrollTo({left,behavior:'smooth'})` (fallback para `scrollLeft`), sem solicitar rolagem de página. Os dois focos automáticos (Queima e Dupla) foram adaptados.
3. **`public/index.html`** — sufixos de cache atualizados nos recursos CSS/JS para facilitar o recebimento da correção após deploy/PWA.
4. **`tests/burn-ux-contract.test.js`** e **`tests/double-ux-contract.test.js`** — contratos ajustados para verificar a nova rolagem horizontal em vez da API antiga.
5. **`tests/mobile-seven-hand-viewport-v4069843.test.js`** — novo teste para saltos verticais, foco horizontal, cartas já visíveis, cartas removidas durante renderização e ausência de overflow.
6. **`CHANGELOG.md`** e este relatório: documentação da alteração.

## 3. Testes executados e resultados reais

- **172 testes Node.js**: aprovados, sem falhas entre os executados (com `DATABASE_URL` removida do ambiente dos testes).
- **1 teste não executado:** `tests/socketio-integration-v4063.test.js`, requer `socket.io-client` não instalado neste ambiente. Está declarado em `package.json`, mas isso não comprova integração real.
- `node --check public/app.js`, `node --check server.js`, `node --check game-engine.js`: aprovados.
- `node scripts/check-lockfile.js`: aprovado; `package-lock.json` íntegro.
- **Chromium headless** com CSS real do ZIP, antes/depois de mostrar o aviso, em um cenário HTML controlado:

| Largura × altura (pixels CSS) | Deslocamento da mão original | Deslocamento após correção | Aviso de 7 visível após correção? |
|---|---:|---:|---|
| 320×640 | 108 px | 0 px | Sim |
| 360×800 | 96 px | 0 px | Sim |
| 390×844 | 61,5 px | 0 px | Sim |
| 430×932 | 84 px | 0 px | Sim |

- Cenário visual adicional 320×568: aviso permanece dentro do feltro; a mão pode continuar exigindo scroll pela altura reduzida da tela, independentemente da carta 7.

**Limitações:** não houve sessão multiplayer real, navegação autenticada, deploy ao Render nem validação em Android/iOS físicos. Os testes com navegador usam uma fixture reduzida (mesmos estilos de produção) e demonstram o salto de layout, não todo o jogo funcionando ponta a ponta.

## 4. Orientação para implantação

- O ZIP incremental deve ser aplicado **sobre o projeto correspondente ao ZIP recebido** (ou sobre repositório com os mesmos arquivos). Não substituir outros arquivos nem alterar variáveis PostgreSQL/TLS.
- O número **V40.69.8.4.3** é a designação deste hotfix. `package.json` permanece `40.69.8-rank.4` intencionalmente para preservar os contratos existentes; nenhum esquema de banco muda.
- Após deploy, em celular: abrir uma partida, provocar uma cadeia de 7, alternar compra e rebatida, observar se a mão fica no mesmo lugar; testar Queima e ×2 Dupla com mãos grandes; atualizar F5 e comparar jogadores e espectadores.
- Se o navegador usar cache do PWA, atualizar/reabrir a página após publicação e confirmar carregamento dos novos recursos.

## 5. Próximas etapas sugeridas

1. **V40.69.8.5 — Interface do ranking de Habilidade e premiações:** adicionar terceira aba e títulos com critérios documentados, sem alterar vitórias existentes.
2. **V40.69.8.6 — Testes integrados:** validar ranking, mídia, espectadores de torneio, reinício e reconexão reais no Render com dispositivos.
3. **Otimização mobile adicional:** tratar telas de altura reduzida e consolidar CSS somente após homologação da correção do 7.

# MAU-MAU CANDEIAS — Auditoria geral e versão V40.69.8.5

**Data:** 11/11/2026  
**Entrada:** ZIP completo `mau-mau-multiplayer-main (18)(8).zip` (336 entradas), que inclui o hotfix mobile V40.69.8.4.3, embora o `package.json` identificasse a versão base `40.69.8-rank.4`.  
**Saída:** V40.69.8.5, versão Node `40.69.8-rank.5`.  
**Escopo de alterações:** ranking e premiações, CSS e documentação; regras de cartas, motor da partida, salas, reconexão, câmera, áudio e torneios não alterados.

## 1. Conclusões da auditoria e evidências

Categorias: **C = confirmado no código**; **R = risco não reproduzido**; **I = funcionalidade existente, preservada**.

| Nº | Área | Problema / estado | Evidência na versão de entrada | Consequência | Solução / decisão | Prioridade | Complexidade | Categoria |
|---|---|---|---|---|---|---|---|---|
| 1 | Ranking/UI | Motor de Habilidade disponível na API, mas faltava a aba visual | `server.js` rota `/api/ranking`, `ranking-store.js` `getSkillLeaderboard`, `public/index.html` `data-rank-category` | Jogadores não conseguiam consultar habilidade na interface | Terceira aba integrada, usando dados existentes | Alta | Média | C, corrigido |
| 2 | Ranking/UI | Filtro HISTÓRICO era ocultado de forma uniforme mesmo existindo rating histórico | `public/app.js`, `loadRanking`, retorno antecipado de `history` | Rating histórico inacessível | Permitir HISTÓRICO para Habilidade, preservar comportamento legado de Vitórias e Aproveitamento | Média | Baixa | C, corrigido |
| 3 | Premiações | Não havia títulos baseados em desempenho comprovado | `ranking-skill.js`, `ranking-store.js`, `public/index.html` | Falta de reconhecimento objetivo para habilidade e consistência | Cálculo somente leitura com mínimos e RD, UI própria | Média | Média | C, implementado |
| 4 | Ajuda | Texto dizia que ranking considerava somente vitórias | `public/index.html`, seção Ajuda | Instrução incorreta | Atualizar para três categorias | Baixa | Baixa | C, corrigido |
| 5 | Histórico | Dados reais das partidas não foram consultados em produção | `ranking-store.js` lê `mm_matches` e `mm_match_results`; nenhum acesso ao banco Render neste ambiente | Cobertura retroativa e ratings históricos não confirmados | Conferência SQL e backup antes de homologar | Alta | Média | R, pendente |
| 6 | Carta 7/mobile | Hotfix anterior removeu crescimento do feltro ao exibir penalidade | `public/styles.css`, `#sevenPenalty` e `overflow-anchor` | Regressão visual seria possível após mexer na mesa | Não alterar mesa; validar CSS isolado do ranking | Alta | Baixa | I, preservado |
| 7 | Mobile muito baixo | Telas próximas de 320×568 ainda podem exigir scroll vertical | `public/styles.css`, dimensões da mesa e mão, relatório V40.69.8.4.3 | Mão pode ficar fora da primeira área visível | Projeto futuro, sem diminuir as cartas | Média | Média | R, não abordado |
| 8 | CSS mobile | Regras sobrepostas para placar e ações móveis | `public/styles.css`, blocos de V53.8 / V53.11 | Regressão possível se houver limpeza ampla | Consolidar após validação visual específica | Média | Alta | R, adiado |
| 9 | Reconexão/mídia | Restauro depende de permissões, ICE e hardware físico | `public/app.js` `pageshow`, `public/camera-video.js` eventos LiveKit | Ícones sozinhos não provam recepção de áudio/vídeo | Homologar com dois dispositivos reais, incluindo iOS/Android | Alta | Média | I/R, não alterado |
| 10 | Torneios | Observador somente leitura já possui fluxo controlado no servidor | `server.js` `watchTournamentTable`; `game-engine.js` `roomSpectatorState` | Segurança depende de homologação integrada | Preservar e testar no Render | Média | Média | I, não alterado |
| 11 | Integração | Teste Socket.IO requer biblioteca não disponível no ambiente local | `tests/socketio-integration-v4063.test.js`, dependência em `package.json` | Não foi possível confirmar fluxo E2E | Executar com `npm ci` em ambiente com dependências instaladas | Média | Baixa | R, pendente |

## 2. O que foi implementado

- `public/index.html`: aba **👑 HABILIDADE**, quadro de títulos e atualização da ajuda. Novo sufixo de cache para CSS/JS.
- `public/app.js`: renderização segura da Habilidade no quadro existente, respeitando filtros de período e modalidade; rating global, RD, índice conservador (`rating − 2 × RD`), evolução e provisório; busca separada de títulos sem travar leaderboard se ela falhar. As informações dinâmicas são escapadas antes de entrar no HTML.
- `public/styles.css`: três abas responsivas e títulos em cartões compactos, isolados dos estilos da mesa.
- `ranking-skill.js`: cada evento da evolução preserva `ratingAfter` e `rdAfter` para que títulos sejam determinados pelo estado no último jogo do período, e não pelo rating obtido em meses posteriores.
- `ranking-awards.js` (novo): cinco prêmios mensais/anuais, filtro `America/Porto_Velho` (UTC−04) e regras transparentes de elegibilidade.
- `ranking-store.js`: `getSkillAwards()` somente leitura e cache de resultados já existente; sempre modalidade `official`.
- `server.js`: `/api/ranking/awards` somente leitura, responde sem cache e nunca altera pontuação ou histórico.
- `package.json`/`package-lock.json`: versão atualizada; dependências inalteradas.
- `.env.example`: exemplos de parâmetros de premiações (não ativa nem altera o ambiente do Render).
- `tests/ranking-awards-v406985.test.js` novo e ajuste do contrato antigo que exigia a ausência da terceira aba. Testes com assertiva de versão recebem apenas atualização do número do pacote.

### Critérios dos títulos, sem premiação automática definitiva

O sistema apresenta títulos **provisórios enquanto o mês/ano corrente está em andamento**, recalculados com base nos registros disponíveis. Não cria conquistas históricas permanentes nem reatribui vitórias anteriores.

- **Rei do Mês:** maior índice conservador no fim da última partida do mês, mínimo 10 jogos OFICIAIS e RD no máximo 200.
- **Rei do Ano:** mesma classificação usando partidas do ano civil em Rondônia e mínimo 30 partidas.
- **Mais Vitorioso:** maior quantidade de vitórias no mês entre elegíveis, desempate por taxa de vitórias e partidas.
- **Revelação:** maior ganho positivo de rating nas partidas do mês entre elegíveis.
- **Mais Consistente:** maior `100 × (vitórias/partidas) − 0,5 × desvio-padrão(deltas de rating)` entre elegíveis com índice conservador de pelo menos 1500.

Mínimos e RD máximo podem ser configurados com `RANK_AWARD_MIN_MONTH` (padrão 10), `RANK_AWARD_MIN_YEAR` (padrão 30) e `RANK_AWARD_MAX_RD` (padrão 200). O conjunto de títulos permanece restrito a resultados completos aceitos pelo motor Glicko-2, e o título Mais Consistente usa uma métrica aproximada que exigirá calibração com mais partidas.

### Comportamento dos filtros

- **Vitórias** e **Aproveitamento:** sem mudança nos resultados atuais, incluindo o comportamento legado de HISTÓRICO.
- **Habilidade:** usa o rating global acumulado das partidas registradas; `Hoje`, `Semana`, `Mês`, `Temporada`, `Histórico` apenas filtram jogos e evolução, **sem reiniciar o rating**.
- **Treino:** permite consultar habilidade separada, mas não concede títulos oficiais.
- Títulos indicam seu próprio período (mês ou ano) e não são alterados pelo filtro de visualização do ranking.

## 3. Validação local realizada

- 174 arquivos de testes Node identificados. **173 aprovados, 0 falhas entre os executados, 1 não executado** (`tests/socketio-integration-v4063.test.js` por dependência ausente).
- `node --check`: JavaScript dos módulos alterados e `public/app.js` aprovados.
- `node scripts/check-lockfile.js`: aprovado, dependências diretas fixadas e lockfile válido.
- Novos testes: Glicko-2 com dados persistidos, janela do mês/anual, corte de fuso, mínimos, ausência de títulos com amostra baixa, TREINO excluído, leitura sem escrita e histórico de vitórias intacto.
- Chromium com **fixture reduzida usando os trechos reais de HTML, CSS e JavaScript**, simulando respostas da API: 320×640, 360×800, 390×844 e 430×932. Terceira aba, provisórios e cinco títulos renderizados sem overflow horizontal nem erros de execução no cenário.

**Limitações:** nenhuma consulta ao PostgreSQL real, não houve deploy ao Render nem teste de partidas simultâneas reais; o teste visual não é o jogo completo autenticado. Câmera e microfone exigem dois aparelhos reais para validar recepção. Títulos e ratings dependem da integridade do histórico registrado.

## 4. Implantação e homologação

1. Fazer backup do PostgreSQL (mesmo sem migração). Comparar contagem de resultados antes/depois do deploy.
2. Aplicar o ZIP incremental em repositório compatível com a versão de entrada, ou o ZIP completo para reconstrução.
3. Verificar build/testes no GitHub Actions e saúde do Render. Manter `PGSSLMODE` coerente com URL interna do banco; não modificar TLS nesta versão.
4. Abrir Ranking → Habilidade com duas contas, testar filtros Hoje/Mês/Histórico, OFICIAL e TREINO; verificar que no TREINO não se concedem títulos oficiais.
5. Finalizar partidas OFICIAIS, conferir crescimento de vitórias e atualização de rating, e confirmar ausência de duplicação após revanche e F5.
6. Em celulares reais, verificar leitura dos cartões e botões sem afetar a mesa e a mão de cartas.

## 5. Próxima versão sugerida

**V40.69.8.6 — Homologação integrada, monitoramento do ranking e robustez do fluxo de títulos.** Testar integração Socket.IO com dependências instaladas, diversos navegadores e Render; conferir PostgreSQL real (sem modificar vitórias), métricas de latência, e avaliar persistência de títulos ao fim de cada mês/ano **somente depois de validar as regras estatísticas com jogadores reais**.

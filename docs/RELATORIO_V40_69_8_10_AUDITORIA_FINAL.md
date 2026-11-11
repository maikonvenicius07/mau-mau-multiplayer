# MAU-MAU CANDEIAS — Relatório técnico V40.69.8.10

**Base:** ZIP `mau-mau-multiplayer-main (17)(10).zip`, identificado no `package.json` como `40.69.8-rank.9` (V40.69.8.9).  
**Entrega:** `40.69.8-rank.10`, V40.69.8.10.  
**Data:** 11/11/2026.  
**Escopo:** auditoria de integração e correção pontual; não houve alteração de regras, resultados ou bancos de produção.

## 1. Síntese executiva

O projeto possui um motor autoritativo no servidor (`game-engine.js`), salas com estados privados por participante (`server.js`, `state-delivery.js`), reconexão e snapshots (`room-snapshot-store.js`), ranking idempotente de vitórias com classificações estatísticas (`ranking-store.js`, `ranking-performance.js`, `ranking-skill.js`), espectadores de torneio somente leitura e mecanismos de recuperação de mídia no cliente.

A auditoria encontrou uma falha objetiva no endpoint de prontidão do Render e um conflito em temporizadores dos avisos da interface. Os dois foram corrigidos e receberam testes novos. As questões abaixo que dependem de PostgreSQL de produção, navegador móvel real ou falhas abruptas **não foram declaradas resolvidas**.

## 2. Alterações efetivamente implementadas

1. **Saúde do Render com tempo limitado** — `service-readiness.js` recebe `probeIdentityReadiness`, que limita tanto a espera pela inicialização da identidade quanto a consulta `healthCheck()` do PostgreSQL. Retorna `{ok:false,reason:...}` quando a operação não responde, sem expor credenciais. `server.js`, rota `/ready`, passa a utilizar essa verificação de 2 segundos. A rota `/health` permanece como liveness, e a política de retornar HTTP 503 em falha permanece intacta.
2. **Avisos temporários previsíveis** — `public/app.js`: um aviso substitui o anterior cancelando seu temporizador, impedindo que o callback antigo oculte a mensagem mais recente. Não foram alterados chat, regras ou tempos de gameplay.
3. **Contrato de versão e cache** — `package.json`, `package-lock.json`, identificações de versão nos testes legados, `CHANGELOG.md` e sufixo de versão no HTML. As versões fixadas das dependências não foram alteradas.
4. **Teste de regressão** — `tests/final-readiness-toast-v4069810.test.js`, cobrindo Promise de inicialização nunca resolvida, saúde do banco pendente ou falha, resposta positiva e concorrência entre avisos.

## 3. Auditoria por prioridade

Critérios: **C** = defeito comprovado no código; **R** = risco técnico confirmado, mas impacto não reproduzido em produção; **P** = validação pendente. A palavra “corrigido” refere-se ao artefato desta versão e aos testes locais.

| Nº | Área | Tipo | Problema/evidência | Consequência | Recomendação | Prioridade | Complexidade | Situação |
|---:|---|:---:|---|---|---|---|---|---|
| 01 | Saúde / Render | C | `server.js`, rota `/ready`: `await authIdentityReady` era sem timeout, diferentemente dos probes do ranking e snapshots | Health check poderia ficar indefinidamente pendente | Usar probe limitado para a identidade | Alta | Baixa | **Corrigido** |
| 02 | Interface | C | `public/app.js`, `toast()`: cada aviso agendava remoção sem cancelar o timeout anterior | Mensagem nova ocultada antecipadamente | Cancelar timer antigo | Média | Baixa | **Corrigido** |
| 03 | Autenticação / disponibilidade | R | `server.js`, inicialização de `authIdentityReady`: um erro é convertido em `false` guardado para o restante da vida do processo | Recuperação do banco não recupera automaticamente o serviço de identidades | Estudar reinitialização idempotente e tentativas com cooldown | Alta | Média | Pendente; não tocar sem testes de identidade em PostgreSQL |
| 04 | Ranking / integridade | R | `server.js`, `maybeRecordFinished`: registro vazio em `buildMatchRecord()` é marcado como registrado sem inserção em `mm_matches` | Em situação com participantes não elegíveis, o sistema não apresenta uma vitória registrada | Instrumentar e definir política para partida sem humanos elegíveis | Alta | Média | Pendente de cenários e regra de elegibilidade |
| 05 | Snapshot / queda abrupta | R | `room-snapshot-store.js`, `DEFAULT_DEBOUNCE_MS = 250`: jogadas comuns persistidas depois de janela de debounce | Em crash antes da escrita, última jogada pode não sobreviver | Avaliar durabilidade com custo e latência de PostgreSQL reais | Alta | Alta | Pendente |
| 06 | Revanche | P | `server.js`, `maybeRecordFinished`, `maybeStartReplay`; `replay-session.js` | A sequência fim/resultado/confirmações depende de PostgreSQL real e sockets | Homologar com 2, 3 e 5 jogadores, revanches consecutivas e reinício | Alta | Média | Tests simulados; produção pendente |
| 07 | Reconexão Socket.IO | P | `tests/socketio-integration-v4063.test.js` exige `socket.io-client`, ausente neste ambiente | Não foi possível executar teste com servidor/socket reais | Executar `npm ci` e teste em CI/Render isolado | Alta | Média | Não executado localmente |
| 08 | Câmera/microfone | P | `public/camera-video.js`, `public/app.js` gerenciam LiveKit e WebRTC com restauração | Mídia remota pode falhar em iOS/Android apesar de ícone ativo | Teste cruzado entre aparelhos, F5, background e troca de rede | Alta | Média | Pendente em aparelhos reais |
| 09 | Estabilidade mobile | R | `public/styles.css` tem muitas regras sobrepostas de `max-width:560px`, 390px e telas baixas | Regressão de posição da mão ou controles em telas específicas | Consolidar regras gradualmente após testes visuais | Média | Média | Não alterado |
| 10 | Performance | P | `public/app.js`, `renderHand()`, e `state-delivery.js` já têm deduplicação/reutilização | Ganho geral não pode ser inferido só de benchmark local | Medir FPS, uso de memória, volume Socket.IO e latência no Render | Média | Média | Otimizações anteriores preservadas |
| 11 | Habilidade | R | `ranking-skill.js` usa Glicko-2 pareado e ponderado por mesa | Calibração multiplayer depende de amostra real | Comparar estabilidade do rating para mesas 2–5 jogadores | Média | Alta | Motor preservado |
| 12 | Dependências | P | `.github/workflows/verify.yml` executa `npm audit`, não bloqueante; instalação local não foi concluída | Não foi possível certificar vulnerabilidades atuais | Executar auditoria npm em CI, revisar alertas | Média | Baixa | CI configurado; auditoria externa não executada |

## 4. Testes realizados

- **182 arquivos `.test.js` encontrados:** **181 executados e aprovados**, **0 falhas**, **1 não executado** (`tests/socketio-integration-v4063.test.js`).
- Os testes executados cobrem, entre outros, turnos, regras, compra, Jogada Rápida, penalidades, revanche e ranking, recuperação de snapshots, observadores de torneio, sanitização, atualização incremental da mão, mídia simulada e aspectos da interface.
- Teste novo: Promises nunca resolvidas e falhas do `healthCheck()` da identidade; confirmação de que `/ready` usa probe com timeout; um novo toast não pode ser ocultado pelo timeout do anterior.
- Sintaxe JavaScript: `node --check` executado nos módulos alterados.
- Integridade do lock: `node scripts/check-lockfile.js` aprovado.
- Não realizados: consulta ao PostgreSQL real do Render, integração socket com processos reais, testes com dois celulares, reprodução real de câmera/microfone, medição de CPU/latência no Render e auditoria atualizada `npm audit`.
- Node local: v22.16.0; projeto exige 22.22.0. A instalação npm neste ambiente não foi concluída, portanto não foi possível homologar dependências nativas e integrações.

## 5. Compatibilidade preservada

- **Ranking**: nenhuma tabela, consulta de gravação ou regra de pontuação alterada. `mm_matches` e `mm_match_results` intocados.
- **Regras**: nenhum arquivo do motor `game-engine.js` alterado; cartas, Queima, ×2 Dupla, Jogada Rápida, sete, turnos e placar preservados.
- **Salas e revanche**: nenhuma alteração em `room-snapshot-store.js`, `replay-session.js` ou fluxo `maybeStartReplay`.
- **Espectadores de torneio**: continuarão sem entrar como jogadores, com chat e mídia bloqueados.
- **Câmera e microfone**: sem mudança no gerenciamento de tracks; necessidade de homologação física mantida.

## 6. Implantação e homologação sugerida

1. Verificar backup e números históricos de `mm_matches` e `mm_match_results` antes de implantar.
2. Publicar o ZIP incremental sobre **V40.69.8.9** ou utilizar o completo para comparação; não copiar a pasta `node_modules`.
3. Conferir o resultado de `npm run verify` no GitHub Actions e a resposta `/ready` do Render. Um erro de banco deve retornar `503`, não travar a requisição; com banco disponível deve retornar `200`.
4. Fazer uma partida OFICIAL completa; conferir a vitória em Vitórias, Aproveitamento e Habilidade.
5. Usar JOGAR NOVAMENTE com 3 jogadores; iniciar outra partida na mesma sala, confirmar segunda vitória sem duplicar a primeira.
6. Testar F5, perda temporária de internet, retorno de observador e torneio sem acesso a cartas privadas.
7. Em dois celulares, verificar câmera/microfone enviados **e recebidos**, antes e depois de suspender o navegador; verificar mão e chat em 320/360/390/430 pixels CSS.

**Critério de conclusão:** esta versão foi validada por testes locais, mas o encerramento definitivo da etapa depende da homologação acima em ambiente real. Nenhum dado histórico foi excluído ou modificado por esta versão.

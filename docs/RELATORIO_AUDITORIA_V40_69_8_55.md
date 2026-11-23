# MAU-MAU CANDEIAS — Auditoria técnica e otimização conservadora

**Release entregue:** V40.69.8.55  
**Base recebida:** V40.69.8.54, identificada em `server.js`  
**Data da revisão:** 23/11/2026  
**Projeto:** aplicação web multiplayer com Node.js, Express, Socket.IO, WebRTC/LiveKit opcional, PostgreSQL/armazenamento local, torneios e ranking.

> **Escopo e confiança:** foram inventariadas as 436 entradas do ZIP original, examinados os principais caminhos de servidor, persistência, torneios, interface, mídia, reconexão, cache e controles de segurança, e executada a bateria de testes disponível sem dependências externas. Isso **não** equivale a uma inspeção manual linha a linha de todos os arquivos, nem a certificação de produção. Onde há teste de contrato, simulação ou leitura estática, isso está identificado. Não foram usadas contas, dados ou credenciais da produção.

## 1. Resumo executivo

A revisão identificou **quatro melhorias pontuais implementadas**, sem alterar o motor das cartas, regras de Queima, classificação, sorteios, entrada automática dos classificados, início manual das partidas, ranking, permissões, tamanho das cartas, identidade visual ou banco de dados. Os pontos corrigidos são: atualização automática rearmada depois de uma pausa, timer visual que operava com a janela fechada, reconciliação que consultava todo o catálogo de torneios e quatro scripts que não recebiam versionamento automático de conteúdo.

Na validação local foram executados **228 arquivos `*.test.js`**: **227 aprovados**, **1 bloqueado pela falta da dependência externa `socket.io-client`**, sem falhas funcionais observadas nos testes que puderam rodar. A verificação de sintaxe de 291 arquivos JavaScript e a verificação do `package-lock.json` também passaram. **Não foram feitos ensaios reais de PostgreSQL, navegador móvel, Render ou várias horas de carga.**

O `package.json` continua com a versão técnica histórica `40.69.8-rank.11`, requerida por diversos testes e pelo lockfile. O identificador funcional sequencial em `server.js` e no campo `releaseVersion` de `/health` e `/ready` agora é **V40.69.8.55**. Não se deve alterar o `package.json` isoladamente, pois isso quebraria verificações de compatibilidade.

## 2. Método e referência inicial

1. ZIP extraído com verificação dos caminhos e cópia de trabalho separada; original preservado.
2. Inventário dos arquivos, tamanho dos scripts e estrutura de dependências.
3. Leitura de pontos críticos do `server.js`, `room-snapshot-store.js`, `ranking-store.js`, `tournament-catalog.js`, `tournament-bracket.js`, `tournament-podium-archive.js`, `database-pool.js`, módulos de mídia e interface, contratos existentes e documentação técnica.
4. Reprodução isolada do erro de pausa de polling **antes** da modificação, usando temporizadores controlados.
5. Correções pequenas e testes de regressão específicos.
6. Execução independente de todos os arquivos de teste disponíveis, com `DATABASE_URL` vazio para impedir acesso a banco de produção.
7. Microbenchmark sintético, separado de medições reais, sobre a listagem de torneios.

### Medidas estáticas da versão recebida

| Recurso | Bytes originais | Bytes após gzip local, nível 6 | Observação |
|---|---:|---:|---|
| `public/index.html` | 83.299 | 21.855 | HTML servido com versionamento dinâmico de URLs |
| `public/styles.css` | 312.096 | 66.701 | Folha extensa, **não alterada** |
| `public/app.js` | 308.240 | 85.044 | Script principal extenso, **não alterado** |
| `server.js` | 272.543 | 70.920 | Medida da base, não um indicador de RAM |
| `public/tournament-ui.js` | 42.452 | 12.005 | Valor anterior à correção |

Os valores gzip são **compressão de arquivo no laboratório**, não prova de que o Render entrega gzip, nem tamanho transferido medido no navegador. Não há tempos HTTP, FPS, heap móvel ou consumo real de CPU antes e depois porque não havia servidor implantado disponível para ensaio. Scripts grandes continuam sendo oportunidade de estudo, **não justificativa automática para reestruturação**.

## 3. Achados, classificação e decisão

| ID | Gravidade | Evidência e localização | Impacto | Decisão |
|---|---|---|---|---|
| A01 | **Médio — confirmado** | `public/tournament-auto-refresh.js`, funções `pause`, `tick`, `queue`: após `pause()` durante `refreshDetails()`, o `finally` recriava um timer. Reprodução original: 1 timer pendente quando o esperado era 0. | Requisições e atualizações dispensáveis após ocultar/pausar o torneio. | **Corrigido**, com teste de regressão. |
| A02 | **Médio — confirmado por inspeção e teste** | `public/tournament-ui.js`: `setInterval(..., 1000)` era registrado na inicialização independentemente de o diálogo estar fechado. | Acorda o navegador desnecessariamente, inclusive quando o usuário está em outra parte do app. | **Corrigido**: ativação ao abrir e parada ao fechar/ocultar. |
| A03 | **Médio — confirmado por código** | `server.js`, `reconcileTournamentProgress()`, chamava `tournamentCatalog.list()` a cada 15 s e só então descartava torneios não encerrados. | Trabalho e transferência de registros não relevantes no reconciliador. | **Corrigido**: consulta filtrada por `status='closed'`, parâmetro SQL seguro. |
| A04 | **Baixo — confirmado por código** | `static-asset-versioning.js`: quatro scripts auxiliares carregados pelo HTML estavam fora da lista de arquivos com hash automático. | Após publicações, suas URLs continuavam dependentes de marcadores manuais e revalidação do navegador. | **Corrigido**, mantendo CDN e Socket.IO dinâmico intactos. |
| R01 | **Alto — risco operacional, não reproduzido** | `render.yaml`, `service-readiness.js`, `room-snapshot-store.js`, `ranking-store.js`: o modo produção exige PostgreSQL funcional; o armazenamento JSON local usa arquivos no filesystem. | Se banco/configuração falhar, disponibilidade e histórico podem ser afetados; arquivo local não deve ser a fonte de verdade em hospedagem efêmera. | **Sem alteração**: verificar `/ready`, `DATABASE_URL`, backups e restauração na implantação. |
| R02 | **Alto — regra de retenção existente** | `tournament-podium-archive.js`, `cleanup()`, e `server.js`, `cleanupCompletedTournamentData()`: após confirmação do pódio, o projeto remove registros operacionais de mesas, fases, inscrições e cadastro do torneio; guarda o pódio. | O histórico detalhado do campeonato deixa de estar disponível, mesmo que o pódio sobreviva. | **Não alterado**: exige decisão explícita se o negócio deve preservar o histórico completo. |
| R03 | **Médio — risco de escala não medido** | `server.js`, `reconcileTournamentProgress()` e `cleanupCompletedTournamentData()`: ciclos de 15/30 s realizam consultas e transações; o primeiro já recebeu filtro seletivo. | Sob muitos torneios e falhas de banco, o custo pode crescer. | Medir consultas e latência no PostgreSQL antes de criar índices ou mudar intervalos. |
| R04 | **Médio — risco de desempenho não medido** | `public/app.js` (308 KB), `public/styles.css` (312 KB), fluxo de WebRTC `sampleLiveVoiceInboundRtpHealth()` (1,2 s quando há peers). | Parsing, renderização ou medições WebRTC podem ser relevantes em celulares modestos. | **Não alterado**: fragmentação e frequência de coleta precisam de perfil real e testes móveis. |
| R05 | **Médio — lacuna de validação** | `tests/socketio-integration-v4063.test.js` importa dependência ausente (`socket.io-client`). Node local v22.16.0; configuração pede v22.22.0. | Não foi possível certificar o fluxo Socket.IO de ponta a ponta nem a configuração exata de produção. | Instalar dependências e executar `npm run verify` com Node 22.22.0 no CI/Render. |

**Nenhuma falha crítica de perda de dados foi comprovada nesta execução.** Isso não demonstra ausência de falhas desconhecidas. Não foi feita auditoria de segurança dinâmica, pentest, `npm audit` concluído ou teste de concorrência real com PostgreSQL.

## 4. Correções implementadas e preservação de compatibilidade

### 4.1. Atualização automática do torneio

**Arquivo:** `public/tournament-auto-refresh.js`.

O scheduler agora registra o estado `paused`. `queue()` e o `finally` de `tick()` não agendam novamente quando pausado; `resume()` retoma o ciclo sem criar uma segunda consulta simultânea; `stop()` limpa timer e estado. A requisição já iniciada **não é artificialmente cancelada**. O estado dos torneios, o período de 15 s e a frequência de atualização da lista permanecem iguais enquanto o diálogo está ativo.

**Regressão:** `tests/tournament-auto-refresh-v4069818.test.js` passou, inclusive no cenário novo em que a pausa ocorre com uma promessa HTTP ainda não resolvida.

### 4.2. Relógio apenas quando necessário

**Arquivo:** `public/tournament-ui.js`.

Substituído o timer permanente de 1 s por `startTournamentClock()` e `stopTournamentClock()`. A abertura do diálogo inicia o relógio uma única vez; fechamento e `document.hidden` param o timer; visibilidade restaurada retoma o relógio. Trata-se apenas do **contador visual**; os prazos de servidor, o início manual, a classificação e a vitória por ausência **não mudaram**.

**Regressão:** teste com DOM simulado comprova 0 timers com diálogo fechado, 1 ao abrir, 0 ao ocultar, 1 ao voltar e 0 ao fechar. Não houve teste real em Safari/Android/iPhone.

### 4.3. Consulta seletiva dos torneios encerrados

**Arquivos:** `tournament-catalog.js` e `server.js`.

`TournamentCatalog.list()` recebeu o parâmetro opcional `status`, usado apenas se o valor é permitido. Em PostgreSQL, a filtragem usa `WHERE status=$1`; no modo JSON, seleciona os registros equivalentes. Sem o parâmetro, a listagem pública continua incluindo todos os status. O reconciliador usa `list({status:'closed'})` em sua rotina existente de 15 s. Não houve índice, migração, exclusão ou alteração de esquema.

**Regressão:** lista completa, filtrada e SQL parametrizado cobertos em `tests/auditoria-torneios-v4069855.test.js`. A criação da fase, o campeão e as regras de avanço não foram alterados.

### 4.4. URLs versionadas por hash

**Arquivo:** `static-asset-versioning.js`.

Adicionados `media-session.js`, `controls-positioning.js`, `tournament-schedule.js` e `tournament-auto-refresh.js` à lista de recursos versionados automaticamente. `index.html` original e parâmetros legados continuam iguais em disco; o servidor prepara o HTML com o hash dos bytes no boot, como já fazia para `app.js` e `styles.css`.

**Regressão:** os quatro endereços usam hash do conteúdo; o script `/socket.io/socket.io.js` e os scripts de terceiros não são alterados. Nenhum Service Worker ou cache offline foi introduzido.

## 5. Arquivos modificados/adicionados

| Tipo | Arquivo | Finalidade |
|---|---|---|
| Modificado | `server.js` | Identificador V40.69.8.55 e filtro na reconciliação |
| Modificado | `tournament-catalog.js` | Listagem seletiva em SQL/JSON |
| Modificado | `public/tournament-auto-refresh.js` | Pausa de polling segura |
| Modificado | `public/tournament-ui.js` | Timer visual com ciclo de vida correto |
| Modificado | `static-asset-versioning.js` | Cobertura dos quatro scripts auxiliares |
| Modificado | `tests/tournament-auto-refresh-v4069818.test.js` | Casos adicionais do relógio e da pausa |
| Novo | `tests/auditoria-torneios-v4069855.test.js` | Filtro, parâmetros SQL e cache por conteúdo |
| Novo | `scripts/bench-tournament-catalog-v4069855.js` | Microbenchmark sintético reproduzível |
| Modificado | `CHANGELOG.md` | Registro das mudanças e limitações |
| Novo | `docs/RELATORIO_AUDITORIA_V40_69_8_55.md` | Cópia deste relatório no projeto |

**Não modificados:** `game-engine.js`, `ranking-store.js`, `room-snapshot-store.js`, módulos de sorteio/classificação/finalização, CSS, `public/app.js`, arquivos de configuração de banco, `package.json` e `package-lock.json`. Não foram executados comandos SQL de migração ou deleção de registros.

## 6. Resultados dos testes

| Verificação | Resultado | O que realmente foi validado |
|---|---|---|
| Arquivos `*.test.js` executados individualmente | **227 aprovados / 228 totais** | Testes locais; muitos usam mocks, VM e armazenamento temporário |
| `tests/socketio-integration-v4063.test.js` | **Não executado com sucesso: dependência ausente** | Falta `socket.io-client`, não uma falha de regra do jogo |
| `node --check` dos 291 arquivos `.js` | **Aprovado** | Sintaxe de JavaScript, não comportamento completo |
| `node scripts/check-lockfile.js` | **Aprovado** | Lockfile v3 consistente; 5 dependências diretas |
| Pausa durante requisição pendente | **Defeito reproduzido antes, regressão aprovada depois** | Antes: 1 timer indevido; depois: 0 |
| Timer do diálogo oculto/fechado | **Aprovado com DOM simulado** | Ciclo de vida do timer, sem medição real de CPU |
| Consulta filtrada SQL/JSON | **Aprovado com mocks/objetos locais** | Seleção e parâmetros, não plano de execução PostgreSQL |
| URLs de scripts versionadas por hash | **Aprovado** | HTML gerado a partir de arquivos no disco |
| Banco PostgreSQL em produção | **Pendente** | Não houve credenciais nem instância real de ensaio |
| Testes WebRTC/Socket.IO com dispositivos reais | **Pendente** | Falta ensaio de rede/áudio/vídeo multiusuário |
| Teste de carga por horas, uso de RAM/CPU do Render | **Pendente** | Não há série temporal anterior/posterior em hospedagem |
| `npm audit` / `npm run verify` completo | **Pendente** | `npm ci` não concluiu neste ambiente; alvo é Node 22.22.0 |

**Cuidado com a interpretação:** executar 227 scripts de teste em paralelo controlado não é a mesma coisa que a suíte oficial `npm test` rodar toda de ponta a ponta em sequência. A implantação só deve ser homologada após `npm ci` e `npm run verify` concluírem no ambiente configurado.

## 7. Comparação de desempenho: evidência disponível

### 7.1. Microbenchmark sintético de listagem local

Com `node scripts/bench-tournament-catalog-v4069855.js`, usando **10.000 torneios em memória (500 encerrados), 30 repetições, Node v22.16.0**, observou-se:

| Operação simulada | Mediana de duração |
|---|---:|
| Listagem anterior, todos os 10.000 registros | **3,247 ms** |
| Nova consulta lógica, apenas os 500 encerrados | **0,140 ms** |

Essa diferença demonstra o benefício de **não processar registros irrelevantes no cenário sintético**; **não é uma medida de aumento de velocidade do aplicativo**. No PostgreSQL real, o custo dependerá de índices, tamanho da tabela, cache, latência e plano de execução. O script está incluído para repetir a medição, sem credenciais e sem dependências de produção.

### 7.2. Eliminação de tarefas visuais inativas

Na base, o código registrava 1 callback de relógio por segundo por aba, mesmo com a janela de torneios fechada. Após a alteração, são **0 callbacks desse relógio quando o diálogo está fechado ou a página oculta**. Isso foi validado por teste de temporizadores; não foi medida a economia de bateria/RAM no celular.

### 7.3. Métricas não disponíveis

**Não há números confiáveis de antes/depois** para FPS, LCP, TTI, tamanho total da rede, heap do Chrome, consumo de CPU no Render, p95 das APIs, throughput Socket.IO, locks PostgreSQL ou tempo de recuperação real após reinício. Publicar percentuais nessas métricas seria especulação.

## 8. Monitoramento recomendado em produção

O projeto já inclui `/health` e `/ready`, diagnóstico de conexões e amostragem opcional em `runtime-connection-monitor.js`. Antes de decidir outra otimização, coletar no mesmo ambiente, por período comparável:

- `/ready`: funcionamento do PostgreSQL e das sessões; qualquer 503 deve bloquear a aprovação da publicação.
- Latência p50/p95 de `/api/tournaments`, consultas de uma mesa, reconexão e persistência de snapshot.
- Memória RSS, event-loop delay e CPU com `MAUMAU_RUNTIME_MONITOR=1`, sob amostragem curta supervisionada.
- Desconexões simultâneas por sala, horário e motivo; correlacionar com reinício/hibernação do serviço.
- FPS, memória da aba, rede e WebRTC com 2–5 jogadores e observadores em celulares modestos.
- Tempo de conclusão de torneio, persistência final e reentrada dos classificados após perda de conexão.

Não registrar cookies, tokens, cartas privadas, senhas nem mídia nos logs.

## 9. Plano de homologação e publicação no Render

1. **Antes do deploy:** confirme o backup recuperável do PostgreSQL, a integridade do histórico de ranking e os torneios em andamento. Guarde o ZIP V40.69.8.54 para rollback. **Não** restaure backups sobre dados mais recentes sem análise de transações.
2. **Arquivos:** se a plataforma usa upload da pasta completa, descompacte o ZIP integral preservando a estrutura. Para atualização de um repositório existente, o ZIP de modificações contém somente caminhos criados/alterados.
3. **Configuração:** mantenha `DATABASE_URL`, `AUTH_SESSION_SECRET` e chaves atuais no painel Render; nunca as inclua no repositório. Node configurado pelo projeto: **22.22.0**. Não há novas variáveis obrigatórias.
4. **CI/build:** na raiz, executar `npm ci --no-audit --no-fund` e `npm run verify`. A configuração do Render já faz essas verificações no build. Se falharem, **não** avance para produção.
5. **Saúde:** após o deploy, verifique `/ready` com HTTP 200 e `releaseVersion` **V40.69.8.55**; também inspecione `/health`. A numeração técnica `version` pode seguir `40.69.8-rank.11` deliberadamente.
6. **Testes manuais críticos:** partida normal, Queima, compra, revanche, ranking, tela de torneios aberta/fechada, inscrição, sorteio, término de uma mesa, classificação, espera, encaminhamento automático à fase seguinte, início **manual** da próxima partida, observador e saída/reentrada; reiniciar o servidor durante um cenário de recuperação controlado.
7. **Rede real:** testar 2–5 aparelhos simultâneos, alternar Wi-Fi/dados móveis, bloquear/desbloquear celular, F5, perda temporária da rede, retorno de microfone/câmera e observadores.
8. **Comparação:** registrar as mesmas métricas antes/depois em janelas equivalentes; interromper ou reverter a implantação diante de aumento de erros, duplicidade de resultados, perda de vagas ou degradação persistente.

**Rollback:** reinstale o ZIP anterior somente após avaliar a compatibilidade com o estado atual do banco. Esta versão não exige migração e não alterou estruturas de armazenamento. Não reverta ou apague dados persistidos como procedimento automático.

## 10. Próximas prioridades (não implementadas nesta versão)

1. **Alto:** decidir a política de histórico dos torneios concluídos antes de modificar a limpeza atual do pódio. Se for necessário histórico integral, criar primeiro armazenamento permanente e estratégia de migração validada com dados de ensaio.
2. **Alto:** homologar Socket.IO, PostgreSQL e recuperação de sessões com múltiplos clientes reais; executar o teste de integração bloqueado.
3. **Médio:** analisar `EXPLAIN (ANALYZE, BUFFERS)` das consultas mais frequentes em um banco de homologação; propor índices somente com evidência e plano seguro de migração.
4. **Médio:** coletar perfis de CPU, memória, DOM e WebRTC em smartphones; só então considerar divisão de scripts, adição de `defer` ou redução de amostragem.
5. **Médio:** executar soak test de horas com monitoramento de heap, timers, eventos duplicados, reconexão e integridade dos resultados.
6. **Baixo:** documentar critérios de manutenção e limpeza de registros temporários, preservando as informações históricas.

## 11. Conclusão

A V40.69.8.55 é uma **atualização conservadora de estabilidade e eficiência**, com correções identificadas, reprodução de bug, testes locais e alterações limitadas. **Não é uma certificação de ausência de bugs, nem uma demonstração de melhoria generalizada no desempenho de produção.** O que é possível afirmar é que a rotina de atualização do torneio já não rearma timer durante pausa, o relógio visual não permanece ativo com o diálogo fechado, o reconciliador não pede todos os torneios quando só precisa dos encerrados e os scripts auxiliares recebem URLs versionadas automaticamente. A regra do jogo e o armazenamento persistente não foram modificados.

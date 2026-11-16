# MAU-MAU CANDEIAS — Auditoria e correção pontual dos torneios — 16/11/2026

## Origem e escopo

Arquivos analisados no ZIP completo do projeto enviado pelo usuário em 16/11/2026. O screenshot mostra um torneio em `Em preparação` e a mensagem `Não foi possível consultar o torneio.`. As alterações se limitam à consulta do campeonato, leitura do status das mesas, declaração correta de campeão, recuperação de inicialização dos módulos e aviso para campeonatos que não pertencem ao usuário.

Não foram alterados: regras das cartas (Queima, Dupla, Rápida), tamanho das cartas, ranking, Socket.IO das partidas regulares, câmera, microfone ou schemas PostgreSQL.

## Falhas identificadas e correções

### 1 — Consultar torneio retorna HTTP 503 apesar de o banco estar disponível (CRÍTICO)

Na rota `GET /api/tournament` o operador `await` antecedia a condição `tournamentBracketReady`, mas **não aguardava** a função assíncrona `tournamentBracket.summary(...)`. O código recebia uma `Promise` em vez do objeto `bracket`. A leitura seguinte de `bracket.stages.find(...)` falhava com TypeError, que era capturado pelo `catch` e convertido na mensagem `Não foi possível consultar o torneio.`.

**Correção:** aguardar explicitamente `tournamentBracket.summary(config.id,tables)`, após validar a prontidão do módulo. Teste isolado da rota verifica resposta HTTP 200 nas fases classificatória e final.

### 2 — Primeira mesa encerrada declara vencedor prematuramente (CRÍTICO)

A função `TournamentBracket.summary(...)` declarava campeão quando a etapa mais recente tinha uma única mesa registrada e terminada, mesmo que o sorteio inicial contivesse muitas mesas e os demais resultados ainda não tivessem sido registrados. Como outros endpoints bloqueiam entradas enquanto `bracket.champion` existe, isso podia congelar torneios com 6 a 100 participantes.

**Correção:** campeão somente em etapa terminal (final ou classificatória única) e, no caso de classificatória, com correspondência a todas as mesas inicialmente sorteadas.

### 3 — Status das partidas registrado como Promise, não como dados (ALTA)

A rota montava `recordedGames` com `tournamentGames.statuses(...)` sem `await`. Por isso, estados persistidos de mesas (`created`, `finished`, `result`) não eram refletidos corretamente na resposta da API quando a sala não estava em memória.

**Correção:** aguardar a consulta assíncrona antes de montar a resposta.

### 4 — Falha transitória do PostgreSQL deixava torneios indisponíveis até reinício (ALTA)

A inicialização de inscrições, catálogo, sorteio, jogos e fases era uma cadeia de `Promise` resolvida uma única vez. Se um módulo falhasse durante a inicialização, a disponibilidade ficava `false` permanentemente, mesmo quando a conexão com o PostgreSQL voltasse.

**Correção:** utilizar o mecanismo existente `createRetryableInitialization` para cada módulo, com tentativa única concorrente e intervalo mínimo de 5 segundos após falha. As chamadas de API e WebSocket agora podem desencadear a reavaliação da prontidão.

### 5 — Torneio padrão/legado não pertence ao jogador (USABILIDADE)

O catálogo inclui por padrão uma Copa com `createdBy='legacy-v51.1'`. Um jogador autenticado comum não tem permissão para alterar, abrir inscrições, sortear ou excluir essa Copa. Na lista, ela aparece como `Em preparação`, o que pode parecer um torneio bloqueado.

**Correção:** ao selecionar um torneio que não pode administrar, a interface informa que é preciso criar um próprio campeonato; permissões existentes permanecem as mesmas.

## Fluxo esperado após atualização

1. Jogador autenticado abre **Torneios** e consulta a lista normalmente.
2. Preenche nome, número de vagas (2 a 100) e data/hora opcional, clica **Criar torneio**.
3. No torneio de sua autoria, clica **Abrir inscrições**. Jogadores autenticados fazem inscrição pelo botão **Inscrever-me**.
4. Organizador clica **Encerrar inscrições** quando houver pelo menos duas pessoas.
5. Organizador aciona **Sortear mesas**. O sorteio é único; participantes e cadeiras são registrados.
6. Cada jogador sorteado clica **Entrar na minha mesa**; todos devem estar presentes para iniciar a primeira rodada.
7. Ao terminar as partidas, o resultado é gravado, os classificados passam automaticamente às próximas fases quando todas as mesas necessárias forem concluídas; o campeão só aparece na etapa final.
8. Observadores podem assistir às mesas ativas, sem ocupar vagas, sem chat, câmera ou microfone, conforme o modo já implantado.

## Validação executada

- Testes específicos de `TournamentCatalog`, `TournamentStore`, `TournamentDraw`, `TournamentGames`, `TournamentBracket` e observação de torneio: aprovados.
- Novo teste `tournament-operational-flow-hotfix.test.js`: aprovado com casos de API HTTP simulada (fases classificatória/final), estados de jogos, 6/9/20/100 jogadores com apenas uma mesa concluída, mesa única com campeão e retomada após falha temporária.
- Suíte local: **184 testes aprovados**; **1 teste Socket.IO não executado**, pois `socket.io-client` não está instalado neste ambiente.
- `node --check server.js`, `tournament-bracket.js` e `public/tournament-ui.js`: sem erros de sintaxe.

## Limitações e riscos residuais

- Não foi possível executar sessões reais entre múltiplos navegadores nem acessar o Render e o PostgreSQL de produção. O teste integral de criação, inscrições, sorteio, primeira rodada, fechamento, gravação de resultados, reinício do servidor e avanço de fase deve ser feito em homologação após deploy.
- A persistência real de torneios requer PostgreSQL (`DATABASE_URL`); o modo JSON local não garante sobrevivência aos ciclos de instância gratuita no Render.
- Se a sala de torneio terminar e o snapshot não for recuperável após reinício, a vinculação persistida do número da mesa com um código de sala anterior poderá impedir entrada; este caso não foi reestruturado para não interferir no mecanismo global de reconexão e deve integrar o próximo teste de carga/failover.
- Resultados incompletos, participantes ausentes e abandono precisam de uma política operacional explícita para desempate/WO; o sistema atual bloqueia avanço com resultado incompleto, evitando classificação fictícia.
- Logs de produção devem ser revisados para afastar outras possíveis causas de `503`, como permissões ou indisponibilidade de banco.

## Instalação

1. Fazer backup da versão atual.
2. Substituir no repositório somente os arquivos contidos no ZIP incremental, respeitando a estrutura de pastas.
3. Fazer commit/push, conferir deploy `Live` no Render e atualizar a página do jogo.
4. Usar **duas ou mais contas autenticadas**; para testar avanço de várias mesas, usar pelo menos seis contas.
5. Conferir a sequência: criar → abrir inscrições → inscrever → fechar inscrições → sortear → entrar nas mesas → iniciar a partida → registrar resultados → avançar fases → campeão.
6. Se o Render ainda retornar `503`, procurar nos logs a marca `[tournament]` e a exceção subsequente; não apagar torneios ou dados do PostgreSQL sem backup.

O `package.json` não foi alterado, para preservar o versionamento interno e as dependências da versão enviada.

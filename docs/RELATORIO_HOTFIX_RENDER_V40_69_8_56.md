# MAU-MAU CANDEIAS — Relatório técnico do hotfix V40.69.8.56

**Data:** 23/11/2026  
**Base:** projeto completo V40.69.8.55 anteriormente entregue  
**Finalidade:** solucionar a falha de build evidenciada no log do Render, sem comprometer as otimizações e regras existentes.

## 1. Problema comprovado no Render

A captura do Render registra:

- `tests/auditoria-torneios-v4069855.test.js:33:10`;
- `ERR_ASSERTION`, operador `match`;
- exigência literal `const events=await tournamentCatalog.list({status:'closed'})`;
- encerramento `Build failed`.

O teste tinha duas fragilidades: comparava **formatação exata de código-fonte** e, quando falhava, imprimia praticamente todo o `server.js` (centenas de milhares de caracteres), dificultando o diagnóstico. Ao inspecionar diretamente o ZIP completo da V40.69.8.55, confirmei que a chamada esperada **está presente** e o teste **passa localmente** com esse ZIP. Assim, a execução mostrada na captura utilizou um `server.js` diferente do código presente no pacote examinado, ou a instrução tinha outra forma no código efetivamente publicado. Arquivos de versões misturadas ou commit/branch/root directory diferentes são hipóteses plausíveis, **não comprovadas** sem acesso ao repositório/commit do deploy.

**Classificação:** **alto**, porque a falha impediu a publicação; não há evidência de que tenha corrompido partidas ou dados.

## 2. Correção implementada

**Nova versão funcional:** `V40.69.8.56` (em `server.js`, refletida por `/ready` quando a aplicação consegue iniciar).

| Arquivo | Alteração | Justificativa |
|---|---|---|
| `server.js` | Atualização de `RELEASE_VERSION` para `V40.69.8.56` | Identificação verificável da revisão e preservação do reconciliador otimizado |
| `tests/auditoria-torneios-v4069855.test.js` | Substituição da comparação textual rígida por verificações de versão mínima e consulta seletiva, limitadas ao reconciliador e tolerantes a espaços/aspas | Manter proteção contra regressão, evitar falsos erros de formatação e produzir mensagem curta de diagnóstico |
| `CHANGELOG.md` | Registro da atualização | Histórico de mudanças |
| `docs/CORRECAO_BUILD_RENDER_V40_69_8_56.md` | Guia de aplicação, verificação de commit e publicação | Evitar instalação parcial/mista |
| `docs/RELATORIO_HOTFIX_RENDER_V40_69_8_56.md` | Inclusão deste relatório no projeto | Rastreabilidade da entrega |

**Regra de segurança:** o teste **ainda falha** se a rotina `reconcileTournamentProgress()` chamar `tournamentCatalog.list()` sem o filtro `status:'closed'`. Ele também testa, com `fakePool`, a SQL `WHERE status=$1`, o parâmetro `'closed'`, a listagem sem filtro e o versionamento dos assets.

**Nenhuma mudança** foi feita em classificação, fase seguinte, sorteio, criação de salas, jogada Queima, jogadores/observadores, início manual das partidas, ranking, banco de dados, permissões ou layout. Sem migração ou exclusão de dados.

## 3. Testes executados nesta entrega

| Verificação | Resultado | Limitação |
|---|---|---|
| `node tests/auditoria-torneios-v4069855.test.js` com o pacote V40.69.8.56 | **Aprovado** | Verificações simuladas e estáticas, não Render |
| Reprodução de código incongruente: removido TEMPORARIAMENTE apenas o filtro de `server.js`, executado teste e restaurado o arquivo | **Falha detectada intencionalmente**, mensagem clara `[BUILD/MISTURA_DE_VERSOES]`; depois o teste voltou a passar | Simulação local, não recuperação de repositório remoto |
| Todos os testes `*.test.js` executados individualmente | **227 aprovados de 228** | Um teste bloqueado por ausência de `socket.io-client` no ambiente local |
| Verificação de sintaxe de arquivos JS com `node --check` | **291/291 aprovados** | Não substitui execução integrada |
| `npm run verify:lock` | **Aprovado** | `package.json` e `package-lock.json` mantidos sem mudanças |
| `npm run verify` com dependências completas do Render | **Pendente** | Depende da instalação npm e do ambiente de implantação |
| PostgreSQL real, vários jogadores, celular e teste prolongado no Render | **Pendente** | Nenhum acesso ao ambiente de produção foi realizado |

**Ferramenta de teste local:** Node.js 22.16.0. O projeto fixa Node.js 22.22.0 no `package.json`; a checagem exata nessa versão deve ser feita no ambiente de implantação.

O único teste não executável localmente foi `socketio-integration-v4063.test.js`, devido a `MODULE_NOT_FOUND` de dependência externa ausente. Isso **não** é evidência de que a aplicação falhará no Render depois de `npm ci`, mas tampouco valida sua conectividade em produção.

## 4. Publicação correta no GitHub / Render

1. Usar preferencialmente o arquivo **PROJETO COMPLETO V40.69.8.56**, e não mesclar arquivos da versão 55 com arquivos da versão 54.
2. Extrair o ZIP e copiar **o conteúdo** de `mau-mau-multiplayer-main/` para a **raiz efetiva** do repositório (sem aninhar a pasta).
3. No mesmo commit, confirmar `server.js`, `tournament-catalog.js`, `tests/auditoria-torneios-v4069855.test.js` e todos os arquivos distribuídos nesta versão.
4. No GitHub, conferir que `server.js` contém `V40.69.8.56`, e que `reconcileTournamentProgress()` chama `tournamentCatalog.list({status:'closed'})`; conferir que o catálogo usa filtro SQL parametrizado `WHERE status=$1`.
5. Verificar se o Render acompanha a **branch e o diretório raiz corretos**. `render.yaml` usa `npm ci` e `npm run verify` durante o build.
6. Após o push, verificar o commit que aparece em **Render > Events**, a conclusão de `Build succeeded`, a inicialização e `GET /ready` com `releaseVersion` `V40.69.8.56`. Se necessário, usar o redeploy limpando cache; isso **não** exige limpar a base de dados.
7. Só depois, homologar uma partida, Queima, sorteio, classificação, transição para próxima fase, início manual, reconexão e observadores.

Se aparecer `[BUILD/MISTURA_DE_VERSOES]`, **não remova nem ignore o teste**: o `server.js` efetivamente implantado ainda não tem a consulta requerida. Compare o commit no Render com o ZIP distribuído.

## 5. Avaliação e riscos remanescentes

A entrega trata **especificamente a falha de validação/build**, melhorando sua capacidade de diagnóstico e fornecendo distribuição coerente, sem prometer corrigir qualquer problema não observado em produção. O resultado real do deploy dependerá de publicar todos os arquivos da mesma versão e de executar `npm ci`/`npm run verify` no ambiente conectado ao Render. A otimização do reconciliador da V40.69.8.55 é preservada; não foi feita nova medição de desempenho de produção.

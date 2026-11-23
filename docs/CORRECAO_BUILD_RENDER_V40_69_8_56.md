# V40.69.8.56 — Correção da falha de build no Render

## Diagnóstico do log enviado (23/11/2026)

O deploy foi interrompido em `tests/auditoria-torneios-v4069855.test.js:33`:
`ERR_ASSERTION`, `operator: match`, padrão esperado:
`/const events=await tournamentCatalog\.list\(\{status:'closed'\}\)/`.

Isso significa que **o conteúdo de `server.js` lido pelo teste na execução do Render não continha a chamada esperada com aquela forma textual**. O ZIP completo V40.69.8.55 entregue anteriormente foi reinspecionado: ele contém a chamada esperada e **o mesmo teste passa localmente**. Portanto, há indício forte de arquivos misturados, alteração intermediária no repositório ou fonte diferente da examinada. Não é possível determinar qual hipótese sem consultar o commit efetivo do deploy.

A verificação era excessivamente rígida no formato, não apenas na funcionalidade: além disso, um `assert.match()` que falha despeja todo o `server.js` no log, atrapalhando o diagnóstico. A V40.69.8.56 mantém a verificação de que o reconciliador faz a consulta filtrada e que o catálogo a implementa, mas fornece erro curto e específico se houver incompatibilidade.

## Instalação recomendada (substituição completa dos arquivos)

1. Baixe `MAU_MAU_CANDEIAS_V40_69_8_56_COMPLETO.zip`.
2. Extraia o ZIP. Dentro dele existe a pasta `mau-mau-multiplayer-main/`. **Publique o conteúdo dessa pasta na raiz efetiva do projeto GitHub/Render.** Não crie uma segunda pasta aninhada.
3. Confirme no mesmo commit os arquivos `server.js`, `tournament-catalog.js`, `tests/auditoria-torneios-v4069855.test.js`, `public/tournament-auto-refresh.js` e `public/tournament-ui.js` da mesma distribuição.
4. Confirme que `server.js` tem `const RELEASE_VERSION = 'V40.69.8.56';` e que `reconcileTournamentProgress()` contém `tournamentCatalog.list({status:'closed'})`.
5. Confira que `tournament-catalog.js` tem `async list({actor='',isAdmin=false,status=null}={})` e usa `WHERE status=$1` para consultas filtradas (sem remover a listagem completa das APIs).
6. Na raiz do projeto, execute `npm ci --no-audit --no-fund`, depois `node tests/auditoria-torneios-v4069855.test.js` e `npm run verify`. Nenhum dos testes deve acessar banco de produção; o `run-all.js` já limpa `DATABASE_URL` em cada script.
7. Envie o commit à branch conectada ao Render, abra **Events** e confirme que o deploy corresponde ao commit atualizado. Caso o Render use outra branch ou root directory, corrija essas configurações antes de reimplantar. Para evitar cache antigo, use a opção de redeploy/limpar cache do Render quando necessário.
8. Só depois do build aprovado, confira o endpoint `/ready`: deverá informar `releaseVersion: "V40.69.8.56"`. Mantenha teste de partida e torneio em homologação antes de usar com jogadores reais.

## Como diferenciar uma correção verdadeira de ocultação de erro

O teste da V40.69.8.56 ainda falha se o reconciliador não fizer a chamada filtrada; não comentamos o teste, não ignoramos o erro e não mudamos a política de banco ou classificação. O teste do catálogo ainda confere a SQL parametrizada e a ausência de filtros na listagem pública. Se o novo pacote produzir o erro `BUILD/MISTURA_DE_VERSOES`, não prosseguir com o deploy até verificar o conteúdo real do commit.

## Segurança

Nenhum comando de migração, exclusão de dados ou limpeza de tabelas é necessário. Não altere `DATABASE_URL`, credenciais ou volumes persistentes para corrigir esta falha de build. **Não apague os dados do Render.**

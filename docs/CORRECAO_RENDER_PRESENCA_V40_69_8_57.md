# MAU-MAU CANDEIAS — publicação segura V40.69.8.57

## Erro observado em 23/11/2026

O Render mostrou `ERR_ASSERTION` em `tests/presence-snapshot-index-v4069855.test.js:54`, com
`assert(handlerStart>0&&handlerEnd>handlerStart)`. Esse teste NÃO consta dos ZIPs
completos V40.69.8.55 ou V40.69.8.56 entregues anteriormente. Portanto, o
Render estava executando pelo menos um arquivo de testes que não fazia parte
daquela entrega. Isso sugere uma árvore Git não sincronizada; não comprova
defeito na reconexão dos jogadores.

## O que foi corrigido

- Adicionado `presence-seat-index.js`: monta um índice temporário de cadeiras humanas
  ao gerar a lista de presença (uma passagem por sala), sem afetar salas,
  persistência ou gerenciamento de conexões.
- `server.js` usa esse índice durante `buildPresenceSnapshot()` e reutiliza a
  cadeira calculada no status. A função geral `roomSeatForKey` e o uso em
  consultas de jogadores recentes continuam disponíveis.
- Criado novo `tests/presence-snapshot-index-v4069855.test.js` com o MESMO nome
  do teste legado falho. Verifica efetivamente a escolha de cadeira, robôs,
  empates, duplicatas, vencimento de reconexão e a ligação ao servidor, sem
  localizar blocos de código por posições frágeis.
- Identificação funcional: `V40.69.8.57`. Não há migração de dados nem mudança
  de regras, banco, dependências, layout ou classificações dos torneios.

## Passo a passo no GitHub / Render

1. **Preferir o ZIP COMPLETO**. Extrair e copiar o CONTEÚDO da pasta
   `mau-mau-multiplayer-main/` para a raiz do clone do repositório conectado ao Render.
   Não criar um segundo diretório `mau-mau-multiplayer-main/` dentro da raiz.
2. Substituir explicitamente estes três arquivos no mesmo commit:
   `server.js`, `presence-seat-index.js` e
   `tests/presence-snapshot-index-v4069855.test.js`. Inclua também o restante
   do ZIP para preservar uma versão coerente.
3. Atenção: **apenas adicionar arquivos no GitHub não exclui arquivos antigos**.
   Compare a pasta `tests/` do repositório com a pasta `tests/` do ZIP: revise
   individualmente testes extras e exclua os que forem sobras obsoletas de
   outras versões. **Não apague testes legítimos sem verificar.**
4. No GitHub, abra o teste `tests/presence-snapshot-index-v4069855.test.js`:
   ele deve começar com `// Regressão funcional para o índice de presença` e
   NÃO deve conter `assert(handlerStart>0&&handlerEnd>handlerStart)`.
5. Verifique que `server.js` contém `V40.69.8.57`, importa
   `./presence-seat-index` e utiliza `indexPresenceSeats(rooms,now)`.
6. Confirme branch e Root Directory em Render, veja o commit implantado em
   **Events** e execute novo deploy. `render.yaml` continuará usando
   `npm ci && npm run verify` antes de iniciar o serviço.
7. Quando a publicação concluir, confirme `/ready` com
   `releaseVersion: V40.69.8.57`; depois teste partida, lista de jogadores
   online, reconexão e um torneio completo.

## Limitações dos testes

No ambiente desta auditoria, 228/229 testes passaram. O teste
`socketio-integration-v4063.test.js` ficou bloqueado por `socket.io-client`
não instalado localmente; `npm ci` do Render deverá fornecer a dependência,
mas **o build e a estabilidade reais do Render ainda não foram validados**.
Não altere nem apague o banco, os dados dos torneios ou as variáveis de ambiente.

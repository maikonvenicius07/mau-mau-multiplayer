# Validação técnica — MAU-MAU CANDEIAS Fases 4A e 4B

## Resultado da auditoria
O ZIP `mau-mau-multiplayer-main (17)(3).zip` já possuía a Fase 4A. Hashes SHA-256 idênticos ao pacote de referência em: `server.js`, `state-delivery.js`, `public/app.js`, `public/index.html`, `public/camera-video.js`, `game-engine.js`, `tests/state-delivery-phase4a.test.js`, `tests/emit-room-phase4a.test.js`, `tests/run-all.js` e `package.json`.

As diferenças entre arquivos comuns dos pacotes são somente `README.md` e `.gitignore`, compatíveis com a limpeza do projeto feita depois; ambos foram preservados do ZIP recebido. O arquivo `docs/LIMPEZA_PROJETO_V52.md` também foi preservado.

## Fase 4B realizada
Mudança confinada a:
- `server.js` — duas chamadas em `broadcastPresence()` passam pelo filtro;
- `lobby-snapshot-delivery.js` — novo módulo de supressão de broadcasts inalterados;
- `tests/lobby-snapshot-delivery-phase4b.test.js` — novo teste de regressão.

Não foram alterados o front-end, `state-delivery.js`, `game-engine.js`, as regras, os timers, o áudio, o vídeo, o PostgreSQL nem as dependências.

## Testes
- `node --check server.js`, `node --check lobby-snapshot-delivery.js`, `node --check public/app.js`, `node --check public/camera-video.js`, `node --check public/voice-relay-worklet.js`: passaram.
- `npm run verify:lock`: passou; pacote de dependências permanece válido.
- **144 testes automatizados executados e aprovados**, incluindo testes antigos da Fase 4A e novo teste da Fase 4B.
- 1 teste adicional (`tests/socketio-integration-v4063.test.js`) **não executado** porque o ambiente não tinha `socket.io-client` instalado. Ele não foi contado como aprovado.

## Casos novos exercitados
- Retransmissão inicial obrigatória para `presenceSnapshot` e `publicRoomsSnapshot`.
- Segunda chamada sem mudanças (apenas `at` diferente): não reenvia.
- Mudança de nome de jogador online: envia presença atualizada.
- Mudança na quantidade de observadores: envia salas atualizadas.
- Cache por evento independente.
- Instância nova do servidor: novo broadcast inicial.
- Campo `at` preservado no payload enviado.
- Dados não serializáveis: falha aberta, sem supressão.
- Execução da função `broadcastPresence` extraída do `server.js` real.
- Preservados os caminhos de snapshot individual inicial e consulta explícita de salas.

## Medições e limitações
A otimização evita transmissões de listas idênticas, mas ainda calcula a lista e compara os dados. Não foi realizada medição real de banda, CPU ou memória em Render nem teste com dispositivos reais no ambiente. Não é seguro afirmar redução de travamentos sem monitoramento pós-deploy.

# MAU-MAU CANDEIAS — Otimização Fase 4B

## Base confirmada
Esta atualização foi feita diretamente sobre o ZIP `mau-mau-multiplayer-main (17)(3).zip` enviado pelo usuário. A Fase 4A já estava instalada e foi mantida integralmente.

## Objetivo e escopo
Reduzir **somente broadcasts globais repetidos** de `presenceSnapshot` (jogadores online) e `publicRoomsSnapshot` (salas públicas).

Os dois snapshots carregam `at: Date.now()`; antes, cada chamada de `broadcastPresence()` retransmitia ambos mesmo se nenhuma lista tivesse mudado. Agora o servidor compara somente os campos de conteúdo, ignorando `at` para decidir se deve retransmitir. Quando há alteração verdadeira, envia o objeto original, inclusive o horário `at`.

## Instalação pelo GitHub
Se a Fase 4A está publicada, use apenas o ZIP de atualização:
1. Substitua `server.js` na raiz do repositório.
2. Adicione o **novo** `lobby-snapshot-delivery.js` na raiz (obrigatório).
3. Adicione `tests/lobby-snapshot-delivery-phase4b.test.js` e esta documentação, se desejar os testes.
4. Faça o commit e verifique o deploy no Render.

Para uma instalação nova, utilize o ZIP de projeto completo, que inclui a Fase 4A e as fases anteriores.

## O que foi preservado
- `state` individual das partidas da Fase 4A (não passou pelo filtro 4B).
- Primeiro `presenceSnapshot` e `publicRoomsSnapshot` enviados diretamente a cada nova conexão.
- Resposta a `requestPublicRooms`, mesmo quando o conteúdo não mudou.
- Convites, matchmaking, ranking, torneios, câmeras, microfones e regras das cartas.
- Toda a interface mobile, os IDs e os controles existentes.
- Arquivos de limpeza e organização da versão enviada pelo usuário.

## Verificação em produção
Em dois celulares, teste abertura da tela inicial, jogadores online, criação/entrada de sala pública, início de rodada, entrada e saída de observador, desconexão/reconexão, botão de atualizar salas, convites e partida normal. Verifique logs de erro do servidor e do console. Compare consumo de rede antes/depois se possível.

## Limites
O teste de integração Socket.IO real não rodou localmente porque não havia `socket.io-client` instalado no ambiente. Os testes de função e regressão executaram, mas não substituem teste com dois clientes após deploy. Nenhum ganho percentual de CPU, memória ou banda em produção é afirmado.

# MAU-MAU CANDEIAS — Otimização Fase 2A (preservação de assentos)

## Base
Aplica-se **sobre a Fase 1 de desempenho**, sem substituir as mudanças dessa fase.

## Mudanças realizadas
- `public/app.js`: `renderPlayers()` preserva o elemento `.player-seat` de cada jogador identificado por ID.
- Durante alterações de nome, turno, pontuação ou cartas, o HTML da ficha é atualizado parcialmente; o avatar original e o vídeo não são reconstruídos.
- Elementos e listeners vinculados ao avatar permanecem; apenas entradas e saídas de jogadores criam/removem fichas.
- `window.MauCamera.renderIntoSeats()` permanece conectado; nenhuma API LiveKit ou WebRTC foi modificada.
- Adicionado `tests/performance-preserve-seats-phase2a.test.js` com verificações estruturais da proteção do vídeo.

## Arquivos a substituir ou adicionar
1. Substituir `public/app.js`.
2. Adicionar `tests/performance-preserve-seats-phase2a.test.js`.
3. Os demais arquivos são instruções e validação.

## Como publicar
Atualizar arquivos no GitHub, fazer commit, conferir o deploy no Render e recarregar o jogo em ambos os celulares. Preferencialmente publicar em período de testes.

## Reversão
Recolocar somente o `public/app.js` da Fase 1 caso apareça regressão (o teste novo poderá permanecer sem execução ou ser removido).

## Testes recomendados antes de avançar
- Turnos alternados, compra e descarte, carta 7, queima, carta dupla, pulo e escolha de naipe.
- Câmera do próprio jogador e de dois adversários, incluindo ampliar a câmera.
- Desligar/ligar câmera e trocar sala.
- Entrada/saída de jogadores e observadores, reconexão e retorno de participante.
- Abrir sala com 2 e 5 participantes.
- Console do navegador e logs do Render sem erros.

## Não alterado
`server.js`, `game-engine.js`, `public/styles.css`, `public/camera-video.js`, módulos WebRTC/voz, ranking, torneio, banco e regras das cartas.

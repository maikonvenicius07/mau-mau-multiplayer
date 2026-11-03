# Validação — Otimização Fase 2A

## Execução local
- Sintaxe: `node --check public/app.js` — passou.
- Suíte existente: 138 testes aprovados; 1 teste Socket.IO não executado porque falta instalação das dependências no ambiente de testes.
- Teste novo: `performance-preserve-seats-phase2a.test.js` — passou.
- Chromium headless (teste controlado de DOM): confirmação de que a mesma ficha, o mesmo avatar, o mesmo elemento `<video>` e `srcObject` continuam existindo após mudança de turno/contagem.
- O teste no navegador cobriu também mudança de avatar com vídeo conectado, listeners na raiz do avatar, inclusão e remoção de participante.

## Limitações
- O teste Chromium foi feito com estado simulado e vídeo MediaStream sem origem LiveKit real.
- Não há medição quantitativa de memória/CPU/FPS em aparelho Android.
- Não foi possível executar uma partida real envolvendo WebRTC, Socket.IO e cinco jogadores neste ambiente.
- A Fase 2A não reescreve o controlador da câmera nem os timers de áudio.

## Critérios para avançar à Fase 2B
- Concluir partida real no Render sem anomalias de turnos e cartas.
- Confirmar transmissão de câmera contínua entre dois celulares em pelo menos uma troca de turno.
- Testar reconexão e conversão do observador em jogador.
- Se houver travamento, reverter `public/app.js` para a Fase 1 e coletar logs.

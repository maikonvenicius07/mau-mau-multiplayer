# MAU-MAU CANDEIAS — Validação da otimização Fase 1

## O que foi confirmado localmente

- `node --check public/app.js` e `node --check server.js`: sintaxe válida.
- Testes de regressão presentes no ZIP: 138 aprovados em 139; integração Socket.IO não executada por ausência de dependência local.
- Teste novo da renderização seletiva: quando apenas `log` muda, o despacho preserva as seções de jogadores/mão/mesa/placar/controles; novos turnos, cartas e troca de papel disparam as atualizações apropriadas.
- Timer de convite: não inicia sem convite pendente, não duplica durante convite e encerra quando deixa de estar pendente.
- Matchmaking e reconexão: ciclos de 1 segundo habilitados somente durante a necessidade correspondente.
- `game-engine.js`, `server.js`, `camera-video.js` e `public/styles.css`: idênticos aos arquivos originais.

## Limitações

- A execução de navegador automatizado foi impedida por restrições de acesso ao browser nesta sessão. Não atribuir a esta versão ganhos quantitativos de FPS/CPU/memória não medidos.
- O teste completo Socket.IO não roda sem instalação das dependências.
- Não foram realizados testes reais de microfone, câmera, TURN, autenticação e partidas completas.

## Checklist no Render e em dois celulares

1. Entrar e sair de sala, observar console do navegador e logs do Render.
2. Jogar duas rodadas completas: compra, passe, Valete/naipe, Dama/inversão, Ás, sete, carta dupla, queima e ação rápida.
3. Testar voz ligada e desligada, câmera local e câmera de outro jogador.
4. Repetir com observador, entrada no intervalo entre rodadas e retorno a jogador.
5. Desconectar/reconectar internet durante o turno e conferir contagens, reserva e habilitação de botões.
6. Testar partida com cinco participantes e combinação de bots/humanos.
7. Verificar uso de memória/CPU do serviço no Render e desempenho no Chrome Android antes/depois. Não extrapolar resultados de simulação.

## Próxima fase sugerida

- Reconciliação por IDs estáveis dos assentos com proteção explícita do elemento de vídeo; exige testes LiveKit reais.
- Medição de broadcasts por sala e bytes por jogador/observador antes de reduzir estados.
- Diagnóstico de conexões PostgreSQL por módulo antes de compartilhar pools.

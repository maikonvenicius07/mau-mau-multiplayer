# MAU-MAU CANDEIAS — Plano de atualizações progressivas

Padrão: publicar uma versão, medir, testar com jogadores reais e só depois avançar. Nunca alterar as regras do jogo por causa de uma otimização visual.

## Concluída — Fase 1: Renderização seletiva + timers ociosos
Gatilhos separados para jogadores, cartas, centro, histórico, placar e controles; timers só durante atividade.

## Nesta entrega — Fase 2A: Preservação dos assentos
Reaproveitar `.player-seat`, `.avatar` e `<video>` entre turnos e mudanças de cartas. Mantém os listeners de ampliação no mesmo elemento. Não altera LiveKit/voz. **Validar com duas câmeras reais antes de avançar.**

## Próxima — Fase 2B: Redução de reconciliações de vídeo
Analisar `camera-video.js` (`renderIntoSeats`, `syncExpanded`, `updateLocalVideo`), verificando `play()`, `srcObject` e anexações repetidas, com testes reais de LiveKit. Risco médio. Um pacote separado.

## Depois — Fase 3: limpeza e diagnóstico WebRTC/voz
Auditar encerramento de peer connections, tracks, timeouts e reconexão. Intervenções pequenas; preservar qualidade de voz e câmera. Risco médio.

## Depois — Fase 4: broadcasts Socket.IO
Primeiro adicionar métricas sem alterar mensagens; só reduzir envios se a instrumentação demonstrar desperdício. Risco médio/alto.

## Depois — Fase 5: PWA/cache e CSS
Conferir atualização do Service Worker, assets antigos e duplicações CSS pontuais. Preservar visual. Risco médio.

## Por último — Banco de dados/pools
Só depois de medir conexões em produção e confirmar isolamento, ciclo de vida e autenticação de cada módulo.

## Checklist entre versões
- 2 celulares reais: com câmera e microfone, 2 jogadores e 1 observador.
- 1 partida completa com rodada 4/5 e entrada tardia do observador.
- Queda e retorno da conexão, sair/entrar, bot temporário.
- Testar carta 7, Valete, Dama, Ás, ação rápida, queima, carta dupla.
- Conferir console e logs no Render; comparar CPU, RAM e tráfego com a versão anterior.
- Se a nova versão falhar, fazer rollback do pacote antes de continuar.

# MAU-MAU CANDEIAS — Auditoria técnica prévia à otimização

**Origem:** `mau-mau-multiplayer-main (17)(1).zip`, fornecido pelo usuário.  
**Escopo:** inspeção estática, testes locais e planejamento de otimizações conservadoras.  
**Restrição principal:** nenhuma alteração nas regras, nas validações do servidor, nos contratos Socket.IO ou na gestão de dados privados.

## Sumário de achados e intervenções propostas

| Prioridade | Problema | Arquivo e ponto | Impacto provável | Risco | Intervenção proposta |
|---|---|---|---|---|---|
| 1 | Recepção de `state` dispara `render()` completo, sem verificar diferenças | `public/app.js`, `socket.on('state')` e `render()` | Alto: trabalho DOM repetitivo em celulares | Médio | Assinaturas separadas por componente, renderizando apenas blocos cujo dado mudou |
| 1 | A cada `renderPlayers()`, `#playersRing` é esvaziado e todas as fichas são recriadas | `public/app.js`, `renderPlayers()` | Alto quando há câmera: desconexão/reanexação visual do vídeo | Médio/alto | Evitar chamada quando assentos/turno não mudaram nesta fase; em fase posterior, reconciliação por chave com testes de mídia |
| 1 | `renderHand()` reconstrói todas as cartas, listeners e animações | `public/app.js`, `renderHand()` | Médio/alto: recriação da mão e custo de layout | Médio | Pular reconstruções quando mão, permissões e turno permanecem idênticos; preservar scroll |
| 1 | `renderScore()`, `renderLog()` e `renderControls()` alteram DOM mesmo quando não há mudanças próprias | `public/app.js` | Médio; custo adicional por atualização | Baixo | Assinaturas com as dependências visuais relevantes |
| 2 | Convites são verificados a cada 500 ms e redesenhados enquanto existem, sem necessidade | `public/app.js`, intervalo próximo de `renderInviteInbox()` | Médio, sobretudo com convites pendentes | Baixo | Agendar contagem apenas com convite pendente e atualizar somente o número de segundos |
| 2 | Matchmaking atualiza contador a cada 250 ms fora de busca | `public/app.js`, `updateMatchmakingCountdown()` | Baixo/médio, trabalho ocioso | Baixo | Contador de 1 s ativo apenas durante busca, com encerramento ao cancelar |
| 2 | Contagem de reconexão roda permanentemente a cada 250 ms | `public/app.js`, `updateReconnectCountdown()` | Baixo/médio | Baixo | Atualização de 1 s apenas quando existe jogador esperando retorno |
| 3 | Assentos, avatares e vídeos são reanexados após mudanças de turno | `public/camera-video.js`, `renderIntoSeats()` | Pode produzir piscadas/interrupções e consumo de CPU | Médio/alto | Fase posterior: DOM keyed e atualização das propriedades sem substituir `.avatar`/`video` |
| 4 | WebRTC tem muitos mapas de peers, timers de recuperação e estado de relay | `public/app.js`, `liveMic*` e `closeAllLiveVoiceConnections()` | Potencial de vazamentos em falhas de rede | Médio/alto | Há rotinas de limpeza presentes; não alterar sem teste multiusuário real/automatizado |
| 5 | Servidor envia estado personalizado para cada jogador e observador em `emitRoom()` | `server.js`, `emitRoom()` | Tráfego e serialização em cada atualização, mesmo em mudanças pequenas | Alto | Medir taxa de estados primeiro; mudanças incrementais exigem preservar privacidade e contratos |
| 6 | Estilos acumulados por versões, múltiplos `@media`/`!important` | `public/styles.css` | Risco de recalcular estilos e maior manutenção | Médio | Não consolidar nesta fase; mapear regras efetivas antes de intervir |
| 7 | Telas secundárias reconstruídas ao receber respostas | `public/app.js`, ranking/perfil/torneios | CPU quando abertas | Baixo/médio | Adiar ou renderizar sob demanda sem mudar telas atuais |
| 8 | Até oito módulos contêm criação direta de `new Pool()` | `ranking-store.js`, `room-snapshot-store.js`, `auth-identity-store.js`, `tournament-*` | Conexões simultâneas no PostgreSQL | Médio/alto | Medir conexões efetivas antes de consolidar com pool compartilhado |
| 9 | JS/CSS do cliente têm tamanho elevado sem divisão ampla | `public/app.js` (~242 KB), `public/styles.css` (~266 KB), `public/index.html` (~73 KB) | Download/parse no celular | Médio | Medir recursos comprimidos; revisão modular só depois de estabilizar renderização |
| 10 | Estáticos JS/CSS usam revalidação; assets têm cache de 1 dia | `server.js`, `express.static` | Versão antiga em cache em certos cenários | Baixo/médio | Revisar versionamento de assets; não alterar cache nesta fase |
| 11 | Não foi identificado registro explícito de Service Worker na base inspecionada | arquivos de `public/` e referências a `serviceWorker` | O PWA depende do cache HTTP e do navegador | Baixo | Confirmar estratégia de PWA antes de adicionar um SW novo |
| 12 | `RTCPeerConnection`, streams e elementos de áudio podem persistir se limpeza falhar | `public/app.js`, `camera-video.js` | Memória e bateria | Alto se confirmado | Instrumentar medições e testes de saída/reentrada, sem reescrever mídias agora |

## Estado inicial e restrições

- O cliente recebe estados de sala em `socket.on('state')` e executa `render()` completo.
- O servidor cria estados distintos para jogadores e observadores, evitando disponibilizar cartas privadas aos espectadores. **Essa fronteira deve ser preservada.**
- `camera-video.js` já possui `closeRoom()`, `stop()`, `clearVideo()` e rotinas de desligamento; `app.js` possui `closeAllLiveVoiceConnections()` e `resetLiveVoice()`.
- O CSS contém muitas regras históricas. Uma grande limpeza elevaria o risco de regressão visual no mobile.
- A análise de código **não comprova** consumo real excessivo no Render ou quantifica uso de memória sem telemetria.

## Plano incremental

**Pacote 1 (baixo risco):** renderização por assinatura para componentes independentes, evitando reconstrução quando as dependências não mudam; reduzir timers ociosos de contagem; adicionar testes de regressão dessa lógica. **Sem modificar servidor, WebRTC, banco ou CSS.**

**Pacote 2 (depois de validar Pacote 1 em produção):** reconciliar as fichas dos jogadores e mídia por identificador estável, preservando vídeos quando mudar turno/contagem; medir impacto no Chrome Android.

**Pacote 3:** instrumentar WebRTC e broadcasts; inspecionar conexões PostgreSQL e caches; avaliar mudanças individualizadas com testes ponta a ponta.

## Riscos e validação obrigatória

- Comparações seletivas precisam considerar `state.me`, status/turno, disponibilidade de ações, `viewerRole`, `players`, logs, pontuação, avatares e conectividade.
- Troca de sala, promoção observador→jogador e atualização de avatar devem invalidar as assinaturas.
- Mudanças de mão precisam manter destaque de cartas, reações, compra obrigatória, carta dupla e ordenação.
- A renderização visual pode ser testada em navegadores simulados; câmera, microfone e estabilidade de rede real precisam de validação manual/multiusuário.


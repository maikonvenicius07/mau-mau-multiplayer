# MAU-MAU CANDEIAS — Relatório técnico V40.69.7

**Data:** 10/11/2026  
**Base:** `MAU_MAU_V40_69_6_HOTFIX_RENDER_PROJETO_COMPLETO.zip` (versão corrigida do Render)  
**Escopo:** recuperação de câmera e microfone após reconexão, com atenção ao Safari/iOS e à liberação de recursos WebRTC.  
**Situação:** código corrigido e testes locais aprovados; deploy real e recepção de mídia entre aparelhos ainda pendentes.

## Diagnóstico baseado no código

1. A câmera LiveKit já tinha recuperação após `joined` e desconexão Socket.IO, porém `public/camera-video.js` usava `window.addEventListener('pagehide', stop)` e apagava `joinedRoomCode`. Se uma página móvel voltasse do **back-forward cache (bfcache)** sem novo `joined`, não havia rotina de republicação de vídeo. Essa condição foi coberta com teste simulado.
2. O SDK LiveKit pode disparar `Reconnected` sem uma nova entrada no jogo. O módulo agora confere a trilha local: quando a faixa ainda está ativa reafirma a presença; quando terminou, agenda restauração; não anuncia vídeo como ativo sem uma trilha válida.
3. `startLiveMic()` no `public/app.js` usava `Promise.all()` para iniciar em paralelo o carregamento da configuração WebRTC e `getUserMedia`. Se a configuração falhasse depois de `getUserMedia` ter adquirido uma trilha, o `Promise.all` rejeitava sem referência à captura, gerando risco de recurso de áudio não liberado. Foi substituído por `Promise.allSettled()` e encerramento da track adquirida na falha. O `catch` também encerra trilhas já atribuídas quando há erro subsequente.

## Implementação

- `public/camera-video.js`: métodos de suspensão e retomada `pagehide`/`pageshow` para páginas mantidas no bfcache; restauração apenas quando o socket está conectado e a sala ainda corresponde à sessão; gestão do evento `LiveKit.RoomEvent.Reconnected` com verificação de trilha ativa.
- `public/app.js`: aquisição concorrente de configuração WebRTC e microfone com liquidação completa, limpeza de capturas adquiridas em erros; preservação da intenção do usuário e lógica de conexão anterior.
- `public/index.html`: atualização das versões de cache dos scripts alterados.
- `tests/media-reconnect-restoration.test.js`: testes simulados de bfcache, LiveKit `Reconnected`, retorno offline seguido de `joined`, ausência de duplicidade, liberação de tracks em falha e recuperação posterior.
- `package.json`, `package-lock.json`: identificação `40.69.7`; testes que validam a versão atual tiveram somente suas asserções de versão atualizadas.
- `CHANGELOG.md` e este relatório: documentação da versão.

## Resultados de validação

| Verificação | Resultado |
|---|---|
| Testes `*.test.js` encontrados | 165 |
| Aprovados com `PGSSLMODE=disable` e `DATABASE_URL` vazio | **164** |
| Testes com falha funcional entre executados | **0** |
| Não executado por dependência local ausente | **1** (`tests/socketio-integration-v4063.test.js`: falta `socket.io-client`) |
| Sintaxe de `public/app.js`, `public/camera-video.js`, `server.js`, `game-engine.js` | Aprovada com `node --check` |
| Verificação de `package-lock.json` | Aprovada |
| Simulação do retorno do iOS/Safari (bfcache) | Aprovada em mock, **não validada em iPhone real** |
| Simulação do LiveKit reconectado e trilha de áudio liberada | Aprovada em mock |
| Duas pessoas transmitindo/recebendo ao vivo | **Não executado** |
| Deploy do Render | **Não executado** |
| Investigação de áudio picotado em rede real e TURN efetivo | **Pendente**, requer aparelhos e métricas |

## Escopo e limitações

Esta versão não altera motor de cartas, turnos, Jogada Rápida, bots, placar, espectadores, ranking, CSS, Socket.IO no servidor, banco, nem política TLS da V40.69.6. O tamanho das cartas permanece igual. A restauração de `getUserMedia` continua sujeita às permissões e políticas de autoplay do navegador. Não há promessa de retorno automático onde o navegador exigir novo gesto.

O resultado dos mocks comprova a lógica isolada, **não a qualidade do áudio/vídeo recebidos por outro aparelho**. É indispensável fazer uma rodada de homologação real antes de afirmar que a transmissão está 100% estável.

## Como atualizar com segurança

1. Usar **somente o ZIP incremental** se o GitHub já estiver na V40.69.6 corrigida do Render, preservando a estrutura de diretórios interna `mau-mau-multiplayer-main/` ao copiar para a raiz do repositório.
2. Se a versão publicada divergir, comparar o ZIP completo em ambiente separado antes de substituir arquivos.
3. Deixar o Render instalar dependências com `npm ci` e executar `npm run verify`; não ignorar erro de build.
4. Não alterar `PGSSLMODE` e `DATABASE_URL` sem necessidade. A configuração `PGSSLMODE=disable` só é adequada à conexão **interna privada** ao PostgreSQL do Render.
5. Em homologação, usar 2 jogadores e um observador em aparelhos diferentes, alternando Android/iPhone/computador; ligar/desligar cada dispositivo; testar F5, ida e volta pelo histórico (bfcache), troca de rede Wi-Fi/4G, segundo plano e permissões negadas. Confirmar **recepção remota real**, não apenas os ícones verdes.
6. Verificar logs e métricas de conexões LiveKit/WebRTC. Confirmar que não aparecem capturas em duplicidade nem trackers remanescentes depois de sair da sala.

## Arquivos alterados

**38 arquivo(s) diferente(s) da base**, dos quais 1 novo(s). Nenhum arquivo removido. Apenas asserções de versão foram atualizadas em 30 teste(s) legados.

- `CHANGELOG.md`
- `docs/RELATORIO_V40.69.7_MIDIA_RECONEXAO.md`
- `package-lock.json`
- `package.json`
- `public/app.js`
- `public/camera-video.js`
- `public/index.html`
- `tests/abuse-protection-v4069.test.js`
- `tests/all-humans-offline-expiry-v40681.test.js`
- `tests/audit-fixes-v40571.test.js`
- `tests/config-v40541.test.js`
- `tests/deploy-safety-v4056.test.js`
- `tests/google-auth-contract.test.js`
- `tests/health-db-v4066.test.js`
- `tests/input-safety-v4064.test.js`
- `tests/lean-avatar-state-v4052.test.js`
- `tests/local-music-v4048.test.js`
- `tests/matchmaking-reservation-v4060.test.js`
- `tests/media-reconnect-restoration.test.js`
- `tests/music-contract.test.js`
- `tests/network-audioworklet-v4050.test.js`
- `tests/network-voice-stability-v4049.test.js`
- `tests/performance-v4046.test.js`
- `tests/persistence-strong-v4061.test.js`
- `tests/pile-side-drag-mobile-v40691f.test.js`
- `tests/project-cleanliness-v4041.test.js`
- `tests/ranking-mode-frozen-v4062.test.js`
- `tests/reconnect-retention-v4067.test.js`
- `tests/reconnection-permanent-v4057.test.js`
- `tests/room-governance-v4068.test.js`
- `tests/room-snapshot-recovery-v4053.test.js`
- `tests/security-monitoring-v4058.test.js`
- `tests/social-v4054.test.js`
- `tests/socketio-integration-v4063.test.js`
- `tests/solo-room-expiry-v40611.test.js`
- `tests/stability-v4055.test.js`
- `tests/universal-auth-v40691.test.js`
- `tests/webrtc-turn-v4051.test.js`

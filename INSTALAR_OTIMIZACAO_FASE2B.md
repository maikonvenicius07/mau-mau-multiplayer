# MAU-MAU CANDEIAS — Otimização Fase 2B (câmera)

## Base
Esta atualização **parte da Fase 2A**, que já inclui a Fase 1. Não substitua o projeto por uma versão anterior.

## Alterações

| Arquivo | Alteração |
| --- | --- |
| `public/camera-video.js` | Reaproveita vídeo quando LiveKit reapresenta a mesma `MediaStreamTrack`; prepara mapa dos assentos apenas uma vez por atualização; evita reatribuir a mesma stream à prévia; evita chamadas repetidas de `play()` e de reposicionamento dos controles flutuantes. |
| `public/index.html` | Acrescenta um identificador à URL de `camera-video.js` para buscar a nova versão no navegador. |
| `tests/performance-camera-phase2b.test.js` | Testa operações redundantes, faixas repetidas e liberação de recursos. |

**Não foram modificados:** motor do jogo, `server.js`, `public/app.js`, `public/styles.css`, controlador de áudio/microfone, SDK LiveKit e regras de câmera.

## Instalação
1. Faça backup da versão anterior.
2. No ZIP de atualização, copie `public/camera-video.js` e `public/index.html` para os mesmos caminhos do GitHub. Acrescente o arquivo de testes se mantiver a pasta `tests/` sincronizada.
3. Faça **Commit changes** e acompanhe o deploy no Render até o estado **Live**.
4. No celular, feche e reabra o jogo ou atualize a página; o identificador de versão do script ajuda a evitar cache antigo.

## Teste prático após a publicação
- Duas pessoas entram na mesma sala e ligam as câmeras.
- Confirmar que o vídeo próprio e do adversário aparecem.
- Jogar diversas cartas e alternar turnos; verificar se os vídeos permanecem estáveis.
- Abrir e fechar a câmera ampliada e trocar frontal/traseira.
- Testar desligar a câmera, sair da sala, retornar e reconectar.
- Testar um observador com vídeos habilitados/desabilitados.
- Repetir em celular e desktop, conferindo a ausência de erros no console.

Se houver regressão, restaure `public/camera-video.js` e `public/index.html` da Fase 2A.

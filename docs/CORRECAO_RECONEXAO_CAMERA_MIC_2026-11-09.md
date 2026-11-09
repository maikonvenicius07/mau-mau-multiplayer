# MAU-MAU CANDEIAS — Correção de mídia após F5 / reconexão

**Data:** 09/11/2026 · **Escopo:** apenas mídia, sinalização/retomada e controles de mídia no cliente.

## 1. Causa identificada no código enviado

- **Vídeo (LiveKit):** o `socket.on('disconnect')` em `public/app.js` executava `MauCamera.stop()`; essa função limpava `publishing`, desmontava a sala LiveKit e descartava a intenção de manter a câmera ligada. No evento `joined` a câmera só voltava a pedir a lista de transmissões: **não republicava a trilha local**.
- **Voz (WebRTC por Socket.IO):** `liveMicWanted` era uma variável JavaScript transitória. O reset de página zerava essa intenção. Já existiam ICE restart e recuperação por peer durante a mesma página, mas não havia reidratação do estado desejado após um F5.
- **Bloqueio de permissão:** após `getUserMedia` falhar por permissão/dispositivo, o aplicativo não mantinha um caminho unificado, visível, para retomar câmera e microfone com um clique.

## 2. Correções implementadas

1. **Preferência por sessão de aba:** novo `public/media-session.js` salva no `sessionStorage` apenas dois booleanos (`mic`, `camera`) associados à sala e ao identificador resumido da conta; não salva mídia, fluxo, credenciais ou token. F5 mantém a preferência. Uma outra conta/sala não herda ativações anteriores. A saída voluntária limpa a preferência.
2. **Retorno confirmado:** após o evento `joined` do Socket.IO, o aplicativo recupera a intenção de ambos os dispositivos. O microfone aguarda estado/sala válidos antes de abrir captura e publicar em `liveVoiceJoin`; a câmera só tenta republicar após reentrada, configuração do serviço e autorização do servidor para a sala.
3. **Microfone:** nova captura com `getUserMedia` (solicitada no gesto de ativação), nova sessão de voz e novas ofertas WebRTC; streams anteriores são parados na desconexão. O mecanismo existente de fechamento de peers antigos, ICE restart, RTP e relay é preservado. Tentativas automáticas são limitadas (até 4); permissão negada ou dispositivo ausente vai para ação manual.
4. **Câmera:** preservação da intenção em `stop({keepWanted:true})`, nova conexão LiveKit e publicação da faixa de vídeo após `joined`; detecta desaparecimento/fim da faixa e desconexão terminal do LiveKit. No máximo 3 tentativas automáticas por ciclo de recuperação. Só sinaliza `cameraPublishState: true` após obter uma publicação local válida.
5. **Sem duplicidades:** gerações invalidam capturas/autorizações antigas; bandeiras `busy` e `liveMicStarting` bloqueiam operações simultâneas; Room e peers anteriores são fechados antes de refazer uma sessão. Os controles permitem cancelar voluntariamente uma restauração pendente.
6. **Botão de recuperação:** painel `Restaurar câmera e microfone` (ou só o dispositivo bloqueado), exibido quando a recuperação exige autorização ou intervenção. As operações são iniciadas na mesma ação do usuário; algumas políticas de iOS/Android podem continuar exigindo autorização manual.
7. **Visualização remota:** preservado o `TrackSubscribed` da LiveKit e o `ontrack`/áudio remoto do WebRTC. O estado visual da câmera considera a existência da trilha de mídia e seu encerramento, não somente um booleano.

## 3. Arquivos incluídos

| Arquivo | Motivo |
| --- | --- |
| `public/app.js` | Retomada do microfone, eventos de sala, preferências e reconexão |
| `public/camera-video.js` | Restauração automática LiveKit, estado das trilhas, limite de tentativas |
| `public/media-session.js` | Novo armazenamento por sessão e painel de restauração |
| `public/index.html` | Carregamento do módulo, painel e atualização de versão dos assets |
| `public/styles.css` | Estilo discreto para o painel móvel/desktop |
| `tests/media-reconnect-restoration.test.js` | Novos testes em memória de mídia/retomada |
| `docs/CORRECAO_RECONEXAO_CAMERA_MIC_2026-11-09.md` | Este relatório |

Não houve alterações em `server.js`, motor do jogo, regras, cartas, placar, contas ou ranking.

## 4. Testes automatizados executados

**Resultado:** 160 arquivos `*.test.js` aprovados (todos os testes locais que não requerem `socket.io-client`). `node --check` aprovado nos três arquivos de mídia e no novo teste. `node scripts/check-lockfile.js` aprovado.

Novo teste `tests/media-reconnect-restoration.test.js` cobre, com APIs de mídia/LiveKit simuladas:

- Recriação do contexto JavaScript após F5, preservando preferências da mesma conta/sala.
- Câmera e microfone voluntariamente desligados permanecem desligados.
- Troca de sala/conta não reutiliza preferências antigas.
- Bloqueio dos dispositivos apresenta painel; um clique chama ambos os restauradores.
- Câmera: publicação local validada, subscrição remota simulada, parada na queda, retomada após `joined`, e reconexão terminal do LiveKit.
- Garantia de apenas uma sala/publicação de câmera ativa na simulação; controle de permissão negada e recuperação manual.
- Microfone: liberação da faixa anterior, novo `liveVoiceJoin` e novo identificador de sessão após retorno.
- WebRTC: ofertas geradas com nova sessão e uma faixa de áudio por peer, sem duplicação de peer.

**Limitações dos testes neste ambiente:** o teste `tests/socketio-integration-v4063.test.js` não pôde ser executado porque `socket.io-client` não está instalado. A tentativa de `npm ci` falhou com erro do próprio npm (`Exit handler never called!`). O ambiente usa Node 22.16.0; o projeto solicita Node 22.22.0. **Não foram executados testes de câmera/microfone com dois navegadores reais, LiveKit/TURN configurados e rede móvel real.** Portanto, o recebimento efetivo de áudio e vídeo *entre dispositivos reais* ainda exige validação em homologação; o resultado simulado não deve ser confundido com comprovação de transmissão real.

## 5. Checklist recomendado para homologação real

1. Publicar os arquivos do ZIP de atualização no GitHub; conferir deploy Render em HTTPS e LiveKit configurado (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Conferir configuração STUN/TURN da voz.
2. Abrir **dois navegadores/aparelhos** na mesma sala (um celular Android/iOS, outro computador), autorizar dispositivos e ligar áudio/vídeo em ambos.
3. Do aparelho A, confirmar **no B** que o vídeo se move e a voz chega; pressionar F5 no A; confirmar retomada de áudio e vídeo **no B** (não somente os ícones do A).
4. No A, desligar voluntariamente só o microfone, atualizar e confirmar no B que o vídeo volta, mas o áudio não; repetir invertendo os dispositivos e depois com ambos desligados.
5. Desligar Wi-Fi/dados do A durante partida, aguardar o retorno permitido pelo jogo, religar rede e verificar o recebimento real no B; testar também alternância Wi-Fi ⇄ dados móveis e segundo plano do celular.
6. Negar permissão de câmera e/ou microfone; confirmar aviso e botão; conceder permissão e testar a retomada com um toque. No iPhone, validar também desbloqueio de autoplay/áudio de entrada quando necessário.
7. Repetir com mais de dois jogadores e um observador. Confirmar que ninguém ouve voz duplicada e não aparecem dois vídeos por jogador.
8. Confirmar que as regras, cartas, placar e o tamanho das cartas permanecem iguais à versão original.

**Instalação:** o ZIP incremental preserva a estrutura de pastas; substitua/crie **somente** os caminhos que ele contém. O ZIP completo contém a árvore da versão recebida, com as mesmas alterações. Não inclua `node_modules` no GitHub; o Render deverá instalar as dependências conforme `package-lock.json`.

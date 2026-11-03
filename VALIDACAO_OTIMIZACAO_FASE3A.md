# Validação — Fase 3A

## Testes automatizados

- `node --check public/app.js` — aprovado.
- `node --check server.js` — aprovado (servidor inalterado).
- `node --check public/camera-video.js` — aprovado (câmera inalterada).
- `node tests/voice-capture-lifecycle-phase3a.test.js` — aprovado.
- **141/141 testes executáveis** (incluindo teste novo) — aprovados, sem falhas.
- **1 teste não executado:** integração Socket.IO por ausência de `socket.io-client` instalado localmente. O projeto declara a dependência em `package.json`; ausência neste ambiente não indica problema no pacote para Render.

## Casos direcionados simulados

1. Permissão de microfone chega após sair → track interrompida e nenhum `liveVoiceJoin` obsoleto.
2. Captura antiga termina depois de nova sessão ativa → a antiga é interrompida, a atual permanece.
3. Duplo toque no Áudio Rápido enquanto aguarda permissão → somente uma solicitação.
4. Cancelamento/saída antes do retorno de `getUserMedia` → não inicia `MediaRecorder`; track interrompida.
5. Gravação normal posterior ao cancelamento → começa normalmente.
6. Configuração TURN termina após microfone desligado → não cria novo `RTCPeerConnection`.

## Ainda requer validação real

- Captura e reprodução em Android/iOS com permissões nativas.
- Conexões de voz WebRTC entre dois ou mais telefones, ida/volta e troca de rede.
- Falha e recuperação de rede com o microfone ativo.
- Partida completa, incluindo câmera, observadores, reconexão e finais de rodada, no Render.

**Observação:** essas correções previnem solicitações obsoletas e recursos extras, mas não constituem medição comprovada de CPU/memória em produção.

# MAU-MAU CANDEIAS — Otimização Fase 3A

**Base:** versão completa de Otimização Fase 2B (câmera).  
**Tema:** proteção das capturas assíncronas do microfone e Áudio Rápido contra retornos atrasados.

## Problemas encontrados antes da alteração

| Problema | Arquivo / função | Impacto | Risco da alteração | Solução aplicada |
|---|---|---|---|---|
| Permissão de microfone pode chegar após saída/desconexão ou após uma nova tentativa | `public/app.js` / `startLiveMic`, `stopLiveMic` | Trilha obsoleta pode ser reativada ou sobrescrever uma sessão nova | Baixo-médio | ID de geração para capturas, encerrando a trilha obsoleta; `catch` e `finally` não afetam uma captura mais recente |
| Dois toques em gravar podem abrir duas solicitações de permissão antes de criar o `MediaRecorder` | `public/app.js` / `startQuickAudio` | Dupla captura, consumo de recursos, gravação inconsistente | Baixo | Marcador de solicitação pendente e descarte seguro do resultado antigo |
| Sair da sala enquanto o Áudio Rápido aguarda autorização pode iniciar gravação atrasada | `public/app.js` / `startQuickAudio`, `stopQuickAudio`, `socket.on('disconnect')` | Captura ativa fora da sala ou após desconexão | Baixo | Invalidação da permissão pendente ao cancelar, sair e desconectar |
| Configuração de TURN pode completar depois que o microfone foi encerrado | `public/app.js` / `createOutboundLivePeer` | Criar `RTCPeerConnection` órfã após desligamento | Baixo | Validar sessão, conexão, stream e participante após aguardar configuração ICE/TURN |
| JavaScript pode continuar em cache no celular | `public/index.html` / URL de `app.js` | Navegador carrega código antigo após deploy | Baixo | Novo sufixo de versão no identificador de cache do script, preservando o prefixo dos testes anteriores |

## Arquivos modificados

- `public/app.js`
- `public/index.html` (apenas sufixo de cache de `app.js`)
- `tests/voice-capture-lifecycle-phase3a.test.js` (arquivo novo)
- Documentos desta fase (novos)

**Não foram modificados:** `server.js`, `game-engine.js`, `public/styles.css`, `public/camera-video.js`, `public/voice-relay-worklet.js`, banco de dados, esquema, TURN/STUN, compressão e formatos de áudio.

## Como atualizar o GitHub

1. Faça uma cópia/commit da versão atual (Fase 2B).
2. Extraia o ZIP incremental preservando a estrutura das pastas.
3. Substitua `public/app.js` e `public/index.html` no repositório e adicione o teste em `tests/`.
4. Faça **Commit changes** e aguarde o deploy concluído no Render.
5. No celular, atualize a página. O novo sufixo da URL de `app.js` ajuda a impedir reutilização do JavaScript anterior.

## Teste manual recomendado antes da próxima versão

- Dois celulares em uma sala: ligar/desligar voz ao vivo, ouvir ambos os lados e alternar turnos.
- Tocar em ligar microfone e sair rapidamente da sala durante o pedido de permissão; nenhuma captura deve continuar.
- Repetir o teste após perda de rede e reconexão; somente a sessão atual deve ativar a captura.
- Áudio Rápido: dois toques rápidos em gravar, cancelar, gravar normalmente, reproduzir e enviar.
- Com câmera e microfone ligados: alternar salas e observar se a câmera permanece funcional.
- Concluir uma rodada e testar observador, convites e saída/entrada; nenhuma regra foi alterada.

## Limitações

O teste de integração `tests/socketio-integration-v4063.test.js` não rodou neste ambiente por falta da dependência `socket.io-client`. Os testes direcionados usam streams simulados; a qualidade e estabilidade do microfone devem ser validadas em dispositivos reais no Render.

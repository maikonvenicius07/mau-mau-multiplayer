# MAU-MAU CANDEIAS — Fase 6B: auditoria final de estabilidade e memória

**Base auditada:** ZIP `mau-mau-multiplayer-main (18)(1).zip`, correspondente à Fase 6A.  
**Objetivo:** eliminar retenção desnecessária de memória e trabalho simultâneo de diagnóstico, sem modificar regras ou protocolo do jogo.

## Achados e decisões

| Área / arquivo | Situação constatada | Consequência possível | Ação / risco |
|---|---|---|---|
| `public/app.js` — evento `chatMessage` | O histórico mantém no máximo 60 mensagens; quando uma mensagem **de texto** removia um áudio antigo, sua URL `blob:` não era revogada. O evento `voiceMessage` e a saída da sala já faziam a liberação. | Manutenção de Blob de áudio na memória até sair da sala. | **Corrigido (risco baixo):** liberar a URL do item removido independentemente do tipo da mensagem recebida. |
| `public/app.js` — `sampleLiveVoiceInboundRtpHealth()` | O monitor executa `getStats()` a cada 1,2 s; uma coleta lenta podia se sobrepor à próxima. O peer podia ser removido enquanto a Promise estava pendente. | Coletas paralelas e resultados antigos reinseridos no mapa após a saída. | **Corrigido (risco baixo/médio):** impedir coletas sobrepostas e descartar resultados de peers removidos. Sem modificar o fluxo WebRTC nem o fallback de voz. |
| `server.js` — `cleanupRoomResources()` | Existe limpeza de timers de reconexão, spectator, debounce, bot, reservas, publishers, snapshots e dados da sala. | Não identificada lacuna concreta nesta revisão estática. | **Preservado** para evitar alterações desnecessárias. |
| `public/app.js` — `stopLiveMic()`, `closeAllLiveVoiceConnections()` | Já encerram peers, faixas, áudios remotos e timers nas saídas e desconexões previstas. | Casos excepcionais ainda dependem de ensaio com dispositivos reais. | **Preservado**, sem trocar codecs/qualidade. |
| `public/camera-video.js` | A Fase 2B já evita trocas de vídeo em mudanças de estado sem efeito e encerra a sessão em saída. | Avaliação real com câmera depende de celulares. | **Preservado**. |
| `server.js` — listeners Socket.IO | Registro por conexão está organizado dentro do handler de conexão; o cliente registra os handlers principais na inicialização. | Não foi confirmado registro repetido por retorno à sala no código auditado. | **Preservado**; teste real de reconexão é necessário. |
| `server.js` — pools e estados | Fases 4A–4C e 6A estão presentes: deduplicação por conexão e pool PostgreSQL compartilhado. | Ganhos sob carga ainda requerem telemetria do Render. | **Preservado**. |

## Arquivos da Fase 6B

- **Alterado:** `public/app.js` (somente duas correções de ciclo de vida).
- **Adicionado:** `tests/performance-memory-phase6b.test.js`.
- **Adicionados:** documentação e instruções desta fase.
- **Não alterados:** `server.js`, `game-engine.js`, `public/camera-video.js`, `public/styles.css`, configuração de PostgreSQL e dependências.

## Testes realizados

- `node --check public/app.js`, `server.js`, `public/camera-video.js` — passaram.
- `node scripts/check-lockfile.js` — passou.
- `tests/performance-memory-phase6b.test.js` — passou. Testa liberação da URL de áudio ao chegar texto, controle de concorrência das leituras `getStats()` e descarte de resultados do peer removido.
- **Suíte disponível: 149 testes aprovados entre 150 testes listados**; um teste de integração Socket.IO não pôde executar porque `socket.io-client` não está instalado no ambiente de trabalho. Não se trata de uma aprovação desse teste.

## Limitações desta auditoria

Esta é uma **auditoria estática e uma regressão local com simulações**. Não houve medição instrumentada de heap, CPU ou latência no aparelho do usuário nem testes reais de áudio/câmera entre celulares, servidor PostgreSQL de produção ou partida completa no Render. Portanto, não é possível afirmar ausência absoluta de vazamentos ou melhoria percentual de desempenho.

## Checklist de validação final no Render

1. Confirmar deploy e abrir o jogo no celular, verificar login e tela inicial.
2. Criar uma sala com dois jogadores; alternar turnos, compras, descarte, 7, Ás, Dama, Valete, Queima, Carta Dupla e Ação Rápida.
3. Ligar microfone e câmera em dois aparelhos; realizar várias rodadas e confirmar que áudio e vídeo continuam estáveis.
4. Enviar um áudio rápido no chat, depois mais de 60 mensagens de texto para expulsá-lo do histórico; conferir que o chat não trava.
5. Desconectar e retornar dentro do prazo; verificar bot temporário, reconexão e encerramento de sala quando aplicável.
6. Entrar e sair como Observador, solicitar vaga no intervalo e confirmar a privacidade das mãos.
7. Abrir ranking e torneios, depois observar logs do Render e contagem de conexões PostgreSQL.
8. Deixar uma partida com áudio ativo por 15–30 min e avaliar consumo de memória e áudio com as ferramentas do navegador, comparando com a Fase 6A.

**Situação:** Fase 6B concluída no código e nos testes locais disponíveis; validação de produção pendente. O plano inicial está implementado, sem dispensar manutenção e medições em condições reais.

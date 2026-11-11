# MAU-MAU CANDEIAS — Relatório V40.69.8.9

**Base:** V40.69.8.8, `40.69.8-rank.8`  
**Nova versão:** V40.69.8.9, `40.69.8-rank.9`  
**Data:** 11/11/2026  
**Escopo:** estabilidade da câmera e prevenção de deslocamento vertical pelo foco do chat em celulares.

## 1. Auditoria do código

Examinei os módulos principais da mídia (`public/camera-video.js`, `public/media-session.js`, recuperação de voz em `public/app.js`), apresentação da mesa, estilos responsivos, servidor, persistência e testes existentes.

| Nº | Área | Evidência | Problema ou risco | Consequência | Correção | Prioridade | Complexidade | Classificação |
|---|---|---|---|---|---|---|---|---|
| 01 | Câmera | `public/camera-video.js`, `watchLocalTrack`, `onState`, `updateButton` | O tratamento cobria `ended`, mas não a captura que permanece `live` com `muted=true` após suspensão do navegador | Ícone pode indicar câmera ligada sem vídeo válido | Detectar `muted`, conferir ao retomar e republicar com limites | Alta | Média | Lacuna confirmada no código; comportamento real requer teste no aparelho |
| 02 | Mobile/chat | `public/app.js`, `openPlayerSide`, `setSideTab`, `sendChatMessage` | Foco convencional do campo de chat pode rolar verticalmente a página; `setSideTab` podia agendar segundo foco | Mesa/mão saem do campo de visão em celular | `focus({preventScroll:true})` com fallback e único agendamento | Média | Baixa | Comportamento do navegador reproduzido em Chromium controlado |
| 03 | Áudio/vídeo reais | `public/app.js`, `public/camera-video.js` | A suíte usa mocks, não conexão WebRTC/LiveKit real entre dois celulares | Recuperação efetiva da mídia não comprovada em rede móvel | Homologação em dois dispositivos reais | Alta | Média | Validação pendente, não defeito comprovado |
| 04 | UI móvel | `public/styles.css`, regras responsivas extensas | Regras móveis sucessivas para a mesma mesa dificultam manutenção | Risco de regressões em novos tamanhos | Consolidar apenas após comparação visual | Média | Média | Melhoria futura, não alterada |
| 05 | Persistência | `room-snapshot-store.js`, código SQL de revisão | Dependência de PostgreSQL no Render exige homologação da durabilidade | Falha isolada de gravação pode atrasar restauração | Manter V40.69.8.7 e verificar logs | Alta | Média | Risco operacional; sem alteração nesta versão |

## 2. Alterações implementadas

- **`public/camera-video.js`**: `scheduleWakeCheck`, com timer único cancelado ao deixar a sala, evento `visibilitychange` e verificação no `pageshow`; sinaliza vídeo inativo e usa a rotina `restore` existente apenas quando o jogador queria a câmera ligada. A recuperação de uma track `muted` a encerra antes da nova captura. O estado visual também considera `track.muted` e `track.enabled`.
- **`public/app.js`**: `focusChatInputWithoutPageJump` com `preventScroll` e fallback; uso na abertura do chat e no envio; evita segundo agendamento de foco no caminho de troca de aba.
- **`public/index.html`**: parâmetros de versão alterados somente para os dois scripts modificados, reduzindo risco de cache de JavaScript antigo nos celulares.
- **`tests/media-reconnect-restoration.test.js`**: cenário de track silenciada no segundo plano e retomada sem duplicar transmissão nem contrariar desligamento voluntário.
- **`tests/mobile-media-wakeup-v406989.test.js`**: foco único, `preventScroll`, fallback e verificações de integração dos componentes.
- **`package.json`, `package-lock.json`, `CHANGELOG.md` e documentação**: identificação da versão e registro das alterações. Arquivos de testes antigos que verificam a identificação exata do pacote foram atualizados, sem mudar os cenários de teste.

Nenhuma função do motor das cartas, SQL do ranking, cálculo Glicko-2, controle da revanche ou regra de observador de torneio foi alterada.

## 3. Testes executados

- **181 arquivos de testes identificados**, **180 aprovados**, **0 falhas** e **1 não executado**: `tests/socketio-integration-v4063.test.js`, porque `socket.io-client` não estava instalada neste ambiente.
- Sintaxe JavaScript de `app.js`, `camera-video.js`, `server.js` e `media-session.js`: aprovada.
- `scripts/check-lockfile.js`: aprovado.
- Cenários de câmera em mocks: ao silenciar a track na página oculta, a indicação de publicação desaparece; ao voltar, há uma recuperação, sem duplicação, e câmera desligada voluntariamente permanece desligada.
- **Chromium controlado:** nas telas de 320×640, 360×800, 390×844 e 430×932 pixels CSS, `focus({preventScroll:true})` manteve `window.scrollY` em zero. Foco convencional deslocou a página no cenário de comparação, respectivamente em 903, 823, 801 e 757 px. Isto é um cenário de controle da API do navegador, não uma partida completa renderizada.

## 4. Testes ainda necessários no Render e em aparelhos

1. Com duas contas, confirmar que Vitórias e ranking de Aproveitamento/Habilidade continuam aparecendo após partida completa e revanche.
2. Android Chrome: ligar câmera e microfone, alternar aplicativo e retornar; conferir no outro aparelho que o vídeo e o áudio foram recebidos de verdade.
3. iPhone Safari: repetir com F5, bloqueio/desbloqueio e retorno do segundo plano; observar permissões e opção de restauração manual.
4. Abrir/fechar chat enquanto a mão está visível, inclusive com cartas numerosas e teclado virtual; verificar se a posição vertical não muda indevidamente.
5. Desligar câmera voluntariamente e retornar ao jogo: confirmar que não há reativação automática.
6. Verificar logs do Render e PostgreSQL, sem alterações nas credenciais ou no modo TLS.

**Limitação:** os testes não comprovam recepção real de mídia, resistência a todas as redes móveis ou desempenho total do celular. A nova lógica é preventiva e sua eficácia em aparelhos físicos precisa ser homologada.

## 5. Implantação

O ZIP incremental deve ser aplicado **somente sobre a V40.69.8.8**. Preservar os caminhos desde a raiz do repositório. O pacote completo pode ser usado como referência. Não há migração de banco ou alteração de regras.

**Próxima versão sugerida:** V40.69.8.10 — consolidação, teste integrado no Render, validação com 2–5 jogadores e revisão final de estabilidade; não acrescentar funcionalidades novas antes da homologação da mídia e do ranking.

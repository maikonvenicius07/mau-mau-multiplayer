# MAU-MAU CANDEIAS — Otimização Fase 4A

**Base:** projeto completo da Fase 3A (microfone).  
**Objetivo:** evitar retransmissões *idênticas* do evento `state` pelo Socket.IO sem mudar seu formato, regras ou permissões.

## Diagnóstico antes da alteração

| Problema | Arquivo / função | Impacto | Risco | Solução desta versão |
|---|---|---|---|---|
| `emitRoom()` envia todos os estados individuais sempre que é chamado, mesmo sem alteração no conteúdo | `server.js` / `emitRoom` | Repetição de pacotes, tráfego e processamento no navegador | Baixo-médio | Comparar assinatura do estado final para **cada conexão** e não retransmitir quando for idêntico |
| Jogadores e observadores recebem informações diferentes | `game-engine.js` / `roomPublicState` e `roomSpectatorState` | Comparação global da sala poderia expor cartas privadas ou suprimir estados corretos | Alto se implementado incorretamente | **Não** usar cache global; escopo separado por socket, sala, partida, papel e identidade |
| `joined` pode reiniciar a tela mesmo quando o estado não mudou | `server.js` / entradas, convites, torneios, retomada | A falta do novo `state` poderia deixar tela vazia/desatualizada | Médio | Invalidar cache antes dos eventos `joined` de jogador/observador. Promoção usa papel diferente e invalida automaticamente pela chave de escopo |
| O estado contém dados privados que não devem permanecer armazenados em caches adicionais | `server.js` / payload `state` | Retenção desnecessária de dados em memória | Baixo-médio | Guardar apenas hash SHA-256 (64 caracteres) e escopo em WeakMap associado ao socket |

## Implementação

1. O `emitRoom` **continua** produzindo estado por jogador/observador utilizando `Engine.roomPublicState` ou `Engine.roomSpectatorState` e `AvatarWire.leanStateAvatars`.
2. `state-delivery.js` serializa o payload para calcular um hash SHA-256 e compara com o último envio daquela conexão.
3. Se escopo e conteúdo forem idênticos, somente o **envio `state`** é suprimido; todos os demais procedimentos da sala continuam funcionando (processamento de pedidos, timers, bots, ranking, snapshots, presença e avatares).
4. Se o conteúdo mudar, a transmissão `state` permanece exatamente no mesmo formato.
5. Um novo `joined` de jogador/observador elimina a assinatura anterior para obrigar a entrega do estado inicial; a promoção de observador para jogador troca a chave de papel/participante.
6. O cache usa `WeakMap`, para não manter a conexão em memória após sua liberação. Não foi necessário alterar protocolo, banco, motor de cartas, CSS, câmera ou microfone.

**Observação de desempenho:** comparar o conteúdo exige serialização e hash no servidor. O benefício é economizar *pacotes idênticos*; chamadas que produzem dados diferentes seguem sendo enviadas. O ganho líquido de CPU/rede deve ser medido no Render, não presumido.

## Arquivos alterados ou adicionados

- `server.js` — inclusão do guard no `emitRoom` e invalidação em entradas.
- `state-delivery.js` — módulo novo, isolado.
- `tests/state-delivery-phase4a.test.js` — regressão e privacidade.
- `tests/emit-room-phase4a.test.js` — testa o `emitRoom` verdadeiro com sockets simulados.
- `INSTALAR_OTIMIZACAO_FASE4A.md` e `VALIDACAO_OTIMIZACAO_FASE4A.md` — documentação.

## Instalação no GitHub

1. Mantenha uma cópia da Fase 3A validada.
2. Extraia o ZIP incremental e envie os arquivos para **os mesmos caminhos** no repositório (raiz, e `tests/`). O arquivo `state-delivery.js` deve ficar **ao lado de `server.js`**.
3. Faça o commit e aguarde o deploy no Render, pois a mudança está no servidor.
4. Teste entrada/saída, jogo completo, reconexão e Observador na sala real antes de avançar para a próxima fase.

## Roteiro de validação em produção

- Crie uma sala, entre com um segundo celular, inicie a rodada e jogue normalmente.
- Confira turnos, compra, descarte, Queima, Dama/naipe e fim da rodada.
- Faça reconexão via atualização da página e queda breve da internet.
- Entre como Observador, confirme que nenhuma mão privada aparece e teste promoção no intervalo.
- Confira câmera e áudio antes/depois de reconectar. A versão não altera os módulos de mídia.
- Verifique logs do Render e console dos dois celulares; se houver qualquer problema de sincronização, reverta o commit da Fase 4A.

## Não alterado nesta fase

`game-engine.js`, `public/app.js`, `public/camera-video.js`, `public/styles.css`, banco de dados, timers de reconexão, protocolos de lobby e Socket.IO, reservas, jogos públicos/privados e política de segurança.

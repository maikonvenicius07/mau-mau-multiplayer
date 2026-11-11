# MAU-MAU CANDEIAS — Relatório técnico V40.69.8.5.1
**Data:** 11/11/2026  
**Base efetiva:** ZIP `mau-mau-multiplayer-main (17)(9).zip`, pacote interno `40.69.8-rank.5` (V40.69.8.5).  
**Escopo:** recuperar o fluxo de iniciar nova partida com o mesmo grupo sem sair da sala.

## 1. Diagnóstico com evidências

O projeto **já possuía a revanche**. O cliente enviava `playAgain` (`public/app.js`, `requestPlayAgain()`) e o servidor mantinha `replayReadyPlayerIds`, `maybeStartReplay()` e `Engine.resetMatch()` (`server.js` e `game-engine.js`). Não era necessário criar novo código de convite nem reiniciar as conexões da sala.

**Falha principal confirmada na implementação:** em `server.js`, `maybeRecordFinished()` grava o resultado no ranking de maneira assíncrona e então altera `room.rankingRecorded` para `true`, mas antes da correção não chamava `emitRoom(room)` nesse ponto. Simultaneamente, `playAgain` rejeitava os cliques enquanto `rankingRecorded` permanecia falso. Assim, o jogador podia clicar no fim da partida, receber erro de espera pelo ranking e continuar sem uma nova notificação que o liberasse para tentar novamente. Esse bloqueio era especialmente perceptível quando o armazenamento demorava ou os jogadores não realizavam novos eventos depois do resultado.

**Segunda limitação confirmada:** `replayEligible()` exigia que todos os participantes fossem humanos. Uma mesa com um bot permanente (incluindo após saída voluntária durante partida) não podia reiniciar mesmo com participantes suficientes.

**Terceiro risco de experiência:** o timer de remoção de cadeira após desconexão não abrangia `status='finished'`, podendo deixar confirmações indefinidamente dependentes de um jogador que não retornava.

## 2. Alterações implementadas

| Arquivo | Modificação |
|---|---|
| `replay-session.js` (novo) | Centraliza elegibilidade, confirmações sem duplicidade, contagem por jogador humano, espera de reconexão e liberação somente depois de resultado gravado. |
| `server.js` | Reutiliza `maybeStartReplay()` existente; aceita votos enquanto ranking grava; notifica a sala quando a gravação termina; inicia automaticamente com quorum completo; inclui a etapa final no prazo de desconexão. |
| `game-engine.js` | Usa o mesmo estado do servidor para expor o painel de revanche e desabilita a elegibilidade para observadores. `resetMatch()` e as regras das cartas foram preservados. |
| `public/app.js` | Exibe botão `JOGAR NOVAMENTE`, progresso das confirmações e motivos de espera, sem pedir saída ou novo convite. |
| `public/index.html` | Atualiza o rótulo do botão e texto de ajuda. |
| `tests/replay-resume-v4069851.test.js` (novo) | Regressões específicas da revanche. |
| `tests/ranking-recovery-v406981.test.js` | Substitui um teste de trecho literal antigo pelo novo contrato de autorização do começo da revanche. |
| `CHANGELOG.md` | Histórico desta atualização. |

**Decisão arquitetural:** reter o mesmo `room.code`. Alterá-lo exige atualização de invites, sessão, sockets, links e dispositivos, sem benefício necessário para este problema. A próxima partida possui um identificador lógico novo por `matchSerial` e mantém as pessoas, a sala e o chat. O servidor continua sendo o único autorizado a reiniciar a partida.

**Ordem de segurança:** a confirmação do jogador pode ser registrada antes do término da gravação, mas a nova partida só inicia depois de `room.rankingRecorded === true`. Não se perde nem se duplica uma vitória em razão de iniciar a revanche; o registro continua idempotente por `matchId`, seguindo o mecanismo existente.

**Desconexão:** a vaga é preservada durante a janela existente de reconexão (60 segundos por padrão). Depois do prazo, o jogador que não voltou pode ser removido da sala encerrada; as confirmações restantes são reavaliadas. Uma saída voluntária também libera o voto. Os bots só contam como participantes da nova partida; **não enviam voto**. Torneios continuam sem revanche por terem fluxo próprio.

## 3. Testes e resultados

- **174 testes automatizados aprovados** ao executar individualmente todos os arquivos `tests/*.test.js` exceto a integração Socket.IO; zero falhas entre os executados.
- **1 teste não executado:** `tests/socketio-integration-v4063.test.js`. A tentativa de instalar dependências localmente via `npm ci` falhou com erro do npm `Exit handler never called`; `socket.io-client` não ficou utilizável. Não tratar como teste aprovado.
- Testes novos efetivamente executados: confirmação antes e depois da gravação do ranking, votos repetidos, iniciar só uma vez, preservação de tokens/código/sockets/chat, novo identificador de partida, zeragem do placar, novo baralho, sentido inicial, mesa humana, mesa de treino com bot, jogador desconectado e reconectado, saída voluntária, bloqueio de observador e torneio.
- **Não executados:** teste ponta a ponta entre navegadores reais, desempenho de mídia WebRTC, teste real de PostgreSQL e deploy no Render.

## 4. Limitações e homologação no Render

1. Faça backup e confira que a V40.69.8.5 está atualmente publicada antes de aplicar o ZIP incremental desta versão.
2. Rode `npm run verify` no ambiente de build e confira os testes e o serviço `Live`.
3. Abra uma sala humana com duas contas, termine as cinco rodadas e confirme o resultado final em ambas. O botão **JOGAR NOVAMENTE** deve aparecer e mostrar `0/2`, `1/2`, `2/2`; o início automático deve acontecer **somente após o ranking confirmar**.
4. Confirme que nenhuma conta é redirecionada para o lobby, o código de sala é o mesmo e câmera/microfone/chat permanecem conectados.
5. Repita com três jogadores, desligue a conexão de um após o fim, verifique espera de reconexão e retorno em até 60 s. Teste também a saída voluntária de um integrante antes de os demais confirmarem.
6. Termine uma partida de TREINO contra bot e confirme a revanche com um único jogador humano.
7. Faça uma revanche e verifique o ranking OFICIAL/TREINO: cada partida concluída deve ter um `matchId` independente, sem contabilização duplicada.
8. Garanta que observadores de torneio não recebam o botão e que a mesa de torneio continue sem revanche.

**Limitação consciente:** após reinicialização total do servidor, snapshots de partidas já encerradas e com ranking registrado são atualmente descartados na restauração (`room-snapshot-store.js`); esse comportamento não foi alterado para evitar ampliar o escopo da correção. F5 e reconexão do navegador com o servidor ativo foram contemplados; continuidade de uma tela de resultado após reinício completo do processo necessita de fase própria.

## 5. Próxima etapa sugerida

Validar manualmente o fluxo com dois aparelhos reais e PostgreSQL no Render. Só depois prosseguir para a rodada V40.69.8.6 — testes integrados de rankings, salas e estabilidade, com especial atenção à restauração entre deploys e problemas móveis.

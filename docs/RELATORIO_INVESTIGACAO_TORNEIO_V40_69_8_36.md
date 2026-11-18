# MAU-MAU CANDEIAS — Relatório técnico de investigação e correção da segunda fase

**Data:** 18/11/2026  
**Versão funcional entregue:** **V40.69.8.36**  
**Base enviada:** `mau-mau-multiplayer-main (20)(20261118-175249).zip`  
**Base encontrada:** `server.js` informava `RELEASE_VERSION = 'V40.69.8.34'`; o topo de `CHANGELOG.md` já mencionava hotfix **V40.69.8.35**. O `package.json` usa a identificação histórica `40.69.8-rank.11`. A nova identificação funcional é **V40.69.8.36** em `server.js` e no endpoint de saúde. Não se alterou o identificador histórico do `package.json`, para preservar contratos de testes/lockfile.

## 1. Conclusão e grau de comprovação

**Causa principal reproduzida e corrigida no ZIP:** o tratamento de entrada manual confundia uma **reserva da fase seguinte ainda sem sala** com uma **sala anteriormente criada e desaparecida**. Isso impedia a PRIMEIRA entrada do finalista e, portanto, impossibilitava a criação da sala oficial da final. A reprodução foi obtida com nove inscritos e quatro classificados, usando os módulos reais de sorteio, fases, gravação e snapshot local e executando a função real de entrada `enterTournamentTable` extraída do servidor.

**O que foi validado após a correção:** quatro finalistas conseguiram entrar no mesmo lobby de final com pedidos concorrentes; reconexão de cadeira; recuperação do lobby salvo após removê-lo da memória; partida iniciada explicitamente com o `game-engine`; gravação de resultado sintético e declaração do campeão. **Não foram disputadas cinco rodadas reais de cartas nem houve homologação com vários navegadores reais, Socket.IO e PostgreSQL/Render.** Assim, a falha específica está corrigida e coberta por teste automatizado local, mas a aprovação em produção permanece pendente.

## 2. Causa raiz comprovada

**Arquivo:** `server.js`.  
**Evento:** `socket.on('enterTournamentTable', ...)`, bloco de resolução de vínculo/sala após adquirir `tournamentTableJoinLocks`.  
**Antes:**

```js
let binding = phase === 'qualifier'
  ? await tournamentGames.get(id, number)
  : await tournamentBracket.getBinding(id, phase, number);
let room = binding ? rooms.get(binding.roomCode) : null;
if (binding && !room) {
  // tenta recuperar uma sala existente
}
```

**Por que falha:** `tournamentBracket.advance()` cria antecipadamente as linhas da fase seguinte, incluindo número da mesa, roster sorteado e reserva temporal, **sem criar a sala real**. A linha persiste com `roomCode: null`; portanto, `binding` é verdadeiro e `room` é indefinido. A condição `binding && !room` encaminhava essa situação **normal** para `canRecoverMissingLobby()`. Essa função exige `binding.roomCode`, retorna falso e a entrada termina com o aviso de que a mesa anterior está sendo verificada. O fluxo que cria a primeira sala nunca é alcançado.

**Evidência pré-correção:** o novo teste com nove inscritos falhou imediatamente no primeiro ingresso da final com estado interno `not-created` e mensagem "A mesa anterior ainda está sendo verificada". A classificação estava formada, mas nenhum finalista recebia evento `joined`. A falha foi reproduzida **antes** de alterar a condição.

**Depois:**

```js
let room = binding?.roomCode ? rooms.get(binding.roomCode) : null;
if (binding?.roomCode && !room) {
  // recuperar somente se já houve uma sala vinculada
}
```

Agora, uma reserva sem `roomCode` passa diretamente à criação segura do lobby; uma sala com código anterior continua sujeita a restauração/validação de snapshot e aos bloqueios de preservação de resultados. Nenhuma mensagem de erro foi simplesmente ocultada.

## 3. Outras proteções implementadas

| Arquivo e função | Problema / risco | Alteração | Teste |
|---|---|---|---|
| `server.js` — `enterTournamentTable` | Uma referência persistida poderia apontar a sala com fase, mesa ou elenco incompatível. | Antes de reutilizar uma sala em memória, validar torneio, fase, número, participantes originais e ausência de máquina. Estado divergente permanece bloqueado e gera diagnóstico. | Teste de elenco adulterado: rejeição confirmada. |
| `server.js` — `joinSocketIntoRoom` | Durante o `await prepareForRoomSwitch()`, o anfitrião poderia iniciar a partida e o segundo pedido adicionar uma cadeira depois da validação inicial. | Revalidar existência da sala, estado `lobby` e bloqueio de início ANTES de inserir ou retomar um jogador em torneio. | Teste específico de corrida: ingresso rejeitado, sem incluir jogador. |
| `server.js` — identificador do release | `RELEASE_VERSION` antigo. | Atualizado para `V40.69.8.36`. | `node --check server.js` aprovado. |

**Nenhuma mudança foi feita no motor de cartas, no cliente, no sorteio, no ranking, em WebRTC, na regra da Queima, no cronômetro ou no modo observador.** Não foram apagados torneios, classificações, snapshots nem resultados.

## 4. Teste de nove participantes — procedimento e resultados

Teste `tests/tournament-nine-player-manual-final-v4069836.test.js` com dados e arquivos temporários isolados:

1. Criou torneio e cadastrou **9 contas** de teste.
2. Encerrou inscrições; `TournamentDraw` gerou **duas mesas: 5 + 4**, preservando a nona conta.
3. As nove contas ingressaram em suas mesas iniciais por meio do handler real de entrada, com comandos de sockets **simulados**.
4. Iniciou as classificatórias explicitamente com `Engine.startRound()`. Os resultados foram **gerados sinteticamente**, com o roster completo, para testar a passagem de fase sem simular todas as jogadas.
5. Registrou os resultados pelos módulos `TournamentGames`/`TournamentBracket` e avançou a classificação.
6. Confirmou fase **final**, mesa única, **4 vagas distintas**, `roomCode === null` antes da primeira entrada.
7. Executou **quatro pedidos de entrada manuais simultâneos** para a final. Todos receberam `joined` e o **mesmo código**; o banco local registrou um único vínculo oficial.
8. Repetiu a entrada de um classificado sem duplicar cadeira nem sala.
9. Provou que jogador eliminado não entra, e que uma alteração indevida do roster da sala impede a admissão.
10. Removeu a final da memória, sem apagar snapshot; a entrada manual restaurou a sala com o **código original** e as mesmas quatro cadeiras.
11. Reconectou os demais finalistas; a sala permaneceu em `lobby` até iniciar explicitamente com o motor real.
12. Gravou o resultado final sintético, avançou a fase e confirmou a identificação de um campeão.

**Resultado após a correção:** PASSOU.  
**Resultado antes da correção:** FALHOU na primeira entrada à final.  
**Teste adicional:** `tests/tournament-admission-race-v4069836.test.js` passou: durante uma espera simulada de troca de sala, o torneio começou; o sistema não criou cadeira tardia.

A simulação de sockets verifica os handlers, mas não é uma conexão de rede Socket.IO; os resultados sintéticos não demonstram a jogabilidade completa de cinco rodadas.

## 5. Regressão do projeto

| Validação | Resultado |
|---|---|
| Todos os arquivos `*.test.js` localizados | **214** |
| Testes Node.js executados, sem banco PostgreSQL real | **213 aprovados**, **0 falhas** |
| Integração real `tests/socketio-integration-v4063.test.js` | **1 não executado**: `socket.io-client` não disponível neste ambiente |
| `node --check server.js`, `game-engine.js`, `public/app.js`, `public/tournament-ui.js` | **Aprovados** |
| `node scripts/check-lockfile.js` | **Aprovado** |
| Instalação local `npm ci --offline` | **Não concluída**: pacote `xtend@4.0.2` ausente no cache offline |
| Node do ambiente de testes | `v22.16.0`; o projeto exige `22.22.0` |
| PostgreSQL e teste real com jogadores no Render | **Não executados** |

A suíte preexistente inclui regras, Queima, partidas normais, observadores, torneios e sorteios. Os **213 testes executados** passaram. A ausência de dependência impediu executar um teste de integração; não se afirma que esse teste passou.

## 6. Diagnóstico das quatro operações

| Etapa | Constatação |
|---|---|
| **Classificação** | O teste de 9 confirmou quatro classificados corretamente, a partir dos dois resultados de mesa. A classificação não era a causa da falha reproduzida. |
| **Formação da fase** | `TournamentBracket.advanceLocked()` criou e persistiu a linha da final com as quatro vagas. Esse registro é anterior à sala. |
| **Criação da sala** | **Falhava antes da correção**: o `binding` com código vazio caía no fluxo de recuperação e impedia a criação. Com a condição corrigida, o primeiro ingresso cria e salva o lobby, depois registra seu código. |
| **Entrada dos jogadores** | Após a correção, quatro classificados ingressaram no mesmo lobby, inclusive simultaneamente, e a sala foi recuperada após perda simulada de memória. |

## 7. Respostas às perguntas principais

1. **Por que a segunda fase falhava?** O fluxo confundia uma mesa *ainda não criada* com uma sala *perdida*, negando a criação do lobby.
2. **Qual função?** `socket.on('enterTournamentTable')`, em `server.js`.
3. **A classificação estava correta?** Sim, no cenário local de nove testado.
4. **A próxima fase estava sendo criada?** Sim, como registro de fase e reserva de vagas no `TournamentBracket`.
5. **A sala real estava sendo criada?** Não, na reprodução pré-correção; sim após a alteração.
6. **Por que os jogadores não entravam?** O primeiro pedido era rejeitado pelo ramo de recuperação indevido; os seguintes não tinham sala real à qual se associar.
7. **Havia conflito com a sala anterior?** Não foi necessário para reproduzir esta falha; o teste passou com salas anteriores concluídas.
8. **Havia falha de persistência?** Não na causa reproduzida: o registro da fase existia; o defeito era a interpretação do registro sem `roomCode`. Falhas reais de PostgreSQL não foram excluídas em produção.
9. **O encaminhamento automático era a causa?** Não na reprodução: a entrada era manual. A proibição de transferência automática em quartas, semifinais e final foi preservada.
10. **Qual solução?** Somente acionar recuperação quando houver `binding.roomCode`; acrescentar validações de vínculo e revalidação de corrida durante a entrada.
11. **Quais provas?** Falha antes da correção; aprovação do cenário de nove jogadores após a alteração; teste de corrida; 213 testes de regressão aprovados.
12. **O que ainda falta?** Homologar em Render com PostgreSQL real, múltiplos clientes, jogadas completas e possíveis torneios antigos cujo vínculo foi gravado como `started`/`legacy` e cujo snapshot esteja ausente ou inválido.

## 8. Limitações e possíveis pendências de dados antigos

Este hotfix **não** converte automaticamente uma partida antiga marcada `started`/`legacy` em lobby vazio. Esses casos podem conter cartas, pontuações ou resultado pendente; recriá-los indiscriminadamente seria perigoso. Também não transforma snapshots inconsistentes ou tombstones em jogos novos. A entrada manual nas próximas fases depende de autenticação e de um torneio fechado com fase e assentos íntegros.

Para a falha específica reproduzida, **não é necessário reestruturar nem remover o módulo de torneios**. Caso um torneio antigo continue indisponível após a atualização, investigar o `tournament_id`, fase/número, `room_state`, presença de `room_code`, snapshot correspondente, mensagens `[tournament]` e estado real das salas no Render. Não apagar resultados antigos para testar novamente.

## 9. Arquivos novos ou modificados nesta versão

- `server.js` — condição causal, validação de vínculo, revalidação de início concorrente, versão funcional.
- `CHANGELOG.md` — registro da V40.69.8.36.
- `tests/tournament-nine-player-manual-final-v4069836.test.js` — novo teste do percurso de nove inscrições até campeão com resultados sintéticos.
- `tests/tournament-admission-race-v4069836.test.js` — novo teste de concorrência no ingresso.
- `docs/RELATORIO_INVESTIGACAO_TORNEIO_V40_69_8_36.md` — esta análise e as evidências.

Nenhum outro arquivo do projeto foi modificado. O ZIP de arquivos alterados preserva os mesmos caminhos relativos do ZIP completo.

## 10. Atualização e homologação em GitHub / Render

1. **Faça um backup** da versão atualmente publicada e preserve banco PostgreSQL/snapshots existentes. Não restaure snapshots antigos sobre dados atuais nem apague histórico para aplicar este hotfix.
2. Caso a base atual do GitHub corresponda exatamente ao ZIP recebido, substitua **somente os arquivos** do ZIP de alterações, mantendo sua estrutura de pastas. Em caso de dúvida sobre a base atual, use o ZIP completo como referência e compare antes de substituir.
3. Faça commit e push; no Render confirme deploy concluído com sucesso e verifique o endpoint de saúde: `releaseVersion` deve mostrar **V40.69.8.36**. A versão técnica `version` poderá continuar `40.69.8-rank.11` por compatibilidade.
4. Confirme a presença de `DATABASE_URL`/PostgreSQL e da configuração de autenticação exigida pelo projeto; confira os logs do processo.
5. Crie um **torneio novo** com 9 contas reais. Confirme 5+4 na primeira fase, duas classificações por mesa, quatro finalistas, e entre manualmente pelo painel de Torneios em quatro navegadores/dispositivos.
6. Antes do início, confira **4 de 4 conectados na mesma mesa oficial**. Inicie por clique, jogue as rodadas até o fim e confira campeão, reconexão e ausência de máquinas. Repita com entradas simultâneas e uma queda de conexão controlada.
7. Se ainda falhar, registre data/hora, fase, número da mesa, erro exibido, e logs `[tournament]` do Render. A mensagem atual deverá revelar a causa do bloqueio em vez de fingir ingresso.

**Situação final:** defeito de primeira entrada na fase seguinte **corrigido e validado localmente**. **Homologação de produção e partidas completas ainda pendentes.**

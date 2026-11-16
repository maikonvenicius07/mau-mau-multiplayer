# MAU-MAU CANDEIAS — Torneios sem substituição por máquinas

**Data:** 16/11/2026  
**Base:** `mau-mau-multiplayer-main (21)(2).zip`  
**Escopo:** abandono voluntário ou desconexão que excede a tolerância durante partidas de torneio.

## Regra implementada

- Em uma mesa de torneio, desistência **nunca** converte o participante em Máquina nem faz um bot jogar por ele.
- O jogador desistente perde sua participação competitiva naquela mesa, fica marcado como **desclassificado por desistência** e não pode ingressar novamente entre rodadas.
- Com dois ou mais participantes humanos restantes, a mesa continua a partida somente com eles. O turno, a mão e o deck são ajustados para não depender da cadeira removida.
- Quando resta apenas um participante, a mesa termina por desistência e a classificação pode prosseguir sem jogar as rodadas restantes.
- A lista de sorteados é preservada no resultado do torneio, mantendo o desistente explicitamente marcado; não se cria jogador fictício e o desistente não ganha vaga em fases seguintes.
- Em uma queda involuntária, o jogador ainda tem a janela existente de reconexão (aproximadamente 60 segundos, conforme configuração). Se não retornar e **houver pelo menos um adversário conectado**, a vaga é tratada como desistência. Quando todos estiverem offline, nenhuma vitória é atribuída automaticamente e a mesa permanece aguardando recuperação, sujeita às regras anteriores de expiração da sala.
- Partidas comuns fora de torneios mantêm sua regra antiga de substituição por Máquina.

## Arquivos modificados e adicionados

- `server.js`: roteamento das saídas de torneio para desistência, bloqueio de retorno de desclassificados, tratamento de desconexões e impedimento de jogadas de bots em torneios.
- `tournament-forfeit.js` (novo): remoção segura da cadeira ativa, preservação do roster competitivo e composição dos resultados completos do torneio.
- `tournament-bracket.js`: registro do indicador `forfeited`, exposição do status e impedimento de classificação do desistente.
- `tournament-games.js`: conservação do indicador `forfeited` no resultado de mesa.
- `room-snapshot-store.js`: restauração de identidade humana em torneios finalizados, sem reclassificá-la como Máquina.
- `public/tournament-ui.js`: identificação visível da situação "Desclassificado por desistência".
- `tests/tournament-forfeit-no-bot.test.js` (novo): testes de 2 e 4 jogadores, desistência na vez, entre rodadas, encerramento por desistência, classificação entre mesas, persistência e retorno bloqueado.

## Verificações

- Verificação de sintaxe dos arquivos JavaScript alterados: aprovada.
- Verificação de consistência do `package-lock.json`: aprovada.
- Suíte local de testes: **185 aprovados, zero falhas**.
- **1 teste de integração Socket.IO não executado**, por ausência do módulo `socket.io-client` neste ambiente de teste. Em homologação com as dependências instaladas, executar `npm ci` e depois `npm run verify`.
- Não houve teste real com jogadores, PostgreSQL e Render de produção.

## Limites e observações

- Trata a desistência **de uma partida iniciada** (`playing` ou `between-rounds` com rodadas já realizadas). A política de saída no lobby antes da primeira rodada não foi redefinida nesta versão.
- O problema independente de **recuperar uma sala de torneio perdida após o vínculo do código** permanece como item de correção futura.
- A gravação de resultados do torneio continua dependendo do PostgreSQL no Render. Conferir em homologação que a partida concluída por desistência aparece como finalizada e a fase seguinte é gerada.
- Torneios já em andamento contendo Máquina decorrente de abandonos antigos **não têm migração automática retroativa** nesta versão; iniciar um torneio novo para validar a regra.
- A desistência após o prazo de reconexão é definitiva; a regra não permite reintegração à mesma mesa como jogador. Ajustar o prazo em uma futura mudança de regra, caso desejado.

## Teste recomendado no Render

1. Criar torneio de duas pessoas, iniciar a partida, clicar **Sair** em uma conta e confirmar que a outra vence a mesa sem Máquina.
2. Criar torneio com quatro pessoas, abandonar durante a vez e verificar que as outras três seguem jogando normalmente.
3. Forçar queda de internet e reconectar dentro de 60 segundos; confirmar recuperação da mão e da vaga, sem desclassificação.
4. Deixar expirar a janela com adversário conectado; confirmar desistência e que o participante não retorna pelo código.
5. Concluir a fase e verificar classificados, eliminados e campeão; confirmar que abandonos não contam para o Ranking Oficial.

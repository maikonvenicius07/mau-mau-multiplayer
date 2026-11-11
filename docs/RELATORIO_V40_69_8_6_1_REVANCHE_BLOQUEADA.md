# MAU-MAU CANDEIAS — V40.69.8.6.1

## Correção do bloqueio de revanche em "Confirmado • 3/3"

**Base analisada:** ZIP `mau-mau-multiplayer-main (18)(9).zip`; identificador interno `40.69.8-rank.6`.

### Evidência e diagnóstico

A captura mostra **3/3 votos** registrados e a mensagem **"Registrando o resultado anterior"**. No código anterior, em `server.js`, `maybeRecordFinished()` definia `room.rankingRecording=true` e dependia exclusivamente da resolução/rejeição de uma cadeia de Promises (snapshot final, inicialização do ranking e `rankingStore.recordMatch`). A única recuperação periódica ignorava operações com `rankingRecording=true`. Se uma Promise não terminasse, a gravação nunca era repetida, `rankingRecorded` permanecia `false` e `ReplaySession.canStartReplay()` bloqueava corretamente a revanche — porém indefinidamente, sem diagnóstico para o jogador.

**Defeito comprovado no fluxo de código e reproduzido por teste controlado.** A causa exata da operação sem resposta na instância de produção ainda não foi demonstrada: somente os logs de produção poderão indicar se a espera ocorreu no snapshot, na inicialização ou no registro do resultado.

### Alterações

- `ranking-finalization.js` (**novo**): prazo máximo configurável para finalizar cada tentativa completa de registro (`RANKING_FINALIZATION_TIMEOUT_MS`, padrão de 30.000 ms, permitido de 10.000 a 120.000 ms) e retentativas com intervalo progressivo de 15 a 60 segundos.
- `server.js`: a gravação mantém o identificador idempotente `matchId`; em erro ou timeout, libera `rankingRecording`, registra etapa e causa no log, atualiza o próximo momento de tentativa e emite novo estado da sala. O timer de recuperação já existente pode então repetir o processo sem novo clique. Após confirmação do registro, `emitRoom()` volta a executar o início automático, quando todos confirmaram.
- `replay-session.js`: fornece ao cliente o estado de recuperação e o intervalo aproximado da próxima tentativa; não envia mensagens internas do PostgreSQL aos participantes.
- `public/app.js`: substitui a espera genérica por aviso claro de falha e retentativa, mantendo o contador de confirmações, tanto no painel da mesa quanto no diálogo de resultado.
- `game-engine.js`: limpa metadados da tentativa anterior quando uma revanche válida reinicia uma nova partida.
- `tests/replay-ranking-finalization-v4069861.test.js` (**novo**): reproduz a Promise travada e valida recuperação com votos preservados, proteção contra callbacks atrasados, 2 a 5 jogadores, empates e reconexão.

### Comportamentos preservados

- A revanche **não** começa sem confirmação do resultado anterior no ranking. Se o banco continuar indisponível, permanece bloqueada, mas comunica o erro e tenta novamente sem depender de outro voto.
- Vitórias não são duplicadas: a gravação usa `matchId` idempotente no PostgreSQL e no armazenamento JSON.
- Mesma sala, jogadores, chat, código de convite, câmera e microfone permanecem; nenhuma regra das cartas, ranking ou modalidade de torneio foi alterada.
- A correção não introduz reset de dados, nova tabela nem migração PostgreSQL.

### Testes executados

- **176 testes locais aprovados**, rodando individualmente os arquivos da pasta `tests`, com `DATABASE_URL` vazio e armazenamento temporário quando previsto.
- **1 teste não executado:** `tests/socketio-integration-v4063.test.js`, pois `socket.io-client` não está instalado neste ambiente (está declarado no projeto para instalação normal).
- Testes adicionais: 3/3 com gravação pendente, resolução após retry, estado provisório visível, retentativa após timeout, 2/4/5 jogadores, confirmação que chega depois do commit, empate, reconexão e idempotência do resultado.
- Sintaxe `node --check` aprovada para os arquivos JS alterados; verificação do lockfile aprovada.

### Limitações importantes

Este ambiente **não possui acesso ao PostgreSQL e aos logs privados do serviço Render**, nem executou o teste real Socket.IO com três celulares. A solução foi verificada com código real, testes de unidade e simulações; precisa de homologação online. Uma interrupção prolongada no banco impede iniciar a revanche sem violar a regra de gravação segura. O timeout interrompe a *espera lógica*; não cancela automaticamente uma operação de banco já enviada. A idempotência por `matchId` protege as novas tentativas contra dupla contabilização.

### Homologação no Render

1. Faça backup do banco e publique o ZIP incremental na versão correta. A versão interna do `package.json` permanece `40.69.8-rank.6` para preservar os contratos de teste anteriores; a versão funcional do hotfix é **V40.69.8.6.1**.
2. Conclua uma partida real com três jogadores. Na tela final, confirme nos três aparelhos. O placar deve mudar para uma nova partida **após o registro do resultado**.
3. Confira no log as mensagens `[ranking] resultado <matchId>, etapa <...>` se persistir a espera. O novo log indica se falhou **snapshot final**, **inicialização do ranking** ou **confirmação do resultado**.
4. Em homologação, simule indisponibilidade temporária do banco com cuidado e confira que a mensagem de nova tentativa substitui a espera genérica, que votos continuam 3/3 e que a revanche começa somente após a recuperação.
5. Execute duas partidas completas consecutivas na mesma sala e verifique exatamente dois registros distintos no ranking, sem duplicação. Teste F5 de um participante durante a confirmação.
6. Confirme que os participantes mantêm chat, câmera e microfone; teste em Android e iPhone.

### Próximos passos

Se os logs reais identificarem uma falha específica de consulta, certificado, pool ou schema, resolva a causa do PostgreSQL nessa etapa posterior, sem alterar regras do jogo ou apagar resultados.

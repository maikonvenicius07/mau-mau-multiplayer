# MAU-MAU CANDEIAS — V40.69.8.4.2 — Observador de torneios

**Base:** ZIP completo `mau-mau-multiplayer-main (20)(1).zip`, correspondente ao código V40.69.8.4.1 (aviso azul removido); `package.json` preserva `40.69.8-rank.4` para não alterar as verificações legadas de versionamento. **Escopo:** alteração pontual de observação, sem alterar cartas, placar, ranking, banco de dados ou chave de sessão.

## Resultado

- No painel **🏆 Torneios**, nas mesas da fase atual **em andamento** (`playing`/`between-rounds`), aparece **👁️ ASSISTIR PARTIDA**, com contador de espectadores.
- O servidor resolve **torneio + fase + mesa** para uma sala ativa e verifica torneio encerrado para inscrições, fase correta, mesa realmente vinculada, partida ainda aberta e autenticação. O código privado da sala não é publicado pela API. Um pedido comum `joinSpectator` por código **não** libera acesso a uma mesa de torneio.
- O modo utiliza o sistema atual de espectadores (limite existente, **5 por mesa por padrão**). Não ocupa cadeiras e não participa do sorteio, turnos, pontuação ou classificação.
- **Somente mesa, placar e SAIR.** Os botões para entrar como jogador, chat, reações, câmera e microfone ficam indisponíveis. O servidor também rejeita ações de chat/efeitos, token de câmera, sinalização WebRTC e voz para espectadores de torneios. Mensagens sociais/áudios rápidos são enviados apenas aos demais participantes.
- O estado emitido para quem assiste não contém a mão dos jogadores; o relatório de fim de rodada com cartas reveladas (`roundReview`) também não é entregue. O jogador observa apenas descarte, andamento, participantes e placar.
- **F5/reconexão:** o navegador salva na sessão o ID do torneio, fase e mesa e faz novamente a solicitação autenticada pelo evento `watchTournamentTable`. Não atribui cadeira de jogador e não reativa o microfone.
- As mesas comuns mantêm observação com os controles anteriores. Torneios ainda proíbem a passagem de observador a jogador.
- Nenhuma mudança de esquema PostgreSQL, configuração TLS/Render, dependências ou serviço de autenticação foi necessária.

## Arquivos envolvidos

1. `server.js` — resolução de mesa, autorização, reutilização do observador, contagem pública, restrições de chat/mídia, emissão de estado sem cartas e isolamento de eventos sociais.
2. `public/tournament-ui.js` — botão ASSISTIR PARTIDA, contador e tratamento do evento de entrada.
3. `public/app.js` — interface somente leitura, restauração por sessão, interrupção da mídia e ocultação de controles especiais.
4. `public/camera-video.js` — impede observação de vídeo via LiveKit no modo restrito.
5. `public/styles.css` — controles ocultos apenas no modo de observação de torneios; estilo compacto do botão.
6. `public/index.html` — atualização dos identificadores das URLs do cliente.
7. `tests/quick-audio-contract.test.js` — atualiza a verificação de entrega do áudio, agora filtrada para espectadores de torneios.
8. `tests/tournament-watch-only-v4069842.test.js` — novo teste com handlers isolados, autorização e regras de isolamento.
9. `docs/RELATORIO_V40_69_8_4_2_OBSERVADOR_TORNEIO.md` — este relatório.

## Testes executados

- **172 arquivos de teste detectados**, **171 aprovados**, **0 falhas**, **1 não executado** (`tests/socketio-integration-v4063.test.js`, requer instalação de `socket.io-client`). Os 171 foram executados individualmente com `DATABASE_URL` vazio e `PGSSLMODE=disable`, para não tocar no PostgreSQL real.
- Validação de sintaxe `node --check`: `server.js`, `public/app.js`, `public/camera-video.js`, `public/tournament-ui.js`, `game-engine.js` — sem erros.
- Validação do lockfile com `scripts/check-lockfile.js` — aprovada.
- Novo teste: somente observação autenticada por torneio/fase/mesa; acesso direto por código negado; reaproveitamento da conta após reconexão; rejeição de mesa/fase inválida; ausência de cadeira, histórico de chat e dados de mão.
- Testes existentes de câmera, áudio, placar do observador e desempenho também aprovados.

**Limitações:** não foi executada uma sessão integrada real do Socket.IO, nem acessado o Render, PostgreSQL de produção, Android ou iOS. A execução dos handlers com simulações não substitui teste com 2 jogadores e 1 ou mais espectadores reais.

## Homologação no Render (após deploy)

1. Faça backup da versão atual e atualize o GitHub com apenas os arquivos do pacote incremental, copiando o conteúdo de `mau-mau-multiplayer-main/` para a raiz do repositório.
2. Confirme o build e o status **Live** no Render. Este hotfix não exige novas variáveis de ambiente.
3. Em duas contas, inicie uma mesa de torneio e entre na primeira rodada. Em outra conta autenticada, abra **Torneios → Mesa → 👁️ ASSISTIR PARTIDA**.
4. Confirme que o observador vê somente mesa, jogadores, descarte e placar, sem mãos privadas, botão de entrar, chat, reações, câmera ou microfone. Tente emitir os eventos proibidos por um cliente de testes e confirme a rejeição no servidor.
5. Teste a sexta entrada quando cinco espectadores já estiverem na sala: deve ser rejeitada sem afetar os jogadores.
6. Atualize a página do espectador (F5) e reconecte. Deve voltar como observador da mesma mesa enquanto ela estiver ativa.
7. Clique **SAIR** e confirme que o contador diminui. Termine a partida; a observação da mesa encerrada deixa de estar disponível. Teste também uma mesa pública comum para verificar que seus recursos atuais continuam funcionando.
8. Verifique que a classificação do torneio e o ranking tradicional não mudaram por causa de espectadores.

## Riscos residuais e retorno

- O evento novo utiliza a base existente de espectadores. Se ocorrer erro no deploy, reverta os arquivos deste hotfix para a cópia da V40.69.8.4.1; não é necessária migração inversa de banco.
- Mudanças de fase do torneio fecham o acesso à mesa antiga. O observador deve escolher uma nova mesa ativa pelo painel.
- O bloqueio do chat para observadores do torneio é intencional e **não** altera a conversa nas partidas comuns.
- A versão **V40.69.8.5** (ranking visual/premiações) não foi iniciada.

# MAU-MAU CANDEIAS — Observador | Etapa 3 (estabilidade e acabamento)

## Base da atualização

Este pacote parte de **MAU-MAU-CANDEIAS_COMPLETO_CHAT_UNICO_OBSERVADOR.zip**, ou seja, inclui as Etapas 1 e 2 e a correção do Chat duplicado.

## Correções introduzidas

1. **Aviso único de promoção:** quando um pedido é aceito no intervalo, a tela informa "Você entrou na partida! Aguarde a próxima rodada para receber suas cartas." O aviso anterior de aceitação não é mostrado uma segunda vez.
2. **Conversa preservada:** a promoção de Observador para Jogador usa a mesma sala e o mesmo socket; o histórico do Chat não é limpo nesse evento. Em uma mudança *real* de sala, a limpeza continua ocorrendo normalmente, para impedir a mistura de mensagens.
3. **Pedido repetido não reprocessa a sala:** o servidor devolve a posição da fila, sem emitir um estado novo para toda a sala nem disparar persistência para cliques repetidos.
4. **Novo teste de estabilidade:** cobre simultaneidade na última vaga, reserva por convite, observador temporariamente desconectado, identidade única, entrada após a 4ª rodada, pontuação, distribuição da mão na 5ª rodada e sigilo das cartas durante a observação.

## O que não mudou

Regras de cartas, ordem anti-horária, pontuação, limite de cadeiras, restrição de torneios, serviços de ranking, PostgreSQL, login, câmeras, microfone e Chat da interface de jogador.

## Instalação no GitHub

Se você está na versão com **Chat único** da etapa anterior:

- Substitua `server.js` na raiz.
- Substitua `public/app.js`.
- Adicione `tests/spectator-final-stability-stage3.test.js`.
- Este documento e o arquivo de resultados são apenas informativos.

**Não é necessário alterar package.json ou package-lock.json.** Faça commit e confira o status Live do Render. Se sua versão atual for mais antiga que a correção do Chat único, use o ZIP de **projeto completo** para não perder as etapas anteriores.

## Testes locais

- `node --check` passou em `server.js`, `public/app.js`, `game-engine.js`, `spectator-seat-admission.js` e no novo teste.
- `node scripts/check-lockfile.js` passou.
- Testes disponíveis sem infraestrutura externa: **135 de 135 aprovados**.
- O teste `tests/socketio-integration-v4063.test.js` **não foi executado**, pois o ambiente local não conseguiu instalar `socket.io-client` e as demais dependências. Portanto, **não há confirmação de integração em servidor real nem de queda/reinício efetivo do Render**.
- Navegador Chromium (simulação de UI): o Chat único, os Eventos e o retorno à interface de jogador foram verificados no desktop e no celular.

## Checklist de validação após o deploy

1. Abrir uma mesa comum com quatro cadeiras ocupadas e dois observadores conectados.
2. Ambos solicitam entrada; confirmar que apenas o primeiro pedido válido ocupa a quinta cadeira.
3. Finalizar a 4ª rodada; confirmar que o promovido recebe aviso **uma vez** e o Chat da sala conserva as mensagens anteriores.
4. Iniciar a 5ª rodada; confirmar que o promovido recebeu 6 cartas e todos veem os jogadores na mesma ordem.
5. Simular desconexão curta de observador durante a espera e confirmar recuperação da posição na fila antes do início da próxima rodada.
6. Confirmar que convite reservado e jogador desconectado **não** aparecem como cadeiras livres.
7. Confirmar que o botão não permite entrada durante a 5ª rodada ou em torneios.
8. Testar com um celular e um computador. Verificar Chat, Eventos, Placar e Pessoas, sem controles duplicados.
9. Comparar Logs, Events e Metrics do Render se ocorrerem quedas coletivas.

**Nota:** pedidos de Observador são temporários em memória; após reinício do processo Node.js não são recuperados, por segurança. Nesse caso é necessário fazer novo pedido.

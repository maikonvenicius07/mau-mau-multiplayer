# MAU-MAU CANDEIAS — V40.69.8.13
## Observadores de torneio e ingresso automático dos inscritos
**Base:** ZIP `mau-mau-multiplayer-main (20)(4).zip`, confirmado equivalente à versão anterior de recuperação de mesas nas funções críticas (`server.js`, módulos de torneios e interface).

### Causa das falhas
1. A interface mostrava o botão de observação apenas enquanto a mesa estava `playing` ou `between-rounds`; o servidor também recusava espectadores com `round <= 0` ou `status = lobby`, inclusive em torneios. Por isso não era possível acompanhar uma mesa ainda em preparação.
2. Os participantes sorteados só tentavam entrar via clique no botão **Entrar na minha mesa**. Não existia sinalização automática após sorteio, avanço de fase ou uma autenticação posterior.
3. As representações públicas de sorteios e chaveamentos omitem corretamente o `playerKey`. As atribuições automáticas precisam consultar as tabelas internas; usar a representação pública não permite identificar o jogador com segurança.

### Mudanças realizadas
- `server.js`: habilita observação de mesas de torneio também no lobby, mantendo a checagem de torneio/fase/mesa, limite de espectadores e proibição de virar jogador. Convoca somente titulares sorteados após o sorteio e após o avanço de fase, via Socket.IO, com identificação interna privada. Adiciona `locateTournamentSeat` para localizar vagas de quem chegou depois/reconectou, sem fornecer o código privado da sala. Bloqueia troca involuntária de outra partida ativa para uma mesa de torneio. A autorização da entrada é revalidada no próprio handler `enterTournamentTable`, inclusive contra desistentes. A ocupação de cadeira existente usa o evento `joined` com origem de torneio.
- `tournament-draw.js`: acesso interno, no servidor, às atribuições por conta autenticada; os endpoints públicos continuam sem retornar `playerKey`.
- `public/app.js`: entrada automática quando o servidor informa a mesa, com bloqueio de repetição, novas tentativas limitadas se houver concorrência, prioridade da recuperação da sessão e preservação do modo observador. A tela mantém aviso explícito MODO OBSERVADOR.
- `public/tournament-ui.js`: retira a exigência do botão **Entrar na minha mesa**, habilita **ASSISTIR AO TORNEIO** também enquanto a sala está em lobby, e consulta o servidor para recuperar a atribuição ao abrir o painel.
- `public/index.html`: atualiza explicação, versão dos recursos estáticos e remove instrução antiga de entrada manual.
- Testes reforçados para observação do lobby, autenticação, notificação privada, não promoção de espectadores, desistências, ausência de duplicações e navegação automática.

### Regras preservadas
- Partidas normais sem alteração de regras; no torneio **nenhuma máquina substitui desistentes**.
- Não existem ações de observador que possam jogar, comprar cartas, pedir ingresso ou participar do ranking.
- Não são divulgadas cartas particulares, tokens ou códigos internos aos espectadores.
- Conexões de câmera e microfone do jogo normal não foram modificadas.
- O fluxo já existente de recuperação de lobby e resultados por fase continua presente.

### Limites intencionais
- Não é possível assistir a uma partida cujo lobby ainda não foi criado. A interface informa que deve aguardar a chegada dos sorteados; assim que a sala surgir, fica visível a opção de observar.
- O jogador que já está disputando outra partida não é removido à força. Deve primeiro sair da partida existente.
- Um usuário que está observando não é automaticamente promovido a jogador. A separação de perfis permanece ativa.
- A entrada automática ocorre quando existe conexão Socket.IO e o servidor e banco estão disponíveis; não garante que uma pessoa desconectada entre fisicamente na partida.

### Testes
- 187 arquivos de teste executados individualmente com êxito, sem `DATABASE_URL` real.
- 1 teste de integração Socket.IO (`socketio-integration-v4063.test.js`) não executado porque o pacote `socket.io-client` não está instalado no ambiente de verificação.
- Verificações sintáticas de todos os arquivos JavaScript alterados com `node --check`.
- ZIP parcial gerado exclusivamente a partir dos arquivos efetivamente alterados, comparados byte a byte com o ZIP completo.
- Não foi possível testar usuários e PostgreSQL no Render; realizar homologação com 2, 6 e 20 jogadores.

### Homologação recomendada no Render
1. Criar torneio, inscrever e confirmar pelo menos 2 participantes autenticados, fechar inscrições e sortear. Confirmar entrada automática, sem botão.
2. Com uma mesa em lobby, outra conta pode usar **ASSISTIR AO TORNEIO** e ver somente informações públicas. Testar comandos de jogar/comprar por socket e confirmar rejeição.
3. Iniciar partida, dar F5 no jogador e no observador, confirmar mesma vaga/somente observação.
4. Encerrar torneio com mais de uma mesa e verificar entrada automática dos classificados na fase seguinte, sem máquina, duplicação ou retorno de desclassificados.
5. Repetir duas tentativas simultâneas e testar interrupção breve do banco e reconexão.

### Instalação
Para atualização do GitHub, copiar o conteúdo do ZIP **SOMENTE_ALTERADOS** para a raiz do repositório, sem criar uma pasta extra. Confirmar `node --check server.js` e o deploy no Render. Não misturar com ZIPs de versões anteriores.

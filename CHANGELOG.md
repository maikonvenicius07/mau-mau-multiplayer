# V40.68 — Limpeza e Limite de Salas

- Limite padrão de 50 salas simultâneas, configurável por `MAX_ROOMS`.
- Reserva de capacidade para impedir ultrapassagem por criações concorrentes.
- Partidas existentes nunca são interrompidas por atingir o limite.
- Limpeza centralizada dos recursos efêmeros de uma sala excluída.
- Auditoria a cada 60 s de salas sem jogadores humanos.
- Diagnóstico agregado de salas/capacidade no `/health`.
- Nenhuma dependência npm nova.

# V40.67 — Tempo de Vida da Reconexão

- Criada política central para os três prazos de recuperação.
- AUTO temporário permanece em 60 segundos.
- Sala solo permanece com expiração de 5 minutos.
- Snapshot multiplayer passa a ter regra oficial explícita de 8 horas (28.800.000 ms).
- Produção/Render mantém 8 h mesmo diante de configuração antiga divergente.
- SAIR, troca de sala e abandono definitivo continuam cancelando a reserva imediatamente.
- Nenhuma dependência npm foi alterada.

# V40.66 — Health Check e Banco

- `/ready` agora faz verificação ativa do PostgreSQL para ranking e snapshots.
- Render usa `/ready` como `healthCheckPath`.
- Produção/Render não é considerada pronta com fallback JSON local.
- `/health` permanece como liveness leve, sem depender do banco.
- Probe protegido por timeout de 2 segundos e resposta sem dados sensíveis.
- Nenhuma dependência npm ou regra do Mau-Mau foi alterada.

# V40.65 — Deploy reproduzível

- Adicionado bootstrap seguro para geração de `package-lock.json` no GitHub com Node 22.22.0.
- Render e GitHub Verify passam a preferir `npm ci` quando o lockfile existe.
- O lockfile é validado antes da suíte (`scripts/check-lockfile.js`).
- O workflow prova `npm ci` + suíte completa antes de tentar commitar o lockfile.
- Se o push automático for bloqueado, o lock fica disponível como artefato `package-lock-v40.65`.
- Nenhuma regra ou interface do jogo foi alterada.

## V40.64 — Segurança de avatar e entradas

A V40.64 reforça a validação no servidor contra clientes modificados sem alterar as regras ou a interface do jogo. Foi criado o módulo compartilhado `input-safety.js`, utilizado pelo servidor, motor e restauração de snapshots.

- nomes ficam limitados a 24 caracteres, sem controles e sem conversão acidental de objetos;
- chat fica limitado a 180 caracteres;
- avatares personalizados aceitam apenas PNG/JPG/WEBP e respeitam o limite do servidor;
- um avatar abusivo de 300 mil caracteres é descartado antes de entrar no estado;
- `game-engine.js` aplica a mesma validação como segunda camada;
- snapshots antigos também são higienizados ao restaurar;
- códigos de sala, tokens, convites, IDs de carta e enums recebem limites explícitos;
- listas de referências de avatar e peers de voz são limitadas antes de serem percorridas;
- o limite global do Socket.IO permanece em 400 KB, preservando Áudio Rápido e figurinha personalizada.

**Validação da montagem:** 87 testes sem dependência externa passaram, incluindo o novo teste V40.64. A suíte agora contém 88 testes; o teste Socket.IO real será novamente confirmado no Render após `npm install`.

---

## V40.63 — Testes reais de Socket.IO

A V40.63 adiciona uma camada de **testes de integração com conexões Socket.IO reais**, complementando os testes unitários e de contrato já existentes. O objetivo é reproduzir o tipo de problema que pode aparecer somente quando servidor e clientes realmente conectam, desconectam e trocam eventos pela rede.

O novo teste sobe uma instância real do servidor em uma porta local temporária, cria sessões autenticadas de teste e conecta clientes usando `socket.io-client` 4.8.1. Ele valida, pelo fluxo real de eventos:

- criação e entrada em sala por Socket.IO;
- início de rodada com jogadores conectados;
- queda involuntária e registro da reserva;
- refresh/reentrada antes do prazo pela mesma cadeira e mesma mão;
- expiração do prazo de reconexão e entrada da cadeira em AUTO;
- retorno após AUTO pela mesma Conta Google, recuperando a cadeira atual;
- botão **SAIR** cancelando a reconexão automática;
- entrada efetiva em outra sala cancelando a reserva anterior;
- convite interno enviado, aceito e concluído por sockets reais;
- duas quedas simultâneas com reservas independentes.

A regra oficial continua sendo **60 segundos em produção**. Para que o teste não precise esperar um minuto inteiro, o servidor aceita relógios acelerados somente quando `NODE_ENV=test` e variáveis específicas de teste estão definidas. Em produção esses valores são ignorados e permanecem `DISCONNECT_DEBOUNCE_MS = 3000` e `RECONNECT_GRACE_MS = 60 * 1000`.

Foi adicionada a dependência fixa `socket.io-client` 4.8.1 para que o próprio `npm run verify` do Render/GitHub consiga executar o cliente de integração real. Também foi adicionado o comando `npm run test:socket` para rodar apenas essa prova.

**Validação local desta montagem:** os 86 testes históricos passaram novamente e todos os arquivos alterados passaram em `node --check`. A execução do novo teste Socket.IO depende das dependências npm instaladas; no ambiente de montagem não houve acesso ao registro npm, portanto a prova integrada deverá ser executada pelo `npm run verify` no GitHub/Render após `npm install`.

---

## V40.62 — Ranking OFICIAL x TREINO congelado no início

A V40.62 corrige a classificação do ranking para que uma partida não mude de categoria por acontecimentos posteriores ao seu início. A modalidade é definida no começo da **primeira rodada** e fica congelada até o fim daquela partida.

- Se a partida começa somente com cadeiras humanas, ela é **👥 OFICIAL**.
- Se a partida começa com pelo menos uma Máquina, ela é **🤖 TREINO**.
- Uma queda de internet com AUTO temporário não altera a categoria, pois a cadeira continua pertencendo ao humano.
- Se um humano sair voluntariamente durante uma partida OFICIAL e sua cadeira virar Máquina para a mesa continuar, a partida permanece **OFICIAL**.
- Uma partida que começou como TREINO não vira OFICIAL se uma Máquina deixar de fazer parte da composição posteriormente.
- Revanche é uma nova partida: a categoria anterior é apagada e será calculada novamente no início da nova primeira rodada.

O campo `rankingModeAtStart` também é salvo no snapshot. Em snapshots criados antes da V40.62, a restauração faz uma migração segura: uma cadeira convertida de humano para Máquina após abandono (`voluntaryLeftAt`) não é confundida com uma Máquina que já existia quando a partida começou.

**Objetivo de integridade:** um jogador não consegue transformar uma partida OFICIAL em TREINO simplesmente saindo quando está perdendo, preservando o registro correto da vitória dos demais.

**Validação:** 86/86 testes aprovados, incluindo teste dedicado à classificação congelada, AUTO temporário, saída humana, TREINO original, snapshot/restart, migração de snapshot antigo e revanche.

---

## V40.61.1 — Expiração de Sala Solo

A V40.61.1 acrescenta uma regra específica para partidas em que existe **somente 1 jogador humano contra uma ou mais Máquinas**. Se esse único humano perder a conexão de forma involuntária, a sala continua reservada por no máximo **5 minutos contados desde a queda**.

Os primeiros 60 segundos continuam com a regra normal de reconexão. Depois disso, a Máquina pode assumir temporariamente a cadeira, mas o prazo total da sala solo continua sendo o mesmo: ele **não reinicia** aos 60 segundos. Se o jogador retornar antes de completar 5 minutos, o timer é cancelado e a partida continua da situação atual.

Se completar 5 minutos sem retorno, o servidor encerra timers/observadores/convites, grava a exclusão durável da V40.61 e remove definitivamente a sala e seu snapshot. Um token antigo não pode recriá-la.

**SAIR** e **entrar efetivamente em outra sala** continuam sendo abandono voluntário. Se era o único humano de uma sala com robôs, a sala antiga é excluída **imediatamente**, sem esperar os 5 minutos.

O marco inicial do prazo (`soloDisconnectStartedAt`) é salvo no snapshot. Assim, se o Render reiniciar durante os 5 minutos, o relógio continua do ponto em que estava e não ganha uma nova janela inteira.

A regra de 5 minutos é exclusiva de **1 humano + robôs**. Se houver dois ou mais humanos pertencentes à partida, permanece a lógica geral de reconexão já definida nas versões anteriores.

**Validação:** 85/85 testes aprovados, incluindo teste dedicado a queda solo, AUTO após 60 s, retorno antes de 5 min, SAIR/troca imediatos, partida com múltiplos humanos e continuidade do prazo após snapshot/restart.

---

## V40.61 — Persistência Forte de Saída e Exclusão

A V40.61 reforça as transições que não podem ser revertidas por um restart brusco do servidor: **Sair**, **entrar efetivamente em outra sala** e **excluir uma sala**.

Antes de alterar a cadeira humana em memória, o servidor grava um **tombstone durável** identificando exatamente aquela associação jogador/sala. Se o processo for interrompido antes de o snapshot atualizado ser salvo, o tombstone continua impedindo que um snapshot antigo devolva a Conta Google à cadeira abandonada. Em partida ativa, a cadeira antiga reaparece apenas como Máquina comum; fora de partida, a associação antiga é descartada.

A exclusão de sala também recebe um tombstone próprio. O PostgreSQL grava o tombstone e remove o snapshot em transação; no armazenamento JSON, ambos são gravados na mesma atualização atômica do arquivo. Gravações atrasadas de snapshot não conseguem ressuscitar uma sala já marcada como excluída.

Cada nova entrada humana possui uma associação própria. Isso permite que, depois de sair voluntariamente, o jogador volte posteriormente pelo **código da sala** como uma nova entrada legítima sem reativar a reserva anterior. Tombstones antigos apontam para a cadeira/associação antiga, não para a Conta Google para sempre.

A V40.60 permanece preservada: apenas iniciar ou cancelar matchmaking não cancela uma reserva involuntária. A persistência forte só é acionada quando a saída/troca realmente é confirmada.

**Validação:** 84/84 testes aprovados, incluindo simulação de crash com snapshot antigo, abandono persistido sem save posterior, nova entrada explícita pelo código e tentativa de gravação atrasada após exclusão da sala.

---

## V40.60 — Matchmaking sem Abandono Prematuro

A V40.60 corrige a diferença entre **procurar uma nova partida** e **entrar efetivamente em outra sala**. Iniciar a busca automática não cancela mais uma reserva válida de reconexão criada por queda involuntária. Se a busca for cancelada, expirar ou falhar antes de formar uma nova mesa, a reserva anterior continua intacta.

Quando o matchmaking realmente consegue criar a nova sala com sucesso, o servidor faz uma segunda validação para confirmar que nenhum participante retomou outra mesa enquanto aguardava. Somente depois dessa confirmação a reserva antiga é encerrada e a Conta Google passa a pertencer exclusivamente à nova sala.

A mesma proteção foi aplicada à criação manual de sala e à criação de mesa iniciada pelo fluxo de convite: primeiro a nova sala precisa ser criada com sucesso; só então uma reserva anterior é cancelada. Entrada por código/link, Modo Observador e convite interno continuam validando o destino antes de confirmar qualquer troca.

**Regra central:** entrar na fila ≠ entrar em outra sala. Cancelar a busca preserva a reconexão anterior; formar/entrar em uma nova sala cancela a reserva antiga conforme a V40.59.

**Validação:** 83/83 testes aprovados, incluindo teste dedicado ao matchmaking com reserva involuntária.

---

## V40.59 — Reconexão Estrita e Ciclo de Vida das Salas

A V40.59 redefine de forma explícita o pertencimento de um jogador à sala. **Reconexão automática passa a existir somente após desconexão involuntária**. Queda de internet, fechamento acidental, segundo plano, refresh ou interrupção temporária mantêm a vaga humana reservada; após 60 segundos, a Máquina pode controlar temporariamente a mesma cadeira, mas o jogador original continua apto a retornar automaticamente.

**Sair da sala e entrar efetivamente em outra sala são abandonos voluntários.** Nesses casos a reserva automática é cancelada, a identidade Google e o token humano deixam de pertencer à cadeira antiga e o jogador só poderá voltar depois por uma entrada normal usando o código da sala, se ela ainda existir e puder recebê-lo. Em uma rodada ativa com outros humanos, a cadeira antiga pode virar uma Máquina comum para não quebrar a partida; essa Máquina não representa mais o usuário e não concede reconexão.

Uma Conta Google não pode manter vínculos humanos em duas salas. Ao ingressar numa nova sala, o servidor remove/converte qualquer vínculo humano anterior. Quando o último jogador humano abandona definitivamente uma sala, a sala é removida da memória, observadores e timers são encerrados e o snapshot temporário é excluído. Máquinas sozinhas nunca mantêm uma sala abandonada.

Dados antigos do navegador não recriam salas: código/token salvo só inicia uma tentativa de retomada; o servidor exige que a sala exista, que a cadeira ainda pertença à mesma Conta Google e que `reconnectEligible` continue válido. Se a sala ou a reserva não existir, a sessão local é descartada e o usuário permanece na tela inicial.

A atualização adiciona `room-lifecycle.js` para centralizar as transições de queda involuntária, AUTO temporário, abandono voluntário, conversão em Máquina comum e detecção de sala sem humanos. Também migra snapshots legados das V40.58.2–V40.58.5 para impedir que antigas saídas voluntárias sejam restauradas como reservas válidas.

**Validação:** 82/82 testes aprovados. Há um teste dedicado aos 14 cenários obrigatórios de reconexão, saída, troca e exclusão de sala, além de toda a suíte histórica de cartas, turnos, Dama em 2 jogadores, observador, chat, ranking, áudio/WebRTC e deploy.

---

## V40.58.5 — Convite por Link com Troca Explícita

- O botão **ENTRAR NA SALA** de um convite por link agora usa um fluxo próprio, separado da entrada por código digitado.
- Ao confirmar um link para outra sala, a Conta Google pode abandonar com segurança uma cadeira antiga ainda presa a outra aba/aparelho.
- Se a mesa anterior estiver em partida ativa, a cadeira vira Máquina preservando mão, placar e posição; fora de partida, a vaga antiga é liberada.
- O socket atual deixa o canal da sala anterior antes de concluir a entrada na nova sala.
- A entrada manual por código continua conservadora e não força a saída de uma mesa conectada.
- Regras de cartas, reconexão, observador, chat por sala, ranking e áudio/WebRTC não foram alterados.
- 81 testes aprovados.

## V40.58.4 — Saída Confirmada + Conta Livre entre Salas

- **Sair** durante partida ativa continua entregando a cadeira à Máquina sem reiniciar a rodada.
- A saída voluntária agora recebe uma marca explícita no servidor (`voluntaryLeftAt`), evitando que um socket antigo mantenha a Conta Google presa à sala anterior.
- Ao escolher outra sala, a vaga antiga em AUTO é liberada mesmo em condições de corrida de conexão; se a partida continuar, a cadeira vira Máquina permanente mantendo mão/placar/posição.
- O botão **Sair** usa confirmação Socket.IO com timeout e estado **Saindo...**, tornando falhas de saída visíveis em vez de silenciosas.
- Se o jogador apenas sair e depois voltar à mesma partida sem escolher outra mesa, a cadeira continua recuperável pela mesma Conta Google.
- O chat continua sendo **por sala**: revanche na mesma sala mantém a conversa; sala diferente começa com outro histórico.

## V40.58.3 — Chat por Sala + Troca Segura de Mesa

- A conversa pertence à sala e continua nas revanches da mesma sala.
- Uma sala diferente começa com conversa própria, sem vazamento visual da sala anterior.
- Convites por link para outra sala têm prioridade sobre a reconexão automática antiga.
- Ao optar por outra mesa, vaga antiga desconectada/AUTO é liberada sem reiniciar a partida anterior: a cadeira vira Máquina permanente.
- Vagas ainda conectadas em outro dispositivo continuam protegidas.

## V40.58.2 — Continuidade ao Sair + Chat Isolado

- Durante uma partida ativa, o botão **Sair** não remove mais o jogador nem cancela/reinicia a rodada. A cadeira humana, mão, pontuação e posição permanecem reservadas e a **Máquina assume imediatamente** até a mesma Conta Google voltar.
- A perda involuntária de conexão continua usando a janela de 60 segundos antes do AUTO, como nas versões anteriores.
- Ao iniciar uma nova partida na mesma sala, o histórico de chat da partida anterior é apagado.
- Ao entrar em qualquer sala ou no Modo Observador, o navegador limpa imediatamente o chat local anterior antes de receber o histórico da sala atual.
- Regras de cartas, Dama em 2 jogadores, Queima, Dupla, Ação Rápida, observador, ranking e áudio/WebRTC não foram alterados.

## V40.58.1 — Correção de Empacotamento e Deploy
- Restaurados `.node-version`, `.npmrc` e `.github/workflows/verify.yml` que ficaram fora do ZIP da V40.58.
- `.env.example` voltou a documentar snapshots, TURN temporário e as opções `MAUMAU_ALLOWED_ORIGINS`/logs da V40.58.
- Cache-busting e versão do pacote atualizados para 40.58.1.
- Nenhuma regra, turno, reconexão, observador, ranking, áudio ou WebRTC foi alterado.

## V40.58 — Segurança e Monitoramento
- Remove CORS global (`origin: *`) do Socket.IO.
- Autoriza automaticamente a mesma origem do jogo e permite origens externas somente por `MAUMAU_ALLOWED_ORIGINS`.
- Valida o `Origin` também no handshake do servidor com `allowRequest`.
- Adiciona CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy e Permissions-Policy.
- Adiciona `X-Request-Id`, `/ready` e métricas operacionais mínimas em `/health`.
- Adiciona logs HTTP estruturados opcionais (`MAUMAU_HTTP_LOGS=1`) sem query string, cookies, corpo, cartas ou tokens.
- Preserva integralmente regras, reconexão, observador, ranking e áudio.
- 76 testes aprovados.

## V40.57.1 — Correções da Auditoria

- Restaurados `.node-version`, `.npmrc`, workflow de verificação do GitHub e `.env.example` completo.
- Sessão substituída agora é removida da sala, perde o papel e é desconectada do servidor.
- Chat, efeitos e Áudio Rápido validam o socket proprietário atual.
- Partidas ativas deixam de ser removidas pela limpeza histórica de 6 horas.
- Regras do Mau-Mau, mãos, turnos, posições, WebRTC e ranking preservados.

## V40.57 — Reconexão Inteligente Permanente

- Vaga humana permanece reservada durante toda a partida mesmo após os 60 s e entrada em AUTO temporário.
- Token local continua sendo a primeira forma de retomar exatamente a mesma cadeira.
- Sem código/token local, a mesma Conta Google pode localizar e recuperar automaticamente sua vaga desconectada/AUTO, inclusive em outro aparelho.
- Nome do jogador nunca é aceito como identidade de reconexão.
- Transferência bot → humano cancela timer automático pendente e sempre entrega a mão/estado atuais, sem desfazer jogadas feitas pelo AUTO.
- Nova bateria de testes cobre retorno antes/depois de 60 s, múltiplas jogadas do AUTO, 2–5 jogadores, múltiplas quedas, dois desconectados, observadores e refresh.

## V40.56 — Deploy Seguro e Reproduzível

- Node.js fixado em 22.22.0 via `package.json` e `.node-version`.
- Render passa a executar a suíte completa antes de publicar.
- GitHub Actions verifica automaticamente pushes e pull requests.
- `.npmrc` passa a salvar futuras dependências com versão exata.
- Nenhuma alteração nas regras do Mau-Mau, voz, reconexão ou persistência.

## V40.55 — Estabilidade Final

- Ativa `connectionStateRecovery` do Socket.IO por 60 s, sem substituir a reconexão inteligente existente.
- Preserva `socket.data` quando a conexão é recuperada nativamente.
- Reduz `maxHttpBufferSize` de 900 KB para 400 KB.
- Reduz o limite do Áudio Rápido de 700 KB para 250 KB, mantendo 15 s e 48 kbps.
- Snapshots deixam de repetir Data URLs/Base64 dentro do JSON da sala.
- Adiciona `mm_room_avatar_assets` no PostgreSQL, com assets endereçados por hash e limpeza por sala.
- Assets de avatar só são regravados quando o conjunto de referências muda.
- Mantém compatibilidade com snapshots antigos da V40.53/V40.54.
- Regras do jogo, WebRTC, observadores, ranking e Minha Música permanecem inalterados.

## V40.54.1 — Correção de configuração TURN / snapshots

- Completa `.env.example` com `VOICE_TURN_SECRET` e `VOICE_TURN_TTL_SECONDS=3600`.
- Documenta `ROOM_SNAPSHOT_TTL_MS=28800000` (8 horas).
- Explica no próprio exemplo as duas formas de autenticação TURN: estática ou temporária/coturn.
- Nenhuma regra, turno, áudio, WebRTC, reconexão, avatar, snapshot ou função social foi alterada.
- Adiciona teste de regressão para impedir que essas variáveis desapareçam novamente.

## V40.54 — Convite por link + jogadores recentes

- O botão 🔗 da sala usa o compartilhamento nativo do celular quando disponível; em outros navegadores copia o link.
- Links `?room=CODIGO` ganham um cartão de convite na tela inicial com entrada direta na sala.
- Se a partida do link já estiver em andamento, permanece o fluxo seguro que oferece Modo Observador.
- A janela Jogadores Online ganhou as abas **ONLINE** e **RECENTES**.
- Jogadores recentes vêm do histórico real de partidas concluídas e mostram última partida e quantidade de partidas juntos.
- Um jogador recente que estiver online pode ser convidado novamente usando o sistema de convite já existente.
- Nenhuma regra, turno, áudio, WebRTC/TURN, reconexão, avatar leve ou snapshot de sala foi alterado.

## V40.53 — Proteção contra reinício do servidor

- Snapshots das salas ativas em PostgreSQL (fallback JSON local).
- Restauração das partidas antes de o servidor aceitar conexões.
- socketIds, WebRTC, observadores e timers não são persistidos.
- Jogadores humanos recebem nova janela de 60 s para reconectar à vaga após restart.
- Salvamento final em SIGTERM/SIGINT para deploy/manutenção do Render.
- Snapshot removido quando a sala é removida normalmente.
- Regras e motor do jogo preservados.

## V40.52 — Estado e avatares leves

- Figurinhas personalizadas deixam de ser repetidas em cada evento `state`.
- O estado usa referência de conteúdo `custom-avatar:<hash>`; a imagem é enviada separadamente uma única vez por socket.
- Cache de avatares no navegador com recuperação automática sob demanda após reconexão/cache ausente.
- Estado de jogador, observador e Conferência da Rodada usam a mesma referência leve sem alterar a aparência.
- Diagnóstico passa a mostrar tamanho do último estado, quantidade de avatares em cache e bytes de avatar recebidos.
- Servidor só atende pedidos de avatar que pertençam à sala atual, evitando acesso cruzado entre salas.
- Motor de regras, bots, ranking, WebRTC/TURN e reconexão permanecem inalterados.

## V40.51 — WebRTC/TURN robusto para observadores

- WebRTC/Opus passa a ser a rota principal também para observadores.
- TURN é usado automaticamente pelo ICE quando configurado no Render/servidor.
- Suporte opcional a credenciais temporárias TURN REST/coturn via `VOICE_TURN_SECRET`.
- Relay μ-law/Socket.IO permanece somente como fallback seletivo por destinatário.
- Fallback é ativado após timeout/falha de ICE e removido quando o WebRTC recupera.
- Quadros residuais do fallback são ignorados quando a rota WebRTC já está saudável.
- Limite de 6 peers WebRTC de saída por microfone protege upload em salas com muitos observadores.
- Diagnóstico mostra configuração TURN e rota P2P/TURN/MISTA.
- Regras, turnos, reconexão de cadeira, ranking e Minha Música não foram alterados.

## V40.50 — Diagnóstico de conexão + AudioWorklet

- Relay do microfone do observador passa a usar **AudioWorklet** quando disponível, retirando captura/processamento da thread principal; navegadores antigos mantêm fallback compatível.
- Frames de relay são processados em blocos curtos com VAD e continuam sendo enviados como eventos `volatile`, sem disputar a fila confiável da partida.
- Novo painel **📶 Diagnóstico de conexão** com ping ao servidor, jitter das sondas, falhas recentes, transporte Socket.IO, reconexões, rota da voz e métricas WebRTC quando disponíveis.
- Adicionada sonda leve `networkProbe`, sem estado da partida ou dados pessoais.
- Nenhuma regra do Mau-Mau foi alterada.


## V40.49 — Estabilidade de rede e voz do observador
- Relay do observador comprimido e com supressão de silêncio.
- Pacotes de áudio em modo VOLATILE para não bloquear turnos/heartbeat.
- Jitter buffer mais curto para conversa em tempo real.
- Reconexão móvel mais rápida e debounce de microquedas de 3 s.
- Heartbeat Socket.IO ajustado.
- Nenhuma regra do jogo alterada.

# V40.48 — Minha Música local

- Botão 🎵 Minha Música na tela inicial e dentro da partida.
- Seleção de arquivo de áudio local (`audio/*`), reproduzido somente no aparelho do jogador.
- Sem upload, Socket.IO, PostgreSQL, ranking ou compartilhamento do arquivo.
- Object URL é revogada ao trocar/remover música ou fechar a aba.
- Música pausa quando há microfone/voz ativa e retoma depois se estava tocando.
- Nenhuma trilha interna volta ao projeto.
- Regras, turnos, observador, reconexão e microfone permanecem inalterados.

# V40.47 — Áudio Simplificado

- Remove todas as trilhas internas e a pasta `public/assets/music/`.
- Remove o botão e o painel 🎵 de música da interface.
- Mantém efeitos sonoros, avisos falados, Áudio Rápido e microfone ao vivo.
- O jogador pode usar a música do próprio celular/app de streaming.
- Preserva as otimizações de avatares/figurinhas/cache da V40.46 e todas as regras da V40.43.
- Reduz significativamente o tamanho público do projeto e elimina RAM/tráfego destinados às trilhas internas.

# V40.46 — Performance Mobile

- Músicas longas passaram de `AudioBuffer/decodeAudioData` para `HTMLAudioElement`, usando streaming/buffering nativo do navegador e reduzindo pressão de memória no celular.
- Mantida a regra V40.45: qualquer microfone ao vivo ativo pausa a música; ela volta quando todos desligam o microfone.
- Música da tela inicial recomprimida de ~3,6 MB para ~2,1 MB, preservando a duração.
- Avatares fixos reduzidos para 256×256 WebP; o conjunto caiu de ~635 KB para ~280 KB. Os originais foram preservados em ZIP de backup separado.
- Novas figurinhas personalizadas passam a ser preparadas em 192×192 WebP, com limite de dados menor; figurinhas antigas grandes são migradas localmente quando possível.
- Assets públicos recebem cache HTTP leve com `stale-while-revalidate`; HTML continua sem cache forte e JS/CSS usam cache-busting V40.46.
- Regras de jogo, turnos, Dama especial de 2 jogadores, Ás, Queima, ×2, Ação Rápida, observador, microfone e reconexão preservados.
- Suíte ampliada para 63 testes.

# V40.45 — Música otimizada e microfone prioritário

- A música de fundo é silenciada completamente quando qualquer participante liga o microfone ao vivo.
- A preferência e o volume do jogador são preservados e a música volta automaticamente quando não há mais microfones ativos.
- O catálogo inteiro de músicas deixou de ser pré-carregado; agora a faixa atual é carregada sob demanda e apenas uma provável próxima faixa é antecipada em baixa prioridade.
- O cache de buffers de música fica limitado a quatro faixas para reduzir uso de memória em celulares.
- A música é silenciada quando o navegador fica em segundo plano e volta ao retornar.
- Stingers de vitória/fim de rodada não iniciam enquanto houver microfone ao vivo ativo.
- Correção de continuidade da V40.44: `.env.example` usa `AUTH_SESSION_SECRET`.
- Nenhuma regra de cartas, turnos, Dama de 2 jogadores, Ás, Queima, Ação Rápida ou Carta Dupla foi alterada.

## V40.44 — Hardening técnico (sem alteração de regras)

- Corrigido risco de figurinha Base64 exceder `avatar VARCHAR(40)` do ranking PostgreSQL; ranking agora salva `custom`.
- Ações da mesa agora exigem que o `socket.id` seja o socket atual da cadeira, bloqueando sessão antiga substituída.
- Adicionada trava geral contra uma mesma Conta Google ocupar duas salas ativas ao mesmo tempo.
- Corrigido `.env.example`: `AUTH_SESSION_SECRET` substitui o nome incorreto `SESSION_SECRET`.
- Nenhuma regra de turno/cartas foi alterada; Q de 2 jogadores permanece exatamente como na V40.43.

## V40.43 — Turnos corrigidos com regra Q de 2 jogadores preservada

- **Preserva integralmente a regra validada da Dama com 2 jogadores:** Q inverte o sentido e quem a jogou joga novamente.
- Mantém a correção de segurança da V40.42 que impede falhas do bot/AUTO de avançarem `currentPlayer` diretamente.
- Mantém o Ás como efeito de pulo: ele avança duas posições no sentido atual e pula exatamente o próximo jogador.
- Para 3, 4 e 5 jogadores, a Dama continua invertendo uma única vez e seguindo para o jogador adjacente no novo sentido.
- Restaura no frontend o alerta **SUA VEZ** quando uma Q de 2 jogadores devolve a vez ao mesmo jogador.
- Mantém a auditoria `turnAudit` e `MAUMAU_TURN_DEBUG=1`.
- Adiciona teste de regressão exclusivo para impedir que a regra Q de 2 jogadores seja alterada novamente.

> A V40.42 anterior não deve ser usada como referência para a regra Q de 2 jogadores; a V40.43 restaura o comportamento correto já existente na V40.41.

## V40.42 — Integridade de turnos (substituída pela V40.43)

- Alteração experimental da V40.42 (revertida na V40.43): Q havia sido uniformizada para seguir ao outro jogador também em partidas de 2; essa mudança **não faz parte da regra atual**.
- Mantém **A como a única carta de pulo**: o Ás avança exatamente duas posições no sentido atual, pulando somente o próximo jogador.
- Remove o avanço direto de `currentPlayer` no tratamento de erro do bot/AUTO; a recuperação agora usa somente ações válidas da Engine (comprar/passar) e, se falhar, mantém a vez parada.
- Adiciona trilha interna `turnAudit` e console opcional com `MAUMAU_TURN_DEBUG=1` para investigar transições de turno sem expor dados ao frontend.
- Adiciona teste profundo de turnos com 2, 3, 4 e 5 jogadores, incluindo cartas normais, A, Q, várias Q, Q→A, Queima, Ação Rápida, ×2, compra/passe, reconexão e partidas completas com bots.
- Assentos/avatares continuam fixos; somente a fila real de turno muda.

## V40.41 — Consolidação e limpeza

- Consolida integralmente a V40.40 sobre a última base do projeto.
- Mantém o microfone do observador visível no celular e o relay de voz da V40.36.
- Mantém a Central ASSISTIR PARTIDAS organizada e o avatar Kaldynho.
- Remove `app.js` e `index.html` duplicados da raiz, evitando regressões por edição do arquivo errado.
- Remove pasta antiga de atualização V40.34 que estava dentro do projeto.
- Atualiza cache-busting do frontend para V40.41.
- Adiciona `.gitignore`, `.env.example` e teste automático de limpeza/consistência.

# V40.36 — Voz do Observador com Relay de Compatibilidade

- Corrige o caso em que o botão do microfone aparecia para o observador, mas não havia áudio em nenhum sentido.
- Jogador ↔ observador e observador ↔ observador passam a usar relay PCM mono/16 kHz pelo Socket.IO.
- Esses caminhos deixam de depender de conexão WebRTC P2P/STUN/TURN.
- Jogador ↔ jogador continua em WebRTC P2P.
- O relay só é ativado para jogadores quando há pelo menos um observador conectado.
- Limites de tamanho e taxa no servidor protegem a sala contra pacotes excessivos.
- A privacidade das cartas e os bloqueios de ações do observador permanecem inalterados.
- 56/56 testes aprovados.

# CHANGELOG


## V40.35 — Microfone do observador sempre visível

- Move o botão `liveMicBtn` para fora da mesa (`felt`), evitando recorte por `overflow: hidden`.
- Garante por CSS que o botão permaneça visível no `Modo Observador`.
- Cria posição flutuante independente para jogador e observador.
- No primeiro uso como observador, posiciona o microfone na parte inferior esquerda da tela, onde não disputa espaço com o painel do modo observador.
- Mantém voz WebRTC entre jogadores e observadores, privacidade das cartas e bloqueio das ações de jogo.
- Adiciona teste de regressão específico para a visibilidade do microfone do observador.

## V40.34 — Microfone também para observadores

- Observadores agora veem e podem ligar o botão flutuante **🎙️ LIGAR MICROFONE**.
- Voz ao vivo WebRTC passa a conectar **jogadores humanos e observadores** da mesma sala.
- O servidor continua aceitando apenas sinalização WebRTC; o áudio permanece P2P.
- Observadores continuam sem receber cartas privadas e continuam bloqueados de jogar, comprar, queimar ou executar qualquer ação da partida.
- A lista de observadores mostra um pequeno **🎙️** quando um observador está com o microfone ligado.
- Reconexão automática, fila ICE, Opus e TURN opcional da V40.33 foram preservados.

## V40.33 — Microfone ao vivo mais estável

- corrigida a perda de candidatos ICE quando a sinalização chega durante a negociação;
- adicionada reconexão automática quando um enlace de voz falha ou fica desconectado;
- o microfone tenta retomar automaticamente após uma oscilação da conexão Socket.IO;
- captura otimizada para fala: cancelamento de eco, redução de ruído, ganho automático, mono e preferência por 48 kHz;
- preferência pelo codec Opus e limite de bitrate voltado para voz;
- música é reduzida automaticamente enquanto há conversa ao vivo, melhorando a inteligibilidade;
- novo estado visual **RECONECTANDO...** no botão do microfone;
- suporte opcional a servidor TURN via `VOICE_TURN_URLS`, `VOICE_TURN_USERNAME` e `VOICE_TURN_CREDENTIAL`;
- o áudio continua sem ser salvo no PostgreSQL, ranking ou histórico de chat.

## V40.32 — Central de Partidas ao Vivo e Modo Observador aprimorado

- Nova opção **👁️ ASSISTIR PARTIDAS** na tela inicial.
- Contadores de salas públicas, partidas ao vivo e observadores conectados.
- Lista de salas públicas em andamento com entrada direta como observador.
- Cada sala criada pela tela inicial pode ser marcada como pública ou privada.
- O anfitrião pode alternar a visibilidade da sala durante a sessão.
- Painel exclusivo do observador com jogadores, rodada, número de espectadores, lista de observadores e acontecimentos recentes.
- As cartas privadas continuam protegidas no servidor e não são enviadas ao observador.

## V40.31 — Lobby de avatares mais equilibrado

- agrupados **Pessoas** e **Sua Figurinha** em uma coluna lateral própria;
- removida a lacuna vertical grande que aparecia antes da área de figurinha;
- figurinha personalizada ficou menor e mais discreta;
- mantidos seleção, troca, remoção, avatares premium e toda a lógica do jogo;
- layout mobile continua empilhado e responsivo.


## V40.30 — Figurinha mais discreta

- A área **Sua Figurinha** foi movida para a parte inferior da galeria de avatares, ficando mais alinhada com o layout da tela inicial.
- O componente ficou mais **compacto e discreto**, com preview menor e botões reduzidos.
- O botão principal mantém a seleção da figurinha personalizada sem alterar a lógica existente do avatar customizado.
- Em celular, a área continua empilhada e com toque confortável.

# Changelog

## V40.26 — Avatares Premium
- redesenhados **Tela Azul, Caldinho, Anão, Anão Cabeção, Vesgo e Hulk Magrelo**;
- novo padrão visual com acabamento 3D/cartoon, luz, volume e halo, compatível com os avatares originais;
- imagens otimizadas em WEBP para manter boa qualidade sem pesar no carregamento;
- nenhuma regra, turno, ranking ou lógica multiplayer foi alterada.

## V40.25 — Figurinha própria e novos avatares
- incluída opção para o jogador enviar a própria figurinha (JPG, PNG ou WEBP);
- a imagem é centralizada, recortada e convertida automaticamente para WEBP antes de ser usada;
- adicionados os novos avatares: **Tela Azul, Caldinho, Anão, Anão Cabeção, Vesgo e Magrelo Verde**;
- mantidas as regras existentes do jogo, sem alteração de turnos, cartas especiais ou ranking.

## V40.24 — Avatares Fixos + Turno em Destaque
- corrigida a ordem visual dos assentos para que ela não dependa mais de `direction`;
- Dama/inversão, Ás/pulo e demais cartas especiais agora mudam apenas a fila/indicadores, sem reorganizar os avatares;
- adicionado destaque forte e elegante no jogador de `currentPlayerId`;
- adicionado indicador `SUA VEZ` para o jogador local e `VEZ DE [NOME]` para os demais;
- preservado o indicador `PRÓXIMO`, calculado pela fila real do servidor;
- nenhuma alteração em `game-engine.js` ou `server.js`.

## V40.23 — Ação Rápida Flutuante
- a **Ação Rápida (⚡)** agora usa um **botão flutuante**, igual à Queima e à Carta Dupla;
- o botão aparece **somente quando a ação estiver disponível**;
- o jogador pode **arrastar o botão** para onde achar melhor e a posição fica salva no navegador;
- o botão some automaticamente quando a oportunidade de Ação Rápida termina;
- removido o pequeno botão ⚡ de cima da carta, deixando a mão mais limpa no celular.

## V40.22 — Carinha Discreta com Transparência Inteligente
- Reduzi o tamanho do botão flutuante de reações, deixando somente a carinha **😊** menor e mais discreta.
- Adicionei efeito de **semi-transparência automática** após alguns segundos sem uso.
- Ao tocar, arrastar, focar ou abrir o painel de reações, a carinha volta automaticamente para o estado totalmente visível.
- Mantive o comportamento atual: a carinha continua arrastável, com posição salva no navegador do jogador.

## V40.21 — Reações com Apenas a Carinha

- simplificada a barra flutuante de reações para exibir **somente a carinha 😊** na mesa;
- ao tocar na carinha, abre o painel com **todas as reações disponíveis**;
- o próprio botão **😊** agora pode ser arrastado para qualquer posição da tela;
- **duplo toque** na carinha devolve o botão à posição inicial;
- removidos da área visível os atalhos fixos **😂**, **😡** e **🔊**, reduzindo poluição visual na mesa.

## V40.20 — Todas as Reações em um Toque

- adicionado botão **😊** na barra flutuante de reações rápidas;
- ao tocar em **😊**, abre um painel compacto com **todas as reações da mesa**;
- painel inclui **👏 Aplausos, 😂 Risada, 😡 Raiva, 📯 Corneta, 🥁 Tambores, 🎉 Vitória, 😱 Uau e 🔊 Joga Boca Aberta**;
- ao escolher uma reação, o painel fecha automaticamente;
- o painel abre acima ou abaixo da barra conforme o espaço disponível na tela;
- mantém a barra arrastável e a posição salva da V40.19.

## V40.19 — Reações Rápidas Flutuantes

- a barra de reações rápidas **😂 😡 🔊** agora é **flutuante e reposicionável**;
- o jogador pode **arrastar a barra** pela alça lateral e colocá-la onde preferir;
- a posição escolhida fica salva no navegador do próprio jogador;
- **duplo clique na alça** retorna a barra à posição inicial;
- mantém o mesmo comportamento de **um toque** para risada, raiva e **JOGA BOCA ABERTA**.

## V40.18 — Reações Rápidas Visíveis

- adicionados **3 atalhos rápidos sempre visíveis** logo abaixo do topo do jogo: **😂 risada**, **😡 raiva** e **🔊 joga boca aberta**;
- o atalho **🔊** fala em voz alta **"JOGA BOCA ABERTA!"** com um clique;
- incluído o novo efeito **Raiva** também dentro do painel de chat/efeitos;
- o botão de **Joga Boca Aberta** no painel lateral foi simplificado para estilo de **alto-falante**, ficando mais claro no celular.

## V40.17.0 — Interface mais limpa no celular

- Removidos os banners inferiores de **Queima disponível** e **Carta Dupla disponível**.
- Mantidos os botões flutuantes reposicionáveis, o destaque das cartas e o foco automático.
- Nenhuma regra do jogo foi alterada.

## V40.16.0 — Seta do próximo jogador

- Adicionada seta visual **PRÓXIMO** no avatar de quem jogará depois do jogador atual.
- A indicação acompanha automaticamente o avanço dos turnos e a inversão de sentido pela Dama.
- Próximo jogador recebe contorno visual adicional, com ajuste para desktop e celular.
- Respeita `prefers-reduced-motion`.

## V40.15.0 — Ordem visual dos jogadores

- Avatares reposicionados na mesa conforme a ordem real de jogar.
- O próprio jogador permanece ancorado na parte inferior da mesa.
- Inclusão de selo visual em cada avatar: **JOGA AGORA**, **PRÓXIMO** ou posição na fila.
- Distribuição ajustada no desktop e no celular para manter a leitura da sequência com 2 a 5 jogadores.

## V40.14.0 — Queima e Carta Dupla flutuantes

- Adicionados botões flutuantes **🔥 QUEIMA** e **×2 DUPLA**, exibidos apenas quando a ação correspondente está disponível.
- Ambos podem ser arrastados livremente; a posição é salva no navegador e restaurada nas próximas partidas.
- As cartas válidas continuam com destaque visual e foco automático, mas os botões deixam de ocupar espaço sobre as cartas.
- Quando existem várias opções de Carta Dupla, um seletor compacto permite escolher a dupla desejada.
- Duplo clique em cada botão restaura sua posição padrão.
- Mantidas integralmente as regras atuais de Queima, Queima da abertura, Carta Dupla e Mau-Mau.


## V40.13.0 — Carta Dupla otimizada para celular

- O botão **×2 JOGAR DUPLA** passa a existir em somente uma das duas cartas idênticas de cada par.
- A segunda carta permanece identificada visualmente como integrante da dupla, sem botão repetido.
- O botão foi deslocado para a parte superior da carta e ampliado no mobile para facilitar o toque.
- A carta dona do botão ganha prioridade de `z-index` em mãos sobrepostas.
- Quando a mesma carta também oferece Queima, o ×2 fica acima e o botão **QUEIMAR** abaixo.
- Nenhuma regra do motor da Carta Dupla foi alterada.


## V40.12.0 — Liberdade de anúncio na batida

- Corrige a regra das duas últimas cartas: o jogador pode escolher **Mau-Mau** simples ou **Mau-Mau batendo/queimando**.
- Ambos os anúncios permitem finalizar por **Queima + continuação** ou **Carta Dupla**.
- Sem anúncio, a batida composta continua proibida.
- Mantida a possibilidade de anunciar Mau-Mau simples, queimar uma carta e passar, ficando com uma carta.


## V40.11.0 — Carta Dupla visual melhorada

- Destaque dourado reforçado para cartas com Carta Dupla disponível.
- Botão pequeno `×2` substituído por **×2 JOGAR DUPLA**, maior e mais fácil de tocar.
- Aviso na mão quando existir Carta Dupla disponível.
- Foco automático na primeira dupla disponível em mãos grandes, sem tirar a prioridade da Queima quando ambas aparecem.
- Queima e Carta Dupla simultâneas ficam com botões separados na mesma carta.
- Nenhuma regra da Carta Dupla foi alterada.


## V40.10.0 — Queima mais visível

- Substitui o pequeno botão 🔥 por uma faixa/botão **🔥 QUEIMAR** maior sobre a carta queimável.
- Reforça a borda e o brilho laranja das cartas com Queima disponível.
- Adiciona aviso **QUEIMA DISPONÍVEL** junto à mão.
- Centraliza automaticamente a primeira carta queimável quando a oportunidade aparece, especialmente útil em mãos grandes.
- Na exceção da abertura, tocar diretamente na carta destacada também pode executar a Queima quando não há outra ação concorrente.
- Mantém inalteradas as regras de Queima, Ação Rápida, Carta Dupla e cartas especiais.

## V40.9.0 — Microfone flutuante

- O botão **🎙️ LIGAR MICROFONE** agora é flutuante e pode ser arrastado livremente pelo jogador.
- Funciona com mouse e toque usando Pointer Events.
- A posição é salva no navegador (`localStorage`) e restaurada ao voltar ao jogo.
- O botão é limitado à área visível da tela para não ficar perdido fora do viewport.
- Ao redimensionar ou girar a tela, a posição é automaticamente ajustada para continuar visível.
- Arrastar não liga/desliga o microfone por engano; clique/toque curto continua controlando o microfone.
- Duplo clique retorna o botão à posição inicial.
- A alteração é somente visual/local e não modifica WebRTC, regras, cartas ou posições dos jogadores.

## V40.8.0 — Novo Ranking + Temporada 1

- Reset único do ranking antigo no primeiro deploy da V40.8, preservando as identidades Google dos jogadores.
- Início da **Temporada 1** com resultados zerados.
- Ranking simplificado para contar **somente vitórias**.
- Modalidades separadas em **👥 OFICIAL** (somente humanos) e **🤖 TREINO** (partidas com máquina).
- Novos filtros: **Hoje, Semana, Mês, Temporada e Histórico**.
- Histórico começa vazio enquanto a primeira temporada estiver em andamento.
- `playerKey` derivado da Conta Google é a chave única do jogador; mudança de nome/avatar apenas atualiza a apresentação.
- Empates em número de vitórias recebem a mesma posição.
- `matchId` passa a incluir `matchSerial`, evitando perda de registro de revanches na mesma sala.

## V40.7.0 — Instrumental na tela inicial

- Adicionada a faixa `tela_inicial_instrumental.mp3`, derivada do áudio enviado pelo usuário.
- A voz foi reduzida por processamento de cancelamento vocal, priorizando a base instrumental.
- A nova faixa toca **somente na tela inicial** (`state == null`).
- O lobby de uma sala continua usando `Mesa Aberta`.
- Durante a partida continuam disponíveis o modo Dinâmico e o **Rock Candeias**.

## V40.6.0 — Rock Candeias

- Adicionada a faixa original **🎸 Rock Candeias** ao painel de música.
- Novo seletor de estilo: **Dinâmica** ou **Rock Candeias**.
- A preferência musical fica salva no navegador.
- No modo Rock, a faixa toca durante a partida normal; a trilha de última carta, conferência e stingers de vitória permanece dinâmica.
- Arquivo `rock_candeias.mp3` sintetizado do zero, sem samples ou gravações de terceiros.


## V40.5.0 — Microfone ao vivo na mesa

- Adicionado botão **🎙️ LIGAR MICROFONE** na área superior da mesa, no ponto indicado pelo usuário.
- Voz em tempo real entre jogadores humanos usando WebRTC; Socket.IO é usado apenas para sinalização.
- Áudio não é gravado, não passa pelo PostgreSQL e não entra no ranking.
- Botão alterna para **MICROFONE LIGADO** e exibe indicador verde enquanto transmite.
- Jogadores com microfone ativo recebem um pequeno ícone 🎙️ junto ao nome.
- Cancelamento automático do microfone ao sair da sala ou perder a conexão, preservando privacidade.
- Mantido o Áudio Rápido de 15 s; quando o microfone ao vivo está ativo, a gravação rápida reutiliza uma cópia da faixa de áudio quando possível.
- STUN público configurado para negociação P2P; redes muito restritivas podem exigir TURN em uma etapa futura.

## V40.4.0 — Jogar de Novo
- Ao terminar uma partida entre jogadores humanos, aparece **🔁 JOGAR DE NOVO**.
- Cada jogador confirma individualmente que deseja continuar.
- Quando todos os humanos conectados confirmam e há pelo menos 2 jogadores, uma nova partida de 5 rodadas começa automaticamente na mesma sala.
- O placar e o histórico de rodadas são zerados para a nova partida, sem exigir novos convites.
- A partida anterior continua sendo registrada separadamente no ranking, mesmo se a nova partida começar antes da gravação assíncrona terminar.

Este arquivo mantém somente os marcos relevantes do projeto. Os antigos arquivos separados `ATUALIZACAO_V*.txt` foram consolidados para evitar documentação repetida na raiz do repositório.

## 40.3.0 — Queima da primeira carta
- Corrige a abertura da rodada: a primeira carta normal virada pode ser queimada por qualquer jogador que tenha uma cópia exatamente igual, mesmo fora da vez.
- A primeira Queima válida assume a jogada e usa a continuação normal da Queima.
- A janela especial termina assim que ocorre a primeira ação normal da rodada.
- Bots e jogadores humanos seguem a mesma regra da abertura.

## 40.2.0 — Buscar Jogadores
- Matchmaking automático de 2 a 5 jogadores.
- Com 1 jogador a fila aguarda; ao entrar o 2º começa uma janela de 15 s.
- Com 5 jogadores a partida começa imediatamente.
- Cancelamento e remoção da fila validados no servidor.
- Aceitar convite remove o jogador da fila antes da troca de sala.

## 40.1.0 — Jogadores Online + Convites
- Presença online unificada pela identidade Google.
- Lista com avatar, nome e status.
- Convites de 30 s com aceitar/recusar.
- Reserva temporária de vaga sem interromper partida multiplayer em andamento.
- Integração com Reconexão Inteligente.

## 39.2.0 — SUA VEZ melhorado
- Aviso grande, destaque visual e iluminação das cartas válidas.
- Campainha curta e vibração opcional.
- Preferência de vibração salva no navegador.

## 39.1.0 — Reconexão Inteligente
- 60 s de tolerância para reconexão.
- Depois do prazo, AUTO temporário joga a mesma mão/posição do usuário.
- Ao retornar, o jogador humano retoma a vaga.
- A identidade do ranking permanece humana.

## 38.x — Consolidação da experiência online
- Login Google obrigatório e sessão HttpOnly.
- Conferência visual da pontuação ao fim da rodada.
- Música dinâmica original.
- Áudio Rápido de até 15 s.
- Regras e textos da interface consolidados.

## 37.x — Consolidação das regras e mobile
- Regras atuais de Queima, Ação Rápida e Carta Dupla consolidadas.
- Melhorias de leitura e layout em celulares.

## Marcos anteriores
- Ranking persistente em PostgreSQL.
- Chat e efeitos compartilhados.
- Mau-Mau falado e alertas de uma carta.
- Bots, avatares e melhorias sucessivas do motor de jogo.

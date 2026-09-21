## V40.68.1 — Expiração quando todos os humanos estão offline

A V40.68.1 amplia a proteção de 5 minutos que antes existia apenas para sala solo. Agora, **qualquer partida ativa** em que não exista nenhum jogador humano conectado fica reservada por no máximo **5 minutos**, independentemente de possuir 1, 2, 3, 4 ou 5 cadeiras humanas.

- Se pelo menos **1 humano permanecer conectado**, a partida continua normalmente e os robôs/AUTO podem jogar.
- Se **todos os humanos desconectarem**, os robôs e AUTO ficam completamente parados e começa o prazo de 5 minutos.
- Se qualquer humano retornar dentro do prazo, o contador é cancelado e a partida continua do ponto em que estava.
- Se ninguém retornar em 5 minutos, a sala, timers, reservas, observadores, convites e snapshot são removidos.
- O relógio começa quando o **último humano conectado** cai e é persistido no snapshot; um restart do Render não concede novos 5 minutos.
- A janela de 60 segundos antes do AUTO continua existindo por cadeira, mas AUTO não joga se não houver nenhum humano conectado.
- O TTL técnico de 8 horas dos snapshots continua existindo como limite máximo de armazenamento, porém uma sala totalmente offline é encerrada antes, aos 5 minutos.

**Validação local:** 92 testes sem dependência externa aprovados; a suíte completa passa a ter 93 testes, incluindo o teste Socket.IO real executado no GitHub/Render.

---

## V40.68 — Limpeza e Limite de Salas

A V40.68 reforça a estabilidade do servidor sem alterar as regras do Mau-Mau. O servidor passa a limitar a criação a **50 salas simultâneas** por padrão (`MAX_ROOMS=50`), sem encerrar partidas que já estejam em andamento. Quando o limite é atingido, somente novas salas ficam temporariamente bloqueadas.

A exclusão de sala agora centraliza a limpeza de timers de reconexão/AUTO, sala solo, debounce de desconexão, observadores, convites, referências de voz, chat/logs e snapshot. Uma auditoria periódica remove salas inconsistentes sem nenhum jogador humano. O `/health` também informa capacidade e métricas agregadas das salas, sem expor cartas, nomes ou tokens.

## V40.67 — Tempo de Vida da Reconexão

A V40.67 formaliza os três relógios de recuperação do jogo em uma política única (`retention-policy.js`), sem alterar as regras das cartas ou a interface.

- **60 segundos:** janela antes do AUTO temporário assumir uma cadeira humana desconectada.
- **5 minutos:** prazo máximo da sala solo (1 humano + robôs) quando o único humano desaparece involuntariamente.
- **8 horas:** retenção oficial do snapshot de partidas multiplayer para permitir recuperação após reinícios do servidor.
- **SAIR / entrar em outra sala / abandono definitivo:** continuam tendo prioridade e encerram a reserva imediatamente; os 8 h não ressuscitam vínculos abandonados.
- No Render/produção, o TTL oficial fica fixado em 8 h para evitar mudança acidental por variável antiga; testes/desenvolvimento ainda podem usar TTL reduzido explicitamente.
- Nenhuma dependência npm foi alterada; o `package-lock.json` existente continua válido.

---

## V40.66 — Health Check e Banco

A V40.66 separa **liveness** de **readiness**. `/health` informa apenas se o processo Node está vivo; `/ready` só retorna 200 quando ranking e snapshots foram inicializados e respondem ativamente. No Render/produção, o serviço só fica pronto com PostgreSQL — o fallback JSON continua disponível apenas para desenvolvimento local.

- Render passa a verificar `/ready`.
- Ranking e snapshots executam `SELECT 1` no PostgreSQL durante o probe.
- Falha/timeout do banco retorna 503 sem expor credenciais.
- `DATABASE_URL` ausente no Render impede estado ready e gera log crítico.
- Nenhuma regra do jogo ou dependência npm foi alterada.

## V40.65 — Deploy reproduzível

A V40.65 não altera nenhuma regra do jogo. Ela torna a instalação de dependências determinística usando `package-lock.json` + `npm ci`. Como o ambiente de montagem não possui acesso ao registry npm, o lockfile é gerado de forma segura no próprio GitHub usando Node 22.22.0, validado com `npm ci` e com a suíte completa antes de ser commitado automaticamente.

- Render prefere `npm ci` assim que o lockfile existe;
- GitHub Verify usa o mesmo caminho;
- o primeiro push possui fallback temporário para `npm install`, apenas enquanto o lock ainda está sendo criado;
- `scripts/check-lockfile.js` confere versão do lock, versão do projeto e dependências diretas;
- um artefato `package-lock-v40.65` é guardado como fallback caso o repositório bloqueie o push automático do bot.

---

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

> **Atualização V40.68.1:** a regra de 5 minutos foi ampliada. Agora ela vale para qualquer partida ativa em que todos os humanos estejam desconectados, e não apenas para 1 humano + robôs.

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

A V40.58.1 corrige o pacote da V40.58 sem alterar a lógica do jogo. Foram restaurados `.node-version`, `.npmrc` e `.github/workflows/verify.yml`, e o `.env.example` voltou a documentar snapshots, TURN temporário e as opções de segurança/monitoramento da V40.58. A identificação/cache-busting foi atualizada para 40.58.1.

As regras do Mau-Mau, Reconexão Inteligente Permanente, Modo Observador, ranking, áudio/WebRTC/TURN e a segurança da V40.58 permanecem inalterados.

---

## V40.58 — Segurança e Monitoramento

A V40.58 reforça o servidor sem alterar as regras do jogo: remove o CORS global do Socket.IO, valida a origem do handshake no servidor, adiciona cabeçalhos HTTP de segurança, cria correlação por `X-Request-Id` e amplia os endpoints `/health` e `/ready`. Os logs opcionais trabalham com uma lista restrita de campos e não registram cartas, mãos, cookies, corpo das requisições, tokens ou credenciais.

Para o uso normal no próprio domínio do Render, nenhuma origem extra precisa ser configurada. A variável `MAUMAU_ALLOWED_ORIGINS` deve ser usada somente se um frontend legítimo em outro domínio precisar acessar o servidor.

A Reconexão Inteligente Permanente da V40.57.1, o Modo Observador, o áudio/WebRTC, o ranking e todas as regras continuam preservados. A regra da Dama em partidas com 2 jogadores permanece intacta.

---

## V40.57.1 — Correções da Auditoria

A V40.57.1 preserva integralmente a Reconexão Inteligente Permanente e corrige três pontos encontrados na auditoria: restaura os arquivos do deploy seguro, encerra completamente o socket antigo quando uma nova sessão assume a vaga e impede que uma partida ativa seja removida apenas por ultrapassar 6 horas. Chat, efeitos e Áudio Rápido também passam a exigir o socket proprietário atual da cadeira.

## V40.57 — Reconexão Inteligente Permanente

A V40.57 fecha a principal lacuna da reconexão longa. A cadeira humana continua reservada durante toda a partida mesmo depois que a Máquina assume temporariamente. O mesmo navegador continua priorizando o token persistente salvo em `localStorage`; se o código/token local não estiver disponível, o servidor pode localizar automaticamente a vaga pela `playerKey` da Conta Google autenticada em cookie HttpOnly. Nome e avatar nunca são usados como prova de identidade. Em outro aparelho, o retorno automático só acontece depois de autenticar a mesma Conta Google e somente se a vaga estiver desconectada/AUTO.

A transferência de controle é segura: o timer automático pendente é cancelado antes da retomada; se uma jogada da Máquina já tiver começado no event loop, ela termina primeiro e o jogador recebe a mão atual resultante. Timers antigos também verificam `autoControlled` antes de agir, impedindo bot e humano de jogarem simultaneamente. Nenhuma regra de turnos, cartas, direção ou posição visual foi alterada.

## V40.56 — Deploy Seguro e Reproduzível

A V40.56 fortalece o processo de publicação sem alterar regras, áudio, rede ou interface do Mau-Mau. O projeto passa a fixar Node.js 22.22.0 em `package.json` e `.node-version`; o Render executa `npm run verify` durante o build e só publica se toda a suíte passar; e o GitHub Actions executa a mesma verificação em pushes e pull requests. O `.npmrc` também força versões exatas para novas dependências adicionadas futuramente.

Observação: como o ambiente de geração desta versão não possui acesso ao npm Registry, não foi incluído um `package-lock.json` não validado. O projeto continua usando versões diretas exatas e a verificação automática bloqueia deploys quebrados. Quando o lockfile puder ser gerado e validado com acesso ao Registry, o build poderá migrar de `npm install` para `npm ci`.

## V40.55 — Estabilidade Final

A V40.55 consolida a camada de rede e persistência sem alterar as regras do Mau-Mau. O Socket.IO passa a usar recuperação nativa de estado por até 60 segundos em microquedas, mantendo a Reconexão Inteligente de 60 s como segunda camada. O Áudio Rápido continua com 15 segundos/48 kbps, mas o limite máximo cai de 700 KB para 250 KB e o limite global de pacote do Socket.IO é reduzido para 400 KB. Nos snapshots, figurinhas Base64 são substituídas por referências de hash no JSON da partida e persistidas em tabela separada, sendo regravadas somente quando o conjunto de avatares muda.

O TURN continua totalmente opcional; a V40.55 funciona com WebRTC P2P e fallback Socket.IO sem serviço pago.

## V40.54.1 — Correção de configuração do Render

A V40.54.1 é uma atualização de manutenção. Ela não altera o comportamento do jogo. O `.env.example` passa a documentar todas as variáveis usadas pelas melhorias de TURN temporário da V40.51 e retenção dos snapshots da V40.53. O objetivo é evitar que uma atualização do repositório deixe o Render sem referência para `VOICE_TURN_SECRET`, `VOICE_TURN_TTL_SECONDS` e `ROOM_SNAPSHOT_TTL_MS`.

Para TURN, use **uma** das formas: credenciais estáticas (`VOICE_TURN_USERNAME` + `VOICE_TURN_CREDENTIAL`) ou credenciais temporárias/coturn (`VOICE_TURN_SECRET`). Quando `VOICE_TURN_SECRET` estiver configurado, ele tem prioridade.

## V40.54 — Convite por link + jogadores recentes

A V40.54 adiciona duas funções sociais leves sem alterar o motor do jogo. O botão 🔗 da sala usa a folha de compartilhamento nativa em celulares compatíveis e mantém cópia para a área de transferência como fallback. Quem abre um link com `?room=CODIGO` vê um cartão claro de convite e pode entrar diretamente; se a partida já tiver começado, continua valendo o fluxo existente que oferece o Modo Observador.

A janela **Jogadores Online** passa a ter a aba **Recentes**, alimentada pelo histórico de partidas concluídas já usado pelo ranking. Ela mostra com quem o usuário jogou por último, quantas partidas foram disputadas juntos e, se a pessoa estiver online, permite enviar o convite normal de 30 segundos. Não é criada uma nova rede social nem são armazenadas conversas.

## V40.52 — Estado e avatares leves

A V40.52 reduz o tráfego repetitivo da partida sem mudar a aparência. Figurinhas personalizadas continuam armazenadas no estado interno da sala, mas os eventos `state` enviados a jogadores e observadores carregam apenas uma referência curta baseada no conteúdo. A imagem correspondente é enviada separadamente uma vez por socket e mantida em cache de sessão no navegador. Se o cache estiver vazio após uma reconexão, o cliente solicita somente as referências ausentes.

O painel de diagnóstico agora também mostra o tamanho do último estado recebido, a quantidade de imagens em cache e o volume acumulado de dados de avatar. As regras do jogo, a voz WebRTC/TURN da V40.51, o fallback de áudio e a reconexão não foram alterados.

## V40.51 — WebRTC/TURN robusto para jogadores e observadores

A V40.51 muda a arquitetura da voz sem alterar nenhuma regra do Mau-Mau. Jogadores e observadores passam a tentar **WebRTC/Opus primeiro**. Quando uma rota direta não funciona, o navegador pode usar **TURN** automaticamente se o servidor estiver configurado; se mesmo assim um peer não conectar, entra apenas para esse destinatário o relay leve μ-law/Socket.IO da V40.49/V40.50. O fallback é seletivo e `volatile`, evitando colocar voz atrasada na fila da partida.

Para proteger a internet móvel em salas públicas, cada microfone mantém no máximo 6 peers WebRTC de saída; participantes excedentes usam o fallback leve. O painel de diagnóstico agora informa se o TURN está configurado e se a rota WebRTC observada é P2P, TURN ou mista. TURN estático continua suportado, e servidores coturn compatíveis podem usar `VOICE_TURN_SECRET` para credenciais temporárias.

## V40.50 — Diagnóstico de conexão + AudioWorklet

A V40.50 melhora o relay de voz do observador sem alterar as regras do jogo. Quando suportado pelo navegador, a captura/compactação μ-law roda em `AudioWorklet`, fora da thread principal; há fallback para navegadores antigos. O indicador de conexão da mesa agora abre um painel de diagnóstico com RTT até o servidor, jitter das sondas, falhas recentes, transporte Socket.IO, reconexões e estatísticas WebRTC disponíveis.

## V40.49 — Estabilidade de rede e voz

A V40.49 reduz o tráfego do microfone do observador e reforça a reconexão móvel sem alterar as regras do jogo.

# Mau-Mau Candeias — V40.48

## V40.48 — Minha Música

- Adiciona o botão **🎵 Minha Música** na tela inicial e na mesa.
- O jogador escolhe um arquivo de áudio do próprio celular/computador; o arquivo toca apenas naquele aparelho.
- A música local usa `URL.createObjectURL()` e não é enviada ao servidor, Socket.IO, PostgreSQL, ranking ou outros jogadores.
- O arquivo não é persistido: ao fechar/atualizar a aba, deve ser escolhido novamente.
- Música local pausa quando há microfone/voz ativa e retoma depois se estava tocando.
- Continua sem existir pasta de trilhas internas no projeto; efeitos e voz permanecem preservados.
- Regras da V40.43, segurança V40.44, performance V40.46 e áudio simplificado V40.47 continuam intactos.

# Mau-Mau Candeias — V40.47

## V40.47 — áudio simplificado e projeto mais leve

- A música de fundo interna foi removida do projeto.
- Cada jogador pode usar a música que quiser no próprio celular ou computador.
- Efeitos sonoros, avisos falados, Áudio Rápido e microfone ao vivo continuam funcionando.
- A pasta `public/assets/music/` não existe mais.
- Otimizações de avatares, figurinha e cache da V40.46 foram preservadas.
- Todas as regras e proteções das V40.43/V40.44 foram preservadas.

# Histórico técnico

## V40.44 — manutenção técnica sem alteração de regras

- Ranking persiste apenas um identificador curto para figurinha personalizada, evitando Base64 no PostgreSQL.
- Ações de jogo só são aceitas pelo `socket.id` atualmente vinculado à cadeira.
- Uma Conta Google não pode ocupar vagas ativas em duas salas simultaneamente.
- `.env.example` usa corretamente `AUTH_SESSION_SECRET`.
- As regras da V40.43 foram preservadas integralmente, inclusive a Dama (Q) especial com 2 jogadores.


## Integridade de turnos com regra da Dama de 2 jogadores preservada

Esta versão substitui a V40.42 anterior e mantém a regra já validada do Mau-Mau Candeias:

- toda rodada inicia em **sentido anti-horário**;
- carta normal avança **uma posição**;
- **Ás (A)** pula exatamente o próximo jogador;
- **Dama (Q), com 2 jogadores ativos:** inverte o sentido e **quem jogou a Dama joga novamente**, exatamente como na V40.41;
- **Dama (Q), com 3, 4 ou 5 jogadores:** inverte o sentido e a vez segue para o jogador adjacente no novo sentido;
- falhas de bot/AUTO não podem avançar `currentPlayer` diretamente;
- `MAUMAU_TURN_DEBUG=1` habilita logs detalhados de transição no console do servidor.

A Queima da primeira carta permanece como exceção já existente: uma Queima válida na abertura pode transferir a jogada ao jogador que queimou. A Ação Rápida continua sem roubar a vez.

---

# Mau-Mau Candeias — V40.35

## Microfone ao vivo para jogadores e observadores

Nesta versão, quem entra no **Modo Observador** também pode conversar pelo microfone ao vivo. O observador continua fora da partida: não ocupa vaga, não recebe cartas privadas e não pode executar ações de jogo.

A voz continua usando WebRTC P2P, com as melhorias de estabilidade da V40.33: fila ICE, recuperação automática, preferência por Opus e suporte opcional a TURN.

---


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

# Mau-Mau Candeias — V40.33

## V40.32 — Partidas ao Vivo

A tela inicial agora possui uma Central de Partidas ao Vivo para observadores. Salas públicas iniciadas podem ser encontradas e assistidas sem código prévio, mantendo cartas privadas protegidas no servidor.



Jogo Mau-Mau Candeias multiplayer para navegador, com salas de 2 a 5 jogadores, Login Google obrigatório, Socket.IO, ranking PostgreSQL, presença online e reações rápidas com apenas a carinha visível.



## V40.24 — Assentos fixos e indicação clara de turno

- Os avatares agora permanecem **fixos no mesmo assento visual**, mesmo quando uma Dama inverte o sentido da partida.
- A fila de turno continua sendo calculada pelo estado real do servidor (`currentPlayerId` + `direction`).
- O jogador atual recebe brilho/pulso discreto e um indicador **SUA VEZ** ou **VEZ DE [NOME]**.
- O indicador **PRÓXIMO** continua acompanhando a fila real.
- Reconexão não troca o assento: o servidor preserva o mesmo jogador/ID e a interface mantém a posição visual.
- Nenhuma regra do motor foi alterada.

## V40.23 — Ação Rápida flutuante

O raio da **Ação Rápida (⚡)** saiu de cima da carta e ganhou um **botão flutuante próprio**, igual ao da **Queima** e da **Carta Dupla**. Ele aparece **somente quando a Ação Rápida estiver realmente disponível**, pode ser **arrastado para qualquer lugar** da tela e a posição fica salva no navegador do jogador. Ao clicar no botão, o jogo executa automaticamente a **Ação Rápida válida** da sua mão.

## V40.22 — Carinha 😊 discreta e inteligente

A barra flutuante de reações ficou mais limpa: agora **somente a carinha 😊 aparece na mesa**. Ao tocar nela, abre um painel com **todas as reações disponíveis**. O próprio botão 😊 também pode ser arrastado para qualquer posição da tela e um duplo toque devolve à posição inicial.

## V40.20 — Todas as reações pelo botão 😊

A barra flutuante possui um botão **😊**. Ao tocar nele, aparece um painel compacto com todos os efeitos sociais disponíveis na mesa: **👏, 😂, 😡, 📯, 🥁, 🎉, 😱 e 🔊**. A seleção continua sendo feita com um único toque e o painel se fecha depois do envio.

## V40.19 — Reações rápidas flutuantes

A barra de reações rápidas com **😂**, **😡** e **🔊 JOGA BOCA ABERTA** agora funciona como um pequeno controle flutuante. O jogador arrasta a barra pela alça lateral e deixa o painel onde achar melhor, especialmente útil no celular e em mesas com 4 ou 5 participantes. A posição é salva no navegador do próprio jogador e um duplo clique na alça devolve a barra à posição inicial.

## V40.9 — Microfone flutuante

O botão de microfone ao vivo agora pode ser arrastado com mouse ou toque para qualquer posição visível da tela. A posição escolhida fica salva apenas no navegador do próprio jogador, evitando cobrir a quantidade de cartas ou outros elementos quando houver 4 ou 5 participantes. Um duplo clique retorna o botão à posição inicial.


### Ajuste visual desta versão
- A carinha de reações ficou **menor** para ocupar menos espaço na mesa.
- Depois de alguns segundos sem interação, ela fica **semi-transparente** automaticamente.
- Ao tocar, arrastar, focar ou abrir o painel, ela volta a ficar **totalmente visível**.
- A posição continua salva no navegador do jogador.

## V40.26 — Avatares Premium

Os seis avatares adicionados na V40.25 foram redesenhados para ficar no mesmo padrão visual dos avatares principais do jogo: **Tela Azul, Caldinho, Anão, Anão Cabeção, Vesgo e Hulk Magrelo**. As novas artes usam acabamento 3D/cartoon, iluminação e halo colorido, mantendo boa leitura em telas pequenas. Nenhuma regra do jogo foi alterada.

## V40.25 — Figurinha própria + novos avatares

- o jogador agora pode escolher a própria **figurinha** (JPG, PNG ou WEBP) direto do celular ou computador;
- a imagem é recortada automaticamente em formato quadrado, redimensionada e comprimida antes de ser salva;
- a figurinha fica vinculada ao perfil local do jogador e é enviada para a mesa quando ele entra na sala;
- incluídos novos avatares fixos: **Tela Azul, Caldinho, Anão, Anão Cabeção, Vesgo e Magrelo Verde**;
- nenhuma regra do jogo foi alterada.

## Recursos atuais

- **Login Google obrigatório** com sessão própria em cookie HttpOnly.
- **Salas multiplayer** de 2 a 5 jogadores e modo contra máquinas.
- **Jogadores Online + Convites** com presença identificada pela Conta Google.
- **Buscar Jogadores**: matchmaking automático de 2 a 5 pessoas; a janela de 15 s começa quando o segundo jogador entra e a partida inicia imediatamente ao chegar a 5.
- **Reconexão Inteligente**: 60 s para retornar; depois a Máquina assume temporariamente a mesma vaga e o jogador retoma o controle quando volta.
- **SUA VEZ melhorado** com animação, iluminação, som e vibração opcional.
- **Áudio Rápido** de até 15 segundos, temporário na sala e sem gravação no PostgreSQL.
- **Microfone ao vivo (V40.5)** diretamente na mesa: conversa de voz em tempo real por WebRTC entre jogadores humanos, sem gravação no PostgreSQL.
- **Música original** com modo Dinâmico e a opção **🎸 Rock Candeias**, volume independente e ducking durante falas/áudios.
- **Chat e efeitos compartilhados**.
- **Reações rápidas (V40.22)**: somente a carinha **😊** fica visível na mesa, agora menor, mais discreta, arrastável e com efeito semi-transparente após alguns segundos sem uso. Ao tocar, abre o painel com todas as reações e volta a ficar 100% visível.
- **Ação Rápida flutuante (V40.23)**: botão **⚡** arrastável, fora da mão do jogador, visível apenas quando houver reação válida; mantém o destaque nas cartas rápidas.
- **Conferência da Rodada** com cartas restantes e cálculo da pontuação.
- **Novo Ranking V40.8**: somente vitórias, separado em **👥 OFICIAL** e **🤖 TREINO**, com filtros **Hoje, Semana, Mês, Temporada e Histórico** e identidade única pela Conta Google.
- Interface adaptada para computador e celular.

As regras consolidadas do jogo estão em [`docs/REGRAS.md`](docs/REGRAS.md).

## Stack

- Node.js 18+
- Express
- Socket.IO
- PostgreSQL (`pg`)
- Google Identity Services + `google-auth-library`
- HTML, CSS e JavaScript no front-end

## Estrutura do projeto

```text
.
├── bot-player.js
├── game-engine.js
├── ranking-store.js
├── server.js
├── package.json
├── render.yaml
├── public/
│   ├── app.js
│   ├── index.html
│   ├── styles.css
│   └── assets/
│       └── avatars/
├── tests/
│   ├── run-all.js
│   └── *.test.js
└── docs/
    ├── DEPLOY_RENDER.md
    └── REGRAS.md
```

## Executar localmente

1. Instale Node.js 18 ou superior.
2. Na pasta do projeto, execute:

```bash
npm install
```

3. Copie `.env.example` para `.env` apenas como referência. Este projeto não carrega `.env` automaticamente; defina as variáveis no terminal/sistema operacional ou na plataforma de hospedagem.
4. Configure pelo menos `GOOGLE_CLIENT_ID` e `AUTH_SESSION_SECRET`.
5. Inicie:

```bash
npm start
```

Por padrão, o servidor usa a porta definida em `PORT` ou 3000.

### Ranking local

Sem `DATABASE_URL`, o ranking usa `data/ranking.json` como fallback local. A pasta `data/` está no `.gitignore` para não publicar dados de partidas no GitHub.

## Testes

Execute toda a suíte:

```bash
npm test
```

O runner executa automaticamente todos os arquivos `tests/*.test.js`. Isso evita manter uma lista manual de testes no `package.json` e reduz o risco de um teste novo ficar fora da suíte.

Para validar também a sintaxe dos arquivos principais:

```bash
npm run verify
```

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID OAuth Web usado para validar o Login Google. |
| `AUTH_SESSION_SECRET` | Assina a sessão própria do jogo. Use valor longo, aleatório e estável. |
| `DATABASE_URL` | Conexão PostgreSQL usada pelo ranking. Recomendada em produção. |
| `PORT` | Porta HTTP. Plataformas como Render normalmente a fornecem. |
| `PGSSLMODE` | Opcional; `disable` desativa SSL do PostgreSQL quando explicitamente necessário. |
| `RANKING_FILE` | Opcional; caminho alternativo para o fallback JSON local. |

**Nunca coloque valores reais de `DATABASE_URL`, `AUTH_SESSION_SECRET` ou outros segredos no GitHub.**

## Deploy no Render

O projeto já inclui `render.yaml`. As instruções consolidadas de Login Google, PostgreSQL e deploy estão em [`docs/DEPLOY_RENDER.md`](docs/DEPLOY_RENDER.md).

## Áudio

A V40.47 não inclui música de fundo interna. O jogador pode usar o player do próprio celular (Spotify, YouTube Music, Deezer etc.). O jogo mantém apenas efeitos sonoros, fala, Áudio Rápido e microfone ao vivo. Dependendo do sistema operacional, ativar o microfone pode reduzir ou pausar o áudio de outro aplicativo; esse comportamento é controlado pelo aparelho.

## Histórico

O histórico resumido das principais versões está em [`CHANGELOG.md`](CHANGELOG.md).


## Ajuste da abertura
A primeira carta normal virada da rodada pode ser queimada por qualquer jogador que tenha uma cópia exatamente igual, mesmo fora da vez.

## Jogar de novo
Ao concluir uma partida entre pessoas, os jogadores podem confirmar **JOGAR DE NOVO** e iniciar outra partida na mesma sala, com placar zerado.




## V40.8 — Novo ranking por vitórias + Temporada 1

- O ranking anterior é descartado **uma única vez** na primeira inicialização desta versão.
- Começa a **Temporada 1** com todos os resultados zerados.
- A classificação conta **somente vitórias**.
- **👥 OFICIAL**: somente partidas entre jogadores humanos.
- **🤖 TREINO**: partidas que contenham máquina.
- Filtros: **Hoje, Semana, Mês, Temporada e Histórico**.
- O **Histórico começa vazio** e será preenchido quando temporadas forem encerradas futuramente.
- A identidade do ranking é o `playerKey` derivado da **Conta Google**. Trocar nome ou avatar não cria outro jogador e não separa vitórias.
- Empates em vitórias ocupam a mesma posição.
- Cada revanche do botão **JOGAR DE NOVO** usa `matchSerial` no `matchId`, garantindo que cada partida seja registrada separadamente.

## V40.7 — Música instrumental na tela inicial

- A tela inicial passa a tocar **uma versão instrumental do áudio fornecido pelo usuário**.
- A faixa é usada somente na tela inicial; ao entrar em uma sala, o jogo volta ao sistema musical normal.
- Durante a partida permanecem disponíveis **Dinâmica** e **🎸 Rock Candeias**.
- O volume continua sendo controlado pelo mesmo botão 🎵.
- A voz foi reduzida por processamento de separação/cancelamento vocal; dependendo da mixagem original, podem permanecer pequenos resíduos de voz.

## V40.6 — Rock Candeias

- Adiciona a faixa original **🎸 Rock Candeias** ao painel de música.
- O jogador pode escolher entre **Dinâmica** e **Rock Candeias**; a preferência fica salva no navegador.
- No modo Rock, a faixa toca durante a partida normal; momentos de última carta, conferência e stingers de vitória continuam usando a trilha dinâmica.
- A faixa foi sintetizada do zero para o projeto, sem samples, gravações ou músicas de terceiros.

## V40.5 — Microfone ao vivo
Botão 🎙️ na mesa para conversa de voz em tempo real entre os jogadores da sala. O áudio não é armazenado.


## V40.10 — Queima mais visível

- Cartas que podem realizar Queima recebem destaque laranja reforçado e pulsante.
- O pequeno botão de chama foi substituído por um botão maior **🔥 QUEIMAR** sobre a própria carta.
- Um aviso **QUEIMA DISPONÍVEL** aparece junto à mão enquanto a oportunidade estiver aberta.
- Ao surgir uma Queima em uma mão grande, a interface centraliza automaticamente a primeira carta queimável.
- Na Queima da abertura, quando a Queima é a única ação disponível naquela carta, tocar na própria carta também executa a Queima.
- A regra do jogo não foi alterada; a mudança é apenas de usabilidade e visibilidade.


## V40.11 — Carta Dupla visual melhorada

- Cartas com **Carta Dupla** disponível recebem destaque dourado reforçado.
- O antigo botão pequeno `×2` foi substituído por **×2 JOGAR DUPLA**, com área de toque maior.
- A mão mostra o aviso **CARTA DUPLA DISPONÍVEL** enquanto a ação puder ser utilizada.
- Em mãos grandes, a primeira dupla disponível é centralizada automaticamente quando não há uma Queima com prioridade de foco.
- Quando uma carta oferece Queima e Carta Dupla ao mesmo tempo, os dois botões ficam separados visualmente.
- A regra da Carta Dupla não foi alterada: continua somente na própria vez e apenas com cartas normais idênticas.



## V40.18 — Avisos inferiores removidos

- Removidos os dois avisos que ocupavam espaço abaixo dos controles: **QUEIMA DISPONÍVEL** e **CARTA DUPLA DISPONÍVEL**.
- Os botões flutuantes **🔥 QUEIMA** e **×2 DUPLA** continuam aparecendo normalmente quando a ação estiver disponível.
- O destaque visual das cartas e o foco automático em mãos grandes foram preservados.
- A mensagem central da mesa sobre continuação após a Queima não foi alterada.

## V40.16 — Seta do próximo jogador

- O jogador que será o próximo da fila recebe uma **seta animada PRÓXIMO** junto ao avatar.
- A seta acompanha automaticamente a sequência real da partida e muda quando o turno avança.
- Quando uma Dama inverte o sentido, a seta passa imediatamente para o novo próximo jogador.
- O próximo avatar recebe também um contorno verde discreto para facilitar a leitura no celular.
- Em dispositivos com redução de movimento ativada, a seta permanece visível sem animação.

## V40.15 — Ordem visual dos jogadores

- Os avatares da mesa agora são posicionados na **ordem de jogar**, facilitando a leitura da sequência da rodada.
- A posição do próprio jogador continua fixa na parte inferior da mesa.
- Os demais jogadores aparecem ao redor da mesa seguindo a ordem real do turno de acordo com o sentido atual da partida.
- Cada avatar mostra uma pequena indicação visual: **JOGA AGORA**, **PRÓXIMO** ou a posição na fila.
- Em caso de inversão de sentido, a ordem visual é atualizada para refletir a nova sequência de jogo.

## V40.14 — Queima e Carta Dupla flutuantes

- **🔥 QUEIMA** e **×2 DUPLA** agora aparecem como botões flutuantes somente quando a respectiva ação está disponível.
- Os dois botões podem ser arrastados com mouse ou dedo e cada posição fica salva localmente no navegador.
- As cartas válidas continuam destacadas na mão e o foco automático continua funcionando em mãos grandes.
- Se houver mais de uma Carta Dupla possível, o botão ×2 abre um seletor compacto para escolher qual dupla jogar.
- A Queima da abertura mantém o toque direto na carta destacada como atalho adicional.
- Nenhuma regra do motor de Queima ou Carta Dupla foi alterada.


## V40.13 — Carta Dupla otimizada para celular

- O botão **×2 JOGAR DUPLA** aparece em apenas **uma** das duas cartas idênticas.
- A segunda cópia continua marcada em dourado, mas sem repetir o botão.
- A carta que contém o botão fica acima das cartas vizinhas quando a mão está sobreposta.
- No celular, o botão foi movido para a parte superior da carta e recebeu uma área de toque maior.
- Quando Queima e Carta Dupla coexistem na mesma carta, o **×2** fica no alto e **🔥 QUEIMAR** fica mais abaixo.
- A lógica da Carta Dupla não foi alterada.

## V40.12 — Liberdade de anúncio na batida

- Com exatamente duas cartas, o jogador pode escolher **Mau-Mau** simples ou **Mau-Mau batendo/queimando**.
- Os dois anúncios permitem concluir a rodada por **Queima + continuação** ou **Carta Dupla**, quando a jogada for válida.
- O jogador também pode anunciar Mau-Mau simples, realizar a Queima e decidir passar, permanecendo com uma carta.
- Sem nenhum dos dois anúncios, a tentativa de usar as duas últimas cartas continua bloqueada.


## Novidade V40.18 — Reações Rápidas Visíveis

Agora a mesa mostra **3 atalhos rápidos sempre visíveis**: **😂**, **😡** e **🔊**.
O botão **🔊** reproduz a fala **"JOGA BOCA ABERTA!"** com um clique.
No painel lateral, o efeito também foi simplificado para o ícone de alto-falante, facilitando o uso no celular.


## V40.30 — Ajuste no nome do avatar Caldinho

Foi alterado apenas o nome exibido do avatar **Caldinho** no lobby e na seleção de avatares. O identificador interno do avatar foi mantido como `caldo` para evitar quebrar compatibilidade com seleções já existentes.


## V40.30 — Ajuste no nome do avatar Hulk Magrelo

Foi alterado apenas o nome exibido do avatar **Hulk Magrelo** no lobby e na seleção de avatares. O identificador interno do avatar foi mantido como `magreloverde` para evitar quebrar compatibilidade com seleções já existentes.

## V40.31 — Lobby de avatares mais equilibrado

A área de seleção de avatar foi reorganizada para aproveitar melhor a largura da tela. **Mascotes** permanece na coluna esquerda e, na coluna direita, **Pessoas** e **Sua Figurinha** ficam agrupadas uma logo abaixo da outra. Isso remove o grande espaço vazio que aparecia entre os blocos e aproxima os botões de criação/entrada da área de perfil. No celular, tudo continua empilhado e responsivo.

## V40.45 — Música otimizada

A trilha musical agora é carregada sob demanda. Quando qualquer jogador ou observador liga o microfone ao vivo, a música é silenciada automaticamente em todos os clientes da sala e retorna ao volume salvo quando todos desligam o microfone. Efeitos sonoros e voz permanecem independentes da música.
## V40.47 — Áudio Simplificado

A trilha interna foi removida para deixar o jogo menor e mais simples no celular. O botão/painel de música saiu da interface e `public/assets/music/` não faz mais parte do projeto. Efeitos sonoros, avisos de voz, Áudio Rápido e microfone ao vivo continuam funcionando. Quem quiser música pode usar o próprio player do aparelho.

## V40.46 — Performance Mobile

A V40.46 reduz o peso para celulares sem alterar as regras do Mau-Mau. As trilhas longas são reproduzidas com streaming/buffering nativo do navegador, evitando manter músicas inteiras decodificadas em RAM. Os avatares fixos foram otimizados para 256×256 e as novas figurinhas personalizadas para 192×192. A música da tela inicial também foi recomprimida.

A regra de áudio continua: **qualquer jogador ou observador que ligar o microfone ao vivo pausa a música da sala**. Quando todos desligam o microfone, a trilha volta ao volume salvo de cada aparelho.

Os avatares originais da V40.45 foram preservados em um ZIP de backup separado para restauração rápida caso se prefira a qualidade anterior.



## V40.53 — recuperação de partidas após restart

Com `DATABASE_URL` configurada, salas ativas são salvas em snapshots no PostgreSQL e restauradas após reinício/deploy. O servidor remove dados efêmeros (socketId, WebRTC, observadores e timers) e oferece 60 segundos para cada jogador humano reconectar automaticamente à própria vaga. Configure também um `AUTH_SESSION_SECRET` fixo no Render para que a sessão de autenticação continue válida entre reinícios.

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

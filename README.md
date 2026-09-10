# Mau-Mau Candeias — V40.18

Jogo Mau-Mau Candeias multiplayer para navegador, com salas de 2 a 5 jogadores, Login Google obrigatório, Socket.IO, ranking PostgreSQL e recursos de presença online.


## V40.9 — Microfone flutuante

O botão de microfone ao vivo agora pode ser arrastado com mouse ou toque para qualquer posição visível da tela. A posição escolhida fica salva apenas no navegador do próprio jogador, evitando cobrir a quantidade de cartas ou outros elementos quando houver 4 ou 5 participantes. Um duplo clique retorna o botão à posição inicial.

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
│       ├── avatars/
│       └── music/
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

## Música

As trilhas do projeto ficam em `public/assets/music/`. As faixas originais possuem declaração de origem em `public/assets/music/ORIGEM_E_LICENCA.txt`; a música instrumental da tela inicial deriva do áudio fornecido pelo usuário.

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

# MAU-MAU V26 — MOBILE

A V26 mantém todas as regras, ranking PostgreSQL, avatares, bots, chat, sons e efeitos da V25, mas reorganiza a interface para jogar com conforto em celulares e tablets.

Principais melhorias: cabeçalho compacto, suporte a notch/áreas seguras, botões de toque maiores, placar horizontal, adversários reposicionados, contagem de cartas preservada, mão com rolagem horizontal, botões 🔥/⚡/×2 maiores, chat em painel inferior, ranking em cartões no telefone e ajustes próprios para orientação paisagem.

---

## V25 — Novo efeito falado

Foi adicionado ao painel de efeitos o botão **📢 JOGA BOCA ABERTA!**. Ao ser acionado, todos os participantes com som ligado recebem um alerta forte e a voz do navegador fala **“JOGA BOCA ABERTA!”** em volume máximo permitido.

# MAU-MAU V25 — CONTAGEM VISÍVEL + ALERTA DE MAU-MAU

A V25 mantém as regras e funções da V22 e melhora a leitura da mesa: a quantidade de cartas de cada jogador aparece em um contador grande; com 2 cartas o contador ganha destaque amarelo e, com 1 carta, fica vermelho e pulsante.

Quando um adversário passa de 2 ou mais cartas para exatamente 1 carta durante a rodada, todos os demais jogadores com som ligado recebem um alerta forte e uma voz em português: “Atenção! NOME está de Mau-Mau! Uma carta!”. O alerta ocorre somente na transição real para uma carta, evitando repetição a cada atualização da mesa.

A V22 mantém todas as regras e funções da V21 e amplia a galeria para 10 avatares HD, organizados em Animais, Mascotes e Pessoas. Os bots também usam os novos avatares ilustrados.

# Mau-Mau V20 — Mau-Mau Falado

## V20 — anúncio falado de Mau-Mau

Quando qualquer jogador anuncia **Mau-Mau**, todos os participantes que estiverem com o som ligado ouvem a voz do navegador dizer **“Mau-Mau!”**. A fala usa `SpeechSynthesisUtterance` com preferência por voz em português do Brasil (`pt-BR`). Se o aparelho/navegador não disponibilizar síntese de voz, o efeito sonoro de Mau-Mau da V19 continua funcionando como fallback.

O botão **🔊 / 🔇** também controla a fala: com o som desligado, a voz não é reproduzida naquele aparelho.


## Correção central da V19

A V19 mantém **Queima**, **Ação Rápida** e **Carta Dupla** como mecânicas separadas, mas altera a continuação da Queima conforme a nova regra definida para o jogo.

- **🔥 Queima:** basta possuir uma carta exatamente igual à recém-jogada (mesmo valor e mesmo naipe). Depois de queimá-la, o jogador assume a jogada.
- Se ainda possuir carta compatível (mesmo valor, mesmo naipe ou Valete), pode **jogá-la ou passar a vez**.
- Se não possuir nenhuma carta compatível, deve **comprar 1 carta**.
- Depois da compra, pode jogar **qualquer carta válida da mão** ou **passar e guardar a carta comprada**, inclusive quando a carta comprada for um Valete.
- **⚡ Ação Rápida:** continua descartando uma única carta igual fora da vez sem tomar a jogada.
- **×2 Carta Dupla:** continua disponível apenas na própria vez e somente para cartas normais; A, 7, 8, J, Q e K não formam Carta Dupla.

A interface informa claramente três estados após a Queima: **jogar ou passar**, **comprar 1 carta**, ou **jogar a comprada ou passar**.

## Testes da V19

O pacote mantém todos os testes anteriores e acrescenta testes específicos dos exemplos de Carla e Paulo, além de **1.000 cenários automatizados de Queima Flexível** com passe imediato, compra obrigatória quando não há continuação e conservação de carta jogável comprada.

# Mau-Mau V16 — Carta Dupla sem cartas especiais

## Novidade principal

Na própria vez, se o jogador possuir duas cartas exatamente idênticas — mesmo valor e mesmo naipe — e essa carta for válida sobre o topo, pode clicar em **×2** e jogar as duas juntas na mesma jogada.

**V16:** a Carta Dupla é permitida **somente para cartas normais**. As cartas especiais **A, 7, 8, J, Q e K não podem formar Carta Dupla**.

- As duas cartas saem da mão de uma vez.
- A segunda cópia fica no topo do descarte.
- Carta Dupla não funciona com cartas especiais (A, 7, 8, J, Q e K).
- De 3 cartas para 1: anuncie **Mau-Mau** antes.
- Se forem as duas últimas cartas: anuncie **Mau-Mau batendo/queimando** antes.
- O jogador automático também usa Carta Dupla quando houver oportunidade.

A V15 mantém as correções anteriores de passar após compra, Queima Dinâmica, bot, chat, sons e regra da Dama em partidas com dois jogadores.

---

# Mau-Mau V14 — Passar a vez corrigido

## Correção principal da V14

Depois de comprar 1 carta, o jogador pode clicar em **⏭️ Passar a vez**. Ao passar:

- a carta comprada fica na mão;
- o turno termina imediatamente no servidor;
- nenhuma carta do jogador que passou pode ser jogada até sua próxima vez;
- a interface bloqueia a mão enquanto a passagem está sendo confirmada;
- aparece uma confirmação indicando quem joga em seguida;
- contra a máquina, há um pequeno intervalo antes da jogada automática para ficar visível que a vez realmente mudou.

A compra de 1 carta continua obrigatória antes de usar **Passar a vez**. Cadeia de 7 e segunda carta da queima continuam sem permitir passe.

## Novidade principal da V13

A regra de **queimar cartas** foi refeita para ficar mais próxima da regra definida para esta mesa. Quando outro jogador baixa uma carta e você possui uma carta exatamente igual (mesmo valor e mesmo naipe), pode interromper a ordem normal e queimar a sua carta. Em seguida, é obrigatório baixar mais uma carta do mesmo valor, do mesmo naipe ou um Valete.

Exemplo:

```text
Mesa: 5♥
Sua mão: 5♥  9♥  2♣

Queima: 5♥
Segunda carta obrigatória: 9♥

Resultado: duas cartas descartadas na mesma jogada.
```

A queima pode acontecer fora da vez. O primeiro jogador que tiver uma queima válida e executá-la assume a jogada. A primeira carta da queima não pode ser A, Q, J, K, 8 ou 7; a segunda pode ser especial e aplica seu efeito normalmente.

A máquina também entende e utiliza essa nova regra.

---



Esta versão mantém as regras e o jogador automático da V8 e acrescenta **chat em tempo real** e **efeitos sonoros compartilhados entre os jogadores da sala**.

## Novidades da V9

- 💬 Chat em tempo real com histórico das últimas 60 mensagens da sala.
- 🔔 Indicador de mensagens não lidas.
- 📱 Painel de chat adaptado para celular, aberto pelo botão 💬 no topo.
- 🔊 Efeitos compartilhados: aplausos, risada, corneta, tambores, vitória e “uau”.
- 🎭 Reação visual na mesa quando um efeito é enviado.
- 🔇 O botão de som continua sendo local: cada jogador pode silenciar os efeitos no próprio aparelho.
- 🛡️ Limite de 180 caracteres, escape de HTML e pequeno intervalo anti-spam no servidor.

> Observação: alguns navegadores bloqueiam áudio automático antes da primeira interação do usuário. O efeito visual continuará aparecendo; após um clique/toque na página, o áudio passa a funcionar normalmente.

# Mau-Mau Multiplayer — Baralho Tradicional

Aplicativo web multiplayer para 2 a 5 jogadores, criado a partir das regras fornecidas pelo usuário e organizado para partidas online em redes diferentes.

## Visão geral

- 2 a 5 jogadores humanos.
- 2 baralhos tradicionais completos, sem curingas (104 cartas).
- 6 cartas para cada jogador.
- 5 rodadas.
- Sentido inicial anti-horário em cada rodada.
- Vence a partida quem terminar as 5 rodadas com a menor pontuação acumulada.
- Salas privadas com código de 6 caracteres.
- Reconexão por token local.
- Pausa automática se alguém cair durante uma rodada.
- Entrada tardia somente entre rodadas e até antes do início da 3ª rodada.

## Cartas especiais implementadas

- Ás (A): próximo jogador perde a vez.
- Dama (Q): inverte o sentido.
- Valete (J): pode ser jogado independentemente do valor/naipe e escolhe o próximo naipe. Não interrompe uma cadeia ativa de 7.
- Sete (7): próximo compra 2 e perde a vez; outro 7 rebate e acumula +2.
- Rei (K): o jogador anterior, considerando o sentido atual, compra 1.
- Oito (8): o jogador anterior, considerando o sentido atual, compra 2.

## Regra de queimar — V12

1. Outro jogador baixa uma carta normal.
2. Se você tiver uma carta exatamente igual (mesmo valor e mesmo naipe), ela pode aparecer destacada com 🔥.
3. Para iniciar a queima, você precisa ter também uma segunda carta compatível.
4. Clique em 🔥 para baixar a carta igual, mesmo fora da sua vez.
5. Você passa a controlar a jogada e deve obrigatoriamente baixar mais uma carta do mesmo valor, do mesmo naipe ou um Valete.
6. Não existe mais o botão “Encerrar queima”: a segunda carta é obrigatória.
7. A primeira carta da queima não pode ser A, Q, J, K, 8 ou 7.
8. Se as duas cartas encerrarem sua mão, anuncie “Mau-Mau batendo/queimando” antes.

## Mau-Mau

Antes de uma jogada que deixe somente uma carta na mão, o jogador deve anunciar “Mau-Mau”. Como o documento original exige o anúncio mas não define a penalidade para esquecimento, o aplicativo adota +2 cartas, regra também encontrada na versão tradicional publicada pela Copag.

## Pontuação

- Ás = 1
- 2 a 10 = valor impresso
- Valete = 11
- Dama = 12
- Rei = 13
- Se o vencedor bater com Valete, os pontos de todos os demais jogadores naquela rodada são dobrados.

## Clarificações operacionais adicionadas

Estas regras foram incluídas para evitar estados indefinidos em uma aplicação digital:

- Se a carta inicial virada for especial, outra carta normal é virada para iniciar a rodada.
- Quando o monte de compra acaba, o descarte é reembaralhado, preservando a carta do topo.
- Depois de comprar 1 carta por não ter jogada possível: se a carta servir, pode jogar somente a carta comprada; se não servir, a vez passa automaticamente.
- Em empate na menor pontuação após a 5ª rodada, os jogadores empatados compartilham a vitória.
- Se um jogador cair durante a rodada, a partida pausa até a reconexão.

## Como executar no computador

Instale Node.js 18 ou superior. Depois, nesta pasta:

```bash
npm install
npm start
```

Abra:

```text
http://localhost:3000
```

Para testar com outro aparelho na mesma rede, use o IP local do computador e a porta 3000, desde que o firewall permita.

## Como jogar pela internet

O projeto possui `render.yaml` e pode ser publicado em um serviço que execute Node.js. Depois de publicado, basta abrir o endereço público, criar uma sala e enviar o link/código para os demais jogadores.

## Teste do motor de regras

```bash
npm test
```

Os testes cobrem: quantidade do baralho, pontuação, jogada por valor/naipe, Valete, cadeia de 7, queima, Mau-Mau e pontuação dobrada ao bater com Valete.

## Referências consultadas para comparação

As regras do usuário são a fonte principal do projeto. As referências abaixo foram usadas apenas para esclarecer comportamentos comuns da família de jogos de descarte e preencher lacunas operacionais:

- Copag — Mau-Mau: https://blog.copag.com.br/blog/regras/maumau
- Bicycle — Crazy Eights: https://bicyclecards.com/how-to-play/crazy-eights/
- Pagat — Eights Group / Crazy Eights: https://www.pagat.com/eights/



## V7 — Jogador automático

- Botão **Jogar contra a máquina** na tela inicial.
- O anfitrião pode adicionar/remover bots no lobby e entre rodadas (respeitando o limite de 5 participantes e a entrada até a 3ª rodada).
- O bot joga no servidor, usa cartas especiais, escolhe naipe no Valete, rebate cadeia de 7, anuncia Mau-Mau e usa queima quando possível.
- É possível misturar jogadores humanos e automáticos na mesma sala.


## V8 — Dama (Q) em partidas com 2 jogadores

A Dama continua invertendo o sentido do jogo. Quando existirem exatamente dois jogadores ativos, a inversão faz com que o jogador que descartou a Dama jogue novamente. Com três ou mais jogadores, o turno segue normalmente para o próximo participante no novo sentido.


## V12 — Passar a vez livre
Durante uma jogada normal, o participante pode clicar em **⏭️ Passar a vez** mesmo que possua carta válida e mesmo sem ter comprado carta. A passagem é voluntária e encerra imediatamente o turno.

O botão não pode ser usado para evitar obrigações pendentes: durante uma cadeia de **7** é necessário rebater com outro 7 ou comprar a penalidade; durante uma **queima dinâmica**, a segunda carta continua obrigatória.


## V13 — Compra obrigatória para passar a vez
Para encerrar voluntariamente a própria jogada com o botão **⏭️ Passar a vez**, o participante precisa primeiro comprar **1 carta do monte**. A compra é permitida mesmo quando ele já possui carta válida. Após comprar, o jogador pode escolher **qualquer carta válida da mão**; se não quiser jogar, pode clicar em **Passar a vez** e guardar a carta comprada. Não é permitido comprar uma segunda carta na mesma jogada normal. A regra não altera a penalidade da cadeia de 7 nem a segunda carta obrigatória da queima dinâmica.

## V19 — Efeitos sonoros automáticos

Foram acrescentados sons automáticos, gerados pelo próprio navegador via Web Audio API, sem arquivos MP3 externos. Há sons distintos para: carta jogada, compra, sua vez, passar, Queima, Ação Rápida, Carta Dupla, Dama/inversão, Ás/pulo, Valete/escolha de naipe, cadeia de 7, penalidade, Mau-Mau, início de rodada, vitória, campeão, chat e erro.

O botão 🔊/🔇 silencia ou ativa todos os sons no aparelho do jogador e a preferência fica salva no navegador.


## V21 — Avatares HD
A tela inicial ganhou cinco avatares ilustrados em alta qualidade: Macaco, Boi, Jacaré, Veado e Cachorro. Os arquivos ficam em `public/assets/avatars/` e são exibidos na mesa, placar, chat e perfil do jogador.

## V25 — Ranking e Estatísticas

A V25 adiciona ranking por **Hoje, Mês, Ano e Geral**, com duas modalidades separadas: **Pessoas** (somente partidas sem bot) e **Com máquina** (partidas que possuem pelo menos um bot). O critério é: mais vitórias, depois menor média de pontos, menor total de pontos e maior número de partidas.

Cada navegador recebe um `playerKey` permanente salvo no `localStorage`. Assim, o jogador pode trocar nome e avatar sem perder seu histórico naquele dispositivo.

### Persistência

- Se `DATABASE_URL` estiver configurada, o jogo usa **PostgreSQL** e cria automaticamente as tabelas `mm_players`, `mm_matches` e `mm_match_results`. Esta é a opção indicada para produção no Render.
- Sem `DATABASE_URL`, o jogo usa `data/ranking.json` como fallback local. Isso é ótimo para testes, mas em hospedagens com filesystem efêmero o histórico pode ser perdido após reinicializações/deploys.

### No Render

Crie/conecte um PostgreSQL ao serviço e disponibilize a variável de ambiente `DATABASE_URL`. Depois faça novo deploy. Não é necessário criar as tabelas manualmente.

## V31 — Cartas especiais somente na vez normal

As cartas A, 7, 8, J, Q e K não podem ser usadas em Queima, Ação Rápida, continuação de Queima ou Carta Dupla. Elas permanecem válidas e produzem seus efeitos normalmente quando jogadas na vez normal do jogador.

### V32 — efeitos especiais na batida
A carta especial mantém seu efeito quando é a última carta. Em especial, 8 e K aplicam a compra antes da pontuação, e o 7 mantém a cadeia ativa. Se a cadeia final de 7 completar uma volta por todos os demais jogadores, ela termina sem compra.

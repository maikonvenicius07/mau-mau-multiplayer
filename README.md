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
Para encerrar voluntariamente a própria jogada com o botão **⏭️ Passar a vez**, o participante precisa primeiro comprar **1 carta do monte**. A compra é permitida mesmo quando ele já possui carta válida. Após comprar, somente a carta recém-comprada poderá ser jogada naquela decisão; se não quiser jogá-la, ou se ela não for válida, o jogador pode clicar em **Passar a vez**. Não é permitido comprar uma segunda carta na mesma jogada normal. A regra não altera a penalidade da cadeia de 7 nem a segunda carta obrigatória da queima dinâmica.
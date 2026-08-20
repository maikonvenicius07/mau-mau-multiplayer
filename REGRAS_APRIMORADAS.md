# Regras aprimoradas do Mau-Mau — versão do aplicativo

## 1. Objetivo da partida

O jogo possui cinco rodadas. Em cada rodada, o objetivo é ficar sem cartas. Quem termina a rodada não recebe pontos; os demais somam o valor das cartas que permaneceram em suas mãos. Depois da quinta rodada, vence quem tiver a menor pontuação acumulada.

## 2. Preparação

- Jogadores: 2 a 5.
- Baralho: dois baralhos tradicionais completos, sem curingas, totalizando 104 cartas.
- Distribuição: 6 cartas para cada jogador.
- Uma carta normal é virada no centro para iniciar o descarte.
- O sentido inicial é anti-horário.

O aplicativo registra simbolicamente quem embaralha, quem distribui e quem vira a carta. Esses papéis giram a cada rodada.

## 3. Jogada normal

Na sua vez, jogue uma carta que tenha o mesmo valor ou o mesmo naipe da carta que está no topo do descarte.

Exemplo: sobre 9 de Copas, são válidos qualquer 9, qualquer carta de Copas ou um Valete.

O jogador também pode optar por comprar uma única carta mesmo tendo jogada válida. Depois da compra, pode jogar apenas a carta recém-comprada se ela for válida ou usar **Passar a vez**, mantendo-a na mão. Não é permitido comprar uma segunda carta na mesma jogada normal.


## 4. Carta Dupla — regra V16

Na própria vez, se o jogador possuir **duas cartas idênticas** na mão — mesmo valor e mesmo naipe — e essa carta for válida sobre o topo do descarte, ele pode jogar as duas juntas na mesma jogada.

Exemplo:

```text
Mesa: 5♥
Mão: 5♣  5♣  9♦  K♠

Carta Dupla: 5♣ + 5♣
```

As duas cartas são retiradas da mão e a segunda cópia fica como carta visível no topo do descarte. No aplicativo, uma dupla disponível recebe o botão **×2**.

A Carta Dupla é tratada como **uma única jogada composta**, porém é permitida **somente para cartas comuns**. Não pode ser utilizada com **Ás (A), Sete (7), Oito (8), Valete (J), Dama (Q) ou Rei (K)**. Essas cartas especiais devem ser jogadas individualmente, preservando integralmente seus efeitos próprios.

Se a Carta Dupla reduzir a mão de 3 para 1 carta, o jogador deve anunciar **Mau-Mau** antes da jogada. Se as duas cartas idênticas forem as duas últimas da mão, deve anunciar **Mau-Mau batendo/queimando** antes de descartá-las.

## 5. Cartas especiais

### Ás (A) — Pular
O próximo jogador perde a vez.

### Dama (Q) — Inverter
O sentido da partida muda de horário para anti-horário ou vice-versa.

### Valete (J) — Escolher naipe
Pode ser jogado mesmo sem combinar com o topo. Quem joga escolhe Copas, Ouros, Paus ou Espadas para a próxima jogada.

Exceção: durante uma cadeia ativa de Sete, somente outro Sete pode rebater. Depois que a penalidade for comprada, o Valete volta a ser uma jogada válida normalmente.

Se o Valete for a carta que encerra a rodada, a pontuação dos demais jogadores naquela rodada é dobrada.

### Sete (7) — Comprar 2 / Rebater
O próximo jogador deve comprar 2 cartas e perder a vez, a menos que possa jogar outro Sete.

Cada Sete rebatido acrescenta +2 à penalidade:

- primeiro 7: +2;
- segundo 7: +4;
- terceiro 7: +6;
- e assim sucessivamente.

Se a rodada for encerrada com um Sete, a penalidade ainda deve ser resolvida antes da pontuação final.

### Rei (K) — Jogador anterior +1
O jogador anterior, considerando o sentido atual da partida, compra uma carta.

### Oito (8) — Jogador anterior +2
O jogador anterior, considerando o sentido atual da partida, compra duas cartas.

## 6. Regra Mau-Mau

Quando estiver com duas cartas e for fazer uma jogada que deixará apenas uma, anuncie “Mau-Mau” antes de descartar.

No aplicativo, esquecer o anúncio gera compra de 2 cartas.

## 7. Queimar cartas — regra V11

A queima passa a funcionar como uma jogada de reação. Quando **outro jogador** coloca uma carta na mesa e você possui na mão uma carta **exatamente igual** — mesmo valor e mesmo naipe — você pode queimar essa carta, inclusive fora da sua vez.

Para iniciar a queima, você também precisa possuir uma segunda carta que possa ser jogada imediatamente depois da carta queimada. Essa segunda carta deve ser:

- do mesmo valor; ou
- do mesmo naipe; ou
- um Valete (J).

A sequência é obrigatoriamente: **carta igual à mesa + segunda carta compatível**. Portanto, a queima elimina duas cartas na mesma jogada. Depois que a primeira carta da queima é baixada, não é permitido desistir nem comprar; o jogador deve completar a queima com a segunda carta.

A primeira carta usada para queimar não pode ser Ás, Dama, Valete, Rei, Oito ou Sete. A segunda carta pode ser especial e, nesse caso, seu efeito é aplicado normalmente.

Quem queima assume a jogada. Depois da segunda carta, a ordem da partida continua a partir do jogador que realizou a queima, respeitando o sentido atual e os efeitos da segunda carta.

### Mau-Mau na queima

Se a queima de duas cartas fizer o jogador terminar com apenas uma carta, ele deve anunciar **“Mau-Mau”** antes de ficar com uma carta.

### Mau-Mau batendo/queimando

Se o jogador tiver apenas duas cartas e puder encerrar a rodada usando a queima, deve anunciar **“Mau-Mau batendo/queimando”** antes de iniciar. As duas cartas não precisam ser iguais entre si: a primeira precisa ser exatamente igual à carta da mesa e a segunda precisa ser compatível com ela.

## 8. Pontuação

- A = 1 ponto
- 2 a 10 = valor da carta
- J = 11 pontos
- Q = 12 pontos
- K = 13 pontos

O vencedor da rodada recebe 0. Os demais somam as cartas restantes. Se a batida ocorrer com Valete, a pontuação dos demais é dobrada.

## 9. Entrada de novos jogadores

Não é permitido entrar durante uma rodada. Um jogador pode entrar no intervalo entre rodadas até antes do início da terceira rodada.

Quem entrar depois do início da partida recebe como pontuação inicial o maior total acumulado pelos jogadores que já estavam participando.

## 10. Regras técnicas para o aplicativo

- Carta inicial especial é devolvida ao monte e outra carta normal é virada.
- Se o monte acabar, o descarte é reembaralhado, preservando a carta do topo.
- Em caso de desconexão durante uma rodada online, a partida pausa para evitar que o jogador perca a vez involuntariamente.
- Empate na menor pontuação após cinco rodadas resulta em vitória compartilhada.


## Jogador automático (V7)

O anfitrião pode jogar contra a máquina ou adicionar jogadores automáticos à mesma sala dos jogadores humanos. O bot segue as mesmas regras da partida: joga por valor ou naipe, compra quando não possui jogada válida, rebate a cadeia de 7 quando possível, escolhe um naipe ao usar Valete, anuncia Mau-Mau e Mau-Mau batendo quando necessário e utiliza a queima dinâmica quando outro jogador baixar uma carta exatamente igual a uma carta da sua mão e houver segunda carta compatível. O limite total da mesa continua sendo de 5 participantes, somando humanos e máquinas.


## Regra V10 — Passar após a compra

Quando o jogador não possuir carta válida, ele compra apenas 1 carta. Se essa carta for compatível com o topo da mesa, o jogador **não é obrigado a jogá-la**. Ele pode:

- jogar a carta recém-comprada; ou
- clicar em **Passar a vez**, mantendo a carta na mão.

Se a carta comprada não puder ser jogada, a vez passa automaticamente. Durante essa decisão, somente a carta recém-comprada pode ser jogada.


## Compra obrigatória para passar a vez (V13)
Em uma jogada normal, o jogador pode optar por **passar a vez**, mas precisa primeiro **comprar 1 carta do monte**. A compra é permitida mesmo quando já existem cartas válidas na mão. Depois de comprar, o participante pode jogar a carta recém-comprada caso ela seja válida ou clicar em **Passar a vez**, mantendo a carta na mão. Não é permitido comprar uma segunda carta na mesma jogada normal.

A passagem voluntária **não pode** ser utilizada para evitar uma cadeia de 7: nessa situação, o jogador deve rebater com outro 7 ou comprar a quantidade acumulada. Também não pode ser utilizada durante a continuação de uma queima dinâmica, pois a segunda carta da queima é obrigatória.

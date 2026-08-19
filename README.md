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

## Regra de queimar — interpretação implementada

A redação recebida indica que cartas exatamente iguais podem ser queimadas e que, depois delas, é possível jogar outra carta compatível ou um Valete. Para deixar a regra inequívoca no aplicativo, foi adotado o seguinte fluxo:

1. Na sua vez, escolha uma carta normal que seja uma jogada válida.
2. Se você tiver uma segunda carta exatamente igual (mesmo valor e mesmo naipe), poderá usar “Queimar”.
3. As duas cartas iguais são descartadas na mesma jogada.
4. Você ganha uma continuação para jogar mais uma carta que combine com o topo (mesmo valor/naipe) ou um Valete.
5. Também pode encerrar a continuação sem jogar outra carta.
6. Ás, Dama, Valete, Rei, Oito e Sete não podem ser queimados.
7. Se as duas cartas iguais forem as duas últimas da mão, é obrigatório anunciar “Mau-Mau batendo/queimando” antes da queima.

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


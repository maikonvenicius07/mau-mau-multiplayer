# Regras consolidadas do Mau-Mau — V37

Este arquivo reúne **somente as regras vigentes** do aplicativo. Textos de atualização antigos permanecem no projeto apenas como histórico.

## 1. Partida
- 2 a 5 jogadores.
- Dois baralhos tradicionais completos, sem curingas: 104 cartas.
- 6 cartas por jogador.
- Uma carta normal inicia o descarte; carta especial sorteada para iniciar volta ao monte.
- Sentido inicial: anti-horário.
- A partida possui 5 rodadas. Vence quem tiver a menor pontuação acumulada.

## 2. Jogada normal e compra livre
Na sua vez, pode jogar uma carta do mesmo valor ou do mesmo naipe do topo. O Valete (J) é coringa, exceto durante cadeia ativa de 7.

O jogador pode comprar **1 carta mesmo tendo carta válida na mão**. Depois da compra, pode:
1. jogar a carta comprada, se válida;
2. jogar **qualquer outra carta válida que já estava na mão**; ou
3. passar a vez e guardar a carta comprada.

Não é permitido comprar uma segunda carta na mesma jogada normal. A passagem voluntária não evita uma cadeia ativa de 7.

## 3. Cartas especiais
- **A**: o próximo jogador perde a vez.
- **7**: o próximo recebe +2; pode rebater somente com outro 7, acumulando +2 por carta.
- **8**: o jogador anterior, considerando o sentido atual, compra 2.
- **J**: escolhe o próximo naipe. Se for a carta da batida, dobra os pontos dos adversários.
- **Q**: inverte o sentido. Com 2 jogadores, quem joga Q joga novamente.
- **K**: o jogador anterior, considerando o sentido atual, compra 1.

Cartas especiais não podem iniciar Queima, não podem ser usadas em Ação Rápida e não podem ser usadas em Carta Dupla.

## 4. Queima — somente na própria vez
A Queima que dá direito a uma segunda carta existe **somente quando já é a vez normal do jogador**.

Se a carta do topo for normal e o jogador tiver uma carta normal **exatamente igual** (mesmo valor e mesmo naipe), pode usar o botão de Queima para descartá-la.

Após uma Queima válida na própria vez:
- pode jogar uma segunda carta legal ou passar;
- a segunda carta pode ser especial e, nesse caso, seu efeito vale normalmente;
- se não houver continuação legal, deve comprar 1 carta e então pode jogar qualquer carta válida da mão ou passar.

Exemplo: mesa 5♦; na sua vez você queima 5♦ e depois pode jogar 8♦ (o anterior compra 2) ou J (escolhe o naipe), se a jogada for legal.

## 5. Ação Rápida — fora da vez
Um jogador que **não é o próximo da vez** pode descartar uma carta normal exatamente igual à carta recém-jogada, antes de o próximo jogador iniciar sua ação.

A Ação Rápida:
- descarta **somente uma carta**;
- não transfere a vez;
- não permite segunda carta;
- não altera o sentido;
- não aceita A, 7, 8, J, Q ou K;
- fica suspensa durante cadeia de 7 e durante continuação de Queima.

Depois da Ação Rápida, continua sendo a vez de quem já seria o próximo jogador.

## 6. Carta Dupla
Na própria vez, duas cartas exatamente iguais podem ser descartadas juntas se a jogada for válida.

Carta Dupla só vale para **2, 3, 4, 5, 6, 9 e 10**. Não vale para A, 7, 8, J, Q ou K.

## 7. Mau-Mau
Antes de uma jogada que deixe o jogador com uma carta, deve anunciar **Mau-Mau**. Esquecer o anúncio gera a penalidade prevista no aplicativo.

Se a jogada composta (Queima + continuação ou Carta Dupla) puder encerrar a mão, utiliza-se **Mau-Mau batendo/queimando** conforme a interface.

## 8. Batida com carta especial
O efeito da carta especial permanece ativo mesmo quando ela é a última carta do jogador.

- Batida com 8: o anterior compra 2 antes do encerramento.
- Batida com K: o anterior compra 1 antes do encerramento.
- Batida com J: os pontos dos adversários são dobrados.
- Batida com 7: a cadeia continua até ser resolvida.

### Cadeia final do 7
Se a batida ocorrer com 7, os jogadores seguintes podem rebater com outro 7. Quem não tiver 7 compra o acumulado e a rodada termina. Se todos os jogadores restantes rebaterem e a cadeia completar uma volta até o vencedor original, ninguém compra e a rodada termina normalmente.

## 9. Pontuação
- A = 1
- 2 a 10 = valor nominal
- J = 11
- Q = 12
- K = 13

O vencedor da rodada recebe 0 ponto. Após cinco rodadas, vence a menor pontuação acumulada.

## 10. Jogadores, bots e entrada tardia
Novos jogadores não entram durante uma rodada. Podem entrar nos intervalos somente antes do início da terceira rodada, recebendo como pontuação inicial o maior total já acumulado na mesa.

Bots seguem as mesmas regras dos humanos, inclusive Queima somente na própria vez e Ação Rápida sem roubar o turno.

## 11. Regras técnicas preservadas
- Se o monte acabar, o descarte é reembaralhado preservando o topo.
- Desconexão durante rodada pausa a partida para evitar perda involuntária da vez.
- Empate na menor pontuação após cinco rodadas resulta em vitória compartilhada.
- Ranking e armazenamento PostgreSQL permanecem com o comportamento já existente no projeto; a V37 não altera essa camada.

## 12. Organização visual
A mão pode ser organizada por número ou por naipe. Essa ordenação é somente visual e não altera as regras. No mobile, valor e naipe são renderizados separadamente para evitar sobreposição.

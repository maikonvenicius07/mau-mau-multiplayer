# MAU-MAU CANDEIAS — Base de Regras Congeladas Pré-APK

**Base:** V40.69.2  
**Data do congelamento:** 22/09/2026  
**Objetivo:** registrar as regras que já estão funcionando antes da preparação do APK e criar um ponto de referência para impedir alterações acidentais.

> “Congelada” não significa que a regra nunca poderá ser alterada. Significa que qualquer mudança futura deverá ser intencional, autorizada e acompanhada da atualização desta base e dos testes correspondentes.

## 1. Estrutura da partida

- 2 a 5 jogadores.
- Dois baralhos tradicionais completos, sem coringas: 104 cartas.
- 6 cartas para cada jogador.
- 5 rodadas por partida.
- Sentido inicial: **anti-horário**.
- A primeira carta do descarte deve ser normal; carta especial não inicia a rodada.

## 2. Jogada normal e compra

- Na própria vez, pode ser jogada uma carta do mesmo valor ou do mesmo naipe da carta do topo.
- O Valete (J) funciona como coringa de naipe, exceto durante cadeia ativa de 7.
- O jogador pode comprar 1 carta mesmo possuindo jogada válida.
- Depois da compra, pode jogar a carta comprada, jogar outra carta válida da mão ou passar e guardar a carta comprada.
- Não há segunda compra normal na mesma vez.

## 3. Mau-Mau

- Antes de uma jogada que deixe o jogador com apenas 1 carta, deve ser anunciado **Mau-Mau**.
- Esquecer o anúncio gera penalidade de **+2 cartas**.
- Em jogada composta capaz de eliminar as duas últimas cartas por Queima + continuação ou Carta Dupla, são aceitos **Mau-Mau simples** ou **Mau-Mau batendo/queimando**.

## 4. Cartas especiais

- **A — Ás:** pula exatamente o próximo jogador.
- **7:** aplica +2 ao próximo jogador; outro 7 pode rebater e acumular +2.
- **8:** o jogador anterior, considerando o sentido atual, compra 2 cartas.
- **J — Valete:** coringa de naipe; o jogador escolhe o naipe. Não interrompe cadeia ativa de 7. Se for a carta da batida, dobra os pontos dos adversários na rodada.
- **Q — Dama:** inverte o sentido. Com apenas 2 jogadores ativos, quem joga a Dama joga novamente. Com 3, 4 ou 5, a vez segue para o adjacente no novo sentido.
- **K — Rei:** o jogador anterior, considerando o sentido atual, compra 1 carta.

## 5. Queima

- Regra normal: a Queima com direito a continuação ocorre na própria vez do jogador.
- A primeira carta da Queima deve ser uma carta **normal exatamente igual** ao topo: mesmo valor e mesmo naipe.
- **Exceção da abertura:** a primeira carta normal virada no início da rodada pode ser queimada por qualquer jogador que possua cópia normal exatamente igual, mesmo fora da vez.
- A, 7, 8, J, Q e K não podem iniciar Queima.
- Depois de uma Queima válida, a continuação pode ser uma carta especial legal e seu efeito deve funcionar normalmente.

## 6. Ação Rápida

- Acontece fora da vez, logo após uma carta normal.
- O jogador não pode ser quem acabou de jogar nem quem já seria o próximo.
- Exige carta normal exatamente igual à recém-jogada.
- Descarta apenas uma carta.
- Não transfere a vez e não permite segunda carta.
- A, 7, 8, J, Q e K não podem ser usadas.
- Fica suspensa durante cadeia de 7 e durante continuação de Queima.

## 7. Carta Dupla

- Acontece na própria vez.
- Exige duas cartas exatamente iguais: mesmo valor e mesmo naipe.
- Permitida somente para **2, 3, 4, 5, 6, 9 e 10**.
- Não é permitida para **A, 7, 8, J, Q ou K**.

## 8. Batida com carta especial

- O efeito da última carta especial continua válido antes do encerramento da rodada.
- Batida com 8: jogador anterior compra 2.
- Batida com K: jogador anterior compra 1.
- Batida com J: pontos dos adversários são dobrados.
- Batida com 7: a cadeia continua até ser resolvida.
- Batida com A ou Q: o efeito é registrado antes do encerramento.

## 9. Pontuação

- A = 1
- 2 a 10 = valor nominal
- J = 11
- Q = 12
- K = 13
- O vencedor da rodada recebe 0 ponto.
- Se a última carta for J, a pontuação dos adversários é dobrada.

## 10. Regras operacionais preservadas

- Ninguém entra durante uma rodada.
- Novos jogadores podem entrar nos intervalos até antes do início da 3ª rodada.
- Quem entra depois do início recebe como pontuação inicial o maior total acumulado da mesa.
- Máquinas seguem as mesmas regras dos humanos.
- Se o monte acabar, o descarte é reembaralhado preservando a carta do topo.
- Reconexão mantém a vaga por 60 segundos; depois, a Máquina pode assumir temporariamente a mesma mão, posição e pontuação, e o jogador original pode retomar ao voltar.

## 11. Proteção desta base

O arquivo `tests/pre-apk-rules-freeze-v40692.test.js` funciona como um alarme de regressão. Ele não modifica nenhuma regra. Se uma alteração futura mudar uma regra congelada, a suíte de testes deve falhar até que a mudança seja revisada e aprovada conscientemente.

**Regra de manutenção:** nenhuma alteração futura nas regras deve ser feita apenas para “fazer o teste passar”. Primeiro deve ser confirmada a nova regra desejada; só depois o motor, este documento e os testes devem ser atualizados em conjunto.

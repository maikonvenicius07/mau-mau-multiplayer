# MAU-MAU CANDEIAS — V53.6: placar aberto por padrão

## Solicitação
O placar acumulado deve aparecer automaticamente quando o jogador entra na sala ou inicia uma nova partida. O jogador pode fechar pelo X ou pelo botão 📊 do topo, e reabri-lo a qualquer momento. A pontuação e a regra do jogo não são alteradas.

## Alterações
- `public/app.js`: abertura inicial uma única vez quando muda o contexto da partida (sala/jogador/função/partida). Não reabre após o fechamento manual durante a mesma partida. A aba do observador permanece independente.
- `public/app.js`: campos de acessibilidade do botão 📊 sincronizados com o painel.
- `public/app.js`: linhas do placar agrupadas em um trilho para o celular; todos os jogadores continuam listados, e o usuário desliza para consultar os demais.
- `public/styles.css`: desktop preserva o quadro flutuante da V53.5; no celular, painel compacto antes da mesa, ao lado dos controles superiores, com rolagem horizontal interna. Sem mudança no tamanho das cartas.
- `public/index.html`: atualização dos parâmetros de versão de CSS e JS, evitando cache antigo.
- `tests/scoreboard-default-visible-v53-6.test.js`: teste de abertura, fechamento, nova partida e isolamento do observador.

## Instalação
No ZIP `SOMENTE_ALTERADOS`, substituir os arquivos mantendo exatamente as pastas `public`, `docs` e `tests` no GitHub. Não colocar `index.html` na raiz.

## Verificação manual recomendada
1. Entrar como jogador pelo celular: o placar aparece aberto.
2. Usar o gesto lateral no placar para consultar todos os jogadores.
3. Fechar pelo X e continuar a mesma rodada: o placar não reaparece sozinho.
4. Reabrir pelo botão 📊 e confirmar que os valores atualizam.
5. Testar microfone, câmera e troca de lado sem sobreposição sobre o placar em posição padrão.
6. Entrar como observador: o placar permanece na gaveta exclusiva de observadores.

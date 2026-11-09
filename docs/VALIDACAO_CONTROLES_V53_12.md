# MAU-MAU CANDEIAS — V53.12 — Controles laterais do celular

Base da atualização: projeto completo V53.11. O placar da V53.11, as cartas, o
jogo e o modo observador permanecem inalterados.

## Correção

No celular, os controles originais ficam organizados na lateral esquerda,
na seguinte ordem: **Câmera → Microfone → Reações 😊 → Trocar lados ⇄**.

- O posicionamento se aplica ao entrar na sala e ao iniciar uma rodada.
- Posições antigas dos botões não provocam sobreposição ao iniciar a rodada.
- Se a câmera estiver indisponível ou oculta, seu espaço inicial é reservado.
- O usuário pode arrastar cada controle durante a partida, sem que a atualização
  normal do estado force nova posição. Em rodada ou sala nova, a coluna é restaurada.
- O desktop usa o mesmo algoritmo V53.5 de antes; observadores não recebem
  a organização específica dos jogadores.
- A posição e a exibição do placar acumulado V53.11 não foram alteradas.

## Arquivos modificados

- `public/controls-positioning.js`: organização dos quatro controles, incluindo
  o botão de reações, e transições entre sala e partida.
- `public/app.js`: informa o estado da rodada ao organizador (sem alterar lógica
  de jogo ou pontuação).
- `public/index.html`: invalidação do cache de scripts modificados.
- `tests/mobile-side-controls-stack-v53-12.test.js`: teste automático novo.
- `docs/VALIDACAO_CONTROLES_V53_12.md`: este relatório.

## Validação

- Sintaxe de `public/app.js` e `public/controls-positioning.js`: OK.
- Testes independentes de Node.js: 159/159 aprovados.
- Teste de integração Socket.IO não executado no ambiente: dependência
  `socket.io-client` não instalada localmente.
- Conferência visual e geométrica com Chromium: 320 × 690, 360 × 780,
  390 × 840, 430 × 900, 844 × 390 e desktop 1280 × 800.
- Emular entrada na sala, início de rodada após posições antigas sobrepostas,
  preservação de posição após atualização normal e exclusão do observador.

## Instalação

No GitHub, abra o ZIP "somente alterados" e substitua os arquivos nos mesmos
caminhos da raiz do repositório. Não crie `index.html` na raiz: o arquivo
correto é `public/index.html`. Após o deploy, teste em uma sala real de celular.

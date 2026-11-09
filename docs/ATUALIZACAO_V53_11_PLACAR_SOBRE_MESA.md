# MAU-MAU CANDEIAS — V53.11

## Objetivo

Ajuste exclusivo do placar acumulado para dispositivos móveis, segundo a referência visual enviada: canto superior direito da mesa, com sobreposição parcial ao feltro, sem ocupar espaço adicional vertical.

## Diagnóstico

O placar do jogador recebia, no CSS móvel da V53.8, `position:relative` e `margin:60px 0 5px auto`, integrando o fluxo vertical da `.table-shell` e afastando a mesa para baixo. O placar desktop já utilizava sobreposição.

## Alterações

- `public/styles.css`: nova regra móvel ao final do arquivo, com o **mesmo** `#scoreboard` em `position:absolute` ancorado à `.table-shell` (que é `position:relative`), `right` compacto e `top` abaixo dos controles superiores. O painel continua por cima da borda/área da mesa, fora do `overflow:hidden` do feltro. Altura responsiva e rolagem vertical interna quando houver mais jogadores. Breakpoints não se aplicam ao modo observador nem ao desktop.
- `public/app.js`: `renderScore` mantém nomes completos acessíveis e no desktop/observador, exibindo somente o primeiro nome no placar móvel do jogador. Não altera o cálculo, a ordem nem os valores das pontuações.
- `public/index.html`: identificação nova nas URLs de CSS e JS para evitar cache da versão anterior.
- `tests/scoreboard-felt-overlay-mobile-v53-11.test.js`: teste de regressão do placar.

## Validação

- Inspeção visual e geométrica com navegador Chromium simulado nas larguras **320, 360, 390, 430, 560, 768 e 844 px**, além de desktop 1280 px.
- Com dois e cinco jogadores, o placar foi renderizado no canto superior direito **sobre a mesa**, e a mesa não se deslocou verticalmente.
- Verificado que o botão de fechar continua clicável e que o placar não cria rolagem horizontal da página.
- No cenário com cinco jogadores e tela estreita, a altura é limitada e a lista de pontos pode rolar verticalmente para manter os avisos centrais disponíveis.
- Modo observador verificado separadamente: mantém a gaveta original.
- **158 testes de unidade/regressão independentes aprovados.** Um teste de integração com Socket.IO não pôde ser executado por ausência da dependência `socket.io-client` neste ambiente.

## Instalação

Descompacte o ZIP **SOMENTE_ALTERADOS** na raiz do seu repositório GitHub, mantendo os caminhos `public/`, `tests/` e `docs/`. Não coloque `index.html` nem `app.js` na raiz do repositório. Após o deploy no Render, valide o placar numa sala real pelo celular.

## Restrições preservadas

Tamanho das cartas, dimensões da mesa, jogadas especiais, botões flutuantes, placar do observador e regras multiplayer não foram modificados.

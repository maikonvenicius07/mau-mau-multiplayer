# MAU-MAU CANDEIAS — V53.8 | Placar vertical compacto

## Diagnóstico

A V53.7 mantinha, para jogadores no celular, a faixa horizontal de cartões da V53.6, com instrução de deslizar. Havia várias regras CSS anteriores ainda presentes, com estilos de dimensões diferentes. O observador já tinha uma correção vertical, mas permanecia mais espaçoso que o necessário.

## Alterações

- **Jogador (celular/tablet até 768 px, incluindo celulares em paisagem):** um jogador por linha, avatar menor, nome truncado com reticências e pontuação `+rodada` e `total` alinhadas à direita. Sem rolagem horizontal. O quadro é tão alto quanto o conteúdo, com rolagem vertical limitada se houver jogadores demais para a tela.
- **Cabeçalho móvel:** `🏆 Placar` com X compacto; retirado o texto `deslize ↔`.
- **Controles:** X fecha o placar e o botão 📊 do topo reabre. A preferência de fechamento é mantida durante o mesmo contexto de partida.
- **Observador:** gaveta vertical com linhas e espaçamentos menores; título `🏆 Placar` em telas pequenas, mantendo um único X. Ao entrar como observador o placar é aberto uma única vez e pode ser fechado sem reaparecer em todo `state` recebido.
- **Computador:** preservado o comportamento e posicionamento da V53.7. Não se modifica o cálculo ou transmissão dos pontos.
- **Proteção contra cache:** identificadores de versão dos arquivos CSS e JS alterados no `public/index.html`.

## Escopo e preservação

A alteração restringe-se a `public/styles.css`, apresentação da função `renderScore()` e inicialização do placar no `public/app.js`, além do identificador de cache. **Não** foram alteradas a lógica da partida, a distribuição das cartas, seus tamanhos, as regras de Queima, Dupla ou Ação Rápida, nem a posição ou o arraste de controles flutuantes.

## Conferência

- Inspeção visual simulada em 320, 360, 390, 430, 560, 768 e 1280 px, além de 844 px na orientação horizontal.
- Cenários com dois e cinco jogadores, incluindo nomes extensos, e nos modos jogador e observador.
- Sem rolagem horizontal da página nos cenários conferidos.
- 157 testes locais independentes aprovados, inclusive teste novo da V53.8 que verifica pontos, cabeçalho e abertura única.
- O teste específico de integração Socket.IO **não foi executado** por falta da dependência `socket.io-client` no ambiente local; é indispensável validar uma partida conectada após a publicação.

## Instalação

Extraia o ZIP `SOMENTE_ALTERADOS` no repositório GitHub, respeitando as pastas `public`, `tests` e `docs`. Não mova `index.html` para a raiz do projeto. Publique a atualização e abra uma sessão nova no celular para não utilizar arquivos do cache antigo. Confirme o X, a reabertura e a pontuação em tempo real como jogador e observador.

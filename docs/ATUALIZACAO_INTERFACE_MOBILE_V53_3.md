# MAU-MAU CANDEIAS — V53.3: mão e botões responsivos

## Diagnóstico

- O CSS anterior continha várias regras mobile com `!important`, incluindo cartas largas (até ~25% da largura da tela) e sobreposição de apenas 9px. Em 390px, seis cartas frequentemente ultrapassavam a área visível.
- `renderHand()` ocultava `#passTurnBtn` fora de `playing`, embora o usuário devesse reconhecer esse controle antes da distribuição.
- `updateFloatingGameActions()` ocultava os atalhos de Queima, Carta Dupla e Ação Rápida fora da janela de disponibilidade; isso era correto para os atalhos, mas dificultava encontrar as funções. O seletor de duplas estava dentro de `.felt`, sujeita a recorte (`overflow:hidden`).

## Solução implementada

1. Cartas menores, preservando proporção, número e naipe. A mão calcula largura e sobreposição conforme viewport e número de cartas. Há um mínimo de **32px expostos por carta**; quando não é possível mostrar todas de uma vez, ativa-se a rolagem horizontal com indicação textual e sem rolar a página lateralmente.
2. **Mau-Mau, Batendo/Queima e Passar a vez** permanecem visíveis no painel do jogador. Suas regras de habilitação permanecem as mesmas; antes da distribuição aparecem desabilitados.
3. Uma faixa permanente com **Queima, ×2 Dupla e Ação Rápida** permanece visível. Os cliques chamam as funções originais do app, que continuam validando o estado e enviando os eventos existentes. Quando indisponíveis, botões desabilitados.
4. **No celular/tablet**, os atalhos flutuantes especiais são substituídos visualmente pela faixa fixa, evitando botões sobre o feltro. **No desktop**, os atalhos flutuantes e arrastáveis continuam funcionando. O seletor de múltiplas duplas foi transferido para fora da mesa e posicionado em relação ao botão efetivamente visível.
5. Controles de teclado adicionados às cartas jogáveis (Enter/Espaço); não se altera a ordem nem a autorização das jogadas.
6. Modo observador mantém sua interface isolada; `#handPanel` permanece oculto para observadores.

## Arquivos modificados

- `public/index.html`
- `public/styles.css`
- `public/app.js`
- `tests/hand-responsive-controls-v53-3.test.js` (novo)
- `docs/ATUALIZACAO_INTERFACE_MOBILE_V53_3.md` (novo)

## Teste visual

Simulações em Chromium headless com viewport 320, 390, 768, 820 (paisagem) e 1280px; com 6, 10 e 16 cartas. Em 390px, 6 e 10 cartas cabem, 16 ficam navegáveis pela rolagem com aviso; a largura do documento permanece contida no viewport.

## Deploy

O pacote parcial contém os caminhos corretos para copiar por cima do projeto, **sem colocar `index.html` na raiz**. Recomenda-se substituir os arquivos alterados no GitHub e deixar o Render implantar normalmente. Atualizar a página do celular após publicação para obter CSS/JS com nova versão de cache.

**Limitação da verificação neste ambiente:** a suíte de integração Socket.IO requer `socket.io-client`, que não estava instalado e não pôde ser instalado offline; os testes independentes de dependências externas são executados separadamente.

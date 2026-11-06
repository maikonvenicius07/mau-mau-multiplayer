# MAU-MAU CANDEIAS — V53.4: posicionar ações antes da distribuição

## Pedido implementado

- O tamanho e a organização adaptável das cartas da V53.3 permanecem **inalterados**.
- A faixa fixa de ações especiais da V53.3 foi **removida**.
- Os **três botões flutuantes originais** (Queima, Carta Dupla ×2, Ação Rápida) aparecem durante o lobby, **antes da distribuição**, para cada jogador escolher suas posições arrastando. Também aparecem nos intervalos entre rodadas para novos ajustes.
- Quando a rodada inicia, os três controles desaparecem se suas funções estiverem indisponíveis. Aparecem **somente** quando a ação é autorizada pelo jogo; desaparecem novamente quando não pode ser executada.
- Posições continuam salvas **localmente no mesmo dispositivo/navegador** usando as chaves já existentes (sem perder ajustes anteriores). Duplo toque restaura a posição padrão.
- Na preparação, um toque no controle dá instrução de arraste, não aciona nenhuma jogada.
- Os controles são filhos da tela principal, não do feltro com `overflow:hidden`, para evitar recorte nos dispositivos móveis. O seletor de Carta Dupla continua fora do feltro e abre junto ao botão flutuante.
- Observador não vê os três controles de jogador. As regras de jogo e eventos de rede não foram alterados.

## Instalação

Atualize os arquivos pelos caminhos do ZIP, preservando `public/`, `tests/`, `docs/` na raiz **sem duplicar arquivos em outras pastas**. O projeto completo inclui a V53.4, e o pacote parcial traz só os arquivos novos ou modificados.

## Testes

A nova suíte `tests/predeal-floating-actions-v53-4.test.js` cobre lobby, intervalo, rodada em andamento, ações autorizadas, pausa, desconexão e observador; o teste V53.3 da mão compacta foi atualizado para a ausência da faixa fixa. Recomendado validar o arraste com touch no celular e o fluxo real de partida no servidor.

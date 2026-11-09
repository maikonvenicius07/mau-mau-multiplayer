# MAU-MAU CANDEIAS — V53.5: organizar microfone, câmera e Trocar lados

## Alteração

Ao entrar na partida, os três botões flutuantes agora procuram uma posição sem sobreposição.

- **Microfone:** alto à esquerda.
- **Trocar lados:** à direita do microfone.
- **Câmera:** abaixo do microfone.
- Em telas estreitas, os controles continuam compactos; onde houver espaço, os rótulos de microfone e câmera são exibidos por completo.
- Se uma posição já foi salva manualmente no navegador e não conflita com os outros botões, ela é respeitada. Posições antigas que se sobrepõem são corrigidas automaticamente no início da partida.
- Os botões permanecem arrastáveis; não há alterações nas regras do jogo, nas cartas ou na comunicação de câmera e microfone.

## Arquivos da atualização

- `public/index.html`
- `public/styles.css`
- `public/controls-positioning.js` (novo)
- `docs/ATUALIZACAO_LAYOUT_MIC_CAMERA_TROCA_LADOS_V53_5.md` (instruções)

Copie os caminhos acima para a raiz do repositório no GitHub, mantendo as pastas.
Não coloque `index.html` na raiz: o arquivo correto é `public/index.html`.

## Validação

- Teste visual isolado no Chromium: larguras 320, 390, 529 e 1280 px.
- Teste com as três posições anteriormente salvas no mesmo ponto: correção de colisão confirmada.
- `node --check public/controls-positioning.js`: aprovado.
- 154 testes independentes do projeto: aprovados.
- A suíte completa não concluiu o teste `socketio-integration-v4063.test.js` porque `socket.io-client` não está instalado no ambiente de execução.

Depois de publicar, valide em uma partida real no celular, inclusive com a câmera ativada e com os botões movidos manualmente.

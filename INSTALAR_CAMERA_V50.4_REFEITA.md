# MAU-MAU CANDEIAS V50.4 — câmeras dos adversários maiores (reconstruída)

## Base correta

Esta edição foi feita diretamente sobre o ZIP `mau-mau-multiplayer-main (7)(4).zip` enviado em 16/10/2026, que contém a câmera funcional da V50.3 (troca frontal/traseira, janela própria arrastável e áudio atual). **Desconsidere o pacote V50.4 anterior**. Esta atualização NÃO foi construída em cima dele.

## Funcionalidades

- Adversário com vídeo ativo: círculo de aproximadamente 96 px no desktop, 66 px em telas intermediárias e 60 px em celulares estreitos (abaixo de 521 px).
- Ao tocar/clicar no vídeo de outro jogador: ampliação temporária de até 400 px, com botão de fechar, clique no fundo ou tecla Esc.
- A janela grande utiliza a MESMA `MediaStream` já recebida pelo LiveKit; NÃO se abre uma segunda transmissão.
- Sem câmera ativa, permanecem o avatar e o tamanho originais.
- A quantidade de cartas continua visível; os assentos das extremidades são reposicionados discretamente para evitar corte.
- A câmera própria flutuante, o botão de alternar entre frontal/traseira, o microfone, os bots, as regras e a reconexão permanecem como na base recebida.
- **Sem gravações**. Nada é enviado ao PostgreSQL, salvo em arquivo ou armazenado como vídeo no Render.

## Arquivos que mudaram

- `public/styles.css` — dimensões responsivas, proteção da contagem de cartas e modal.
- `public/index.html` — elemento de ampliação e atualização da versão dos recursos para evitar cache antigo.
- `public/camera-video.js` — abrir/fechar ampliação, tratar desconexão e preservar a transmissão existente.
- `tests/camera-v504-larger-opponents.test.js` — verificações de regressão.
- `INSTALAR_CAMERA_V50.4_REFEITA.md` — estas instruções.

## Atualização pelo GitHub

1. Guarde uma cópia da versão atualmente em produção.
2. No pacote **ATUALIZACAO**, substitua os arquivos conforme suas pastas e adicione o novo teste/documento.
3. Faça commit e aguarde o deploy do Render.
4. Caso o navegador exiba a interface antiga, atualize a página (Ctrl+F5). Os recursos receberam nova versão na URL.
5. Entre em uma sala com dois celulares, ligue as câmeras e confira: vídeo ampliado, contagem de cartas, fechamento com X, troca frontal/traseira, botão flutuante e microfone.

Não há novas variáveis de ambiente ou alterações nas credenciais do LiveKit.

## Testes e limites

Verificações de sintaxe JavaScript e testes V50.1/V50.2/V50.3 executados. Teste visual com Chromium simulado em 1280, 390 e 360 px confirmou expansão e fechamento, sem LiveKit real. O teste de integração com `socket.io-client` não executa neste ambiente por falta da dependência; faça a validação final em uma partida real antes de considerar a implantação concluída.

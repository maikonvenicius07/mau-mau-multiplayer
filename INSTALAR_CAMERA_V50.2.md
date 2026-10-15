# MAU-MAU CANDEIAS — V50.2 Câmera flutuante arrastável

## O que mudou

- **Botão da câmera flutuante**: pode ser arrastado com o mouse no computador ou com o dedo no celular, como o botão do microfone.
- **Sua prévia de câmera flutuante**: quando você liga a câmera, sua própria imagem aparece em uma janela circular arrastável. Antes, essa prévia aparecia somente no celular; agora também aparece no computador.
- As **posições são lembradas** separadamente para tela de celular e de computador, no armazenamento local do próprio navegador. **Apenas duas coordenadas (x e y) por elemento são guardadas**, não imagens, vídeos, voz nem arquivos.
- Ao arrastar o botão, **não liga nem desliga a câmera acidentalmente**. Para ligar ou desligar, toque/clique sem arrastar.
- A prévia fica dentro da tela e ajusta a posição quando a janela é redimensionada. O jogo mantém vídeo dos outros jogadores sobre os avatares, como na V50.1.
- Câmera continua opcional. Ao desligar ou sair da sala, o vídeo é parado conforme o funcionamento da V50.1.
- **Nenhuma gravação de vídeo é implementada ou armazenada no projeto**, Render, Socket.IO ou PostgreSQL. A LiveKit continua transportando o vídeo ao vivo. Outros participantes ainda podem capturar a tela por meios externos.

## Arquivos novos/alterados

1. `public/camera-floating.js` — novo controlador independente para posição e arraste.
2. `public/camera-video.js` — prévia própria visível também no computador; reposicionamento após ser exibida.
3. `public/index.html` — marcador de arraste, novo script, atualização de versão para evitar cache antigo.
4. `public/styles.css` — aparência flutuante e suporte ao toque.
5. `tests/camera-v501-contract.test.js` — atualiza a verificação do nome de recurso.
6. `tests/camera-v502-floating.test.js` — novo teste de movimento, limites, persistência e prevenção de clique.
7. `INSTALAR_CAMERA_V50.2.md` — este guia.

**Não foram alterados** `server.js`, as regras das cartas, bots, ranking, microfone e as credenciais LiveKit. Não há novas dependências npm.

## Instalação no GitHub / Render

1. Faça backup da versão atualmente em produção.
2. **ZIP de atualização**: extraia e substitua somente os arquivos indicados, preservando os diretórios `public/` e `tests/`. Se estiver usando a interface web do GitHub, carregue cada arquivo na pasta correspondente — não jogue tudo na raiz.
3. Alternativamente, utilize o **ZIP completo** como base do projeto.
4. Faça o commit no GitHub; aguarde o Render concluir o novo deploy.
5. Não é necessário mudar `LIVEKIT_URL`, `LIVEKIT_API_KEY` nem `LIVEKIT_API_SECRET` que já funcionam. Jamais inclua valores dessas variáveis no ZIP ou no GitHub.
6. Abra o jogo com **F5 / atualização forçada**, de preferência em dois dispositivos para testar transmissão real.

## Como usar

- Toque em **📷 LIGAR CÂMERA** para ativar a câmera; toque de novo para desativar.
- Segure e arraste o **botão da câmera** para qualquer posição segura dentro da janela.
- Com a câmera ligada, segure e arraste o **círculo com a sua imagem** para reposicioná-lo independentemente do botão.
- As posições são lembradas no mesmo navegador/dispositivo. Apagar os dados do site remove essas preferências e as posições voltam ao padrão.
- O recurso não move nem altera as cartas, o microfone, os assentos ou a visualização do vídeo dos outros jogadores sobre seus avatares.

## Validação

- Sintaxe: `node --check public/camera-video.js && node --check public/camera-floating.js`.
- Contratos: `node tests/camera-v501-contract.test.js && node tests/camera-v502-floating.test.js`.
- Teste visual de arraste e recuperação de posição realizado em Chromium; a transmissão real com LiveKit ainda precisa ser validada no Render.
- Suíte de 111 testes: 110 passaram individualmente; o teste `socketio-integration-v4063.test.js` não executou porque faltava `socket.io-client` no ambiente de auditoria. Isso não significa reprovação do código do jogo.

**Recomendação de teste em produção**: dois jogadores com câmera, testes de arraste no Chrome Android e Safari do iPhone, mudança de orientação, F5, observador e reconexão após 60 segundos.

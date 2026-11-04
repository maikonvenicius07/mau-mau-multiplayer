# MAU-MAU CANDEIAS — Fase 5A | Cache e entrega de arquivos

Base: projeto completo da Fase 4C. Todas as fases anteriores foram preservadas.

## Problemas detectados
- `public/index.html` contém versões de CSS/JS escritas manualmente em `?v=...`, sujeitas a esquecimento quando um arquivo muda.
- `server.js` já revalidava JS/CSS, mas o documento HTML e o manifesto não possuíam versionamento automático por conteúdo.
- Ícones em `/assets/app/` recebiam a mesma política de cache longo dos avatares. Isso podia atrasar a atualização de ícones substituídos com o mesmo nome.
- O projeto possui manifesto PWA, mas NÃO registra Service Worker próprio. Não há cache offline controlado por SW para atualizar nesta etapa.

## Solução Fase 5A
- Novo módulo `static-asset-versioning.js` calcula SHA-256 curto (12 caracteres) dos arquivos locais permitidos, uma vez ao iniciar o servidor.
- `server.js` serve `/` e `/index.html` com o HTML original, apenas substituindo as versões de CSS, JS, manifesto e ícones por hashes do conteúdo atual.
- HTML é `no-cache, must-revalidate` e permite revalidação por ETag automática do Express.
- JS/CSS continuam com `no-cache, must-revalidate`; não se impôs re-download integral se não mudaram.
- Manifesto e ícones do aplicativo agora são revalidados. Avatares mantêm a política anterior.
- Sem alteração nas URLs de Socket.IO, Google, de salas ou na lógica do jogo.

## Arquivos para subir ao GitHub
1. `server.js` (substituir)
2. `static-asset-versioning.js` (adicionar na raiz)
3. `tests/static-assets-cache-phase5a.test.js` (adicionar, opcional mas recomendado)
4. Estes arquivos de instruções/validação, se desejar manter histórico.

**Não altere `public/index.html` nem `public/styles.css` manualmente**: o versionamento será atualizado a cada deploy com reinício do processo servidor.

## Checklist após deploy no Render
1. Render: confirmar `Build successful` e `Your service is live`.
2. Abrir `https://jogo.maumaucandeias.com.br` e atualizar a página uma vez.
3. No navegador, verificar que `styles.css?v=` e `app.js?v=` possuem hash hexadecimal de 12 caracteres.
4. Abrir a página em 2 celulares: login, sala pública/privada, partida e reconexão.
5. Conferir microfone, câmera, observadores, ranking e matchmaking após navegação/atualização da página.
6. Se houver erro, voltar ao ZIP completo Fase 4C ou reverter o commit desta fase.

**Limites:** nenhum Service Worker novo, nenhum modo offline, nenhum bundler e nenhuma mudança em comunicação Socket.IO ou persistência. A melhora principal é confiabilidade de atualização de CSS/JS/PWA; ganhos de velocidade de rede precisam ser medidos no aparelho. O teste de servidor HTTP com Express real e integração Socket.IO foi impedido pela ausência de dependências instaladas neste ambiente; no Render o npm ci instala as dependências do package-lock.

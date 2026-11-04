# MAU-MAU CANDEIAS — Fase 5B | Carregamento inicial leve (mobile)

Base: Fase 5A completa, com as otimizações anteriores preservadas.

## O que foi alterado

- O logotipo visual usado no splash e na marca da interface usa agora `/assets/app/logo-display-512.webp`, com 512 × 512 px e qualidade alta. O PNG de 512 px permanece intacto para PWA/ícones.
- Os 17 thumbnails no seletor de avatares receberam `loading="lazy"` e `decoding="async"`. Quando visíveis, os avatares continuam com os mesmos arquivos e controles.
- `static-asset-versioning.js` passa a versionar também o novo WebP com SHA-256 curto na URL entregue pelo servidor.
- Nenhum script, listener, evento, regra, protocolo, CSS de layout, sistema de cache offline ou função de servidor foi alterado.

## Arquivos modificados/adicionados no GitHub

1. `public/index.html` — substituir (fonte do logo e atributos de imagens)
2. `public/styles.css` — substituir (somente URL do logo de marca)
3. `static-asset-versioning.js` — substituir (versionamento de WebP)
4. `public/assets/app/logo-display-512.webp` — adicionar
5. `tests/initial-loading-phase5b.test.js` — adicionar (teste novo)

## Como instalar

1. Parta do projeto que já contenha a Fase 5A. Se não tiver certeza, use o ZIP completo desta fase.
2. Copie os arquivos do ZIP de atualização respeitando as pastas.
3. Faça commit no GitHub e confirme o novo deploy no Render.
4. No celular, feche e abra a página do jogo para obter o HTML e o CSS atualizados.
5. Confira visualmente logotipo, login, seleção de avatar, sala e mesa. No DevTools > Rede, verifique a solicitação `logo-display-512.webp?v=<hash>`.
6. Role até o seletor de avatares e confirme que as imagens surgem normalmente e que a seleção/customização funciona.

## Validação após o deploy

- Login Google e e-mail/senha
- Avatar padrão, troca de avatar e figurinha própria
- Criação e entrada em sala pública/privada; observador
- Partida com dois aparelhos, reconexão e mudança de turno
- Microfone, câmera, matchmaking e ranking
- Monitoramento de erros no console e logs do Render

## Como voltar

Reverter somente os arquivos listados acima para a Fase 5A (ou usar o ZIP completo da Fase 5A).

## Limitações

- Em navegador automatizado deste ambiente, a navegação para páginas locais foi bloqueada por política do ambiente. Não foram medidos tempos reais de carregamento nem tráfego de rede.
- A melhoria demonstrada aqui é redução do tamanho do recurso de logo. A efetiva economia dos avatares depende do navegador e da posição da seleção no viewport.
- `styles.css`, `app.js` e `index.html` continuam com o peso anterior; uma reorganização/bundle/minificação exigiria testes específicos em outra versão.
- A compressão HTTP pode já ocorrer no proxy Render e precisa ser medida no ambiente real antes de qualquer mudança de servidor.

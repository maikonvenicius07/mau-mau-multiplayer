# MAU-MAU CANDEIAS — Hotfix visual V40.69.8.4.1

**Base:** projeto completo V40.69.8.4 (`40.69.8-rank.4` no package.json).  
**Escopo:** retirada integral do bloco informativo azul mostrado no centro da mesa após a compra de uma carta.  
**Estado:** alteração implementada e validada localmente; implantação no Render e conferência visual com celulares reais pendentes.

## Alterações realizadas

- `public/index.html`: removido completamente o elemento `#drawChoice` e seu texto "Carta comprada: você pode jogar QUALQUER carta válida...".
- `public/app.js`: retirado o código que calculava a exibição e manipulava o elemento removido (evita erros JavaScript pelo ID inexistente).
- `public/styles.css`: retirados os estilos e seletores exclusivos do aviso, sem alterar os estilos compartilhados com penalidades e o naipe solicitado.
- `tests/remove-draw-notice-ui-hotfix.test.js`: novo teste de regressão para confirmar a ausência integral do aviso e a presença dos controles essenciais.
- `docs/RELATORIO_HOTFIX_UI_V40_69_8_4_1.md`: relatório deste ajuste.

## O que NÃO foi alterado

- Nenhuma função em `game-engine.js`, `server.js` ou nos arquivos de ranking foi modificada.
- Regras de compra, jogar ou passar, penalidades e pontuação permanecem idênticas.
- Botões Comprar carta e Passar a vez continuam na interface.
- Nenhum aviso alternativo (toast, texto curto ou temporário) foi criado.
- Mantida a identificação de pacote `40.69.8-rank.4` para evitar alterações em cerca de 30 testes antigos acoplados à versão: este arquivo identifica o hotfix visual **V40.69.8.4.1**, aplicado sobre a mesma versão de motor.

## Testes realmente executados

- Teste novo `remove-draw-notice-ui-hotfix.test.js`: aprovado.
- Suíte de arquivos `tests/*.test.js` executáveis localmente: **170 aprovados, 0 falhas**.
- `socketio-integration-v4063.test.js`: **não executado**, porque `socket.io-client` não estava instalado no ambiente local.
- `node --check public/app.js`: aprovado.
- `node scripts/check-lockfile.js`: aprovado.
- Comparação binária com a base: `game-engine.js`, `server.js`, `ranking-store.js`, `ranking-performance.js`, `ranking-skill.js`, `package.json` e `package-lock.json` inalterados.
- Sem testes no Render, no navegador real ou nos celulares nesta execução.

## Implantação

1. Faça backup/commit da versão atualmente publicada.
2. Use o ZIP incremental **somente se a branch em produção for a V40.69.8.4**; caso contrário, compare os arquivos, pois a atualização substitui `public/index.html`, `public/app.js` e `public/styles.css`.
3. Copie os arquivos e pastas da raiz `mau-mau-multiplayer-main/` para a raiz do repositório no GitHub.
4. Confira GitHub Actions e Render; entre em uma partida, compre uma carta e certifique-se de que o aviso azul não apareça e que Comprar, Jogar e Passar continuem funcionando.
5. Faça também uma conferência em celular com a mesa contendo muitas cartas e com penalidade de 7.

**Nota:** a explicação detalhada da regra continua no manual/ajuda do jogo e nos logs das ações; somente o painel azul da mesa foi removido.

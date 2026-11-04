# MAU-MAU CANDEIAS V53.2.1 — correção da instalação (sem mudança de regras)

## Problema confirmado no ZIP (23)
A atualização V53.2 teve três arquivos colocados na **raiz** do repositório, e não nas pastas corretas.
Isso criou um `index.html` duplicado que faz falhar `tests/project-cleanliness-v4041.test.js`.
O motor de jogo `game-engine.js` já está atualizado e não precisa ser substituído.

## AÇÃO OBRIGATÓRIA NO GITHUB — apague estes três arquivos da RAIZ
1. `index.html` (o arquivo da raiz, NÃO o `public/index.html`)
2. `REGRAS.md` (o arquivo da raiz, NÃO o `docs/REGRAS.md`)
3. `quick-action-own-top-after-draw-v53-2.test.js` (o arquivo da raiz, NÃO o `tests/...`)

No GitHub, abra cada arquivo da raiz, escolha a opção de excluir e confirme o commit.
Não apague as pastas `public`, `docs` ou `tests`.

## ENVIE ESTES ARQUIVOS do ZIP de atualização aos caminhos certos
- `public/index.html` (substituir)
- `docs/REGRAS.md` (substituir)
- `tests/quick-action-own-top-after-draw-v53-2.test.js` (adicionar)

Confirme que os nomes dos arquivos não aparecem **novamente na raiz**.

## Conferência
- No projeto, deve existir somente `public/index.html` (não deve haver `index.html` na raiz).
- No Render, teste se o build conclui sem `AssertionError: não deve existir index.html duplicado na raiz`.
- Execute `npm test` em um ambiente com dependências instaladas.
- Na partida real: o autor do 4♥ descarta o segundo 4♥ fora da vez, após a compra do próximo jogador; a vez de quem comprou não muda, a menos que o descarte rápido encerre a rodada.

## Testes feitos nesta análise
152 de 153 testes executados e aprovados; o teste Socket.IO não pôde rodar localmente por falta de `socket.io-client`.
A correção de caminhos foi comparada byte a byte com a V53.2 de referência; todos os arquivos de execução coincidem.

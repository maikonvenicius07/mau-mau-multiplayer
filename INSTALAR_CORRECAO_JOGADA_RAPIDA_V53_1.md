# Instalação — MAU-MAU CANDEIAS V53.1 (Ação Rápida após compra)

**Projeto-base:** `mau-mau-multiplayer-main (21).zip` (V53.0).

1. Abra o arquivo **ATUALIZACAO** e envie os arquivos para o GitHub, mantendo os mesmos caminhos.
2. Substitua `game-engine.js`, `public/app.js`, `public/index.html`, `docs/REGRAS.md`, `tests/engine.test.js`, `CHANGELOG.md`.
3. Adicione `tests/quick-action-after-draw-v53-1.test.js`, este manual e o relatório técnico.
4. Faça commit e aguarde o Render publicar a nova versão.
5. Teste Ação Rápida antes, durante e após uma compra normal. Em seguida, teste o passe sem trocar o topo; confira que a reação não rouba a vez.
6. Verifique Queima, Carta Dupla, cadeia de 7, primeiro descarte e início de rodada.

**Não adicione scripts ou dependências.** O Servidor e o código de Socket.IO não foram modificados. A Fase 6B e os níveis do robô continuam preservados.

Para recuperar a versão anterior, restaure esses arquivos a partir do ZIP do seu projeto enviado.

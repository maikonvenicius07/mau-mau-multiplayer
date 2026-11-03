# MAU-MAU CANDEIAS — Otimização Fase 1 (front-end)

Esta versão foi feita com base no arquivo `mau-mau-multiplayer-main (17)(1).zip`.

## Arquivos alterados

- `public/app.js`: renderização seletiva por componente; contadores ociosos sob demanda; invalidação de assinaturas ao sair/reconectar/trocar papel/novo avatar.
- `public/index.html`: alteração **apenas** da versão do endereço do script `app.js` para evitar cache antigo em celulares.
- `tests/performance-selective-render-phase1.test.js`: teste adicional de não reconstrução e timers.
- `RELATORIO_AUDITORIA_DESEMPENHO_MAU-MAU.md`: relatório anterior às mudanças.
- `VALIDACAO_OTIMIZACAO_FASE1.md`: evidências e plano de testes de produção.

## Procedimento de atualização

1. Faça backup/guarde o commit anterior no GitHub.
2. Descompacte **somente** o pacote de atualização e preserve os caminhos.
3. Substitua `public/app.js` e `public/index.html` e adicione o arquivo de teste e os documentos.
4. Faça commit, confirme o deploy no Render e recarregue no celular.
5. Teste partida, observador, reconexão, câmera e voz com pelo menos dois aparelhos antes de considerar a versão validada.
6. Se aparecer regressão, faça rollback para o commit anterior. Não é necessário migrar PostgreSQL.

## O que NÃO mudou

Sem mudanças em `game-engine.js`, `server.js`, regras, modelo de banco de dados, CSS, WebRTC, LiveKit, protocolo Socket.IO ou autenticação.

## Limites da validação local

A suíte de 139 testes contém 1 teste de integração Socket.IO que exige `socket.io-client` instalado, ausente neste ambiente. Os 138 demais testes executados passaram. Não foram executados cenários reais de rede móvel, webcam, microfone ou PostgreSQL no Render.

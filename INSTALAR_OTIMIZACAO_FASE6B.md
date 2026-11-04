# Instalação — MAU-MAU CANDEIAS, Fase 6B

**Pré-requisito:** Fase 6A já instalada no GitHub/Render.

## Pacote de atualização

1. Faça um backup ou marque o commit atual no GitHub.
2. No repositório, substitua **somente `public/app.js`** pelo arquivo incluído neste ZIP.
3. Adicione `tests/performance-memory-phase6b.test.js` e os documentos desta fase. Não altere o restante do projeto.
4. Faça o commit, aguarde o deploy do Render e abra o jogo novamente no celular. O versionamento automático da Fase 5A identifica a mudança do JavaScript.
5. Siga o checklist do relatório final antes de considerar a fase validada em produção.

## Reversão

Se surgir regressão, volte **somente `public/app.js`** à versão do commit da Fase 6A. Não é necessário restaurar tabelas, alterar PostgreSQL ou modificar o motor de cartas.

**Observação:** o ZIP completo inclui todo o código da Fase 6A e as melhorias 6B; use-o apenas para uma instalação integral. Não sobrescreva arquivos personalizados do repositório sem conferir as diferenças.

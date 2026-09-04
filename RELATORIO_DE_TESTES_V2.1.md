# Relatório de testes — AutoAgenda V2.1

## Testes executados antes da entrega

- `node --check server.js`: aprovado.
- `node --check public/app.js`: aprovado.
- `npm run check`: aprovado.
- Verificação de IDs HTML: nenhum ID duplicado.
- Verificação das referências diretas principais do JavaScript para IDs do HTML: sem ausência real identificada.
- Verificação da migração `reposicao_de_id`: presente no `server.js` e no `sql/schema.sql`.
- Verificação da chave estrangeira de autorreferência: presente com `ON DELETE RESTRICT`.
- Verificação do índice de reposição: presente.
- Verificação da rota `POST /api/aulas/:id/reposicao`: presente.
- Verificação de bloqueio de reposição duplicada ativa: presente.
- Verificação de preservação do histórico: a rota cria nova aula e não altera/apaga a aula original.

## Limitação do teste local

Não foi utilizada a `DATABASE_URL` privada do ambiente de produção. Portanto, o teste final de integração com PostgreSQL deve ser feito após o deploy no Render, seguindo o `CHECKLIST_V2.1.md`.

# AutoAgenda V2.1 — Reagendamento Inteligente

Sistema web para organização de aulas práticas com alunos, planos automáticos, agenda diária/semanal, configurações, disponibilidade de instrutores e veículos e busca de horários livres.

## Novidades da V2.1

- Reagendamento inteligente para aulas com status **CANCELADA** ou **FALTOU**.
- Ao marcar uma aula como cancelada/faltou, o sistema oferece procurar uma reposição imediatamente.
- Botão **↪️ Repor** usa o motor de horários livres e mostra até 5 opções válidas.
- A nova aula fica vinculada à aula original por `reposicao_de_id`.
- A aula original permanece no PostgreSQL e no histórico; nunca é substituída.
- O sistema impede duas reposições ativas para a mesma aula original.
- Reposição respeita saldo do aluno, funcionamento, disponibilidade do instrutor, veículo, manutenção, folgas e conflitos.
- Aulas de reposição recebem identificação visual na agenda.

## Atualização

Substitua os arquivos da versão anterior pelos desta pasta, faça commit no GitHub e aguarde o deploy do Render.

Não é necessário executar `schema.sql` manualmente. O `server.js` faz a migração automática e cria o vínculo de reposição com segurança.

## Variáveis de ambiente

Obrigatórias em produção:

- `DATABASE_URL`
- `NODE_ENV=production`
- `AUTOAGENDA_USER`
- `AUTOAGENDA_PASSWORD`

Recomendada:

- `APP_TIMEZONE=America/Porto_Velho`

## Versão

**2.1.0**

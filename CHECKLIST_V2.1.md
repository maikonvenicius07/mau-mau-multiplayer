# Checklist de testes — AutoAgenda V2.1

## Deploy
- [ ] Render concluiu o deploy sem erro.
- [ ] O topo mostra AutoAgenda V2.1.0.
- [ ] Login continua funcionando.
- [ ] Alunos, aulas, planos, instrutores e veículos antigos continuam aparecendo.

## Reagendamento inteligente
- [ ] Alterar uma aula válida para CANCELADA.
- [ ] Confirmar que o sistema oferece procurar reposição.
- [ ] Confirmar que aparecem até 5 horários disponíveis.
- [ ] Escolher um horário e confirmar a nova aula.
- [ ] Confirmar que a nova aula aparece com indicação de reposição.
- [ ] Confirmar que a aula original continua preservada.
- [ ] Confirmar que a aula original mostra que já existe reposição ativa.
- [ ] Tentar criar uma segunda reposição para a mesma aula e confirmar o bloqueio.

## Falta
- [ ] Marcar uma aula de hoje/passada como FALTOU.
- [ ] Usar o botão ↪️ Repor.
- [ ] Criar uma reposição e confirmar o vínculo.

## Regras de disponibilidade
- [ ] Confirmar que não sugere horário com instrutor indisponível.
- [ ] Confirmar que não sugere horário durante folga/férias.
- [ ] Confirmar que não sugere veículo em manutenção/indisponível.
- [ ] Confirmar que respeita o horário de funcionamento.
- [ ] Confirmar que respeita conflito de aluno, instrutor e veículo.
- [ ] Confirmar que respeita o saldo do aluno.

## Regressão
- [ ] Nova aula manual continua funcionando.
- [ ] Plano automático continua funcionando.
- [ ] Agenda diária e semanal continuam funcionando.
- [ ] Encontrar horário livre normal continua funcionando.
- [ ] Configurações continuam funcionando.

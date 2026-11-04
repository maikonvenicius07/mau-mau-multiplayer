# MAU-MAU CANDEIAS — Fase 6A: pool PostgreSQL compartilhado

## Instalação no GitHub (partindo da Fase 5C)

Use o ZIP **ATUALIZACAO** e copie os arquivos para os mesmos caminhos no repositório:

- `server.js` (substituir)
- `database-pool.js` (novo na raiz)
- `ranking-store.js` (substituir)
- `auth-identity-store.js` (substituir)
- `room-snapshot-store.js` (substituir)
- `tournament-store.js` (substituir)
- `tests/database-shared-pool-phase6a.test.js` (novo)
- Este documento e `VALIDACAO_OTIMIZACAO_FASE6A.md` (opcionais no deploy)

Faça commit e aguarde o deploy do Render. **Não altere `DATABASE_URL`, tabelas ou dados.**

## O que mudou

Antes o servidor criava pools PostgreSQL independentes para ranking, identidade, snapshots e inscrições de torneios (cada um com limite padrão do `pg`, até 10 conexões). Agora o `server.js` cria **um único pool por processo** e o injeta nesses quatro armazenamentos. Catálogo, sorteios, jogos e chaves dos torneios já reutilizavam o pool de inscrições e continuam assim.

O modo JSON sem `DATABASE_URL` permanece igual. As consultas, transações, SSL e parâmetros de pool existentes foram preservados. Não há migração de banco.

O pool compartilhado não é encerrado por cada armazenamento; o servidor o encerra uma vez após salvar os snapshots no desligamento.

## Verificação recomendada no Render

1. Confirme inicialização sem erros de PostgreSQL e status **live**.
2. Faça login e recuperação de senha (com conta de teste).
3. Abra o ranking e as informações do perfil.
4. Crie uma sala, jogue algumas cartas, force reinício e teste restauração/reconexão.
5. Teste a inscrição, criação e sorteio de torneios com dados de teste.
6. Observe conexões ativas e espera por conexões em métricas do PostgreSQL antes/depois. Sob carga intensa, o pool único padrão (máximo de 10 conexões) pode gerar fila; acompanhe latência.

## Reversão

Se alguma operação de banco falhar no Render, restaure os arquivos originais da **Fase 5C**, publique novamente e investigue os logs, sem alterar a base de dados.

## Limitações dos testes

A regressão local usou modo JSON e pool PostgreSQL simulado. Não foi possível testar um PostgreSQL real nem a integração Socket.IO nesta máquina porque dependências/serviços não estavam disponíveis. Teste partida real com áudio e câmera após o deploy.

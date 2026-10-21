# MAU-MAU CANDEIAS — V51.1 Preparação para Torneios

Base: V51.0.4 — Histórico de Vitórias Organizado.

## O que a versão faz

- Novo botão **🏆 Torneios** dentro do Ranking, sem adicionar botões ao menu inicial.
- Mostra nome do campeonato, data prevista (se configurada), quantidade de inscrições e nomes dos inscritos.
- Jogadores com conta autenticada podem se inscrever ou cancelar a inscrição, enquanto o período estiver aberto.
- Uma inscrição por conta; limite padrão de 20 participantes. Inscrições ficam fechadas por padrão.
- No PostgreSQL cria somente a tabela independente `mm_tournament_signups`. Não altera `mm_matches`, `mm_match_results`, vitórias nem estatísticas existentes.
- Ainda NÃO cria mesas, sorteia chaves, agenda partidas ou declara campeões. Essas regras dependem do regulamento de torneio, a definir na próxima etapa.

## Como instalar

1. Substitua no GitHub os arquivos do ZIP de atualização, respeitando as pastas.
2. Aguarde o Render concluir o deploy. O servidor poderá criar a tabela independente se o usuário do PostgreSQL possuir as permissões necessárias.
3. Abra Ranking → Torneios. Inicialmente, aparecerá a inscrição fechada.
4. Quando quiser abrir as inscrições, entre em Render → Environment e configure:

```env
MAUMAU_TOURNAMENT_OPEN=1
MAUMAU_TOURNAMENT_ID=copa-candeias-1
MAUMAU_TOURNAMENT_NAME=Copa MAU-MAU CANDEIAS
MAUMAU_TOURNAMENT_CAPACITY=20
MAUMAU_TOURNAMENT_START_AT=2026-11-21T19:00:00-04:00
```

A data acima é apenas um exemplo. Use a data real do campeonato, quando estiver definida. Se ainda não houver data, deixe `MAUMAU_TOURNAMENT_START_AT` vazia. Para fechar inscrições, troque `MAUMAU_TOURNAMENT_OPEN` para `0`. Para uma edição futura independente, use outro `MAUMAU_TOURNAMENT_ID`.

**Não é necessário configurar LiveKit, câmeras ou microfones novamente.**

## Testes recomendados no Render

- Conta A entra e se inscreve → 1 inscrito.
- Conta A tenta se inscrever de novo → continua 1 inscrito.
- Conta B entra → vê o inscrito A, sem identificadores privados.
- Conta A cancela → inscrição é removida.
- Fechar inscrições no Render → novos pedidos são recusados.
- Reiniciar deploy → inscrições já gravadas no PostgreSQL continuam.

## Preservação

Os arquivos do motor de regras (`game-engine.js`), inteligência de bots (`bot-player.js`), snapshots e ranking não foram alterados. O torneio não registra mãos, cartas ou gravações, nem interfere no modo Oficial/Treino.

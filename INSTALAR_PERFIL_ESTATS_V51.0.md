# MAU-MAU CANDEIAS — V51.0 Perfil Estatístico Básico

**Base:** V50.5 (arquivo `mau-mau-multiplayer-main (10)(1).zip`).

Esta versão **não inclui** contadores de Queima, Jogada Rápida, Carta Dupla, penalidades ou rodadas vencidas. A atualização V51.0 anterior com esses contadores deve ser desconsiderada.

## Importante para quem já publicou a V51.0 anterior de contadores
Se você já colocou no GitHub o pacote antigo `V51_0_ESTATISTICAS` (Queimas, Jogadas Rápidas etc.), **exclua também**:
- `tests/stats-counters-v510.test.js` (teste da funcionalidade descartada);
- `INSTALAR_ESTATISTICAS_V51.0.md` (instrução antiga, que não se aplica mais).

O pacote de atualização inclui `game-engine.js` original da V50.5 para desfazer os contadores implementados anteriormente. Substitua também esse arquivo, mesmo que não tenha sido alterado nesta nova versão.

## Instalação
1. Utilize somente o pacote de atualização desta versão, substituindo os arquivos nas mesmas pastas do GitHub.
2. Aguarde o deploy no Render. Nenhuma variável nova é necessária.
3. Abra o MAU-MAU e clique em **📊 Meu Perfil**, na tela inicial ou a partir do Ranking.
4. Alterne entre **Oficial/Treino** e **Hoje/Semana/Mês/Temporada**.
5. Confira partidas, vitórias, aproveitamento, partidas sem vitória, posição média, pontos médios e as últimas 10 partidas registradas.

## Fonte e privacidade
Tudo é calculado com os resultados finais já existentes no PostgreSQL (`mm_matches` e `mm_match_results`). O endpoint `/api/me/stats` identifica a conta por cookie autenticado e não aceita escolher outra conta. Não há migração, limpeza de dados, gravações, histórico das cartas nem novos contadores.

## Observações
- Só entram partidas concluídas e registradas; partidas abandonadas podem não constar do histórico.
- A posição média e a média de pontos referem-se às partidas completas, não às rodadas isoladas.
- Na temporada inicial, o Histórico de temporadas encerradas continua indisponível.
- A implantação deve ser validada em produção com conta real e duas modalidades; os testes locais não substituem essa conferência.

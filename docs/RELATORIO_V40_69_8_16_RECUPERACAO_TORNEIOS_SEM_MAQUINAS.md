# MAU-MAU CANDEIAS — V40.69.8.16
## Relatório independente — Recuperação de torneios sem máquinas

**Data:** 16/11/2026  
**Versão-base:** V40.69.8.15 (ranking com resultados completos)  
**Escopo:** restauração de snapshots de torneios após queda/reinício do servidor.  
**Status:** correção implementada; testes locais aprovados; validação em PostgreSQL/Render ainda necessária.

### 1. Problema corrigido

Mesmo depois da implementação da desistência sem bots, uma lacuna no `RoomSnapshotStore.applyLifecycle()` ainda permitia que um jogador desistente reaparecesse como **Máquina**. O cenário acontecia quando o registro durável de abandono (*tombstone*) era gravado, mas o servidor caía **antes** de salvar o snapshot atualizado da sala.

O procedimento comum de recuperação convertia automaticamente a cadeira antiga em robô, sem distinguir se era uma mesa competitiva. Isso também fazia desaparecer a identidade do desistente do resultado oficial, podendo bloquear a classificação entre fases.

### 2. Correções implementadas

1. **Recuperação própria do torneio:** ao encontrar um abandono durável mais recente que o snapshot, o sistema aplica a lógica existente de desistência (`TournamentForfeit.forfeitActiveSeat`), em vez de chamar `convertStaleMembershipToBot`.
2. **Resultado completo:** mantém o registro de desistência em `room.tournament.forfeits`, com o `playerKey`, a pontuação disponível e a identidade original. O participante não ocupa a mesa nem avança de fase.
3. **Mesas com 2 pessoas:** se uma desiste durante partida ativa, o outro jogador vence por desistência e o resultado permanece pronto para gravação pendente.
4. **Mesas com 3–5 pessoas:** os remanescentes seguem jogando sem Máquina. A vez é recalculada pelo procedimento de desistência já existente.
5. **Abandono entre rodadas:** não reapresenta a cadeira desistente na rodada seguinte.
6. **Saída após a conclusão:** não desclassifica retroativamente quem saiu depois do término enquanto o resultado ainda aguarda confirmação; bloqueia sua reconexão à vaga já abandonada.
7. **Antes do primeiro início:** remove a cadeira abandonada sem criar Máquina; não inventa resultado ou substituto.
8. **Proteção de snapshots legados:** se um snapshot antigo de torneio *já contiver* `isBot` ou `autoControlled`, a recuperação automática dessa sala é suspensa e **o registro original não é apagado**, para conferência manual. Não é possível reconstruir com segurança a identidade e a pontuação de uma cadeira que já perdeu o `playerKey`.
9. **Isolamento de falhas:** se um snapshot de torneio estiver inconsistente, ele não paralisa a restauração das demais salas; os dados brutos ficam preservados.
10. **Salas comuns preservadas:** abandono durante partida comum continua seguindo o tratamento anterior de Máquina; regras das cartas, partidas normais, rankings, entrada automática, observadores e interface não foram alterados.

### 3. Arquivos criados ou modificados

| Caminho no projeto | Alteração |
|---|---|
| `room-snapshot-store.js` | Separação de recuperação de torneio e sala comum; reconstrução de desistência a partir do tombstone; proteção de snapshots competitivos inconsistentes. |
| `tests/tournament-snapshot-forfeit-recovery-v4069816.test.js` | **Novo:** testes de crash entre tombstone e snapshot, mesas com múltiplos jogadores, abandono em turno, entre rodadas, após término, quarentena de snapshot legado e regressão de sala comum. |
| `CHANGELOG.md` | Registro da nova versão. |
| `docs/RELATORIO_V40_69_8_16_RECUPERACAO_TORNEIOS_SEM_MAQUINAS.md` | Cópia do relatório de entrega para rastreabilidade dentro do projeto. |

**Arquivos excluídos:** nenhum.  
**Banco de dados:** nenhuma alteração de esquema ou migração nesta versão.

### 4. Testes executados

- `node --check server.js`: aprovado.
- `node --check room-snapshot-store.js`: aprovado.
- `node --check tournament-forfeit.js`: aprovado.
- `node --check tests/tournament-snapshot-forfeit-recovery-v4069816.test.js`: aprovado.
- `node scripts/check-lockfile.js`: aprovado.
- Suíte local: **190 arquivos de teste aprovados**, **0 falhas**.
- Teste de integração `tests/socketio-integration-v4063.test.js`: **não executado**, dependência `socket.io-client` ausente no ambiente de execução.

As simulações usam armazenamento local de snapshots e os módulos reais de recuperação/desistência; a persistência efetiva de um restart do Render utilizando PostgreSQL **não foi testada aqui**.

### 5. Cenários essenciais para homologar no Render

1. Instalar a V40.69.8.16 e confirmar que o deploy conclui com sucesso.
2. Torneio com 2 jogadores: um abandona durante a partida. Confirmar vitória por desistência, sem Máquina, e resultado completo.
3. Torneio com 4 jogadores: um abandona na vez, outros continuam, sem pular turno nem adicionar Máquina.
4. Reinício do serviço durante torneio com desistência recém-gravada: quem abandonou não deve retornar, o resultado deve continuar reconhecendo seu nome e o classificado deve seguir na competição.
5. Testar reconexão de quem **apenas perdeu a internet**, sem clicar em **Sair**; desconexão temporária não deve ser confundida com desistência antes do prazo previsto.
6. Conferir painel de torneios, observadores, sorteio, próxima fase e resultado no Ranking.
7. Conferir logs do Render: se aparecer `snapshot contém Máquina/AUTO`, há um registro legado inconsistente que requer revisão específica; **não excluir o banco ou a sala indiscriminadamente**.

### 6. Limitações e próxima etapa

- A proteção contra snapshots legados com bots é conservadora: **preserva os dados, mas não reconstrói automaticamente um placar cuja identidade original tenha sido apagada**. Necessita conferência de registros antigos específicos.
- A política geral de expiração de salas sem jogadores conectados e a atualização automática do painel do torneio são temas de melhoria separada.
- Os resultados e a progressão devem ser confirmados com testes reais de PostgreSQL, Socket.IO e reconexões no Render.

**Orientação para GitHub:** use o ZIP `SOMENTE_ALTERADOS`, respeitando os caminhos relativos. O ZIP `PROJETO_COMPLETO` é a mesma versão integrada, e este relatório Markdown é um terceiro artefato separado.

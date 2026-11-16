# MAU-MAU CANDEIAS — V40.69.8.14 — Integridade dos resultados de torneios

**Origem:** `mau-mau-multiplayer-main (21)(3).zip` (última versão enviada para auditoria).  
**Data:** 16/11/2026.  
**Objetivo:** corrigir os itens 1 e 2 da auditoria: resultados incompletos considerados encerrados e gravações de fases que silenciosamente afetavam zero linhas.

## Correções implementadas

1. `tournament-games.js`: `finish()` exige a quantidade de jogadores sorteados, rejeita resultado parcial e rejeita divergência em gravações repetidas. Só aceita repetição **idêntica** do mesmo `matchId`; um resultado salvo anteriormente não pode ser sobrescrito silenciosamente. `statuses()` não trata como concluído um resultado legado explicitamente marcado `complete: false`.
2. `tournament-bracket.js`: `recordResult()` valida a lista completa e única de identidades do torneio; para fases posteriores, confirma previamente que a mesa e as identidades correspondem àquelas persistidas. `INSERT ... ON CONFLICT DO NOTHING` e `UPDATE` que não alterem nenhuma linha agora verificam o registro existente: repetição idêntica é aceita, divergência ou ausência lança erro.
3. `tournament-result-commit.js` (novo): coordena a gravação da fase e do resultado público da classificatória na **mesma transação PostgreSQL**, com `BEGIN/COMMIT/ROLLBACK`. Nenhum avanço acontece se alguma gravação falhar. No armazenamento JSON local, que não suporta transações entre arquivos, o resultado de fase é salvo primeiro e tentativas repetidas são idempotentes.
4. `server.js`: utiliza o novo coordenador de persistência. A chamada existente de avanço continua sendo feita **depois** da confirmação da gravação.
5. Testes: novos cenários cobrem rejeição de registros incompletos, gravação repetida idêntica, conflito de pontuação ou `matchId`, falha da segunda gravação com rollback, `UPDATE` de fase com zero linhas e identidades que não correspondem à mesa. Testes antigos adaptados à nova política de não sobrescrever resultados.

## Regras preservadas

- Observador assiste, sem ocupar cadeira nem executar jogadas.
- Jogador inscrito entra automaticamente na mesa sorteada.
- Nenhuma máquina substitui o participante que desiste durante torneios.
- Recuperação existente de lobbies de torneio; regras das cartas, ranking e funcionamento de partidas normais sem alteração.

## Limitações e pontos pendentes

- **Sem teste real no PostgreSQL/Render:** a atomicidade foi exercitada usando um simulador de transações. Confirmar com banco real e múltiplas conexões durante homologação.
- Registros antigos já gravados como `complete:false` permanecem pendentes e **não são apagados nem corrigidos automaticamente**. Se existirem no ambiente real, devem passar por conferência antes de intervenção manual.
- Esta versão **não corrige** o reaparecimento de máquinas durante a recuperação de snapshots antigos, nem o descarte de resultados ainda pendentes após longas desconexões; esses itens continuam planejados para as próximas versões.
- Um erro posterior no avanço da fase não desfaz a gravação já confirmada da partida. O processamento é repetível, pois a confirmação do resultado idêntico é idempotente.
- O número de versão acima identifica o conjunto de correções; a versão interna do `package.json` não foi alterada para não interferir nas dependências e no lockfile durante a correção pontual.

## Testes recomendados no Render

1. Campeonato com 2 jogadores: concluir mesa, confirmar vencedor e campeão.
2. Campeonato com 6 jogadores: uma mesa conclui antes da outra; não antecipar o campeão nem a próxima fase.
3. Desistência durante a vez de jogar: continuar sem máquina e registrar o desistente sem classificação.
4. Simular queda temporária do banco no fim da mesa: não avançar; ao voltar, permitir a mesma confirmação, sem duplicar ou sobrescrever dados.
5. Terminar duas mesas simultaneamente, incluindo classificados avançando para a próxima fase.
6. Repetir o recebimento do mesmo resultado e tentar registrar resultado diferente: o idêntico é aceito, o divergente é bloqueado.

**Instalação:** aplicar os arquivos do ZIP `SOMENTE_ALTERADOS` mantendo os caminhos dentro da pasta do projeto. Depois executar `npm run verify:lock`, `node --check server.js` e `npm test` no ambiente com dependências instaladas. Não misturar arquivos de ZIPs de versões anteriores.

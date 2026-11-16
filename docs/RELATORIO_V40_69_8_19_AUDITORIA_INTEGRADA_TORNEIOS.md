# MAU-MAU CANDEIAS — V40.69.8.19
## Auditoria integrada do torneio e correção da exclusão de partidas em andamento

**Data:** 16/11/2026  
**Base utilizada:** V40.69.8.18, ZIP `MAU_MAU_CANDEIAS_V40_69_8_18_ATUALIZACAO_AUTOMATICA_TORNEIOS_PROJETO_COMPLETO.zip`.  
**Escopo:** inscrição → sorteio → alocação privada de vagas → gravação → progressão de fases → final → campeão; revisão de exclusão após reinício.

## 1. Resumo executivo

A auditoria integrada simulou competições com **2, 6, 20, 50 e 100 jogadores** usando os módulos locais reais de catálogo, inscrições, sorteio, jogos e fases. Cada simulação avançou até o campeão sem falhas, com resultados idempotentes (gravações repetidas), validação de classificação e proibição de vazamento das chaves privadas na apresentação pública.

Foi **reproduzida uma falha na versão base**: mesmo com registro persistido de uma mesa iniciada, o organizador conseguia excluir o torneio quando não havia sala ativa na memória (ex.: após reinício). A rota HTTP conferia o mapa de salas; a rotina de catálogo não consultava o estado persistido de início das disputas antes de apagar os dados. A exclusão podia comprometer a continuidade da competição.

**Correção V40.69.8.19:** a exclusão verifica, dentro da transação PostgreSQL, se existem mesas iniciadas e sem resultado confirmado nos registros de jogos ou fases. No modo local, confere os arquivos correspondentes. Se houver partida pendente, retorna erro **409**, preservando o torneio. A verificação está protegida por bloqueio transacional no registro do torneio. O endpoint também aguarda a inicialização das tabelas de histórico antes de autorizar a operação.

**Compatibilidade:** torneios sem partidas iniciadas (inclusive lobby abandonado) e torneios já concluídos podem continuar sendo excluídos pelo criador, respeitando o comportamento anterior. Uma exclusão de torneio concluído continua removendo o histórico associado: é uma ação intencional do organizador, não um arquivamento.

## 2. Problema comprovado e causa

**Cenário reproduzido antes da correção:**
1. Criar torneio em ambiente local.
2. Registrar mesa e marcá-la como `started` no armazenamento persistido.
3. Reinstanciar o catálogo, simulando um servidor sem sala carregada na memória.
4. Executar `TournamentCatalog.delete` como proprietário.
5. **Resultado anterior:** exclusão autorizada; o torneio desaparecia do catálogo.

**Causa:** a validação de exclusão na rota `/api/tournaments/:id` dependia do mapa de salas em memória. Em `tournament-catalog.js`, a exclusão apagava os vínculos e o torneio, sem impedir a remoção de disputas persistidas que ainda estavam em andamento.

**Correção:** consultar `mm_tournament_table_games` e `mm_tournament_stage_tables` durante a transação, bloquear exclusão de mesas começadas sem resultado confirmado, e aplicar equivalente no modo local. Resultado íntegro já confirmado não impede a exclusão intencional de um torneio concluído.

## 3. O que foi testado

- Criação e inscrições: grupos com 2, 6, 20, 50 e 100 participantes, com unicidade de identidade.
- Encerramento das inscrições e sorteio: distribuição por mesas, sem exposição pública de `playerKey`.
- Início das mesas, registro de todos os participantes e tentativas duplicadas idempotentes.
- Desistência simulada em mesa classificatória: participante marcado como desistente não ganha vaga.
- Progressão das fases: classificatória; semifinal/final nos formatos aplicáveis; quartas nos torneios maiores.
- Resultado final e campeão; exibição pública sem informações privadas.
- Exclusão após reinício: partida pendente bloqueia exclusão; usuário sem permissão bloqueado.
- Compatibilidade: exclusão de lobby não iniciado e de torneio concluído continua permitida.
- Simulação de transação de banco: bloqueio não exclui registros e provoca rollback.
- Sintaxe JavaScript e integridade do arquivo de dependências.

### 3.1. Resultado das simulações completas

| Inscritos | Etapas simuladas | Conclusão |
| ---: | --- | --- |
| 2 | Classificatória | Campeão definido |
| 6 | Classificatória → Final | Campeão definido |
| 20 | Classificatória → Semifinal → Final | Campeão definido |
| 50 | Classificatória → Semifinal → Final | Campeão definido |
| 100 | Classificatória → Quartas → Semifinal → Final | Campeão definido |

Os nomes de campeões podem variar devido ao sorteio de mesas. Os testes verificam critérios estruturais e não um vencedor predeterminado.

### 3.2. Regressão do projeto

- **195** arquivos `*.test.js` identificados.
- **194** executados e aprovados; **0** falhas nos testes executados.
- **1** não executado: `socketio-integration-v4063.test.js`, dependência `socket.io-client` indisponível neste ambiente.
- O comando padrão de testes interrompe ao encontrar essa dependência ausente; os demais foram executados individualmente com `DATABASE_URL` vazio, em ambiente local de testes.
- `node --check` passou nos arquivos alterados e em `server.js`.
- `scripts/check-lockfile.js` aprovou o lockfile.

**Limitação:** não foi realizado um torneio em produção nem uma conexão real ao PostgreSQL/Socket.IO do Render. O banco da SEFIN e serviços externos não são necessários para essa etapa. Os testes são locais e a segurança sob concorrência real de múltiplos processos ainda deve ser homologada.

## 4. Arquivos criados e modificados

| Caminho relativo | Situação | Descrição |
| --- | --- | --- |
| `tournament-catalog.js` | Modificado | Bloqueio de exclusão de partidas pendentes no PostgreSQL e em arquivo local, sem proibir exclusão de finalizados. |
| `server.js` | Modificado | Exige histórico de fases/jogos inicializado antes de permitir exclusão. |
| `tests/tournament-delete-persistence-v4069819.test.js` | Novo | Testes de exclusão, reinício, permissões, lobby, torneio finalizado e transação simulada. |
| `tests/tournament-full-cycle-v4069819.test.js` | Novo | Simulação integrada de 2 a 100 participantes até a final. |
| `docs/RELATORIO_V40_69_8_19_AUDITORIA_INTEGRADA_TORNEIOS.md` | Novo | Cópia deste relatório no projeto completo. |

**Arquivos excluídos:** nenhum.  
**Regras das cartas, Ranking, câmera, microfone, entrada automática, modo observador e apresentação:** nenhuma alteração.

## 5. Orientações de implantação

1. Confirme que o GitHub está na V40.69.8.18.
2. Extraia o ZIP **Somente arquivos alterados** preservando os caminhos originais.
3. Faça commit e acompanhe a implantação no Render.
4. Com duas contas, teste um torneio completo e confirme a classificação/ranking.
5. Em ambiente de homologação, inicie uma mesa, reinicie o serviço e confira que a exclusão do torneio é bloqueada enquanto não houver resultado confirmado.
6. Verifique que um torneio de teste não iniciado ainda pode ser excluído.

**Não exclua torneios reais para testar a proteção.** Use campeonatos de homologação.

## 6. Próximas verificações recomendadas

- Teste real de Socket.IO: vários jogadores entrando e reconectando durante a mudança de fase.
- Concorrência no PostgreSQL/Render: confirmar transições e exclusões no mesmo instante.
- Simular indisponibilidade temporária do banco após terminar mesas, verificando o processamento pendente da V40.69.8.17.
- Confirmar em aparelhos móveis o painel de atualização automática da V40.69.8.18 e resultados completos no ranking.

**Conclusão:** a auditoria integrada local passou; a V40.69.8.19 corrige uma causa demonstrável de perda de continuidade em torneios ativos, sem mexer em regras de jogo. A homologação de um torneio com contas reais no Render permanece necessária.

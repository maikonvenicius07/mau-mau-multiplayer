# MAU-MAU CANDEIAS — Recuperação segura de mesas perdidas (torneios)

**Data:** 16/11/2026  
**Base:** MAU_MAU_CANDEIAS_TORNEIOS_SEM_MAQUINAS_PROJETO_COMPLETO_2026_11_16.zip  
**Objetivo:** corrigir o bloqueio em que o código de sala fica gravado no torneio, mas a sala desaparece antes de a partida começar, sem inserir máquinas ou modificar os participantes sorteados.

## O que mudou

- **Mesas classificatórias e fases posteriores:** `tournament-games.js` e `tournament-bracket.js` registram um estado persistente da vinculação da sala: `legacy` (sem histórico confiável do início), `lobby` (criada pelo novo protocolo) ou `started` (início confirmado antes de distribuir cartas).
- **Recuperação segura:** se o código da sala existe no torneio mas a sala não está na memória, `server.js` primeiro exige inicialização/restauração dos snapshots e consulta snapshots ainda ativos. Só autoriza nova sala se o vínculo persistido estiver comprovadamente em `lobby`, sem resultado, e (a) a sala antiga tiver tombstone persistente de exclusão, ou (b) não houver snapshot ativo e pelo menos **60 segundos** tiverem passado desde a vinculação.
- **Concorrência:** a atualização da sala no PostgreSQL utiliza `UPDATE ... WHERE room_code = código_antigo AND room_state = 'lobby' AND result_json IS NULL`, protegido pelo vínculo único da mesa. O servidor confere o código retornado antes de publicar a nova sala. Com isso, duas tentativas simultâneas não geram duas salas ativas para a mesma mesa.
- **Início protegido:** a primeira chamada `startRound` confirma o estado `started` no armazenamento do torneio **antes** de iniciar a rodada no motor. Se não for possível persistir a confirmação, a partida não começa. Outras chamadas concorrentes durante essa transição são bloqueadas.
- **Participantes:** a nova sala conserva as identidades sorteadas; não adiciona robôs, não concede vitória, não registra resultado fictício e não reinicia uma partida já iniciada. A política de desistência da versão anterior permanece.
- **Migração de armazenamento:** `init()` cria (quando necessárias) as colunas `room_state` e `claimed_at` nas tabelas `mm_tournament_table_games` e `mm_tournament_stage_tables`. As vinculações criadas por versões anteriores ficam com `legacy` e **não são recuperadas automaticamente**, pois não é possível comprovar que suas partidas não começaram.

## Arquivos alterados

1. `server.js` — entrada em mesa perdida, espera da persistência, recuperação segura, gravação durável do início da primeira rodada e tratamento de callback assíncrono.
2. `tournament-games.js` — estado de sala para classificatórias; marca início e troca condicional de código.
3. `tournament-bracket.js` — o mesmo controle para fases posteriores.
4. `tournament-lobby-recovery.js` (**novo**) — decisão auditável de quando uma vinculação pode ser recuperada.
5. `tests/tournament-lobby-recovery.test.js` (**novo**) — testes de vínculo órfão, tombstone, espera, corrida, final, partidas iniciadas, resultados e legado.
6. `docs/RELATORIO_RECUPERACAO_LOBBY_TORNEIOS_2026_11_16.md` (**novo**) — este relatório.

## Testes locais

- `node --check` para `server.js`, `tournament-games.js`, `tournament-bracket.js`, módulo de recuperação e teste: **aprovado**.
- `node tests/tournament-lobby-recovery.test.js`: **aprovado**.
- Todos os **186 testes executáveis individualmente** sem as dependências de integração: **186 aprovados; 0 falhas**.
- O único teste de integração Socket.IO (`tests/socketio-integration-v4063.test.js`) não pôde ser executado localmente por ausência de `socket.io-client`; isto não demonstra erro do código. Em instalação com dependências completas, executar `npm ci && npm run verify`.
- Integridade e comparação de arquivos entre os dois ZIPs de entrega: aprovadas.

## Como homologar no Render

1. Executar `npm ci` e `npm run verify` no build (a configuração existente já faz isso) e confirmar migração das duas tabelas PostgreSQL, sem erros de permissão.
2. Criar torneio com 2 jogadores; o primeiro entra na mesa ainda em lobby e pressiona **Sair**. Depois, o outro entra pelo painel: deve criar **uma nova sala de lobby com os mesmos sorteados**, sem bot.
3. Reiniciar o Render com o lobby sorteado em andamento. Se o snapshot estiver disponível, a sala **original** deve ser restaurada; não deve ser criada outra.
4. Simular perda da sala **antes da primeira rodada** com vínculo do novo protocolo e sem snapshot; após 60 s de segurança, a entrada deve recuperar o lobby.
5. Iniciar partida, simular desconexão/reinício e confirmar que não é possível recriar a mesa do zero. Se houver snapshot de partida, a reconexão deve seguir o mecanismo existente; sem snapshot, exige tratamento administrativo, não reset automático.
6. Testar 6 jogadores (múltiplas mesas), fase posterior e duas tentativas simultâneas de recuperar o mesmo lobby. Conferir classificação, vencedor e ausência de máquinas.
7. Confirmar que salas comuns, ranking oficial, câmera/microfone e **Jogar Novamente** não sofreram regressões.

## Limites de segurança

- **Não reconstitui cartas nem pontuação de uma partida iniciada sem snapshot disponível.** Reiniciar uma partida nesse caso poderia apagar o progresso ou produzir resultados duplos, por isso continua bloqueado.
- Vínculos históricos anteriores a esta atualização (`legacy`) não são automaticamente recuperados. Um processo de intervenção administrativa deve validar a situação antes de liberar uma mesa antiga.
- O sistema do Render deve possuir PostgreSQL persistente (`DATABASE_URL`) e as permissões necessárias para adicionar duas colunas. Na ausência de persistência durável, reinícios do serviço podem perder estado.
- Uma atualização do banco que confirme `started` seguida imediatamente por uma queda antes de o motor distribuir cartas pode deixar a mesa bloqueada de modo conservador. Esse bloqueio é intencional para não recriar uma partida potencialmente iniciada.
- Testes locais não substituem testes reais com navegadores, Socket.IO e PostgreSQL do Render.

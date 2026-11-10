# MAU-MAU CANDEIAS — Relatório técnico V40.69.8

**Data:** 10/11/2026  
**Base:** projeto completo V40.69.7, preservando as correções da V40.69.6 no Render.  
**Escopo implementado:** recuperação segura dos pedidos dos espectadores para ocupar vagas depois de reinício do servidor.  
**Diagnóstico adicional:** relatos de vitórias não contabilizadas no ranking; **nenhum resultado ou tabela de ranking alterado**.

## 1. Problema de espectadores confirmado

No código-base `room-snapshot-store.js`, `buildRoomSnapshot` descartava `spectatorSeatRequests` e `restoreRoomSnapshot` sempre atribuía `[]`. Assim, mesmo que um observador tivesse solicitado uma vaga e a sala voltasse após reiniciar o Render, a intenção de entrada era perdida. Já existiam regras de entrada após rodadas 1 a 4, limite de cinco jogadores e proteção contra concorrência; foram preservadas.

### Correção

- Armazenar no snapshot privado **somente** a ordem, a chave da conta autenticada (`playerKey`) e o prazo da intenção de entrada. Não persistir sessão/socket, token, nome, avatar, áudio/vídeo ou cartas de espectadores.
- Restaurar pedidos apenas para partidas elegíveis, com snapshot recente (até 2 minutos) e prazo ainda válido. O limite evita retenção indefinida.
- Somente depois que a conta autenticada voltar como observador na mesma sala, vincular o pedido ao **novo** identificador de espectador. Não confiar em identificador recebido isoladamente pelo cliente.
- Manter os pedidos temporariamente sem espectador conectado; não ocupar uma cadeira durante a espera. Quando a partida alcançar o intervalo, a capacidade é novamente verificada, inclusive convites reservados e jogadores conectados ou desconectados.
- Descartar pedidos expirados ou quando não houver rodada seguinte. Nunca admitir espectadores como jogadores em torneios.

**Arquivos funcionais alterados:** `spectator-seat-admission.js`, `room-snapshot-store.js`, `server.js`. **Nenhum arquivo visual, de mídia, de cartas ou de ranking modificado.**

### Limitações

- O prazo de restauração da intenção é **até 2 minutos**; requer que a sala também sobreviva ao reinício e que o observador retorne autenticado. Não significa reserva garantida.
- Espectadores em si não são restaurados como sessões conectadas; precisam voltar à sala. Apenas a intenção pode ser reivindicada pela mesma conta.
- Em caso de restart longo ou atraso até depois da última rodada, a solicitação expira. O jogador poderá solicitar novamente se ainda for elegível.
- Testes em ambiente Render e concorrência entre processos separados não foram executados.

## 2. Ranking: investigação solicitada

O código-base (`server.js:maybeRecordFinished`) tenta registrar o ranking **somente quando a partida completa termina**, não quando se vence uma rodada. O registro é gravado por `RankingStore.recordMatch`, de forma idempotente (`matchId`), no PostgreSQL. A modalidade pode ser **official** (somente humanos no início da partida) ou **training** (bot permanente presente ao iniciar), e a interface possui filtros por **HOJE/SEMANA/MÊS/TEMPORADA**.

Os logs do Render mostrados anteriormente pelo usuário no dia 09/11/2026 confirmaram falha temporária de conexões PostgreSQL com `DEPTH_ZERO_SELF_SIGNED_CERT` em ranking, autenticação e snapshots. Isso **pode** ter impedido o registro de partidas que terminassem naquela execução afetada, mas **não prova** quais partidas ou vitórias foram perdidas. Um deploy posterior mostrou `[ranking] armazenamento: postgres` e serviço `Live`, porém não revela os registros já presentes.

**Estado do diagnóstico:** não é possível concluir que o ranking parou de contar desde 09/11 sem consultar os dados persistidos e logs da(s) partidas(s) citada(s). Não há acesso direto ao banco ou aos logs privados do serviço neste ambiente; também não se deve acrescentar resultados presumidos.

### Verificação sem alterar dados

Utilize o arquivo `scripts/diagnosticar-ranking-v40698.sql`, com quatro consultas `SELECT`:

1. Partidas e vitórias por dia no fuso de Rondônia e modalidade a partir de 08/11.
2. Horário da última partida gravada.
3. Quantidade de vitórias da Temporada 1 em cada modalidade.
4. Geração de ranking armazenada.

Confira também, nos logs de aplicação da partida que terminou, se aparecem mensagens `[ranking] gravação falhou:`; compare a classificação da partida, seu encerramento completo e o filtro do ranking na interface. Nunca compartilhe conexão, senha, token ou playerKey publicamente.

**Próxima ação se a falha for comprovada:** correção pontual e prioritária do ranking, com testes de recuperação de partidas concluídas, proteção contra dupla contagem e sem redefinir a temporada. Não inventar resultados para recompor vitórias.

## 3. Testes

- Novo teste `tests/spectator-seat-restart-v40698.test.js`: snapshot mínimo sem credenciais, deduplicação, reivindicação autenticada, espera após restart, concorrência pela última vaga, vencimento do prazo, privacidade das cartas e exclusão de torneios/5ª rodada.
- Testes existentes de fila e concorrência adaptados ao novo auxiliar, sem alterar as regras verificadas.
- Testes que fixam a versão do pacote atualizados de `40.69.7` para `40.69.8`; nenhum cenário funcional foi removido.
- Testes locais: **165 aprovados**, **0 falhas entre executados**, **1 integração Socket.IO não executada** por ausência local de `socket.io-client`.
- Sintaxe de JavaScript e verificação do lockfile: aprovadas.
- Homologação em Render, Android/iPhone, múltiplos processos e PostgreSQL de produção: **não realizada**.

## 4. Instalação

- **ZIP incremental**: copiar os arquivos da pasta `mau-mau-multiplayer-main/` para a raiz do GitHub **somente sobre a versão V40.69.7**, preservando os caminhos.
- **ZIP completo**: usar para substituir integralmente o código de uma cópia ou nova implantação, caso o GitHub esteja divergente da V40.69.7.
- Não modificar `DATABASE_URL`, `PGSSLMODE` nem a política TLS; não foi realizada migração de banco.
- Validar o GitHub Actions e a sequência do Render antes de anunciar o deploy concluído.
- Teste manual recomendado: com 4 jogadores e 2 espectadores, solicitar a última vaga durante a 3ª rodada, reiniciar o servidor, reentrar com a mesma conta dentro do prazo e confirmar que somente um espectador pode ser promovido no próximo intervalo. Testar também convite reservado e uma conta diferente.

## 5. Escopo preservado

Não foram alterados: motor de cartas, Queima, ×2 Dupla, Jogada Rápida, turnos, pontuação, ranking, autenticação, webcam, microfone, interface, tamanho das cartas, regras das rodadas ou configuração do banco. O próximo desenvolvimento funcional planejado era a V40.69.9 (desempenho), porém um defeito de ranking confirmado deve receber prioridade de correção antes de otimizações cosméticas.

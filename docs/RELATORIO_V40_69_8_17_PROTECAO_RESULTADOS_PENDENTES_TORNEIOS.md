# MAU-MAU CANDEIAS — V40.69.8.17
## Relatório técnico independente — proteção dos resultados pendentes de torneios

**Data:** 16/11/2026  
**Versão-base:** V40.69.8.16 (recuperação de torneios sem máquinas).  
**Escopo:** impedir exclusão de uma mesa que já encerrou sua partida, mas ainda não confirmou o resultado competitivo, e restabelecer a gravação automaticamente quando houver falha transitória.  
**Situação:** implementado e validado localmente; **ainda não homologado no PostgreSQL e no Render reais**.

### 1. Problema e causa

A classificação do torneio depende de operações assíncronas: salvar o snapshot final, registrar o resultado de mesa e a fase e solicitar o avanço do torneio. A política genérica de limpeza não verificava se esse resultado estava confirmado. Assim, uma remoção por rotina de manutenção, ausência de jogadores ou limpeza de sala poderia excluir um estado ainda necessário para completar a classificação. Além disso, uma falha transitória durante o registro do torneio não possuía, em todos os casos, retentativa independente da presença de jogadores ou de um novo evento da interface.

**Atenção:** o prazo de cinco minutos se aplica originalmente a partidas em curso sem humanos conectados. Mesas já com estado `finished` normalmente seguem outros caminhos de limpeza, como a auditoria e a remoção por inatividade. A melhoria verifica tanto esses caminhos quanto a expiração, caso haja um registro de resultado pendente.

### 2. O que foi alterado

1. Novo módulo **`tournament-room-retention.js`** define quando o resultado de um torneio está pendente: a sala pertence a torneio, ainda não está marcada como `rankingRecorded` e está finalizada ou possui `pendingRankingRecord`.
2. **`removeRoomDurably`** e **`removeRoom`** bloqueiam exclusões com resultado pendente. A exclusão durável revalida o estado após aguardar a persistência; não cria *tombstone* nesse caso.
3. A auditoria geral em **`room-governance.js`** não classifica resultados competitivos pendentes como salas descartáveis, inclusive quando a lista de jogadores está vazia.
4. Os caminhos de remoção por desconexão, prazo de reconexão, inatividade e limpeza após restauração não eliminam resultados pendentes. A regra de seis horas para salas normais e a regra de cinco minutos para partidas comuns permanecem.
5. Temporizador leve, a cada **60 segundos**, retenta o registro competitivo e renova o snapshot de resultados pendentes, mesmo que não haja jogadores online.
6. A confirmação do resultado do torneio passou a exigir que o snapshot tenha sido persistido; falhas recebem prazo de retentativa com aumento gradual, em vez de aguardar indefinidamente uma promessa pendente. O timeout é o mecanismo já utilizado pelo projeto; gravações repetidas continuam protegidas pelo mecanismo idempotente da V40.69.8.14.
7. Snapshots de resultados de torneios pendentes recebem **prazo de conservação de até 30 dias desde a última gravação**; partidas comuns e torneios já confirmados mantêm o TTL convencional. Se houver falha prolongada do banco, o estado é preservado no armazenamento enquanto o prazo ainda for válido e as gravações concluírem.
8. Se um snapshot de torneio pendente não puder ser restaurado com segurança, o processo não o apaga automaticamente; registra erro e conserva os dados para análise.

**Não alterados:** regra de desistência sem máquinas, pontuação, classificação, jogos normais, Ranking Oficial, cartas, câmera, microfone, observadores e estrutura de tabelas do PostgreSQL.

### 3. Arquivos incluídos na atualização

| Caminho relativo ao projeto | Situação | Descrição |
|---|---|---|
| `server.js` | Modificado | Proteção das exclusões, retentativa de resultados pendentes e confirmação da persistência. |
| `room-governance.js` | Modificado | Impede a auditoria de tratar resultado pendente como sala descartável. |
| `room-snapshot-store.js` | Modificado | Amplia a conservação do snapshot somente para resultados competitivos pendentes. |
| `tournament-room-retention.js` | **Novo** | Regra centralizada para identificar resultado pendente e decidir sobre a limpeza. |
| `tests/tournament-pending-result-retention-v4069817.test.js` | **Novo** | Testes de proteção contra exclusão, tombstones, expiração, persistência e restauração. |
| `CHANGELOG.md` | Modificado | Histórico da versão V40.69.8.17. |
| `docs/RELATORIO_V40_69_8_17_PROTECAO_RESULTADOS_PENDENTES_TORNEIOS.md` | **Novo** | Cópia do relatório de entrega dentro do projeto. |

**Arquivos excluídos:** nenhum.  
**Migração ou alteração de esquema:** nenhuma.  
**Versão interna do `package.json`:** permanece `40.69.8-rank.11`, como nas versões imediatamente anteriores, para não interferir na verificação histórica do lockfile; a entrega é identificada como **V40.69.8.17**.

### 4. Testes executados

- `node --check server.js`, `room-governance.js`, `room-snapshot-store.js`, `tournament-room-retention.js` e novo teste: **aprovados**.
- `node scripts/check-lockfile.js`: **aprovado**.
- Teste novo: exclusão bloqueada antes de marcar tombstone, limpeza possível depois de resultado confirmado, expiração de cinco minutos protegida em caso de resultado pendente, 30 dias para snapshot pendente, 8 horas para registros normais, restauração e preservação do resultado: **aprovado**.
- Regressão de todos os testes locais exceto a integração Socket.IO: **191 testes aprovados, 0 falhas**.
- `tests/socketio-integration-v4063.test.js`: **não executado** porque `socket.io-client` não está instalado neste ambiente. A execução de `npm test` para na dependência ausente; os demais testes foram executados individualmente sem alterá-los.
- **Não houve testes em PostgreSQL de produção, Render ou múltiplos navegadores em tempo real.**

### 5. Plano de verificação no Render

1. Confirmar que a versão anterior em produção é a V40.69.8.16 e aplicar o ZIP **SOMENTE_ALTERADOS**, preservando os caminhos. Caso haja diferença de base, utilizar o ZIP completo e revisar a atualização antes do deploy.
2. Conferir build do Render, especialmente `node --check server.js`, inicialização do PostgreSQL e possíveis erros de módulos.
3. Criar torneio de teste, concluir uma mesa e conferir o registro da classificação e o avanço normal da fase.
4. Em ambiente de homologação e com controle do banco, simular indisponibilidade **depois do fim de uma mesa** e antes da confirmação do resultado; verificar que o estado pendente não é excluído e que novas tentativas ocorrem após retorno do PostgreSQL.
5. Verificar que uma segunda execução do mesmo resultado não gera pontuação duplicada e que desistentes continuam sem máquinas substitutas.
6. Verificar que salas **comuns**, sem torneio, continuam com seus prazos de desconexão e limpeza anteriores.
7. Acompanhar logs `[tournament] gravação de resultado falhou; nova tentativa automática` e `[tournament] snapshot pendente inválido preservado para auditoria`. Não apagar snapshots antigos manualmente sem confirmar sua classificação.

### 6. Limitações e próxima etapa

A proteção é específica para **resultados competitivos pendentes**, não remove a regra de expiração de cinco minutos de partidas de torneio **ainda em andamento e sem resultado iniciado**. Essa política de partida abandonada/sem jogadores é um tema de regras separado, que deve ser definido antes de mudar o comportamento. O prazo de 30 dias não garante recuperação se o armazenamento estiver indisponível por período superior a esse prazo, se as gravações nunca forem aceitas ou se os dados persistidos estiverem irrecuperavelmente inválidos.

**Próxima melhoria sugerida:** atualização automática leve do painel de torneios (mesas, classificação e fases), sem exigir o botão **Atualizar**, acompanhada de otimização das consultas por mesa.

### 7. Entregas

1. ZIP do **projeto completo** da V40.69.8.17.
2. ZIP contendo **somente os arquivos novos/modificados**, com os mesmos caminhos relativos e bytes idênticos aos do ZIP completo.
3. **Este relatório `.md` independente.**

Os dois arquivos ZIP devem passar na verificação de integridade antes do envio ao GitHub. Nenhum deploy foi realizado por esta entrega.

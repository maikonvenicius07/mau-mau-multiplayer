# MAU-MAU CANDEIAS — Relatório técnico V40.69.6

**Data:** 09/11/2026  
**Base comprovada:** `mau-mau-multiplayer-main (17)(6).zip` — conteúdo idêntico ao ZIP completo V40.69.5 entregue na etapa anterior (comparação SHA-256 de todos os arquivos).  
**Escopo exclusivo:** segurança de conexão PostgreSQL, prevenção de abuso da sinalização WebRTC, criação de torneios e detecção de dependências vulneráveis no CI.

## 1. Problemas confirmados no código original

1. `database-pool.js` e os oito caminhos de criação independente de pools configuravam `ssl: {rejectUnauthorized:false}` sempre que não houvesse `PGSSLMODE=disable`. O servidor poderia negociar TLS sem autenticar o certificado do PostgreSQL.
2. `server.js` validava sala/destino/formatos e tamanhos de SDP e candidatos ICE, mas não aplicava quota própria ao evento `liveVoiceSignal`. O limite existente para `liveVoiceRelayPcm` não protege a sinalização.
3. `tournament-catalog.js` permitia criação sem limite por conta. A API autenticava o usuário, mas não aplicava limite de frequência, quota persistente ou serialização concorrente de criações por conta.
4. `.npmrc` contém `audit=false`, e o workflow `verify.yml` executava `npm ci --no-audit`; não havia verificação separada de vulnerabilidades de dependências.

Nenhuma exploração em produção foi identificada ou presumida.

## 2. Correções implementadas

### 2.1 PostgreSQL / TLS

- `database-pool.js` centraliza `createDatabasePoolConfig()` e aplica `ssl: {rejectUnauthorized:true}` por padrão.
- `PGSSLROOTCERT` (caminho para CA) e `DATABASE_SSL_CA` (certificado PEM, podendo usar `\\n`) permitem configurar a cadeia de confiança sem desabilitar verificação.
- `PGSSLMODE=disable` continua permitido **somente por decisão explícita do operador** quando a conexão usa URL **interna** em rede privada confiável. Não se deve usar em conexão externa/pública.
- `sslmode=no-verify` é recusado; `sslmode` na `DATABASE_URL` é normalizado para impedir que o parser do `pg` descarte a configuração TLS segura. Conflitos de configuração provocam erro em vez de degradar silenciosamente a segurança.
- `auth-identity-store.js`, `ranking-store.js`, `room-snapshot-store.js` e os cinco módulos de torneio que criam pools independentes passam a usar o mesmo auxiliar. Em produção, o servidor continua injetando **um único pool compartilhado**.

**Atenção à implantação:** a ativação de validação TLS pode impedir a conexão se o PostgreSQL externo utilizar certificado não confiável pelo ambiente. Antes do deploy, confirmar a URL usada no Render, o modo TLS e se existe CA a configurar; fazer backup e validar `/ready`. Não alterar cegamente `PGSSLMODE`.

### 2.2 WebRTC

- `abuse-guard.js`: `voiceSignal` limitado a **180 mensagens/10 segundos por conta**, janela com expiração, distinto do limite já aplicado ao áudio de fallback.
- `server.js`: após validar que o socket é participante válido de uma sala, o evento `liveVoiceSignal` consome a quota da conta. Ao atingir o limite, descarta novos sinais e emite, no máximo a cada 10 s por socket, `liveVoiceSignalLimited` (evento específico, sem disparar `gameError` nem interferir na jogada).
- A descrição WebRTC precisa ter tipo coerente com a ação (`offer` ou `answer`). Validação anterior de destino na mesma sala, IDs e tamanhos foi preservada.
- O limite é intencionalmente folgado para a negociação comum. Redes móveis com renegociações excepcionais ainda precisam ser testadas em dispositivos reais.

### 2.3 Torneios

- Limite de **10 torneios não cancelados por conta** por padrão, configurável com `MAUMAU_MAX_TOURNAMENTS_PER_ACCOUNT` entre 1 e 50. Um torneio cancelado não ocupa quota; os demais continuam contados.
- Para PostgreSQL, a criação usa transação e `pg_advisory_xact_lock` derivado da conta, conferindo a contagem antes do `INSERT`, de modo que duas criações simultâneas não ultrapassem o limite.
- O armazenamento JSON verifica a mesma quota de maneira síncrona.
- A API `/api/tournaments` aplica limite de **3 tentativas por hora por conta**, retornando `429` e `Retry-After` quando a quota de frequência é ultrapassada.
- Permissões do criador e regras do torneio não foram alteradas.

### 2.4 Dependências

- `.github/workflows/verify.yml` passou a executar `npm audit --omit=dev --audit-level=high` como etapa independente e registrar seu resultado no resumo do GitHub Actions.
- O diagnóstico é **não bloqueante** para evitar que um alerta preexistente interrompa imediatamente o serviço; isso **não significa** que vulnerabilidades tenham sido corrigidas. É necessário examinar e tratar os alertas do CI.
- O pipeline de build do Render não foi modificado.

## 3. Arquivos com modificações funcionais

- `database-pool.js` — política TLS segura.
- `auth-identity-store.js`, `ranking-store.js`, `room-snapshot-store.js` — criação independente de pools pelo auxiliar comum.
- `tournament-store.js`, `tournament-catalog.js`, `tournament-draw.js`, `tournament-games.js`, `tournament-bracket.js` — política de conexão centralizada, além de quota transacional no catálogo.
- `abuse-guard.js`, `server.js` — limitação de sinalização e criação de torneios.
- `.github/workflows/verify.yml` — auditoria npm separada.
- `.env.example` — parâmetros novos e aviso de conexão segura.
- `tests/server-security-v40696.test.js` — testes de segurança e concorrência.
- `package.json`, `package-lock.json` e testes com identificação de versão literal — atualização V40.69.5 → V40.69.6.
- `CHANGELOG.md` e este relatório.

## 4. Testes executados e limites

- **164 arquivos de teste JavaScript executados e aprovados, 0 falhas** na execução local (todos os `*.test.js` exceto a integração Socket.IO indisponível no ambiente).
- Novo teste `server-security-v40696.test.js` verifica: CA por arquivo e variável; TLS validado por padrão; rejeição de modos inseguros; remoção de `sslmode` conflitante da URL; quota de 180 sinais/10 s; quota de 3 criações/h; 2 torneios por conta em arquivo JSON; simulação PostgreSQL de **três criações concorrentes para duas vagas**, que produz 2 sucessos e 1 recusa esperada.
- `node --check` nos arquivos JS modificados, `node scripts/check-lockfile.js` e leitura sintática do workflow YAML: **aprovados**.
- **1 teste não executado:** `tests/socketio-integration-v4063.test.js`, porque o ambiente não tem `socket.io-client` instalado. A dependência continua declarada e fixada no projeto.
- Não houve conexão PostgreSQL verdadeira, deploy no Render, execução de `npm audit` online, teste WebRTC em aparelhos físicos, ataque real ou benchmark de produção. O Node local era v22.16.0; o projeto solicita 22.22.0.

## 5. Verificações recomendadas no Render

1. Antes de implantar, conferir `DATABASE_URL` e modo TLS. Se usar endpoint PostgreSQL externo, manter validação TLS e configurar CA se necessário. Para rede privada interna sem TLS, configurar explicitamente `PGSSLMODE=disable` somente se for esse o cenário real.
2. Fazer backup do banco e implantar a V40.69.6; conferir `/ready` e logs de conexão. Não houve migração de schema nesta versão.
3. Criar um torneio autenticado, consultar e abrir normalmente; tentar repetir quatro vezes em menos de uma hora. A quarta tentativa deve retornar `429`.
4. Com conta de testes e limite reduzido em homologação (`MAUMAU_MAX_TOURNAMENTS_PER_ACCOUNT=2`), criar dois torneios, tentar um terceiro e confirmar recusa `409`; cancelar um dos torneios e confirmar que a quota é liberada.
5. Com dois celulares em redes distintas, ligar o microfone, confirmar oferta/resposta/ICE, desligar e reconectar, verificando **áudio realmente recebido** pelos demais; o limitador não deve interferir em uso comum.
6. Verificar a etapa de `npm audit` no GitHub Actions, ler os alertas e planejar atualizações cuidadosas de dependências. Validar novamente toda a suíte no Node 22.22.0 com `npm ci && npm run verify`.

## 6. Pontos deliberadamente não modificados

- A biblioteca LiveKit continua carregada de um CDN com versão fixada, mas sem hash SRI. Uma migração de SDK, hospedagem própria ou aplicação de SRI exige validar os bytes exatos antes de tocar na câmera; não foi feita sem essa prova.
- A listagem de torneios continua sem paginação para não romper o contrato atual da interface; pode ser tratada após medir necessidade ou em etapa própria.
- As regras, as cartas, a pontuação, a Jogada Rápida, a reconexão, a câmera, a interface móvel, o ranking e os dados salvos das partidas **não foram alterados** nesta versão.

**Próxima fase prevista, somente após homologação:** V40.69.7 — Câmera, microfone e reconexão.

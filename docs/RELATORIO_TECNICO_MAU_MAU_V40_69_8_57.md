# MAU-MAU CANDEIAS — Relatório técnico V40.69.8.57

**Data:** 23/11/2026  
**Base:** ZIP completo V40.69.8.56 já entregue  
**Prioridade:** falha de build no Render; manutenção de presença/reconexão e torneios.

## 1. Evidência do problema

O screenshot enviado do Render registra `ERR_ASSERTION` em
`/opt/render/project/src/tests/presence-snapshot-index-v4069855.test.js:54:1`,
no comando `assert(handlerStart>0&&handlerEnd>handlerStart)`. O próprio teste
falha porque não conseguiu identificar duas posições de texto no arquivo que
inspeciona; **isso não comprova falha real no Socket.IO ou no algoritmo de
reconexão**. A publicação foi interrompida antes da inicialização.

**Constatação verificável:** o teste com esse nome não constava dos arquivos
completos V40.69.8.55 e V40.69.8.56. A árvore que o Render verificou,
portanto, tinha ao menos um arquivo que não fazia parte do pacote entregue.
É plausível que o arquivo tenha permanecido no GitHub após uploads que
substituíram arquivos sem remover os antigos; não há acesso à árvore/commit
do GitHub ou Render para confirmar a causa exata. **Gravidade: ALTA
(publicação bloqueada)**.

## 2. Auditoria do algoritmo de presença

**Problema adicional constatado:** na V40.69.8.56, `buildPresenceSnapshot()`
fazia uma varredura das salas para encontrar jogadores em reconexão. Em
seguida, para cada usuário online, `roomSeatForKey()` era chamado duas vezes:
uma para o nome/avatar e outra dentro de `presenceStatusForKey()`. Isso
introduzia repetição de buscas proporcional ao produto de jogadores e salas
(aproximadamente `O(P * S * M)`, com P jogadores online, S salas e M assentos
por sala). **Gravidade: MÉDIA (escalabilidade)**. O impacto na produção não
foi medido.

## 3. Correções implantadas no pacote

| Arquivo | Alteração | Impacto previsto |
|---|---|---|
| `server.js` | Identificação funcional V40.69.8.57; índice utilizado uma vez por snapshot; cadeira selecionada reaproveitada para status | Menos varreduras repetidas na presença |
| `presence-seat-index.js` (novo) | Índice efêmero de jogadores humanos e vagas dentro do prazo de reconexão; prioridade preservada | Busca linear por snapshot, sem cache permanente ou migração |
| `tests/presence-snapshot-index-v4069855.test.js` (novo) | Substitui o teste legado homônimo do Render por validações de comportamento, complexidade e integração, com erros claros | Evita o falso erro `handlerStart` e detecta regressões reais |
| `CHANGELOG.md` | Histórico da correção | Rastreabilidade |
| `docs/CORRECAO_RENDER_PRESENCA_V40_69_8_57.md` (novo) | Passos para sincronizar o repositório e publicar | Redução de erros de versão mista |

**Preservados:** regras de cartas/Queima, torneios, classificação e avanço,
início manual das partidas, observadores, áudio/vídeo, ranking, permissões,
layout, dados existentes, `package.json`, `package-lock.json` e `render.yaml`.
**Migração do banco:** não necessária.

## 4. Validações executadas

| Teste | Resultado | Interpretação |
|---|---|---|
| Teste específico `presence-snapshot-index-v4069855.test.js` | **Aprovado** | Confere prioridade, reconexão ativa/vencida, ausência de robôs, duplicidade histórica, empate de prioridade, ausência de mutação e ligação do servidor |
| Índice em 120 salas com 12 jogadores cada | **Aprovado** | 1.440 assentos indexados, uma leitura do conjunto de jogadores por sala (120 no teste) |
| Comparação entre índice e seleção original para cenários simulados | **Aprovado** | A mesma cadeira foi escolhida para os casos exercitados |
| Todos os 229 testes `*.test.js` localmente | **228 aprovados; 1 bloqueado** | `socketio-integration-v4063.test.js` depende de `socket.io-client`, ausente neste ambiente |
| Validação de sintaxe `node --check` | **293/293 aprovados** | Não substitui execução com dependências instaladas |
| `npm run verify:lock` | **Aprovado** | Dependências e lockfile não alterados |
| `npm ci && npm run verify` no Render | **Não executado** | É preciso confirmar o novo commit, dependências e ambiente |
| PostgreSQL real / múltiplos jogadores / várias horas de jogo | **Não executado** | Requer homologação na hospedagem |

**Observação:** a redução de buscas foi sustentada por inspeção do algoritmo
e contagem instrumentada de varreduras no teste; **não há medição de CPU,
latência ou economia financeira no Render** para esta versão.

## 5. Publicação correta — detalhe essencial

1. Extraia `MAU_MAU_CANDEIAS_V40_69_8_57_COMPLETO.zip` e copie o **conteúdo**
   de `mau-mau-multiplayer-main/` para a raiz do repositório que o Render usa.
2. No mesmo commit, confira `server.js`, `presence-seat-index.js` e
   `tests/presence-snapshot-index-v4069855.test.js`, junto com os demais arquivos.
3. **Upload no GitHub não exclui arquivos antigos.** Compare a pasta de testes
   no GitHub com a distribuída, identificando e removendo apenas sobras
   comprovadamente obsoletas; não elimine testes de segurança/regressão legítimos.
4. Abra no GitHub o teste `presence-snapshot-index-v4069855.test.js` e confira
   que não contém `assert(handlerStart>0&&handlerEnd>handlerStart)`.
5. Verifique branch/root directory e commit em Render Events; realize deploy.
   `npm ci` deve instalar as dependências antes de `npm run verify`.
6. Após `Build succeeded`, confira `GET /ready` com `releaseVersion`
   `V40.69.8.57`. Faça testes reais de presença, F5, queda e retomada,
   2–4 jogadores, torneios e início manual da partida.

Se o log continuar referindo a mesma expressão `handlerStart>0` **a origem
ainda não foi sincronizada**, e o Render não está executando o teste entregue.
Isso não deve ser contornado desligando a suíte inteira.

## 6. Riscos e próximos passos

- **Alto:** árvore de testes do GitHub potencialmente com arquivos antigos.
  Confirmar a correspondência com o ZIP é condição para concluir o deploy.
- **Médio:** não há teste de integração Socket.IO nem medição de longa duração
  no Render nesta auditoria. Executar a suíte com dependências completas e
  realizar homologação real.
- **Baixo:** o índice temporário acrescenta um `Map` e um `Set` durante a
  criação do snapshot, coletados após o uso; risco mitigado por testes de
  paridade com a seleção original.

**Conclusão:** pacote corrigido e validado localmente nos limites acima;
**publicação e estabilidade de produção não confirmadas**.

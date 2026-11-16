# MAU-MAU CANDEIAS — V40.69.8.20
## Correção da reconexão e retomada de mesas já iniciadas no torneio

**Data:** 16 de novembro de 2026.  
**Base:** V40.69.8.19 — `MAU_MAU_CANDEIAS_V40_69_8_19_AUDITORIA_INTEGRADA_PROJETO_COMPLETO.zip`.  
**Escopo:** retorno após F5, queda temporária, retomada de cadeira sorteada, falha temporária na restauração após deploy. Preservação das regras do torneio e das partidas normais.

### 1. Problemas reproduzidos na análise do código

**1. Mesa iniciada sem retorno do jogador pelo fluxo de entrada automática.** No evento `enterTournamentTable`, após validar identidade, sorteio, mesa e fase, se a partida já estivesse em andamento o servidor emitia `tournamentTableResume` com o código da sala e encerrava o atendimento. O `public/app.js` não possuía receptor para esse evento. Consequentemente, um jogador que utilizasse esse caminho de entrada automática não recebia confirmação de ingresso e as novas tentativas podiam acabar esgotadas.

**2. Busca de cadeira antes da restauração das salas.** O evento `resumeActiveSeat` procurava as salas em memória imediatamente. Após o reinício da aplicação, o armazenamento persistido podia estar disponível, mas a restauração ainda não tinha terminado. Nessa janela o servidor respondia `none` incorretamente. O navegador fazia apenas algumas tentativas curtas, insuficientes para cenários de recuperação atrasada.

### 2. Alterações implementadas

- **`tournament-seat-recovery.js` (novo):** valida a possibilidade de retomar uma vaga humana existente em mesa de torneio iniciada, pela identidade autenticada e pelo roster original. Não autoriza espectador, conta não sorteada, máquina, participante desistente ou cadeira marcada como saída voluntária.
- **`server.js`:** a mesa já iniciada usa a função autenticada `resumeReservedPlayerSeat` para entregar a **mesma cadeira** ao jogador, sem criar novo participante e sem revelar um código privado como instrução de retorno. Quando a cadeira não existe, responde com erro explícito, em vez de fingir retomada.
- **`server.js`:** `resumeActiveSeat` passa a aguardar `requireRoomPersistenceReady()` antes de concluir que não há vaga. Essa função exige que snapshots previamente armazenados sejam restaurados, ou informa indisponibilidade temporária sem marcar ausência definitiva.
- **`public/app.js`:** nas mensagens de restauração temporariamente indisponível, aplica retentativas limitadas da busca autenticada de cadeira, com espaçamento progressivo; não entra em repetição infinita nem altera o fluxo de observador ou saída voluntária. A pequena tolerância anterior para resposta `none` permanece.
- **`public/index.html`:** atualiza o identificador de cache do script `app.js` para que o navegador receba a correção após deploy.
- **`tests/tournament-reconnect-v4069820.test.js` (novo):** cobre mesa em andamento, retorno durante intervalo, identidade errada, desistência, cadeira ocupada por máquina, saída voluntária, repetição após indisponibilidade da restauração e limites de tentativas.

### 3. Cenários de funcionamento esperado

| Situação | Comportamento esperado |
| --- | --- |
| Recarregar a página durante uma partida com token válido | Retoma a cadeira original (mesmo jogador/mão/pontuação). |
| Reentrar pelo aviso de mesa sorteada depois da partida ter começado | Só retoma se a identidade autenticada já tinha cadeira ativa nessa mesa. |
| A conta foi sorteada, mas não entrou antes de a mesa iniciar | Não cria cadeira nova e não altera o jogo em andamento; apresenta mensagem explicativa. |
| Jogador desistiu voluntariamente | A retomada é negada; proibição de máquinas permanece. |
| Render reinicia e snapshots ainda são restaurados | Busca de cadeira aguarda restauração; falhas temporárias podem receber novas tentativas limitadas. |
| Duas abas usam a mesma conta | O fluxo de retomada transfere a mesma cadeira ao socket atual, sem duplicar jogadores. |
| Conta está apenas observando | Não é convertida automaticamente em jogador. |
| Troca de fase | Mantém os requisitos de identidade, classificação e atribuição de mesa já existentes. |

### 4. Validação local

- **196 arquivos de teste encontrados**; **195 executados e aprovados**, **0 falhas** nos testes executados.  
- **1 teste não executado:** `tests/socketio-integration-v4063.test.js` por ausência de `socket.io-client` neste ambiente de execução. A dependência está declarada no `package.json`/`package-lock.json` e deve ser instalada no ambiente da aplicação.  
- `node --check`: `server.js`, `public/app.js`, `tournament-seat-recovery.js` passaram.  
- `node scripts/check-lockfile.js`: arquivo de dependências aprovado; nenhuma dependência alterada.  
- Teste específico novo de reconexão passou incluindo simulação da execução do ramo de retomada no servidor.

### 5. Limitações

Os testes acima são **locais**, com simulação de componentes e contrato de recuperação, não uma partida real de vários navegadores contra Socket.IO e PostgreSQL no Render. Uma queda prolongada além dos prazos de reconexão pode levar à desclassificação conforme regras existentes; esta versão não altera tais prazos. Se a restauração do banco persistir indisponível, as retentativas terminam, e o jogador precisará tentar novamente após normalização. Nenhuma mudança em câmera/microfone ou no algoritmo das cartas foi feita.

A versão de distribuição é V40.69.8.20. A identificação histórica de `package.json` (`40.69.8-rank.11`) foi mantida porque várias dezenas de testes existentes dependem dessa identificação; nenhuma dependência foi modificada.

### 6. Arquivos da versão

| Caminho | Tipo |
| --- | --- |
| `server.js` | Modificado |
| `public/app.js` | Modificado |
| `public/index.html` | Modificado |
| `tournament-seat-recovery.js` | Novo |
| `tests/tournament-reconnect-v4069820.test.js` | Novo |
| `docs/RELATORIO_V40_69_8_20_RECONEXAO_TORNEIOS.md` | Novo |

**Arquivos excluídos:** nenhum.  
**Funcionalidades preservadas:** pontuação, classificação, Ranking, observadores sem jogar, proibição de máquinas em torneios, regras das cartas, sala comum, WebRTC.

### 7. Instalação e homologação recomendada

1. Confirmar que o GitHub está na V40.69.8.19. Para uma versão antiga, preferir o ZIP completo V40.69.8.20.
2. Para atualizar a V40.69.8.19, copiar os arquivos do ZIP `SOMENTE_ALTERADOS` mantendo as pastas originais. Não enviar o Markdown do relatório como `server.js`.
3. Fazer commit, conferir o deploy do Render e abrir o jogo em uma aba nova (ou atualizar forçando recarregamento).
4. Criar torneio de teste com 2–4 contas, iniciar uma mesa e recarregar um dos navegadores durante a rodada. Verificar que a mesma mão, pontuação, posição e identidade foram recuperadas.
5. Fazer um teste com nova aba para a **mesma** conta e conferir que não criou outro jogador. Repetir em uma fase posterior do torneio.
6. Testar um abandono voluntário, confirmando que a conta desistente não pode voltar nem é substituída por máquina.
7. Em ambiente controlado, reiniciar a aplicação enquanto a mesa está em andamento e conferir o resultado após a restauração.

**Não interromper o PostgreSQL de produção e não realizar testes destrutivos em torneios reais.**

# MAU-MAU CANDEIAS — V40.69.8.8

**Tema:** desempenho da mão de cartas e estabilidade da interface mobile.  
**Base:** ZIP completo V40.69.8.7, `package.json` versão `40.69.8-rank.7`.  
**Entrega:** `40.69.8-rank.8` (11/11/2026).

## Diagnóstico e seleção da próxima melhoria

O sistema já conta com renderização seletiva de componentes (`public/app.js`, `renderWhenChanged`), prevenção de envio de estados idênticos por socket (`state-delivery.js`, `emitState`), recuperação de mídia, limites de reconexão e retentativas de snapshots. Não seria seguro refazer esses mecanismos sem evidência de falha.

Na versão-base, `renderHand` executava `h.innerHTML=''` toda vez que a renderização da mão era solicitada e recriava todas as cartas, eventos de clique e de teclado. Mesmo quando o conjunto de cartas não mudava, alterações nas permissões do turno provocavam remoção e criação de todos os nós da mão. Em celular, isso gera trabalho de DOM evitável, pode interromper o foco e favorece deslocamentos visuais.

### Achados e prioridades

| Nº | Área | Estado | Problema e evidência | Consequência | Solução | Prioridade | Complexidade |
|---|---|---|---|---|---|---|---|
| 01 | Interface mobile | Confirmado pelo código | `public/app.js`, `renderHand`: limpeza integral da mão via `innerHTML` | Recriação da mão e dos listeners a cada alteração visível | Reconciliação incremental por ID | Alta | Média |
| 02 | Acessibilidade | Risco do desenho anterior | `renderHand`: listener de teclado criado para cada elemento novo | Foco de teclado perdido após reconstrução; custo evitável | Instalar uma vez por carta, validar permissão na hora da tecla | Média | Baixa |
| 03 | Responsividade | Risco condicionado ao aparelho | Desmontagem/reinserção de todos os nós da mão | Possível deslocamento lateral/foco em telas pequenas | Preservar nós e rolagem horizontal quando possível | Média | Média |
| 04 | Diagnóstico de rede | Oportunidade, não falha confirmada | `public/app.js`, evento `state`: serialização JSON para medir bytes de todos os estados | Custo de CPU adicional | Avaliar métricas sob demanda em versão posterior | Média | Baixa |
| 05 | Emissão Socket.IO | Oportunidade, não falha confirmada | `state-delivery.js`, `emitState`: serialização e SHA-256 por destinatário | Custo sob carga elevada | Medir com várias salas antes de mudar protocolo | Média | Alta |
| 06 | Interface CSS | Oportunidade | `public/styles.css`: diversas media queries mobile coexistentes | Manutenção difícil e possíveis efeitos em aparelhos específicos | Consolidar só após testes visuais de regressão | Média | Alta |
| 07 | Persistência | Limitação conhecida | `room-snapshot-store.js`: salvamento assíncrono e retries limitados | Queda abrupta antes do commit ainda pode perder a última ação | Testar durabilidade em PostgreSQL real na fase posterior | Alta | Alta |
| 08 | Mídia | Necessita testes de campo | WebRTC/LiveKit e recuperação após F5 | Recepção real não garantida só por testes simulados | Homologação entre Android/iOS/desktop | Alta | Média |

**Alterado nesta versão:** somente o achado 01 e sua proteção de acessibilidade (02); os demais ficam para fases separadas.

## Correção aplicada

- `public/app.js`: `makeHandCardElement` cria o nó apenas quando a carta entra na mão, ou quando o ID corresponde a uma face diferente.
- `reconcileHandCardPosition` move apenas cartas cuja posição mudou na ordenação. As demais permanecem no mesmo nó DOM.
- `renderHand` atualiza permissões, classes `playable`, `burnable`, `quickable`, `double-available`, `quick-direct`, destaque da carta comprada, `onclick`, rótulo e foco sem reconstruir a mão.
- O listener `keydown` é registrado **uma única vez por nó**, e só aciona o clique quando a carta está efetivamente permitida no estado atual.
- Cartas jogadas são removidas do DOM. Troca de partida, sala ou papel zera o contexto; espectadores não herdam cartas privadas.
- Atualizado o parâmetro de cache do `app.js` no `public/index.html` para a nova implementação chegar aos celulares após o deploy.
- `package.json` e `package-lock.json` sincronizados com `40.69.8-rank.8`; contratos antigos de versão nos testes atualizados sem alteração de suas regras.
- `tests/hand-dom-reconciliation-v406988.test.js` adicionado.

**Não houve alteração:** `server.js`, `game-engine.js`, `ranking-store.js`, `ranking-performance.js`, `ranking-skill.js`, `room-snapshot-store.js`, `state-delivery.js`, WebRTC, arquivos de estilo ou tabelas do banco. A correção SQL de snapshots `$1::text` continua na versão-base.

## Verificações e resultados

| Teste | Resultado |
|---|---|
| Novo teste de DOM por ID, permissões, foco/teclado, Queima, Dupla, Jogada Rápida, compra, ordenação, troca de partida e espectador | Aprovado |
| Testes automatizados `*.test.js` executáveis localmente, em quatro lotes | **179 aprovados**, **zero falhas** |
| Teste `socketio-integration-v4063.test.js` | **Não executado**: `socket.io-client` indisponível localmente |
| `node --check public/app.js`, `node --check server.js` | Aprovados |
| `node scripts/check-lockfile.js` | Aprovado |
| Browser Chromium headless controlado: 25 cartas e 5 rodadas de 60 renderizações para cada versão | Aprovado — DOM reutilizado e permissões atualizadas |
| Dispositivos Android/iOS, PostgreSQL e Render em produção | Não executados |

### Benchmark controlado (não representa a produção)

No Chromium headless, com HTML e dados sintéticos de 25 cartas, cada bloco de 60 atualizações levou:

- **Antes:** 30,8; 32,5; 31,2; 30,0; 30,4 ms.
- **Depois:** 20,4; 11,6; 10,2; 7,9; 7,6 ms.

O tempo médio do bloco diminuiu aproximadamente de **31,0 ms para 11,5 ms** (~63%). A medição é indicativa do custo da rotina isolada, não é um ganho garantido de FPS, CPU ou bateria no jogo completo. A contagem de nós foi mantida, permissões foram aplicadas e `scrollLeft` não se alterou no cenário estável.

## Implantação e homologação

1. Aplicar o ZIP incremental sobre a V40.69.8.7 (não sobre versões anteriores).
2. Conferir CI e deploy do Render; manter as variáveis de ambiente como estavam no serviço estável.
3. Em um celular, iniciar uma partida de duas pessoas; comprar cartas, jogar, alternar turnos e verificar destaques das cartas e botões.
4. Testar Queima, ×2 Dupla, Jogada Rápida e cadeia de 7, inclusive com muitas cartas.
5. Ordenar a mão por número e por naipe; confirmar que a posição horizontal não salta quando os IDs não mudam.
6. Confirmar uma revanche, reconexão/F5, ranking OFICIAL/TREINO e observador de torneio. Conferir que o ranking continua contabilizando partidas completas.
7. Confirmar foco Enter/Espaço em desktop e toque em Android/iPhone. Verificar se há regressão visual.

## Próxima etapa proposta

**V40.69.8.9 — estabilidade e experiência mobile**, priorizando medidas em aparelhos reais, layout em telas baixas, confirmação de câmera/microfone e redução do custo de diagnósticos somente se houver métrica comprovada. A alteração no servidor de estados deve ser separada para preservar as correções recentes de PostgreSQL e ranking.

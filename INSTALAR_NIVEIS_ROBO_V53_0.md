# MAU-MAU CANDEIAS — V53.0 | Níveis de dificuldade do robô

## O que foi implementado
- Fácil, Normal e Difícil: seletor na área do anfitrião junto de **Adicionar máquina**.
- O nível escolhido vale para todas as máquinas permanentes daquela sala.
- O nível também aparece na ficha das máquinas para todos os participantes.
- O anfitrião pode mudar o nível apenas no lobby ou no intervalo entre rodadas; a rodada atual nunca muda de comportamento no meio.
- Salas já existentes iniciam em **Normal**, mantendo a estratégia do bot anterior. O nível é salvo com o snapshot da sala, inclusive após deploy/reconexão.
- Jogadores humanos em AUTO por desconexão mantêm a estratégia Normal, independentemente do nível selecionado.
- Nada muda no ranking: uma partida iniciada com máquinas permanece TREINO de acordo com as regras já existentes.

## Significado dos níveis

**Fácil (🟢)**: joga a primeira carta legal encontrada e não escolhe Carta Dupla por iniciativa própria. Continua obedecendo a regras de compra, Ação Rápida, Queima, 7, Ás, Dama, Valete etc.

**Normal (🟡)**: preserva integralmente a estratégia do robô da versão anterior: prioridades de cartas especiais, escolha do naipe com mais cartas e Carta Dupla quando aplicável.

**Difícil (🔴)**: considera a quantidade **pública** de cartas dos adversários, os naipes que possui, a penalidade das cartas e quando preservar/usar o Valete. O robô não vê as cartas privadas dos outros jogadores e continua obedecendo ao mesmo motor de regras.

## Como atualizar
1. Use o ZIP de atualização sobre a versão de produção com Fase 6B (ZIP mais recente enviado pelo usuário).
2. No GitHub, substitua **server.js**, **game-engine.js**, **bot-player.js**, **room-snapshot-store.js**, **public/app.js** e **public/styles.css**.
3. Adicione na raiz **bot-difficulty.js** e em tests/ **bot-difficulty-levels.test.js**.
4. Faça commit e confirme novo deploy no Render.
5. Abra uma sala com máquina; procure **🎯 Nível do robô** próximo a **Adicionar máquina**. Teste cada nível, inicio da rodada, troca entre rodadas, saída e reconexão.

## Preservação
Nenhuma regra de carta foi modificada. Nenhuma mudança em login, timers, áudio, vídeo, PostgreSQL, torneios, limite de jogadores ou observadores. Dificuldade afeta somente escolhas estratégicas dos bots permanentes, não a legalidade.

## Testes
- 150 testes disponíveis passaram (incluindo 36 partidas completas com bots nos três níveis).
- 1 teste de integração Socket.IO ficou pendente pela ausência de node_modules/socket.io-client no ambiente de inspeção. Esse teste deve ser executado em CI/Render com dependências instaladas.
- Seletor responsivo inspecionado em 320, 360, 390, 430 e 1366 px em Chromium.

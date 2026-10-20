# MAU-MAU CANDEIAS — Correção da Ação Rápida na primeira carta (V50.5)

**Base:** ZIP `mau-mau-multiplayer-main (9)(4).zip` enviado em 20/10/2026.

## Comportamento corrigido
- Quando uma carta comum é virada no início da rodada, **quem não está na vez** e possui cópia normal exatamente igual pode usar **Ação Rápida** (botão ⚡ ou toque direto na carta).
- A Ação Rápida remove somente uma carta; **não transfere a vez** e **não abre continuação de Queima**.
- Quem deveria iniciar a partida continua sendo o jogador da vez.
- Na própria vez, a **Queima** com continuação continua funcionando (inclusive sobre a carta de abertura).
- Cartas especiais não iniciam Queima ou Ação Rápida.
- O servidor continua sendo a autoridade sobre o turno e envia o estado aos clientes.

## Arquivos alterados
- `game-engine.js` — autorização e turno da reação de abertura.
- `server.js` — seleção de bot automática alinhada com a regra.
- `public/app.js` — toque direto fora da vez vira Ação Rápida; mensagens adequadas.
- `public/index.html` — regras apresentadas ao usuário.
- `README.md` — referências históricas ao atalho de abertura atualizadas.
- `tests/opening-burn.test.js` — regressões de 2 a 5 jogadores, primeira jogada, cartas especiais e Queima normal.
- `tests/turn-integrity-v4042.test.js` — remove expectativa de roubo de vez.
- `tests/burn-ux-contract.test.js` — valida novo atalho de Ação Rápida.
- `CHANGELOG.md` — histórico da correção.

## Instalação
1. Extraia o ZIP de atualização.
2. Copie cada arquivo para a **mesma pasta relativa** do repositório GitHub.
3. Não apague outros arquivos e não substitua credenciais do LiveKit ou do Render.
4. Aguarde o deploy e teste com dois jogadores: quem não está na vez faz Ação Rápida com cópia da carta inicial, e a vez deve permanecer com quem começou.

Não foram alterados módulos de câmera, microfone, ranking, cartas especiais, conexão ou persistência.

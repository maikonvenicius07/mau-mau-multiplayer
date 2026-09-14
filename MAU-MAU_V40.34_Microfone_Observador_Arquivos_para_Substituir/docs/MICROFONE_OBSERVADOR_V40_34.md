# V40.34 — Microfone no Modo Observador

O observador pode ligar/desligar o mesmo microfone ao vivo usado pelos jogadores.

## Segurança preservada

- Observador não ocupa vaga de jogador.
- Estado do observador continua com `hand: []`.
- Nenhuma carta privada é enviada ao navegador do observador.
- Ações de jogo continuam bloqueadas no servidor para `ROLE_SPECTATOR`.
- O servidor repassa apenas a sinalização WebRTC; o áudio é P2P.

## Voz

- Jogador ↔ jogador.
- Jogador ↔ observador.
- Observador ↔ observador.
- Reconexão automática e TURN opcional continuam disponíveis.

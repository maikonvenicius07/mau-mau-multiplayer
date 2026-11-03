# MAU-MAU CANDEIAS

Jogo multiplayer de Mau-Mau para web/PWA, com salas em tempo real via Socket.IO, reconexão, observadores, ranking, torneios, câmera e voz.

## Estado do projeto

- Backend: Node.js + Express + Socket.IO.
- Persistência: PostgreSQL para recursos persistentes do projeto.
- Frontend: HTML/CSS/JavaScript em `public/`.
- Node esperado pelo projeto: `22.22.0`.
- Entrada do servidor: `server.js`.
- Deploy: `render.yaml`.

As regras de jogo já validadas não devem ser alteradas durante refatorações de performance ou layout.

## Instalação local

```bash
npm ci
npm start
```

Para validar o projeto:

```bash
npm run verify
```

Para rodar somente a suíte de testes:

```bash
npm test
```

## Estrutura principal

```text
public/                     interface do jogo
server.js                   servidor principal e Socket.IO
game-engine.js              regras do Mau-Mau
bot-player.js               comportamento dos bots
room-lifecycle.js           ciclo de vida das salas
room-snapshot-store.js      persistência/recuperação de salas
ranking-store.js            ranking
spectator-seat-admission.js entrada de observador como jogador
tournament-*.js             torneios
tests/                      testes automatizados
docs/                       documentação técnica
```

## Documentação atual

- Regras: `docs/REGRAS.md`
- Status Pré-APK: `docs/PRE_APK_STATUS.md`
- Deploy no Render: `docs/DEPLOY_RENDER.md`
- Modo observador: `docs/MODO_OBSERVADOR.md`
- Microfone: `docs/MICROFONE_V40_33.md`
- Performance: `docs/PERFORMANCE_V40_46.md`
- Limpeza atual: `docs/LIMPEZA_PROJETO_V52.md`

## Histórico antigo

Notas de atualização, instalação e validação antigas foram preservadas em:

`docs/archive/root-history/`

Elas não são necessárias para executar o jogo.

## Regra de manutenção

Ao fazer uma melhoria:

1. não alterar regra de jogo sem pedido explícito;
2. preferir mudanças pequenas e testáveis;
3. executar `node --check` nos arquivos JavaScript modificados;
4. executar os testes antes do deploy;
5. evitar adicionar novas sobreposições de CSS quando uma regra existente pode ser consolidada.

# Validação — MAU-MAU CANDEIAS / Fase 4A

**Base:** pacote completo de otimização Fase 3A.

## Testes automatizados locais

- **143 testes aprovados** entre os executados; **0 falhas**.
- **1 teste pendente**: `tests/socketio-integration-v4063.test.js`, não executado por ausência das dependências de Socket.IO no ambiente de teste.
- `node --check` passou em `server.js`, `state-delivery.js`, `public/app.js` e `game-engine.js`.
- `node scripts/check-lockfile.js` validou o `package-lock.json`, sem alterações de dependências.
- Novos testes `state-delivery-phase4a.test.js` e `emit-room-phase4a.test.js` passaram.

## Casos validados com simulação da função real

1. Primeiro estado de dois jogadores e um observador enviado a cada um.
2. Segunda chamada de `emitRoom` sem mudança: **nenhum** `state` repetido.
3. Alteração de pontuação: **todos** recebem estado atualizado.
4. Invalidação em nova entrada: state completo enviado mesmo que os dados sejam iguais.
5. Observador recebe `me.hand=[]` e não recebe a mão privada dos jogadores.
6. Promoção do observador: papel muda para PLAYER e o estado novo é entregue.
7. Mudança de sala, participante, papel ou partida invalida a comparação por escopo.
8. Payload não serializável não é suprimido artificialmente.
9. Testes anteriores de concorrência de vagas de observadores e chaves de torneio continuam passando.

## Limitações

- A validação de eventos Socket.IO com clientes reais **não pôde rodar** neste ambiente sem as dependências instaladas.
- Não foi possível medir tráfego real, CPU, memória, reconexão de rede móvel nem uma partida ponta a ponta com voz/câmera no Render.
- Esta atualização reduz apenas **emissões redundantes de `state`**. Ela ainda calcula o estado completo para fazer a comparação; a redução do custo dessa geração pode ser estudada somente após medir os resultados desta fase.

**Critério para avançar:** confirmar em produção que jogadores e observadores continuam sincronizados, especialmente reconexão e promoção de Observador para jogador.

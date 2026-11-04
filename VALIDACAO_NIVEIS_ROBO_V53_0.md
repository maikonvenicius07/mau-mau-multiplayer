# Verificação técnica — V53.0

## Arquivos de execução alterados
- `bot-player.js`: três estratégias de escolha; Normal preserva comportamento antigo.
- `bot-difficulty.js`: enum de níveis e Normal como fallback; AUTO permanece Normal.
- `game-engine.js`: valor padrão e campo público de dificuldade.
- `room-snapshot-store.js`: restauração e saneamento da dificuldade.
- `server.js`: evento `setBotDifficulty`, validado exclusivamente no servidor; host apenas, lobby/intervalo, sem torneios, com robô na sala.
- `public/app.js`: controle do anfitrião, etiqueta do nível na ficha do bot, renderização seletiva respeitando mudança de nível.
- `public/styles.css`: estilo pequeno e responsivo do seletor.

## Testes
- `node --check`: sintaxe dos arquivos JS modificados aprovada.
- 150 testes disponíveis passaram; 1 integração Socket.IO indisponível por ausência de `socket.io-client` no ambiente local.
- 36 partidas completas simuladas (12 por nível) concluídas, 11.433 ações na execução de desenvolvimento; outros números variam com embaralhamento.
- Salas antigas sem `botDifficulty`: restauram como Normal.
- AUTO de desconexão não usa dificuldade da máquina.
- Os níveis não recebem cartas privadas de adversários: apenas o tamanho público da mão.
- Chromium headless: seletor visível sem rolagem horizontal em 320/360/390/430/1366 px.

## Testes que precisam de aparelhos reais no Render
1. Criar sala com máquina e alternar níveis entre rodadas; verificar atualização em dois celulares.
2. Jogar 5 rodadas em cada nível, inclusive 7, Queima, Carta Dupla e Dama.
3. Testar 2 a 5 participantes, com robôs e humanos.
4. Validar saída, reconexão, observador, bot temporário e ranking TREINO.
5. Confirmar que torneios continuam sem máquinas.

Os testes automatizados não substituem estas verificações de produção.

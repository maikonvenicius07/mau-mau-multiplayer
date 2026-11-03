# Análise completa — Mau-Mau Candeias V40.3

## Resultado geral
A base recebida estava funcional e passou na suíte existente de 30 testes. A auditoria encontrou um defeito real na abertura da rodada: a primeira carta virada não criava janela de Queima, portanto uma cópia exatamente igual na mão de um jogador fora da vez não podia ser usada.

A V40.3 corrige esse caso e adiciona um teste específico. Após a correção, a suíte completa passou com 31 testes.

## Correção principal — Queima da primeira carta
Regra consolidada:
- a carta inicial da rodada continua sendo uma carta normal;
- enquanto ninguém realizou a primeira ação normal, qualquer jogador com uma carta normal exatamente igual (mesmo valor e mesmo naipe) pode Queimar, mesmo fora da vez;
- a primeira Queima válida encerra a janela de abertura;
- quem queimou assume a jogada e recebe a continuação normal da Queima;
- cartas especiais A, 7, 8, J, Q e K continuam proibidas para iniciar Queima;
- depois da primeira ação normal, volta a regra comum: Queima com continuação na própria vez e Ação Rápida fora da vez.

Exemplo validado: 2♣ na mesa + 2♣ na mão de jogador fora da vez = Queima permitida.

## Funções revisadas
- Baralho: 2 baralhos tradicionais sem curingas, 104 cartas.
- Partida: 2 a 5 jogadores, 6 cartas, 5 rodadas.
- Jogada normal por valor/naipe e Valete como coringa de naipe.
- Compra livre de 1 carta e possibilidade de jogar qualquer carta válida depois da compra ou passar.
- Mau-Mau e Mau-Mau batendo/queimando.
- Queima e continuação opcional.
- Ação Rápida com carta normal exatamente igual e sem roubar a vez.
- Carta Dupla somente com cartas normais idênticas.
- Ás, 7, 8, Valete, Dama e Rei, inclusive efeitos quando usados para bater.
- Cadeia de 7 e cadeia final de 7.
- Pontuação e Conferência da Rodada.
- Bots e vagas humanas em AUTO.
- Reconexão Inteligente de 60 segundos.
- SUA VEZ com animação, som e vibração opcional.
- Chat, efeitos sociais e Áudio Rápido de 15 segundos.
- Música dinâmica e volume independente.
- Login Google obrigatório e sessão HttpOnly.
- Ranking PostgreSQL por período e modo.
- Jogadores Online e convites.
- Busca Automática / matchmaking de 2 a 5 jogadores.
- Layout mobile, avatares e organização visual da mão.

## Verificações estruturais
- Sintaxe de server.js, game-engine.js, bot-player.js, ranking-store.js e public/app.js: OK.
- IDs HTML duplicados: nenhum.
- Funções nomeadas duplicadas nos arquivos principais: nenhuma.
- Assets referenciados ausentes: nenhum.
- Segredos reais como DATABASE_URL, chave privada ou Google Client Secret no projeto: não encontrados.
- Inconsistência de versão do package.json recebida: corrigida para 40.3.0.

## Limitações que não são defeitos desta versão
O estado das salas, presença online, convites, fila de matchmaking e timers de reconexão vivem em memória no processo Node.js. Um reinício/deploy do servidor encerra esses estados transitórios. O PostgreSQL persiste o ranking, não a partida em andamento.

Alguns comportamentos dependem de teste real após deploy e não podem ser validados somente pela suíte local: Login Google real, PostgreSQL remoto, microfone/permissões, vibração do aparelho e interação simultânea entre navegadores/celulares diferentes.

## Resultado dos testes
31 testes automáticos aprovados, incluindo simulação de 50 partidas completas entre bots e o novo teste da Queima da primeira carta.

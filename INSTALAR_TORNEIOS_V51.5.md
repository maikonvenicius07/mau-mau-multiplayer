# MAU-MAU CANDEIAS — V51.5 | Classificação, fases e campeões

**Base:** V51.4 — Mesas jogáveis.

## Atualização pelo GitHub
1. Faça cópia de segurança da versão funcionando.
2. Extraia o ZIP `...ATUALIZACAO.zip` e copie os arquivos nas mesmas pastas do GitHub, sem apagar outros arquivos.
3. Faça o commit e aguarde o deploy do Render.
4. Confira o log do Render: não deve haver mensagens de falha em `tournamentBracket.init` / fases de torneio. O servidor acrescenta automaticamente a tabela `mm_tournament_stage_tables` ao PostgreSQL; não execute comandos SQL manuais.
5. Não altere o LiveKit nem as credenciais do microfone/câmera. Não é preciso definir variável nova.

## Fluxo do torneio
1. Qualquer conta autenticada pode criar seu torneio e abrir inscrições. Apenas o criador administra e exclui o seu.
2. O organizador encerra as inscrições e sorteia uma única vez as mesas da primeira fase. Não há escolha manual de companheiros/adversários.
3. Cada jogador utiliza **Entrar na minha mesa**. São sempre cinco rodadas; só os sorteados podem ocupar as vagas.
4. **Todas as mesas de uma fase devem concluir com os participantes previstos.** O resultado é salvo com identidades internas das contas (não exibidas ao público).
5. O sistema seleciona os classificados pela menor pontuação final e sorteia a fase seguinte automaticamente, sem intervenção do organizador e sem opção de refazer a composição.
6. Terminada a última mesa, é declarado o campeão (ou campeões em caso de empate na menor pontuação da final). Em **Ranking → Resultados dos torneios** ficam os vencedores e a classificação final. As vitórias de torneio **não** integram o Ranking Oficial.

## Formatos automáticos
- **2–5 inscritos:** uma mesa, que decide o campeão.
- **6–10:** duas mesas classificatórias; dois melhores de cada → final com quatro jogadores.
- **11–25:** 3–5 classificatórias; dois melhores de cada → duas semifinais; dois melhores por semifinal → final.
- **26–50:** 6–10 classificatórias; primeiro colocado de cada → semifinais → final.
- **51–100:** 11–20 classificatórias; primeiro de cada → quartas → semifinais → final.

Cada fase usa um novo sorteio criptograficamente aleatório (`crypto.randomInt`). Em empate pela última vaga, a vaga é decidida por sorteio automático entre os empatados; esse critério deve ser divulgado aos inscritos antes da disputa. Na final, empates na menor pontuação produzem campeões compartilhados.

## Teste recomendado
Crie **um torneio novo de teste** com 4 jogadores e conclua a mesa; confira o campeão no Ranking. Depois, teste 8 jogadores em duas mesas e confirme que apenas depois de ambos os resultados a final de quatro jogadores é sorteada. Verifique exclusão do torneio pelo criador e recusa de outras contas.

## Limitações / cuidados
- A V51.5 não presume identificações a partir dos nomes em resultados antigos. **Torneios com partidas finalizadas antes da atualização podem não avançar automaticamente**; organize um novo torneio para validar a sequência completa.
- Se um resultado for parcial por ausência de jogador, **não há avanço automático**: é necessária resolução administrativa/revisão; não se inventam pontuações.
- A atualização foi verificada com testes locais; a integração real com PostgreSQL/Socket.IO no Render precisa ser confirmada após o deploy.
- Não foram modificadas as regras das cartas, Jogada Rápida, Queima, bots, reconexão, câmeras, microfones nem adicionadas gravações.

## Arquivos alterados
`tournament-bracket.js` (novo), `server.js`, `public/tournament-ui.js`, `public/index.html`, `public/styles.css`, `tests/tournament-bracket-v515.test.js` (novo), testes antigos atualizados para o novo identificador da interface e este guia.

# MAU-MAU CANDEIAS V51.4 — Mesas de Torneio Jogáveis

## Objetivo

A versão V51.4 transforma as mesas sorteadas na V51.3.1 em **salas jogáveis reais** do MAU-MAU, sem modificar o motor das regras das cartas nem o Ranking Oficial.

## Instalação

1. Faça backup da versão implantada (V51.3.1).
2. Extraia `MAU_MAU_CANDEIAS_V51_4_MESAS_JOGAVEIS_ATUALIZACAO.zip`.
3. Substitua e adicione no GitHub apenas os arquivos contidos no pacote, mantendo a hierarquia de diretórios.
4. Verifique o deploy no Render. A tabela `mm_tournament_table_games` será criada automaticamente quando o servidor iniciar com um PostgreSQL acessível.
5. Não é preciso configurar novas variáveis de ambiente; as credenciais do LiveKit permanecem inalteradas.

## Teste com jogadores reais

1. Entre em **Torneios** usando uma conta conectada e crie um torneio.
2. Abra inscrições, inscreva de 2 a 5 contas diferentes (ou mais para múltiplas mesas), encerre inscrições e sorteie.
3. Cada participante abre Torneios e vê **🎮 Entrar na minha mesa** somente na mesa atribuída à própria conta.
4. O primeiro jogador cria a sala automaticamente. Os demais entram na mesma sala pelo botão, sem digitar código.
5. A primeira rodada só pode ser iniciada depois que todos os sorteados daquela mesa estiverem presentes.
6. O anfitrião da mesa inicia normalmente; a partida mantém as cinco rodadas e os controles existentes.
7. Após a partida, reabra Torneios para consultar **🏆 Resultado da mesa** com colocações e pontuação final.

## Restrições e segurança

- Conta não sorteada é rejeitada como jogadora, mesmo que descubra o código da sala.
- Não há máquinas como participantes adicionados manualmente, nem revanche dentro da mesa de torneio.
- O torneio pode ter observadores conforme as regras já existentes; observadores não ocupam vagas sorteadas.
- O resultado é salvo uma única vez e separado do Ranking Oficial/Treino.
- Somente nomes, pontuação, colocação e indicação de vitória são gravados. Nenhuma carta da mão, áudio ou vídeo é gravado.
- Em abandono voluntário durante a partida, o bot temporário/permanente continua seguindo o comportamento anterior; caso um participante deixe de constar no resultado, o relatório é sinalizado como **parcial**.
- Se a sala expirar antes de terminar, o sistema não inventa vencedores. A recuperação de mesas abandonadas e o avanço automático de classificados são trabalhos futuros.
- Torneios com salas em andamento não podem ser excluídos; campeonatos cujo sorteio já iniciou as salas não podem ser cancelados.

## O que fica para a versão seguinte

A montagem das fases seguintes (semifinal e final), política de desempates, avanço dos classificados e exibição do quadro oficial de campeões dentro do Ranking. A V51.4 não gera automaticamente uma segunda fase.

## Testes

Testes locais da criação da mesa, confirmação de identidade sorteada, impedimento de sala duplicada, registro idempotente do resultado e regressão do projeto. Teste Socket.IO completo e gravação em PostgreSQL de produção não foram executados neste ambiente: valide inicialmente em torneio de testes com 2–5 jogadores reais.

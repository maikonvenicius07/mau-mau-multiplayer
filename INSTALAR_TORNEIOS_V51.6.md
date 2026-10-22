# MAU-MAU CANDEIAS — V51.6 | Acompanhamento dos Torneios

**Base:** V51.5 Classificação, Semifinais, Final e Campeão.

## O que mudou
- Painel **Acompanhamento do torneio** dentro do diálogo Torneios.
- Fases com expansão para visualizar cada mesa, suas situações (aguardando, sala criada, em andamento, concluída), resultados e participantes classificados/eliminados quando a fase seguinte já existe.
- O servidor informa apenas a situação da sala ativa e o total de participantes conectados, sem revelar cartas, tokens ou chaves privadas.
- Botão **↻ Atualizar** para consultar dados atuais sem sair da tela.
- Nenhuma nova tabela de banco, gravação de áudio/vídeo ou mudança no motor das cartas.

## Instalação
1. Guarde backup da V51.5 em funcionamento.
2. Extraia o ZIP de atualização; copie os arquivos nas pastas equivalentes do GitHub, incluindo `public/tournament-dashboard.js`.
3. Aguarde o deploy do Render. Não altere as variáveis ou credenciais LiveKit.
4. Entre em **Torneios**, escolha um campeonato com mesas sorteadas e abra **Acompanhamento do torneio**.
5. Use **↻ Atualizar** após a entrada e conclusão das mesas. Expanda uma fase para ver a situação das mesas.
6. Após a formação da fase seguinte, os resultados da fase anterior mostrarão `Classificado` ou `Eliminado` por participante, identificados internamente pela conta (não pelo nome).

## Verificação recomendada
- Torneio novo com 4 jogadores: uma mesa e campeão no final.
- Torneio novo com 8 jogadores: duas mesas iniciais; as duas precisam encerrar para a final aparecer.
- Teste saída/reconexão e refresh manual; salas sem estado ao vivo no servidor mostram `Sala criada`, sem afirmar que estão em andamento.
- Testes reais Socket.IO e PostgreSQL Render não foram validados neste ambiente.

A versão mantém os resultados dos torneios separados do Ranking Oficial e não altera classificação, empates ou sorteios. 

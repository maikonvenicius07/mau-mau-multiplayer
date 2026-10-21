# MAU-MAU CANDEIAS — V51.0.3 — Vitórias por período

## Mudança
A seção do perfil passa a exibir **todas as vitórias** encontradas no período escolhido (Hoje, Semana, Mês ou Temporada) e na modalidade (Oficial/Treino).

Não existe mais limite fixo de 10 partidas na lista. Se houver 5 vitórias na semana, 10 no mês e 20 na temporada, são exibidas exatamente 5, 10 e 20, respectivamente. Os filtros seguem a definição atual de semana/mês/temporada do Ranking.

A seção mostra data, indicação de vitória e pontuação final. As seis estatísticas superiores continuam considerando **todas as partidas**, inclusive as derrotas.

## Implantação
1. Faça backup do projeto.
2. Substitua no GitHub os arquivos correspondentes aos do ZIP de atualização.
3. Execute o deploy no Render; não é necessário mudar variáveis de ambiente ou o LiveKit.
4. Atualize a página e confira os filtros do Meu Perfil e de perfis de outros jogadores.

## Privacidade e armazenamento
Nenhuma tabela, migração ou gravação nova. Os resultados são lidos das partidas já registradas. Vídeo, áudio e cartas privadas não são armazenados por esta funcionalidade.

## Observação de escala
A lista inclui todas as vitórias do período; perfis com histórico muito extenso podem levar mais tempo para carregar. Se isso ocorrer no futuro, podemos carregar as vitórias em lotes, sem diminuir a quantidade disponível.

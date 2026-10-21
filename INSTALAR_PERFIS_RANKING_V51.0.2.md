# MAU-MAU CANDEIAS — V51.0.2: perfis acessíveis no ranking

Base: `mau-mau-multiplayer-main (14).zip` (V51.0.1).

## Mudanças
- O atalho `Meu Perfil` foi retirado somente do menu inicial.
- O acesso `Abrir Meu Perfil` continua na janela Ranking.
- A lista do Ranking apresenta `👤 Ver perfil` de forma visível em cada jogador.
- Ao tocar, abre o perfil estatístico já existente, com vitórias, aproveitamento, colocação média, pontos e últimas partidas. Ao fechar, retorna ao Ranking.
- Os parâmetros de versão do CSS/JS foram atualizados para reduzir cache antigo.
- Nenhum dado de cartão, histórico de cartas, áudio ou vídeo é gravado. Não há migração do banco.

## Instalação
1. Faça backup do repositório.
2. Extraia o ZIP ATUALIZACAO na pasta raiz do repositório, preservando os caminhos `public/` e `tests/`.
3. Publique o commit no GitHub e aguarde o Render concluir o deploy.
4. Abra o jogo em uma janela atualizada, entre na sua conta, selecione Ranking → Temporada e toque em `Ver perfil` em uma linha.
5. Ao fechar o perfil do outro jogador, o Ranking deverá reaparecer. Confirme que o botão `Meu Perfil` existe apenas dentro do Ranking.

Observação: a consulta de outros perfis depende da autenticação atual do jogo. Não é necessário alterar LiveKit ou variáveis do Render.

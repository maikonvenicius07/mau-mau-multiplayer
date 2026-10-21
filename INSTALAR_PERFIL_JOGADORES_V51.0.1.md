# V51.0.1 — Ver perfil de outro jogador pelo ranking

Base: V51.0 Perfil Estatístico Básico aprovada. **Não instalar a V51.0 antiga de contadores de jogadas.**

## Instalação

1. Faça backup do projeto no GitHub.
2. Do ZIP de atualização, substitua `server.js`, `public/app.js`, `public/index.html`, `public/styles.css` e adicione o arquivo de teste e este guia.
3. Faça commit e aguarde o deploy do Render.
4. Entre na sua conta, abra Ranking e toque no nome de um jogador.
5. Confira as seis estatísticas básicas e até dez partidas recentes, alterne entre Oficial/Treino e Hoje/Semana/Mês/Temporada.
6. Feche o perfil para retornar ao Ranking. O botão **Meu Perfil** continua abrindo seus próprios dados.

## Preservação

Sem alterações nas regras, no ranking por vitórias, no PostgreSQL ou nos dados privados. Nenhum contador de Queimas, Jogadas Rápidas, Cartas Duplas ou penalidades. Nenhuma gravação de áudio/vídeo.

## Teste

`node tests/profile-from-ranking-v5101.test.js`

A integração em produção ainda deve ser testada com contas reais.

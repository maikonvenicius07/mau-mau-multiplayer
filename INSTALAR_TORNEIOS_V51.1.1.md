# MAU-MAU CANDEIAS V51.1.1 — Torneios no menu inicial

## Escopo
- Move **🏆 Torneios** de dentro de Ranking para os atalhos da tela inicial, ao lado de Ranking, Minha Música e Ver Regras.
- Dentro de Ranking mantém a classificação usual por vitórias e inclui um painel recolhido **🏅 Resultados dos torneios** com informação clara: ainda não existe registro de partidas nem resultados específicos de torneios na V51.1. 
- Não anuncia função **Criar torneio**, pois a versão V51.1 atualmente permite apenas inscrição/cancelamento em torneio configurado pelo administrador no Render.
- Não modifica backend, banco, regras, ranking de vitórias, jogo ou credenciais.

## Instalação
1. Faça backup do projeto existente.
2. Extraia o ZIP de atualização e copie cada arquivo para o mesmo caminho dentro do repositório GitHub.
3. Faça commit e aguarde o deploy no Render.
4. No navegador, atualize a página e procure **🏆 Torneios** no menu inicial.
5. Teste o acesso às inscrições, o fechamento da janela e o acesso ao Ranking separado.
6. Em Ranking, expanda **🏅 Resultados dos torneios**. O painel mostrará apenas uma mensagem informativa até que exista uma funcionalidade futura de apuração oficial.

## Cuidados
- Não são criados resultados fictícios nem misturados resultados de campeonatos ao Ranking Oficial.
- A criação de torneios pela interface e o registro automático de resultados ainda não existem e exigem uma versão posterior, com regulamento aprovado.
- As variáveis do LiveKit não mudam.

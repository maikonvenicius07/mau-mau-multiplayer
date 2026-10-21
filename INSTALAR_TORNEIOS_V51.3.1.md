# MAU-MAU CANDEIAS — V51.3.1: Torneios por qualquer jogador

## O que mudou

- Qualquer **jogador autenticado** (Google ou e-mail) pode criar um campeonato no menu **🏆 Torneios**.
- A conta que cria o torneio pode editar seus dados, abrir/fechar inscrições, sortear as mesas e **excluir definitivamente o torneio**.
- Os demais usuários podem consultar e inscrever-se enquanto as inscrições estiverem abertas, mas não podem administrar nem apagar torneios alheios.
- Exclusão definitiva exige confirmação e remove **somente** as inscrições e mesas daquele torneio; Ranking, perfis, resultados e outros campeonatos não são afetados.
- Torneios antigos criados automaticamente como `legacy-v51.1` não pertencem a uma conta comum. Permanecem preservados e só podem ser administrados por um moderador previamente autorizado, quando houver. Isso impede que um usuário apague dados antigos de terceiros.
- Controles antigos de administração global continuam possíveis, se já configurados, mas **não são necessários para criar seu próprio torneio**.

## Como instalar

1. Faça backup da versão que está no GitHub.
2. Copie os arquivos do ZIP **ATUALIZAÇÃO** para as mesmas pastas do repositório, inclusive os novos arquivos de testes e este guia.
3. Faça commit e aguarde o deploy do Render.
4. **Não precisa adicionar `MAUMAU_TOURNAMENT_ADMIN_EMAILS`** para criação e administração do seu próprio campeonato. A variável existente pode permanecer se você mantiver moderadores globais.
5. Entre em uma conta comum, abra **🏆 Torneios**, preencha nome/vagas/data e escolha **+ Criar torneio**.
6. Selecione o campeonato recém-criado. Poderá abrir inscrições, salvar alterações, sortear depois do encerramento, cancelar ou clicar em **🗑 Excluir meu torneio**.

## Testes recomendados no Render

- Conta A cria um torneio; o botão Excluir aparece habilitado para A.
- Conta B pode ver o mesmo torneio e inscrever-se quando estiver aberto, mas não pode editar, sortear ou excluir.
- Conta B cria seu próprio torneio e pode excluí-lo.
- Exclua o torneio de teste de A; sua lista de inscritos e grupos devem desaparecer; o torneio de B não pode ser afetado.
- Confira se o Ranking e as partidas continuam funcionando.

## Observações

- A exclusão de um torneio é **irreversível** e exige confirmação na interface.
- **Cancelar** é diferente de excluir: o cancelamento conserva o registro do torneio, enquanto excluir o remove definitivamente.
- A versão não cria partidas automáticas, não modifica cartas nem faz gravações de áudio ou vídeo.
- A persistência em produção continua utilizando PostgreSQL; a instalação é aditiva e não requer nova variável ou migração destrutiva.
- A integração com o banco de produção e duas contas reais deve ser validada após o deploy.

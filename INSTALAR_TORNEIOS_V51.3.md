# MAU-MAU CANDEIAS — V51.3 — Sorteio das mesas

## O que mudou
- Torneios continuam no menu principal; Ranking não sofre alteração.
- Administrador pode sortear inscritos em mesas equilibradas de **2 a 5 jogadores por mesa**, após encerrar as inscrições.
- O sorteio é efetuado uma vez e persistido no banco; atualizar página ou reiniciar Render não muda os grupos.
- Jogadores e observadores podem consultar a lista de mesas sorteadas, sem permissão para sortear ou editar.
- A tela explica quando a conta atual não tem autorização administrativa.
- O sorteio NÃO cria salas nem partidas automaticamente; resultados de campeonato ficam para próxima versão.
- Não altera cartas, bots, ranking, câmera, microfone, reconexão, nem grava mídias.

## ATENÇÃO: por que você vê apenas 'Em preparação'?
A mensagem 'Em preparação' é normal enquanto as inscrições do torneio estiverem fechadas e nenhuma inscrição tiver sido feita. O botão 'Administrar torneios' é exibido APENAS para conta autenticada e autorizada, a partir de uma configuração no Render. Instalar a nova versão NÃO concede essa autorização automaticamente.

## Autorizar sua conta no Render (obrigatório para administrar)
1. Acesse Render > mau-mau-multiplayer > Environment.
2. Adicione a chave `MAUMAU_TOURNAMENT_ADMIN_EMAILS`.
3. No VALOR, informe **exatamente o e-mail utilizado no login do MAU-MAU**, não o apelido público. Para vários admins, separe por vírgula.
4. Salve e conclua o deploy. Depois saia e entre novamente na conta autorizada.
5. Abra 🏆 Torneios pela tela principal. Você deverá enxergar `⚙️ Administrar torneios`.
6. Se não aparecer, confira se o e-mail logado é o mesmo configurado e se o deploy terminou.
7. Alternativa técnica para contas cuja sessão não exponha e-mail: `MAUMAU_TOURNAMENT_ADMIN_KEYS`, preenchido com a identificação permanente (`playerKey`) da conta — nunca com apelido; não publique a chave no GitHub.

**Não envie senhas ou valores de chaves privadas pelo chat ou em prints.**

## Como sortear
1. Como administrador, selecione um torneio ou crie um novo.
2. Defina o nome, a data e a capacidade. Clique em **Abrir inscrições**.
3. Jogadores autenticados entram no torneio; verifique os nomes na lista de inscritos.
4. Com pelo menos **2 inscritos**, clique em **Encerrar inscrições**.
5. Clique em **Sortear mesas** e confirme. O sorteio é único e fica salvo.
6. As mesas aparecem abaixo dos inscritos. Não é possível reabrir inscrições após o sorteio.

## Dados e segurança
- PostgreSQL: cria apenas a tabela `mm_tournament_table_seats`, sem alterar inscrições e resultados já existentes.
- Armazena número da mesa, assento e conta inscrita; ao exibir, devolve somente nome e número do assento, sem o `playerKey`.
- Com DATABASE_URL de produção os grupos persistem após deploy; o modo JSON é somente para desenvolvimento local.
- Inscrições só podem ser encerradas por administrador. O POST de sorteio valida a conta no servidor.

## Testes
- Sorteio com 2–100 pessoas, nenhuma mesa de 1 e máximo de 5 jogadores.
- Repetição de sorteio negada e reabertura das inscrições negada após sorteio.
- Persistência em modo JSON e testes estáticos de autenticação/autorização.
- Em produção, ainda é preciso testar dois aparelhos e confirmar a nova tabela criada no PostgreSQL.

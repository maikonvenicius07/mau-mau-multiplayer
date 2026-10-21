# MAU-MAU CANDEIAS V51.2 — Criação e administração de torneios

## O que esta versão faz
- Mantém Torneios no menu inicial e os resultados futuros dentro do Ranking.
- Administradores autorizados podem criar, editar, abrir/encerrar inscrições e cancelar torneios na interface.
- Usuários comuns podem consultar campeonatos e se inscrever/cancelar somente durante o período aberto.
- Torneios novos começam com inscrições FECHADAS (rascunho).
- O cancelamento preserva inscrições/histórico do evento; não apaga partidas.
- Ainda NÃO há sorteio de mesas, disputa nem resultado automático de torneio nesta versão.

## Como instalar
1. Faça backup da versão atual do projeto.
2. Envie os arquivos do ZIP de atualização para os mesmos caminhos do GitHub.
3. No Render > serviço do MAU-MAU > Environment, acrescente **MAUMAU_TOURNAMENT_ADMIN_EMAILS** com o endereço de e-mail da sua conta de login no jogo. Exemplo (FICTÍCIO): `administrador@exemplo.com`. Para mais de um administrador, separe e-mails por vírgula.
4. Alternativamente, use `MAUMAU_TOURNAMENT_ADMIN_KEYS` com as identidades permanentes `playerKey` das contas autorizadas. Não use apelidos, porque podem mudar.
5. Salve as variáveis e conclua o deploy.
6. Entre novamente no jogo com a conta autorizada, abra Torneios no menu principal e confira a seção **Administrar torneios**.
7. Crie um torneio, defina nome, vagas e data; clique em **Abrir inscrições** somente quando desejar disponibilizá-las.
8. Faça teste com outra conta de jogador: ela deve enxergar inscrições, mas NÃO os controles administrativos.

## Compatibilidade e preservação
- Cria a tabela `mm_tournaments` no PostgreSQL de forma aditiva, sem alterar `mm_tournament_signups` ou o ranking.
- O campeonato legado da V51.1 é importado automaticamente para o catálogo usando o identificador configurado em `MAUMAU_TOURNAMENT_ID`, preservando suas inscrições.
- As antigas variáveis `MAUMAU_TOURNAMENT_ID/NAME/CAPACITY/START_AT/OPEN` só determinam o cadastro inicial do campeonato legado; depois, mudanças feitas pela interface ficam armazenadas no banco.
- Não modifica lógica de cartas, rodada, microfone, câmera, bots ou reconexão. Nenhum vídeo/áudio é gravado.
- O Render precisa estar conectado ao PostgreSQL para persistência em produção. Sem `DATABASE_URL`, o sistema utiliza arquivos JSON apenas para desenvolvimento local.
- O administrador é autenticado e autorizado pelo servidor. O painel não deve expor chaves ou segredos da aplicação.

## Testes de aceitação
1. Conta sem autorização: nunca deve criar ou editar torneio (403 na API).
2. Admin cria um campeonato: fica em preparação até abrir inscrições.
3. Vagas: inscrições duplicadas não criam duas entradas; não pode reduzir capacidade abaixo do total inscrito.
4. Inscrições fechadas/canceladas: ninguém entra ou sai por ação de inscrição.
5. Reinicie o serviço: eventos e inscrições devem permanecer no banco.
6. Ranking e regras das partidas devem funcionar da mesma maneira que antes.

## Observação sobre datas
A interface usa o horário de Rondônia (UTC−4) para cadastrar e apresentar a data do campeonato.

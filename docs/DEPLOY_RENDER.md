# Deploy no Render

## 1. Google Login

O jogo usa Google Identity Services no navegador e valida o ID token no servidor. Não existe modo visitante.

No Google Cloud / Google Auth Platform:

1. Crie ou selecione o projeto do Mau-Mau Candeias.
2. Configure Branding/Audience conforme o público pretendido.
3. Crie um cliente OAuth do tipo **Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, inclua a origem HTTPS do serviço Render, por exemplo:

```text
https://SEU-SERVICO.onrender.com
```

Para testes locais, adicione também:

```text
http://localhost:3000
```

O fluxo atual recebe a credencial do Google no navegador e a envia para `/api/auth/google`; não depende de um `GOOGLE_CLIENT_SECRET` no projeto.

No Render > Web Service > Environment, configure:

```text
GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
AUTH_SESSION_SECRET=UMA_CHAVE_LONGA_E_ALEATORIA
```

Mantenha `AUTH_SESSION_SECRET` estável em produção. Alterá-lo invalida as sessões abertas.

## 2. PostgreSQL para o ranking

Em produção, configure `DATABASE_URL` apontando para o PostgreSQL usado pelo ranking:

```text
DATABASE_URL=CONNECTION_STRING_DO_POSTGRESQL
```

As tabelas necessárias são criadas automaticamente na inicialização. Não é necessário criar manualmente `mm_players`, `mm_matches` ou `mm_match_results`.

Sem `DATABASE_URL`, o jogo usa `data/ranking.json`, adequado para desenvolvimento local, mas não indicado para hospedagem com filesystem efêmero.

Após o deploy, confirme nos logs:

```text
[ranking] armazenamento: postgres
```

## 3. Variáveis recomendadas no Render

- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `AUTH_SESSION_SECRET`

Não publique os valores dessas variáveis no GitHub.

## 4. Deploy

O `render.yaml` já define:

- runtime Node;
- `npm install` como build;
- `npm start` como start;
- `/health` como health check.

Depois de salvar as variáveis:

1. Faça o deploy do commit mais recente.
2. Aguarde o serviço ficar `Live`.
3. Abra o site em janela anônima.
4. Confirme o Login Google.
5. Crie uma sala e verifique o Socket.IO.
6. Conclua uma partida e confira o ranking.
7. Teste Jogadores Online/Convites e Buscar Jogadores com duas Contas Google diferentes.

## 5. Checklist de segurança

- Nunca commitar `.env`.
- Nunca commitar `DATABASE_URL` real.
- Nunca commitar `AUTH_SESSION_SECRET` real.
- Não colocar senha do PostgreSQL no código.
- Não colocar Client Secret Google no front-end ou no repositório.

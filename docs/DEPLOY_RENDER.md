# Deploy no Render — MAU-MAU CANDEIAS V40.69.1

## 1. Login universal

A V40.69.1 aceita **Google, Apple e e-mail com código de 6 dígitos**. Não existe modo visitante. A sessão do jogo continua em cookie HttpOnly e o `playerKey` autenticado é a identidade usada por ranking, presença e reconexão.

### Google

No Google Cloud / Google Auth Platform, mantenha um cliente OAuth do tipo **Aplicativo da Web** e inclua a origem HTTPS do Render em **Origens JavaScript autorizadas**.

No Render:

```text
GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
```

As contas Google antigas preservam o mesmo `playerKey` da versão anterior.

### E-mail sem senha — recomendado para liberar iPhone rapidamente

O servidor envia um código temporário de 6 dígitos. Esta versão usa a API do **Resend** para o envio.

No Render:

```text
RESEND_API_KEY=SUA_CHAVE_RESEND
EMAIL_FROM=Mau-Mau Candeias <login@seudominio.com>
```

O endereço/domínio usado em `EMAIL_FROM` precisa estar autorizado no serviço de envio. `EMAIL_OTP_DEV_MODE=1` existe somente para desenvolvimento local e não funciona em produção.

### Sign in with Apple — opcional nesta primeira publicação

Para habilitar o botão Apple no navegador/PWA, configure o Sign in with Apple no Apple Developer, um **Services ID** e uma Return URL HTTPS. O servidor valida o ID token e também troca o authorization code diretamente com a Apple.

No Render:

```text
APPLE_CLIENT_ID=SEU_SERVICES_ID
APPLE_REDIRECT_URI=https://SEU-SERVICO.onrender.com/
APPLE_TEAM_ID=SEU_TEAM_ID
APPLE_KEY_ID=SEU_KEY_ID
APPLE_PRIVATE_KEY=SUA_CHAVE_P8
```

`APPLE_PRIVATE_KEY` é segredo. Nunca publique o conteúdo da chave `.p8` no GitHub.

### Sessão

```text
AUTH_SESSION_SECRET=UMA_CHAVE_LONGA_E_ALEATORIA
```

Mantenha `AUTH_SESSION_SECRET` estável. Alterá-lo encerra as sessões abertas.

## 2. PostgreSQL

Configure:

```text
DATABASE_URL=CONNECTION_STRING_DO_POSTGRESQL
```

O PostgreSQL armazena ranking, snapshots das salas e a relação entre métodos de login e a identidade canônica do jogador. As tabelas são criadas automaticamente.

Após o deploy, os logs devem indicar armazenamento PostgreSQL para ranking, snapshots e identidades.

## 3. Variáveis mínimas recomendadas

Para continuar com Google e acrescentar login por e-mail imediatamente:

- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `AUTH_SESSION_SECRET`
- `MAX_ROOMS=10`
- `MAX_SPECTATORS_PER_ROOM=5`

As variáveis Apple podem ser adicionadas depois, sem retirar Google ou e-mail.

## 4. Deploy

O `render.yaml` usa Node, instala pelo lockfile quando disponível, executa a verificação do projeto e usa `/ready` como health check.

Depois de salvar as variáveis:

1. Faça o deploy do commit mais recente.
2. Aguarde o serviço ficar `Live`.
3. Teste primeiro uma conta Google já existente e confirme que o ranking continua vinculado à mesma identidade.
4. Teste o login por e-mail em janela anônima e em um iPhone/Safari.
5. Se Apple estiver configurado, teste o botão Apple e também a opção de ocultar o e-mail.
6. Crie uma sala, reconecte e confira ranking/presença.
7. Teste duas contas diferentes simultaneamente.

## 5. Segurança

- Nunca commitar `.env`, `DATABASE_URL`, `AUTH_SESSION_SECRET`, `RESEND_API_KEY` ou `APPLE_PRIVATE_KEY`.
- O OTP por e-mail expira em 10 minutos, possui limite de tentativas e rate limit por endereço/IP.
- O código do OTP não é armazenado em texto puro.
- O servidor valida Google, Apple e e-mail; o navegador não escolhe o `playerKey`.
- Nome e avatar continuam sendo apenas dados visuais e nunca provam identidade.

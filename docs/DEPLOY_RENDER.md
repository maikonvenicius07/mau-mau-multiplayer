# Deploy no Render — MAU-MAU CANDEIAS V40.69.2

## 1. Formas de entrada

A V40.69.2 aceita **Google**, **Apple** e **e-mail + PIN de 6 números**. Não existe modo visitante. A sessão do jogo usa cookie HttpOnly e o `playerKey` autenticado continua sendo a identidade usada por ranking, presença e reconexão.

### Google

No Google Cloud / Google Auth Platform, mantenha um cliente OAuth do tipo **Aplicativo da Web** e inclua a origem HTTPS do Render em **Origens JavaScript autorizadas**.

No Render:

```text
GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
```

As contas Google antigas preservam o mesmo `playerKey`.

### E-mail + PIN

Não usa Resend e não envia código. O jogador cria uma conta informando e-mail e um PIN de 6 números. O e-mail é um identificador de login; a posse da caixa postal não é verificada.

O PIN é derivado com `scrypt` e salt aleatório. Após várias tentativas incorretas há bloqueio temporário. Na criação da conta o jogo entrega uma chave de recuperação, exibida uma vez, que deve ser guardada pelo jogador.

Não há variáveis de ambiente adicionais para esse método.

### Sign in with Apple

Para habilitar o botão Apple, configure Sign in with Apple no Apple Developer, um **Services ID** e uma Return URL HTTPS.

No Render:

```text
APPLE_CLIENT_ID=SEU_SERVICES_ID
APPLE_REDIRECT_URI=https://SEU-SERVICO.onrender.com/
APPLE_TEAM_ID=SEU_TEAM_ID
APPLE_KEY_ID=SEU_KEY_ID
APPLE_PRIVATE_KEY=SUA_CHAVE_P8
```

`APPLE_PRIVATE_KEY` é segredo. Nunca publique a chave `.p8` no GitHub.

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

O PostgreSQL armazena ranking, snapshots, identidades Google/Apple e as credenciais protegidas de e-mail + PIN. As tabelas são criadas automaticamente.

## 3. Variáveis mínimas recomendadas

Para publicar com Google + e-mail/PIN:

- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `AUTH_SESSION_SECRET`
- `MAX_ROOMS=10`
- `MAX_SPECTATORS_PER_ROOM=5`

Para Apple, acrescente depois `APPLE_CLIENT_ID`, `APPLE_REDIRECT_URI`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`.

## 4. Deploy e teste

1. Faça o deploy do commit mais recente.
2. Aguarde o serviço ficar `Live`.
3. Teste uma conta Google antiga e confirme o mesmo ranking.
4. Crie uma conta nova por e-mail + PIN e guarde a chave de recuperação.
5. Saia e entre novamente com o mesmo e-mail + PIN.
6. Teste a recuperação trocando o PIN pela chave de recuperação.
7. Se Apple estiver configurado, teste o botão Apple no Safari/iPhone.
8. Crie uma sala, reconecte e confira ranking/presença.

## 5. Segurança

- Nunca commitar `.env`, `DATABASE_URL`, `AUTH_SESSION_SECRET` ou `APPLE_PRIVATE_KEY`.
- PIN e chave de recuperação não são armazenados em texto puro.
- O e-mail do modo PIN não é tratado como e-mail verificado e não auto-vincula Google/Apple.
- Google/Apple só usam e-mail verificado para a vinculação canônica existente.
- O navegador nunca escolhe o `playerKey`; a identidade é resolvida no servidor.

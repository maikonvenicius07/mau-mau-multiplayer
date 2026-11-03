# Deploy no Render — MAU-MAU CANDEIAS — Estado Pré-APK

## 1. Formas de entrada atuais

A versão atual usa **Google** ou **e-mail + senha**. Não existe modo visitante. O `playerKey` autenticado é a identidade persistente usada por ranking, presença e reconexão.

### Google

No Google Cloud / Google Auth Platform, mantenha um cliente OAuth do tipo **Aplicativo da Web** e inclua a origem HTTPS do jogo em **Origens JavaScript autorizadas**.

No Render:

```text
GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
```

As contas Google existentes preservam o mesmo `playerKey`.

### E-mail + senha

O jogador cria uma conta com e-mail e uma senha escolhida por ele, entre **6 e 60 caracteres**. A senha é derivada com `scrypt` e salt aleatório. Após 5 tentativas incorretas há bloqueio temporário de 15 minutos.

Contas antigas criadas com PIN de 6 números continuam compatíveis; esse PIN passa a funcionar como a senha atual até ser redefinido.

### Recuperação de senha por e-mail

Ao usar **Esqueci minha senha**, o servidor gera um código numérico de 6 dígitos. O código:

- vale por 10 minutos;
- é de uso único;
- aceita no máximo 5 tentativas;
- fica armazenado somente de forma protegida;
- é enviado ao e-mail cadastrado por meio do Resend.

No Render:

```text
RESEND_API_KEY=re_...
EMAIL_FROM=MAU-MAU CANDEIAS <noreply@maumaucandeias.com.br>
```

O domínio `maumaucandeias.com.br` deve permanecer verificado no Resend. Nunca publique a API key no GitHub ou em documentação.

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

O PostgreSQL armazena ranking, snapshots, identidades e credenciais protegidas das contas de e-mail + senha. As tabelas são criadas automaticamente.

## 3. Variáveis recomendadas em produção

- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `AUTH_SESSION_SECRET`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `ROOM_SNAPSHOT_TTL_MS=28800000`
- `VOICE_TURN_TTL_SECONDS=3600` quando TURN temporário estiver em uso
- `MAX_ROOMS=10`
- `MAX_SPECTATORS_PER_ROOM=5`

Credenciais TURN adicionais são opcionais conforme o provedor utilizado.

## 4. Reconexão em produção

- F5/reload, fechamento acidental, queda de internet e troca de rede **não são abandono voluntário**.
- A mesma conta autenticada recupera a própria cadeira por `playerKey`, preservando sala, posição, avatar, mão e pontuação.
- Depois de 60 segundos, o AUTO pode assumir temporariamente a cadeira; o jogador original continua podendo reassumir enquanto a sala existir.
- Se todos os humanos ficarem desconectados, começa o prazo global de **5 minutos**. Sem retorno, a sala e o snapshot são encerrados.
- **SAIR** é abandono voluntário.
- Ao tentar trocar de sala, o sistema confirma primeiro se o jogador quer voltar à partida ou sair e continuar para a nova sala.

## 5. Checklist de deploy

1. Faça o deploy do commit mais recente.
2. Aguarde `/ready` ficar saudável e o serviço ficar `Live`.
3. Teste uma conta Google existente e confirme a mesma identidade/ranking.
4. Crie uma conta nova por e-mail + senha.
5. Saia e entre novamente com a mesma senha.
6. Use **Esqueci minha senha**, confirme o recebimento do código e redefina a senha.
7. Inicie uma partida e teste F5/reload durante a rodada.
8. Teste retorno antes e depois do AUTO temporário.
9. Teste a confirmação ao tentar trocar voluntariamente de sala.
10. Confirme ranking, presença, observadores e voz após o deploy.

## 6. Segurança

- Nunca commitar `.env`, `DATABASE_URL`, `AUTH_SESSION_SECRET`, `RESEND_API_KEY` ou credenciais TURN.
- Senhas e códigos de recuperação não são armazenados em texto puro.
- O navegador não escolhe o `playerKey`; a identidade é resolvida no servidor.
- O modo e-mail/senha não deve ser usado para auto-vincular uma Conta Google apenas porque o texto do e-mail coincide.
- A interface Pré-APK atual não oferece login Apple.

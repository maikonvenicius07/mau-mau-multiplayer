'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const {AuthIdentityStore,normalizeEmail}=require('../auth-identity-store');
const U=require('../universal-auth');

(async()=>{
  const root=path.join(__dirname,'..');
  const pkg=require('../package.json');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const universal=fs.readFileSync(path.join(root,'universal-auth.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');

  assert.strictEqual(pkg.version,'40.69.2');
  assert.strictEqual(normalizeEmail('  Jogador@Exemplo.COM '),'jogador@exemplo.com');
  assert.strictEqual(normalizeEmail('invalido'),'');

  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mau-auth-'));
  const filePath=path.join(tmp,'auth.json');
  const store=new AuthIdentityStore({databaseUrl:'',filePath});
  await store.init();

  // Google antigo preserva o mesmo playerKey.
  const google=await store.resolveIdentity({provider:'google',subject:'google-sub-1',legacyPlayerKey:'g_legado_123',name:'Orlando',email:'orlando@example.com',picture:'https://example.com/a.jpg',verifiedEmail:true});
  assert.strictEqual(google.playerKey,'g_legado_123');
  // Apple com o mesmo e-mail VERIFICADO continua reutilizando a identidade Google.
  const appleSame=await store.resolveIdentity({provider:'apple',subject:'apple-sub-1',name:'Orlando',email:'orlando@example.com',verifiedEmail:true});
  assert.strictEqual(appleSame.playerKey,google.playerKey);
  // Relay Apple cria outra conta, como esperado.
  const appleRelay=await store.resolveIdentity({provider:'apple',subject:'apple-sub-relay',name:'Outro',email:'abc@privaterelay.appleid.com',verifiedEmail:true});
  assert.notStrictEqual(appleRelay.playerKey,google.playerKey);

  // E-mail + senha cria uma identidade própria SEM marcar a caixa postal como verificada.
  const passwordAccount=await store.registerEmailPassword({email:'novo@example.com',password:'MinhaSenha123!',name:'Novo'});
  assert(/^u_[0-9a-f]{40}$/.test(passwordAccount.user.playerKey));
  const passwordLogin=await store.loginEmailPassword({email:'novo@example.com',password:'MinhaSenha123!'});
  assert.strictEqual(passwordLogin.playerKey,passwordAccount.user.playerKey);
  await assert.rejects(()=>store.loginEmailPassword({email:'novo@example.com',password:'SenhaErrada123!'}),/incorreta/i);
  await assert.rejects(()=>store.registerEmailPassword({email:'curta@example.com',password:'12345',name:'Curta'}),/6.*60/i);
  const sixChars=await store.registerEmailPassword({email:'seis@example.com',password:'123456',name:'Seis'});
  assert.strictEqual((await store.loginEmailPassword({email:'seis@example.com',password:'123456'})).playerKey,sixChars.user.playerKey);
  const reset=await store.issueEmailPasswordResetCode({email:'novo@example.com'});
  const recovered=await store.resetEmailPasswordWithCode({email:'novo@example.com',code:reset.code,newPassword:'NovaSenha#2026'});
  assert.strictEqual(recovered.playerKey,passwordAccount.user.playerKey);
  await assert.rejects(()=>store.loginEmailPassword({email:'novo@example.com',password:'MinhaSenha123!'}),/incorreta/i);
  assert.strictEqual((await store.loginEmailPassword({email:'novo@example.com',password:'NovaSenha#2026'})).playerKey,passwordAccount.user.playerKey);

  // Compatibilidade: conta antiga com PIN de 6 números continua entrando pela tela nova de senha.
  const legacy=await store.registerEmailPin({email:'legado@example.com',pin:'111222',name:'Legado'});
  assert.strictEqual((await store.loginEmailPassword({email:'legado@example.com',password:'111222'})).playerKey,legacy.user.playerKey);

  // Segurança: um e-mail digitado manualmente não pode sequestrar futura identidade Google/Apple.
  const manual=await store.registerEmailPassword({email:'seguro@example.com',password:'Segura#1234',name:'Manual'});
  const googleVerified=await store.resolveIdentity({provider:'google',subject:'google-safe',legacyPlayerKey:'g_safe',name:'Google',email:'seguro@example.com',verifiedEmail:true});
  assert.notStrictEqual(googleVerified.playerKey,manual.user.playerKey,'e-mail + senha não verificado não deve auto-vincular Google');

  const reopened=new AuthIdentityStore({databaseUrl:'',filePath});
  await reopened.init();
  assert.strictEqual((await reopened.loginEmailPassword({email:'novo@example.com',password:'NovaSenha#2026'})).playerKey,passwordAccount.user.playerKey,'e-mail + senha deve sobreviver a reinício');

  const secret='segredo-teste-123';
  const challenge=U.createAppleChallenge(secret,{ttlMs:60000,now:1000});
  const parsed=U.verifyAppleChallenge(secret,challenge.state,{now:2000});
  assert.strictEqual(parsed.nonce,challenge.nonce);
  assert.strictEqual(U.verifyAppleChallenge('outro',challenge.state,{now:2000}),null);
  const {privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
  const appleSecret=U.createAppleClientSecret({clientId:'com.example.web',teamId:'TEAM123',keyId:'KEY123',privateKey:privateKey.export({type:'pkcs8',format:'pem'}),now:1000,ttlSeconds:600});
  assert.strictEqual(appleSecret.split('.').length,3);

  for(const route of ['/api/auth/google','/api/auth/apple','/api/auth/email-password/register','/api/auth/email-password/login','/api/auth/email-password/recovery/request','/api/auth/email-password/recover'])assert(server.includes(route),`rota ${route} ausente`);
  assert(universal.includes('https://appleid.apple.com/auth/keys'));
  assert(universal.includes('https://appleid.apple.com/auth/token'));
  assert(server.includes('EMAIL_RECOVERY_CONFIGURED'),'recuperação por e-mail deve ser configurável no servidor');
  assert(!server.includes('/api/auth/email/request'),'OTP antigo deve ficar desativado');
  assert(server.includes("const AUTH_COOKIE = 'maumau_session'"));
  assert(server.includes("const LEGACY_AUTH_COOKIE = 'maumau_google_session'"));

  for(const id of ['googleSignInButton','emailPasswordAuthBox','emailPasswordLoginForm','emailPasswordRegisterForm','emailPasswordRecoverForm','emailPasswordRecoverySend'])assert(html.includes(`id="${id}"`),`controle ${id} ausente`);
  assert(!html.toLowerCase().includes('jogar como visitante'));
  assert(!html.includes('appleSignInButton')&&!html.includes('appleid.cdn-apple.com'),'Apple não deve ser exposto na interface Pré-APK');
  assert(!app.includes('handleAppleLogin')&&!app.includes('renderAppleSignIn')&&!app.includes('waitForAppleIdentity'));
  assert(app.includes('loginEmailPassword')&&app.includes('registerEmailPassword')&&app.includes('requestEmailPasswordRecoveryCode')&&app.includes('recoverEmailPassword'));
  assert(app.includes('initializeAuth()'));
  assert(!css.includes('.apple-signin-btn')&&css.includes('.email-auth-box'));
  assert(!html.includes('emailPasswordRecoveryDialog'),'chave de recuperação não deve ser exibida no fluxo atual');

  fs.rmSync(tmp,{recursive:true,force:true});
  console.log('✓ V40.69.2 Pré-APK: Google + e-mail/senha, compatibilidade de PIN legado, recuperação e isolamento validados.');
})().catch(e=>{console.error(e);process.exit(1);});

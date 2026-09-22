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

  // E-mail + PIN cria uma identidade própria SEM marcar a caixa postal como verificada.
  const pinAccount=await store.registerEmailPin({email:'novo@example.com',pin:'123456',name:'Novo'});
  assert(/^u_[0-9a-f]{40}$/.test(pinAccount.user.playerKey));
  assert(/^RC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(pinAccount.recoveryCode));
  const pinLogin=await store.loginEmailPin({email:'novo@example.com',pin:'123456'});
  assert.strictEqual(pinLogin.playerKey,pinAccount.user.playerKey);
  await assert.rejects(()=>store.loginEmailPin({email:'novo@example.com',pin:'999999'}),/incorreto/i);
  const recovered=await store.recoverEmailPin({email:'novo@example.com',recoveryCode:pinAccount.recoveryCode,newPin:'654321'});
  assert.strictEqual(recovered.playerKey,pinAccount.user.playerKey);
  await assert.rejects(()=>store.loginEmailPin({email:'novo@example.com',pin:'123456'}),/incorreto/i);
  assert.strictEqual((await store.loginEmailPin({email:'novo@example.com',pin:'654321'})).playerKey,pinAccount.user.playerKey);

  // Segurança: um e-mail digitado manualmente não pode sequestrar futura identidade Google/Apple.
  const manual=await store.registerEmailPin({email:'seguro@example.com',pin:'111222',name:'Manual'});
  const googleVerified=await store.resolveIdentity({provider:'google',subject:'google-safe',legacyPlayerKey:'g_safe',name:'Google',email:'seguro@example.com',verifiedEmail:true});
  assert.notStrictEqual(googleVerified.playerKey,manual.user.playerKey,'e-mail + PIN não verificado não deve auto-vincular Google');

  const reopened=new AuthIdentityStore({databaseUrl:'',filePath});
  await reopened.init();
  assert.strictEqual((await reopened.loginEmailPin({email:'novo@example.com',pin:'654321'})).playerKey,pinAccount.user.playerKey,'e-mail + PIN deve sobreviver a reinício');

  const secret='segredo-teste-123';
  const challenge=U.createAppleChallenge(secret,{ttlMs:60000,now:1000});
  const parsed=U.verifyAppleChallenge(secret,challenge.state,{now:2000});
  assert.strictEqual(parsed.nonce,challenge.nonce);
  assert.strictEqual(U.verifyAppleChallenge('outro',challenge.state,{now:2000}),null);
  const {privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
  const appleSecret=U.createAppleClientSecret({clientId:'com.example.web',teamId:'TEAM123',keyId:'KEY123',privateKey:privateKey.export({type:'pkcs8',format:'pem'}),now:1000,ttlSeconds:600});
  assert.strictEqual(appleSecret.split('.').length,3);

  for(const route of ['/api/auth/google','/api/auth/apple','/api/auth/email-pin/register','/api/auth/email-pin/login','/api/auth/email-pin/recover'])assert(server.includes(route),`rota ${route} ausente`);
  assert(universal.includes('https://appleid.apple.com/auth/keys'));
  assert(universal.includes('https://appleid.apple.com/auth/token'));
  assert(!server.includes('RESEND_API_KEY'),'V40.69.2 não deve depender do Resend');
  assert(!server.includes('/api/auth/email/request'),'OTP antigo deve ficar desativado');
  assert(server.includes("const AUTH_COOKIE = 'maumau_session'"));
  assert(server.includes("const LEGACY_AUTH_COOKIE = 'maumau_google_session'"));

  for(const id of ['googleSignInButton','appleSignInButton','emailPinAuthBox','emailPinLoginForm','emailPinRegisterForm','emailPinRecoverForm','emailPinRecoveryDialog'])assert(html.includes(`id="${id}"`),`controle ${id} ausente`);
  assert(!html.toLowerCase().includes('jogar como visitante'));
  assert(app.includes('handleAppleLogin'));
  assert(app.includes('loginEmailPin')&&app.includes('registerEmailPin')&&app.includes('recoverEmailPin'));
  assert(app.includes('initializeAuth()'));
  assert(css.includes('.apple-signin-btn')&&css.includes('.email-auth-box')&&css.includes('.recovery-key-modal'));

  fs.rmSync(tmp,{recursive:true,force:true});
  console.log('✓ V40.69.2: Google + Apple + e-mail/PIN, recuperação e isolamento de identidade validados.');
})().catch(e=>{console.error(e);process.exit(1);});

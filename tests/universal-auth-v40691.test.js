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
  const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');

  assert.strictEqual(pkg.version,'40.69.1');
  assert.strictEqual(normalizeEmail('  Jogador@Exemplo.COM '),'jogador@exemplo.com');
  assert.strictEqual(normalizeEmail('invalido'),'');

  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mau-auth-'));
  const filePath=path.join(tmp,'auth.json');
  const store=new AuthIdentityStore({databaseUrl:'',filePath});
  await store.init();
  const google=await store.resolveIdentity({provider:'google',subject:'google-sub-1',legacyPlayerKey:'g_legado_123',name:'Orlando',email:'orlando@example.com',picture:'https://example.com/a.jpg',verifiedEmail:true});
  assert.strictEqual(google.playerKey,'g_legado_123','Google existente deve preservar o playerKey legado');
  const email=await store.resolveIdentity({provider:'email',subject:'orlando@example.com',name:'Orlando',email:'orlando@example.com',verifiedEmail:true});
  assert.strictEqual(email.playerKey,google.playerKey,'e-mail verificado igual deve reutilizar a mesma identidade canônica');
  const appleSame=await store.resolveIdentity({provider:'apple',subject:'apple-sub-1',name:'Orlando',email:'orlando@example.com',verifiedEmail:true});
  assert.strictEqual(appleSame.playerKey,google.playerKey,'Apple com o mesmo e-mail verificado deve reutilizar a identidade');
  const appleRelay=await store.resolveIdentity({provider:'apple',subject:'apple-sub-relay',name:'Outro',email:'abc@privaterelay.appleid.com',verifiedEmail:true});
  assert(/^u_[0-9a-f]{40}$/.test(appleRelay.playerKey),'nova conta Apple deve receber playerKey interno');
  assert.notStrictEqual(appleRelay.playerKey,google.playerKey);

  const reopened=new AuthIdentityStore({databaseUrl:'',filePath});
  await reopened.init();
  const emailAgain=await reopened.resolveIdentity({provider:'email',subject:'orlando@example.com',email:'orlando@example.com',verifiedEmail:true});
  assert.strictEqual(emailAgain.playerKey,google.playerKey,'identidade deve sobreviver à reinicialização do armazenamento');

  const secret='segredo-teste-123';
  const challenge=U.createAppleChallenge(secret,{ttlMs:60000,now:1000});
  const parsed=U.verifyAppleChallenge(secret,challenge.state,{now:2000});
  assert.strictEqual(parsed.nonce,challenge.nonce,'challenge Apple deve ser autenticado por HMAC');
  assert.strictEqual(U.verifyAppleChallenge('outro',challenge.state,{now:2000}),null,'challenge Apple adulterado deve falhar');
  const {privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
  const appleSecret=U.createAppleClientSecret({clientId:'com.example.web',teamId:'TEAM123',keyId:'KEY123',privateKey:privateKey.export({type:'pkcs8',format:'pem'}),now:1000,ttlSeconds:600});
  assert.strictEqual(appleSecret.split('.').length,3,'client_secret Apple deve ser JWT ES256');
  const otp=U.generateEmailOtp();
  assert(/^\d{6}$/.test(otp),'OTP deve ter exatamente 6 dígitos');
  assert.strictEqual(U.emailOtpHash(secret,'A@B.COM','123456'),U.emailOtpHash(secret,'a@b.com','123456'),'hash do OTP deve normalizar e-mail');

  for(const route of ["/api/auth/google","/api/auth/apple","/api/auth/email/request","/api/auth/email/verify"]){assert(server.includes(route),`rota ${route} ausente`);}
  assert(universal.includes("https://appleid.apple.com/auth/keys"),'verificação das chaves públicas Apple ausente');
  assert(universal.includes("https://appleid.apple.com/auth/token"),'validação do authorization code Apple ausente');
  assert(server.includes('RESEND_API_KEY'),'envio de OTP por provedor de e-mail ausente');
  assert(server.includes("const AUTH_COOKIE = 'maumau_session'"),'cookie universal ausente');
  assert(server.includes("const LEGACY_AUTH_COOKIE = 'maumau_google_session'"),'migração do cookie antigo ausente');
  assert(server.includes('https://appleid.cdn-apple.com'),'CSP deve permitir o SDK Apple');

  for(const id of ['googleSignInButton','appleSignInButton','emailAuthBox','emailLoginInput','emailCodeInput'])assert(html.includes(`id="${id}"`),`controle ${id} ausente`);
  assert(html.includes('appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'),'SDK Apple ausente');
  assert(!html.toLowerCase().includes('jogar como visitante'),'V40.69.1 não deve criar identidade descartável de visitante');
  assert(app.includes('handleAppleLogin'),'cliente Apple ausente');
  assert(app.includes('requestEmailCode'),'cliente de OTP por e-mail ausente');
  assert(app.includes('initializeAuth()'),'bootstrap universal ausente');
  assert(css.includes('.apple-signin-btn')&&css.includes('.email-auth-box'),'estilos do login universal ausentes');
  for(const key of ['APPLE_CLIENT_ID=','APPLE_REDIRECT_URI=','APPLE_TEAM_ID=','APPLE_KEY_ID=','APPLE_PRIVATE_KEY=','RESEND_API_KEY=','EMAIL_FROM='])assert(env.includes(key),`.env.example sem ${key}`);

  fs.rmSync(tmp,{recursive:true,force:true});
  console.log('✓ V40.69.1: Google + Apple + e-mail, identidade canônica e OTP validados.');
})().catch(e=>{console.error(e);process.exit(1);});

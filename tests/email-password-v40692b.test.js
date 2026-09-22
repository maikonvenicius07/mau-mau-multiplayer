'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {AuthIdentityStore,normalizePassword,PASSWORD_MIN_LENGTH,PASSWORD_MAX_LENGTH}=require('../auth-identity-store');

(async()=>{
  assert.strictEqual(PASSWORD_MIN_LENGTH,6);
  assert.strictEqual(PASSWORD_MAX_LENGTH,60);
  assert.strictEqual(normalizePassword('12345'),'');
  assert.strictEqual(normalizePassword('123456'),'123456');
  assert.strictEqual(normalizePassword('Senha123'),'Senha123');
  assert.strictEqual(normalizePassword('x'.repeat(61)),'');
  assert.strictEqual(normalizePassword('123456',{allowLegacyPin:true}),'123456');
  
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mau-password-'));
  const store=new AuthIdentityStore({databaseUrl:'',filePath:path.join(tmp,'auth.json')});
  await store.init();
  const created=await store.registerEmailPassword({email:'senha@example.com',password:'Minha senha #2026',name:'Senha'});
  assert.strictEqual((await store.loginEmailPassword({email:'senha@example.com',password:'Minha senha #2026'})).playerKey,created.user.playerKey);
  const legacy=await store.registerEmailPin({email:'pin-antigo@example.com',pin:'654321',name:'Legado'});
  assert.strictEqual((await store.loginEmailPassword({email:'pin-antigo@example.com',password:'654321'})).playerKey,legacy.user.playerKey);
  fs.rmSync(tmp,{recursive:true,force:true});

  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  assert(html.includes('e-mail + senha'));
  assert(html.includes('6 a 60 caracteres'));
  assert(!html.includes('PIN de 6 números'));
  console.log('✓ Pré-APK Passo 2B: senha flexível 6–60 e compatibilidade com conta antiga validadas.');
})().catch(e=>{console.error(e);process.exit(1);});

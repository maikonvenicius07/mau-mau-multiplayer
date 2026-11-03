'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {AuthIdentityStore,PASSWORD_RESET_TTL_MS}=require('../auth-identity-store');
const EmailDelivery=require('../email-delivery');

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mau-email-reset-'));
  const store=new AuthIdentityStore({databaseUrl:'',filePath:path.join(tmp,'auth.json')});
  await store.init();
  const created=await store.registerEmailPassword({email:'recupera@example.com',password:'Senha123',name:'Recupera'});
  const issued=await store.issueEmailPasswordResetCode({email:'recupera@example.com',now:1000});
  assert(issued.exists);assert(/^\d{6}$/.test(issued.code));assert.strictEqual(issued.expiresAt,1000+PASSWORD_RESET_TTL_MS);
  await assert.rejects(()=>store.resetEmailPasswordWithCode({email:'recupera@example.com',code:'000000'===issued.code?'999999':'000000',newPassword:'NovaSenha',now:2000}),/Código inválido/i);
  const user=await store.resetEmailPasswordWithCode({email:'recupera@example.com',code:issued.code,newPassword:'NovaSenha',now:2000});
  assert.strictEqual(user.playerKey,created.user.playerKey);
  await assert.rejects(()=>store.loginEmailPassword({email:'recupera@example.com',password:'Senha123'}),/incorreta/i);
  assert.strictEqual((await store.loginEmailPassword({email:'recupera@example.com',password:'NovaSenha'})).playerKey,created.user.playerKey);
  await assert.rejects(()=>store.resetEmailPasswordWithCode({email:'recupera@example.com',code:issued.code,newPassword:'OutraSenha',now:3000}),/expirado|inválido/i);
  assert.deepStrictEqual(await store.issueEmailPasswordResetCode({email:'inexistente@example.com'}),{exists:false});

  let sent=null;
  const fakeFetch=async(url,opts)=>{sent={url,opts,body:JSON.parse(opts.body)};return {ok:true,status:200,text:async()=>''};};
  await EmailDelivery.sendPasswordResetCode({to:'recupera@example.com',code:'123456',apiKey:'re_test',from:'MAU-MAU <noreply@example.com>',fetchImpl:fakeFetch});
  assert(sent&&sent.body.to[0]==='recupera@example.com');assert(sent.body.text.includes('123456'));assert(!sent.body.text.includes('NovaSenha'));
  assert.strictEqual(EmailDelivery.emailRecoveryConfigured({RESEND_API_KEY:'x',EMAIL_FROM:'a@b.com'}),true);
  assert.strictEqual(EmailDelivery.emailRecoveryConfigured({RESEND_API_KEY:'',EMAIL_FROM:'a@b.com'}),false);

  fs.rmSync(tmp,{recursive:true,force:true});
  console.log('✓ Pré-APK Passo 2E: recuperação de senha por código de e-mail validada.');
})().catch(e=>{console.error(e);process.exit(1);});

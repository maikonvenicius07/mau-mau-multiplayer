'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

// Este teste protege somente a superfície EXECUTÁVEL do login Pré-APK.
// Documentação (docs/*.md) não deve bloquear deploy por diferença de redação.
const html=read('public/index.html');
const app=read('public/app.js');
const css=read('public/styles.css');
const server=read('server.js');
const authStore=read('auth-identity-store.js');

assert(html.includes('Use Google ou e-mail + senha'),'tela deve oferecer Google ou e-mail + senha');
assert(html.includes('minlength="6"')&&html.includes('maxlength="60"'),'senha deve permitir 6 a 60 caracteres');
assert(html.includes('googleSignInButton')&&html.includes('emailPasswordAuthBox'),'controles Google e e-mail/senha devem existir');
assert(!/Apple|appleSignInButton|appleid\.cdn-apple\.com/.test(html),'interface não deve exibir Apple');
assert(!/handleAppleLogin|renderAppleSignIn|waitForAppleIdentity/.test(app),'cliente não deve carregar fluxo Apple');
assert(!css.includes('.apple-signin-btn'),'CSS do botão Apple deve permanecer removido');

assert(server.includes("app.post('/api/auth/email-password/register'"),'rota de cadastro com senha deve existir');
assert(server.includes("app.post('/api/auth/email-password/login'"),'rota de login com senha deve existir');
assert(server.includes("app.post('/api/auth/email-password/recover'"),'rota de recuperação com senha deve existir');
assert(authStore.includes('const PASSWORD_MIN_LENGTH=6;'),'limite mínimo da senha deve ser 6');
assert(authStore.includes('const PASSWORD_MAX_LENGTH=60;'),'limite máximo da senha deve ser 60');

console.log('✓ Pré-APK Passo 2D: login executável validado com Google + e-mail/senha de 6 a 60 caracteres.');

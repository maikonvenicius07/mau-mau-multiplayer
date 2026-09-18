'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const pkg=require('../package.json');

assert.strictEqual(pkg.version,'40.63');
assert(html.includes('app.js?v=40.63')&&html.includes('styles.css?v=40.63'),'cache-busting V40.58 ausente');

// CORS/handshake: não pode voltar ao curinga global.
assert(!server.includes("cors: { origin: '*' }"),'Socket.IO não pode aceitar CORS global com *');
assert(server.includes('MAUMAU_ALLOWED_ORIGINS'),'allowlist de origens ausente');
assert(server.includes('function requestOriginAllowed(req)'),'validação de origem ausente');
assert(server.includes('allowRequest: (req, callback) =>'),'handshake Socket.IO precisa validar origem no servidor');
assert(server.includes('socket-origin-rejected'),'rejeição de origem Socket.IO precisa ser monitorada');
assert(env.includes('MAUMAU_ALLOWED_ORIGINS='),'.env.example não documenta a allowlist');

// Cabeçalhos de proteção do frontend/API.
for(const header of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy','Content-Security-Policy']){
  assert(server.includes(header),`cabeçalho ${header} ausente`);
}
assert(server.includes("frame-ancestors 'none'"),'CSP precisa impedir framing');
assert(server.includes("script-src 'self' https://accounts.google.com"),'CSP deve preservar o login Google');
assert(server.includes("microphone=(self)"),'Permissions-Policy deve preservar o microfone do jogo');

// Monitoramento deve ser útil sem registrar conteúdo privado.
assert(server.includes("app.get('/health'"),'endpoint /health ausente');
assert(server.includes("app.get('/ready'"),'endpoint /ready ausente');
assert(server.includes('X-Request-Id'),'correlação de requisições ausente');
assert(server.includes('MAUMAU_HTTP_LOGS'),'chave de logs HTTP ausente');
assert(server.includes("for(const key of ['requestId','method','path','status','durationMs','reason','origin','host'])"),'logger deve trabalhar por allowlist de campos');
assert(!/logMonitor\([^\n]*(cookie|credential|card|hand|body)/i.test(server),'logger não deve registrar credenciais/cartas/corpo');

// A regra especial da Dama com 2 jogadores continua intocada.
const engine=fs.readFileSync(path.join(root,'game-engine.js'),'utf8');
assert(engine.includes('if (ativos.length === 2)'),'regra da Dama para 2 jogadores ausente');

console.log('✓ V40.58: CORS restrito, headers de segurança e monitoramento sem dados privados validados.');

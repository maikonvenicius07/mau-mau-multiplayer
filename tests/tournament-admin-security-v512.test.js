'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
assert.match(server,/TOURNAMENT_ADMIN_EMAILS/);
assert.match(server,/function tournamentIsAdmin\(session\)/);
for(const method of ['post','patch']){
 const ix=server.indexOf(method==='post'?"app.post('/api/tournaments'":"app.patch('/api/tournaments/:id'");
 assert(ix>=0,'endpoint de administração '+method);
 const block=server.slice(ix,ix+1000);
 assert.match(block,/authFromCookieHeaderVerified/);
 assert.match(block,/tournamentIsAdmin\(session\)/);
 assert.match(block,/403/);
}
assert.match(html,/id="tournamentAdminPanel"[^>]*hidden/);
assert.match(ui,/panel.hidden=!result.isAdmin/);
assert.match(ui,/tournamentId:config.id/);
assert.match(html,/tournament-ui\.js\?v=51\.2/);
assert.doesNotMatch(ui,/localStorage|sessionStorage/);
console.log('✓ V51.2 administração somente autenticada e autorizada no servidor; sem credenciais no cliente.');

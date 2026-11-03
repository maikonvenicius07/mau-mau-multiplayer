// Observador: Chat na barra compacta. Jogador: Chat apenas na aba do painel Mesa.
// O atalho de Chat no topo foi removido sem retirar o chat real de ambos.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
assert.match(css,/#game\.spectator-mode \.topbar #chatToggleBtn,\s*#game\.spectator-mode #spectatorDrawerActivity \.side-tabs\s*\{\s*display:none!important;/);
assert.match(html,/data-spectator-panel="chat"/);
assert.doesNotMatch(html,/id="chatToggleBtn"/);
assert.doesNotMatch(app,/\$\('#chatToggleBtn'\)/);
assert.match(html,/id="tableInfoToggleBtn"/);
assert.match(app,/openPlayerSide\('log'\)/);
assert.match(app,/\$\('#chatTabBtn'\)\.onclick=\(\)=>openPlayerSide\('chat',true\)/);
assert.match(html,/id="chatTabBtn"/);
assert.match(app,/setSideTab\(spectatorDrawerActive==='chat'\?'chat':'log',false\)/);
assert.match(html,/styles\.css\?v=[^"\s]+chat-one/);
console.log('PASS — sem Chat duplicado no topo; chat acessível pelo painel Mesa e pelo Observador');

// A interface do Observador usa somente a entrada Chat da barra compacta.
// Sem alterar os controles de chat usados pelas partidas normais.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
assert.match(css,/#game\.spectator-mode \.topbar #chatToggleBtn,\s*#game\.spectator-mode #spectatorDrawerActivity \.side-tabs\s*\{\s*display:none!important;/);
assert.match(html,/data-spectator-panel="chat"/);
assert.match(html,/id="chatToggleBtn"/);
assert.match(html,/id="chatTabBtn"/);
assert.match(app,/setSideTab\(spectatorDrawerActive==='chat'\?'chat':'log',false\)/);
assert.match(html,/styles\.css\?v=[^"\s]+chat-one/);
console.log('PASS — apenas uma entrada de Chat para Observador; controles normais preservados');

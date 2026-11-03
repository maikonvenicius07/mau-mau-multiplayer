// Regressão: o Chat permanece acessível sem atalho duplicado no topo.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
assert.doesNotMatch(html,/id="chatToggleBtn"/);
assert.doesNotMatch(app,/\$\('#chatToggleBtn'\)/);
assert.match(html,/id="tableInfoToggleBtn"/);
assert.match(html,/id="sidePanel"/);
assert.match(html,/id="chatTabBtn"/);
assert.match(html,/id="chatView"/);
assert.match(html,/id="chatForm"/);
assert.match(html,/data-spectator-panel="chat"/);
assert.match(app,/\$\('#tableInfoToggleBtn'\)\?\.addEventListener\('click',\(\)=>openPlayerSide\('log'\)\)/);
assert.match(app,/\$\('#chatTabBtn'\)\.onclick=\(\)=>openPlayerSide\('chat',true\)/);
assert.match(app,/const panelOpen=isSpectatorState\(\)\?spectatorDrawerActive==='chat':\$\('#sidePanel'\)\.classList\.contains\('open'\)/);
assert.match(app,/for\(const el of \[\$\('#chatBadge'\),\$\('#spectatorChatBadge'\)\]\)/);
console.log('PASS — botão superior removido; Chat da Mesa e Chat do Observador preservados');

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
for(const id of ['spectatorFeedToggle','spectatorSidebarToggle']){
  assert(html.includes(`id="${id}"`));
  assert(ui.includes(`$('#${id}')?.addEventListener('click'`));
}
assert(ui.includes("game.classList.toggle('spectator-feed-collapsed',spectator&&spectatorFeedHidden)"));
assert(ui.includes("game.classList.toggle('spectator-sidebar-collapsed',spectator&&spectatorSidebarHidden)"));
assert(ui.includes("if(isSpectatorState()&&spectatorSidebarHidden){spectatorSidebarHidden=false;syncSpectatorVisibility();}"));
assert(css.includes('#game.spectator-feed-collapsed #spectatorLivePanel .spectator-feed-wrap{display:none!important}'));
assert(css.includes('#game.spectator-sidebar-collapsed #sidePanel{display:none!important}'));
assert(html.includes('id="spectatorSeatBtn"'));
assert(html.includes('id="scoreboard"'));
console.log('OK: controles independentes, restritos ao observador, sem remover placar ou botão de entrada.');

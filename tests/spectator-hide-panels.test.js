'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
for(const id of ['spectatorModeBanner','spectatorLivePanel','spectatorSeatBtn','spectatorAuxDrawer','spectatorDrawerScore','spectatorDrawerActivity','spectatorDrawerWatchers','spectatorDrawerClose','spectatorPeople']){
  assert(html.includes(`id="${id}"`),`faltando id ${id}`);
}
for(const key of ['score','events','chat','watchers']){
  assert(html.includes(`data-spectator-panel="${key}"`),`aba ausente: ${key}`);
}
assert.equal((html.match(/id="scoreboard"/g)||[]).length,1,'placar não pode ser duplicado');
assert.equal((html.match(/id="sidePanel"/g)||[]).length,1,'histórico/chat não pode ser duplicado');
assert(ui.includes('function syncSpectatorCompactUI()'),'sincronização do novo layout ausente');
assert(ui.includes("$('#spectatorDrawerScore')?.appendChild(score)"),'placar original não movido');
assert(ui.includes("$('#spectatorDrawerActivity')?.appendChild(side)"),'chat original não movido');
assert(ui.includes('shell.insertBefore(score,shell.firstElementChild)'),'placar não é restaurado para jogadores');
assert(ui.includes('shell.appendChild(side)'),'chat não é restaurado para jogadores');
assert(ui.includes('function openSpectatorDrawer(key,force=false)'),'gaveta não tem controle');
assert(ui.includes("if(isSpectatorState())openSpectatorDrawer(activeSideTab==='chat'?'chat':'events',true)"),'botão de chat da barra superior não abre gaveta');
assert(ui.includes("const panelOpen=isSpectatorState()?spectatorDrawerActive==='chat'"),'contador de mensagens não considera a gaveta');
assert(css.includes('#game.spectator-mode .table-shell{padding-right:12px!important'),'mesa do observador não ganha espaço');
assert(css.includes('#game .spectator-compact-drawer'),'CSS da gaveta ausente');
assert(css.includes('@media(max-width:700px)'),'adaptação mobile ausente');
assert(html.includes('observer-compact-v2-seatqueue'),'query anti-cache da Etapa 2 ausente');
console.log('OK: painel compacto recolhível, sem duplicar placar/chat e com restauração ao virar jogador.');

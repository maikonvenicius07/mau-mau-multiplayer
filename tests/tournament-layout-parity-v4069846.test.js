"use strict";
// Contrato visual da V40.69.8.46. Medições reais: relatório da versão.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const css=read('public/styles.css');
const html=read('public/index.html');
const js=read('public/app.js');
const server=read('server.js');
assert.equal((html.match(/id="game"/g)||[]).length,1,'Deve haver somente uma mesa');
for(const id of ['playersRing','drawPile','discardPile','hand','scoreboard','liveMicBtn','liveCameraBtn']){
  assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`Componente duplicado: ${id}`);
}
assert.match(js,/function visualSeatLayout\(count\)/);
assert.match(js,/function renderPlayers\(\)/);
assert.match(js,/function renderHand\(\)/);
assert.match(js,/syncTournamentWaitBanner\(\)/);
assert.match(js,/banner\.classList\.toggle\('hidden',!visible\)/);
assert.match(css,/#game \.tournament-wait-banner:not\(\.hidden\)\s*\{[^}]*position:absolute/s,
  'Cronômetro deve sair do fluxo, sem empurrar o feltro');
assert.match(css,/#game \.tournament-wait-banner:not\(\.hidden\)[^}]*pointer-events:none/s,
  'Cronômetro não deve bloquear interação com a mesa');
assert.match(css,/@media\(max-width:900px\)[\s\S]*?#game \.tournament-wait-banner:not\(\.hidden\)/);
assert.match(css,/@media\(max-width:560px\)[\s\S]*?#game \.tournament-wait-banner:not\(\.hidden\)/);
assert.match(html,/v4069846-layout-parity/,'Cache-busting do CSS necessário para disponibilizar correção');
assert.match(server,/RELEASE_VERSION = 'V40\.69\.8\.46'/);
console.log('✓ Paridade de componentes, cronômetro fora do fluxo e cache-busting validados');

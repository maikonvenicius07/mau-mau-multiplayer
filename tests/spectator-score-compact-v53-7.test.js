'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const start=js.indexOf('let spectatorDrawerActive=null;');
const end=js.indexOf('for(const button of document.querySelectorAll(\'[data-spectator-panel]\'))',start);
assert(start>=0&&end>start,'controle real do modo observador presente');

function mk(){
  const flags=new Set();
  const c={contains:(key)=>flags.has(key),add:(key)=>flags.add(key),remove:(key)=>flags.delete(key),toggle:(key,force)=>{
    const on=force===undefined?!flags.has(key):!!force;
    if(on)flags.add(key);else flags.delete(key);
    return on;
  }};
  return {classList:c,appendChild(node){this.child=node},insertBefore(node){this.child=node},attrs:{},setAttribute(k,v){this.attrs[k]=v}};
}
const keys=['#game','#game .table-shell','#scoreboard','#sidePanel','#spectatorDrawerScore','#spectatorDrawerActivity','#spectatorDrawerWatchers','#spectatorAuxDrawer','#spectatorDrawerTitle'];
const nodes=Object.fromEntries(keys.map(key=>[key,mk()]));
for(const key of ['score','events','chat','watchers'])nodes[`[data-spectator-panel="${key}"]`]=mk();
const $=selector=>nodes[selector]||null;
const document={querySelector:$};
let spectator=true;
const funcs=new Function('document','$','isSpectatorState','closePlayerAuxPanels','setSideTab',js.slice(start,end)+`;return {syncSpectatorCompactUI,openSpectatorDrawer};`)(
  document,$,()=>spectator,()=>{},()=>{}
);
funcs.syncSpectatorCompactUI();
assert(nodes['#spectatorAuxDrawer'].classList.contains('hidden'),'observador inicia com gaveta fechada');
funcs.openSpectatorDrawer('score');
assert(nodes['#spectatorAuxDrawer'].classList.contains('spectator-score-active'),'placar abre modo compacto');
assert(!nodes['#spectatorAuxDrawer'].classList.contains('hidden'),'placar visivel');
assert(!nodes['#spectatorDrawerScore'].classList.contains('hidden'),'conteudo do placar visivel');
assert(nodes['#spectatorDrawerActivity'].classList.contains('hidden'),'chat nao duplica placar');
funcs.openSpectatorDrawer('score');
assert(nodes['#spectatorAuxDrawer'].classList.contains('hidden'),'clicar novamente fecha placar');
assert(!nodes['#spectatorAuxDrawer'].classList.contains('spectator-score-active'),'ao fechar remove modo compacto');
funcs.openSpectatorDrawer('chat');
assert(!nodes['#spectatorAuxDrawer'].classList.contains('spectator-score-active'),'chat mantem gaveta independente');
assert(!nodes['#spectatorDrawerActivity'].classList.contains('hidden'),'chat continua funcional');
funcs.openSpectatorDrawer('events');
assert(!nodes['#spectatorAuxDrawer'].classList.contains('spectator-score-active'),'eventos mantem gaveta independente');
spectator=false;funcs.syncSpectatorCompactUI();
assert(nodes['#spectatorAuxDrawer'].classList.contains('hidden'),'jogador nao recebe gaveta do observador');

assert(css.includes('#game.spectator-mode #spectatorDrawerScore #scoreboard .score-head{display:none!important}'),'cabecalho X duplicado oculto apenas no observador');
assert(css.includes('max-height:min(52dvh,385px)'),'placar compacto no celular');
assert(css.includes('grid-template-columns:30px minmax(0,1fr) 36px 36px!important'),'quatro colunas preservadas');
assert(css.includes('overflow:visible!important'),'linhas do observador nao podem ser cortadas');
assert(html.includes('v53.7-spectator-score-fix'),'cache de CSS e JS invalidado');
console.log('✓ V53.7: placar do observador compacto, legivel, com X unico e sem alterar eventos/chat/jogador');

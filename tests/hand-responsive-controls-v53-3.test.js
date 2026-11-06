'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');

for(const id of ['hand','handScrollHint','handBurnBtn','handDoubleBtn','handQuickBtn','mauBtn','batendoBtn','passTurnBtn']){
  assert(html.includes(`id="${id}"`),`controle ausente: ${id}`);
}
for(const id of ['handBurnBtn','handDoubleBtn','handQuickBtn']){
  assert(new RegExp(`id="${id}"[^>]*\\bdisabled\\b`).test(html),`${id} não começa desabilitado`);
}
assert(html.includes('id="passTurnBtn" class="pass-turn-btn" disabled'),'Passar a vez deve ficar visível/desabilitado antes da distribuição');
assert(app.includes("$('#passTurnBtn').classList.remove('hidden');"),'Passar a vez não mantém seu lugar em todos os estados');
assert(app.includes('function updateHandSpecialActions()'),'Painel não acompanha o estado da partida');
assert(app.includes('function triggerFloatingQuick()'),'Regra atual da Ação Rápida foi removida');
assert(app.includes('function triggerFloatingBurn()'),'Regra atual da Queima foi removida');
assert(app.includes('function triggerFloatingDouble()'),'Regra atual da Dupla foi removida');
assert(css.includes('#game:not(.spectator-mode) .special-actions-dock'),'Faixa de ações não tem CSS separado do observador');
assert(css.includes('var(--mm-hand-overlap)'),'Mão não implementa sobreposição dinâmica');
assert(css.includes('overflow-x:auto!important'),'Mão com muitas cartas precisa continuar rolável');
assert(css.includes('.felt > .floating-game-action{display:none!important}'),'Atalhos flutuantes cobrem a mesa no celular');

const start=app.indexOf('function updateHandLayout(){');
const end=app.indexOf('function scheduleHandLayout(){',start);
assert(start!==-1&&end>start,'Função real de layout não encontrada');
const functionText=app.slice(start,end);
function simulate(width,count,containerWidth,height=840){
  const properties={};
  const hand={
    children:Array(count).fill({}),clientWidth:containerWidth,
    closest:()=>null,
    style:{setProperty:(key,value)=>properties[key]=value}
  };
  const ctx={
    $:selector=>selector==='#hand'?hand:undefined,
    window:{innerWidth:width,innerHeight:height,getComputedStyle:()=>({paddingLeft:'6px',paddingRight:'6px'})},
    updateHandOverflowHint:()=>{}
  };
  vm.runInNewContext(`${functionText}\nupdateHandLayout();`,ctx,{timeout:1000});
  const w=parseInt(properties['--mm-hand-card-width'],10),h=parseInt(properties['--mm-hand-card-height'],10),overlap=parseInt(properties['--mm-hand-overlap'],10);
  return{w,h,overlap,visiblePerCard:w-overlap};
}
for(const [width,count,containerWidth] of [[320,6,300],[390,6,370],[390,10,370],[390,16,370],[768,10,738],[1280,10,920]]){
  const actual=simulate(width,count,containerWidth);
  assert(actual.w>=62&&actual.w<=88,`largura fora dos limites: ${width}/${count}`);
  assert(actual.visiblePerCard>=32,`número/naipe impossível de selecionar: ${width}/${count}`);
  assert(actual.h>actual.w,`proporção de carta inválida: ${width}/${count}`);
  if(count===6)assert(count*actual.w-(count-1)*actual.overlap<=containerWidth,`6 cartas não couberam em ${width}px`);
}
assert.equal(simulate(390,16,370).visiblePerCard,32,'Uma mão longa deve conservar 32px de cada carta e habilitar rolagem');
console.log('✓ V53.3: mão adaptável, controles persistentes, ações desabilitadas e seletividade preservadas.');

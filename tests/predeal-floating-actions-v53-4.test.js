'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');

for(const id of ['floatingBurnBtn','floatingDoubleBtn','floatingQuickBtn']){
  assert.equal(html.split(`id="${id}"`).length-1,1,`Botão ${id} duplicado ou ausente`);
  assert(html.indexOf(`id="${id}"`)<html.indexOf('<main class="table-shell">'),'Atalho deve ficar fora da mesa para o arraste não ser recortado');
}
for(const id of ['handBurnBtn','handDoubleBtn','handQuickBtn'])assert(!html.includes(`id="${id}"`),'Faixa fixa deve ser removida');
assert(!css.includes('.felt > .floating-game-action{display:none!important}'),'Regra que oculta os botões no celular não pode existir');
for(const key of ['maumauFloatingBurnPositionV1','maumauFloatingDoublePositionV1','maumauFloatingQuickPositionV1'])assert(app.includes(key),'A posição persistida de V53.3 deve ser preservada');
assert(app.includes("btn.classList.contains('predeal-positioning')"),'Toque de posicionamento não deve executar jogada');
assert(app.includes("setFloatingActionPosition(kind,parseFloat(btn.style.left)||0,parseFloat(btn.style.top)||0,{save:true})"),'O arraste deve salvar a posição');
assert(app.includes('showDoubleActionChooser(pairs)'),'Seletor das duplas precisa continuar');
assert(!app.includes("const dockBtn=$('#handDoubleBtn')"),'O seletor de Dupla não pode ancorar num botão excluído');
assert(css.includes('--mm-hand-card-width:76px'),'Tamanho das cartas da V53.3 foi alterado');
assert(css.includes('var(--mm-hand-overlap)'),'Sobreposição automática deve permanecer');

function sourceOf(name,next){
  const s=app.indexOf(`function ${name}(`);
  const e=app.indexOf(`function ${next}(`,s+1);
  assert(s>=0&&e>s,`Função ${name} indisponível`);
  return app.slice(s,e);
}
const code=app.slice(app.indexOf("function specialActionAvailability(){"),app.indexOf("initDraggableGameAction('burn'",app.indexOf("function specialActionAvailability(){")));
// Somente essas funções são executadas. Não precisamos carregar o app inteiro.
function mockBtn(){
  const names=new Set(['hidden']);const attrs={};
  return {classes:names,attrs,title:'',
    classList:{contains:k=>names.has(k),toggle:(k,v)=>{if(v)names.add(k);else names.delete(k)}},
    setAttribute:(k,v)=>attrs[k]=v};
}
function check({status='lobby',spectator=false,paused=false,connected=true,turn=true,burn=0,quick=0,double=0,justDrawn=false}={}){
  const controls={floatingBurnBtn:mockBtn(),floatingDoubleBtn:mockBtn(),floatingQuickBtn:mockBtn()};
  const restored=[],hiddenChooser=[];
  const ctx={
    state:{status,paused,openingReaction:false,me:{justDrawnCardId:justDrawn?'drawn':null,burnableCardIds:Array(burn).fill('a'),quickActionCardIds:Array(quick).fill('a'),doublePairs:Array(double).fill({cardIds:[1,2]})}},
    socket:{connected},
    isSpectatorState:()=>spectator,
    canAct:()=>!spectator&&turn&&connected&&status==='playing'&&!paused,
    $:s=>controls[s.slice(1)],
    restoreFloatingActionPosition:k=>restored.push(k),
    hideFloatingActionChooser:()=>hiddenChooser.push(true)
  };
  vm.runInNewContext(code+'\nupdateFloatingGameActions();',ctx,{timeout:2000});
  return{controls,restored,hiddenChooser};
}
function shown(result){return Object.entries(result.controls).filter(([,b])=>!b.classes.has('hidden')).map(([k])=>k).sort()}
const all=['floatingBurnBtn','floatingDoubleBtn','floatingQuickBtn'];
for(const status of ['lobby','between-rounds']){
  const r=check({status});
  assert.deepEqual(shown(r),all,`Todos devem aparecer antes da distribuição: ${status}`);
  assert.deepEqual(r.restored,['burn','double','quick']);
  for(const btn of Object.values(r.controls)){
    assert(btn.classes.has('predeal-positioning'));
    assert.equal(btn.attrs['aria-disabled'],'true');
    assert(btn.title.includes('arraste para posicionar'));
  }
}
assert.deepEqual(shown(check({status:'playing'})),[],'Após distribuição, sem jogada especial não aparece nenhum botão');
assert.deepEqual(shown(check({status:'playing',burn:1})),['floatingBurnBtn']);
assert.deepEqual(shown(check({status:'playing',quick:1})),['floatingQuickBtn']);
assert.deepEqual(shown(check({status:'playing',double:1})),['floatingDoubleBtn']);
assert.deepEqual(shown(check({status:'playing',burn:1,double:1,quick:1})),all);
assert.deepEqual(shown(check({status:'playing',burn:1,double:1,quick:1,paused:true})),[]);
assert.deepEqual(shown(check({status:'playing',burn:1,double:1,quick:1,connected:false})),[]);
assert.deepEqual(shown(check({status:'lobby',spectator:true})),[],'Observador não pode posicionar botões de jogador');
assert.deepEqual(shown(check({status:'between-rounds',spectator:true})),[]);
assert.deepEqual(shown(check({status:'finished'})),[]);
assert.deepEqual(shown(check({status:'playing',burn:1,quick:1,justDrawn:true})),[],'Compra impede Queima/Rápida');
assert.deepEqual(shown(check({status:'playing',double:1,turn:false})),[],'Dupla só na própria vez');
console.log('✓ V53.4: posicionamento pré-distribuição, ocultação condicional e posições persistentes preservados.');

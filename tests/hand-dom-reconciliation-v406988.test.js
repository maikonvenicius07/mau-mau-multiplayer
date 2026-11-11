'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Testa as funções reais da mão sem instalar dependências de DOM no Render.
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const start=source.indexOf('// V40.69.8.8 — reconciliação da mão por ID:');
const end=source.indexOf('\nlet spectatorSeatRequested=false;',start);
assert(start>=0&&end>start,'helper de reconciliação da mão não encontrado');
const realHandCode=source.slice(start,end);

class Classes {
  constructor(){this.set=new Set()}
  add(...names){names.forEach(x=>this.set.add(x))}
  remove(...names){names.forEach(x=>this.set.delete(x))}
  toggle(name,force){if(force===undefined)force=!this.set.has(name);if(force)this.set.add(name);else this.set.delete(name);return force}
  contains(name){return this.set.has(name)}
}
let created=0;
class Element {
  constructor(){this.dataset={};this.classList=new Classes();this.style={};this.attrs={};this.listeners=new Map();this.parent=null;this.onclick=null;this.tabIndex=undefined;this.disabled=false;this.title=''}
  setAttribute(k,v){this.attrs[k]=String(v)}
  removeAttribute(k){delete this.attrs[k]}
  addEventListener(k,fn){const a=this.listeners.get(k)||[];a.push(fn);this.listeners.set(k,a)}
  click(){this.onclick?.()}
  key(k){let prevented=0;for(const fn of this.listeners.get('keydown')||[])fn({key:k,preventDefault(){prevented++}});return prevented}
  remove(){if(this.parent){const a=this.parent.children;const i=a.indexOf(this);if(i>=0)a.splice(i,1);this.parent=null}}
}
class Hand {
  constructor(){this.children=[];this.scrollLeft=111}
  replaceChildren(){for(const x of this.children)x.parent=null;this.children=[]}
  insertBefore(element,before){
    if(element.parent)element.remove();
    const i=before?this.children.indexOf(before):-1;
    this.children.splice(i<0?this.children.length:i,0,element);element.parent=this;
  }
  querySelector(){return null}
}
const h=new Hand();
const nodes=new Map([['#hand',h]]);
for(const k of ['#mauBtn','#batendoBtn','#passTurnBtn','#endBurnBtn','#drawPile'])nodes.set(k,new Element());
const cards=[{id:'c1',rank:'4',suit:'hearts'},{id:'c2',rank:'5',suit:'spades'},{id:'c3',rank:'7',suit:'clubs'}];
let played=[],quickPlayed=[];
const context={
  document:{createElement:()=>{const wrapper={};Object.defineProperty(wrapper,'innerHTML',{set(){wrapper.firstElementChild=new Element();created++}});return wrapper}},
  $:key=>nodes.get(key),previousHandIds:new Set(),lastBurnFocusKey:'',lastDoubleFocusKey:'',
  renderContextKey:'A:player:1',Set,Map,
  state:{status:'playing',paused:false,openingReaction:false,currentPlayerId:'p1',pendingSeven:0,continuationPlayerId:null,
    me:{id:'p1',hand:cards.slice(),legalCardIds:['c1','c2'],burnableCardIds:[],quickActionCardIds:[],doublePairs:[],justDrawnCardId:null}},
  socket:{connected:true},passPending:false,
  isSpectatorState:()=>false,compareHandCards:(a,b)=>Number(a.rank)-Number(b.rank),
  cardHTML:()=>'card',canAct:()=>true,canBatendo:()=>false,play:c=>played.push(c.id),playQuick:c=>quickPlayed.push(c.id),
  focusCardWithinHandHorizontally:()=>{},scheduleHandLayout:()=>{},updateHandOverflowHint:()=>{},suitName:{hearts:'copas',spades:'espadas',clubs:'paus'},
};
vm.createContext(context);
vm.runInContext(realHandCode,context);
const render=context.renderHand;
const elems=()=>new Map(h.children.map(x=>[x.dataset.cardId,x]));
render();
assert.equal(created,3);
assert.deepEqual(h.children.map(x=>x.dataset.cardId),['c1','c2','c3']);
assert.equal(h.scrollLeft,111);
let old=elems();
assert.equal(old.get('c1').attrs.role,'button');
assert.equal(old.get('c3').attrs.role,'img');
old.get('c1').click();assert.deepEqual(played,['c1']);
assert.equal(old.get('c1').key('Enter'),1);assert.deepEqual(played,['c1','c1']);

// Muda a permissão sem mexer nas cartas: DOM, foco e rolagem não mudam.
context.state.me.legalCardIds=['c3'];
context.state.me.quickActionCardIds=['c2'];
render();
assert.equal(created,3,'carta existente não pode ser recriada a cada state');
for(const [id,el] of old)assert.equal(elems().get(id),el,`identidade DOM alterada em ${id}`);
assert.equal(h.scrollLeft,111,'rolagem horizontal não deve saltar');
assert.equal(old.get('c1').onclick,null);
assert.equal(old.get('c1').attrs.role,'img');
assert.equal(old.get('c1').attrs.tabindex,undefined);
assert.equal(old.get('c1').key('Enter'),0,'tecla não deve jogar carta sem permissão');
assert.equal(old.get('c2').classList.contains('quick-direct'),true);
old.get('c2').key(' ');assert.deepEqual(quickPlayed,['c2']);
context.state.me.justDrawnCardId='c3';render();
assert.equal(old.get('c2').classList.contains('quick-direct'),false,'depois da compra a ação rápida não fica disponível');
assert.equal(old.get('c3').style.outline,'3px solid #65dc96');
assert.equal((old.get('c2').listeners.get('keydown')||[]).length,1,'listener de teclado duplicado');
// Queima e Dupla atualizam os destaques sem criar novas cartas nem listeners.
context.state.me.justDrawnCardId=null;
context.state.me.burnableCardIds=['c1'];
context.state.me.doublePairs=[{cardIds:['c1','c3']}];
render();
assert.equal(old.get('c1').classList.contains('burnable'),true);
assert.equal(old.get('c1').classList.contains('double-available'),true);
assert.equal(old.get('c1').classList.contains('burn-and-double'),true);
context.state.me.burnableCardIds=[];context.state.me.doublePairs=[];
render();
assert.equal(old.get('c1').classList.contains('burnable'),false);
assert.equal(old.get('c1').classList.contains('double-available'),false);
assert.equal(created,3,'destaques Queima e Dupla não devem recriar cartas');

// Ao comprar, apenas uma carta é criada; ao ordenar, cartas antigas são movidas.
context.state.me.hand.push({id:'c4',rank:'8',suit:'diamonds'});
context.state.me.justDrawnCardId='c4';
render();assert.equal(created,4);assert.equal(old.get('c3').style.outline,'');
assert.equal(elems().get('c1'),old.get('c1'));
context.compareHandCards=(a,b)=>Number(b.rank)-Number(a.rank);
render();assert.deepEqual(h.children.map(x=>x.dataset.cardId),['c4','c3','c2','c1']);
assert.equal(created,4,'ordenar não pode recriar cartas');
assert.equal(h.scrollLeft,111);

// Ao jogar carta, removê-la. Contexto novo não pode reaproveitar mão da sala anterior.
context.state.me.hand=context.state.me.hand.filter(x=>x.id!=='c2');
render();assert.equal(elems().has('c2'),false);assert.equal(h.children.length,3);
context.renderContextKey='B:player:2';context.state.me.hand=[{id:'c1',rank:'4',suit:'hearts'}];
render();assert.equal(h.children.length,1);assert.notEqual(h.children[0],old.get('c1'));

// Observador não pode herdar nenhuma carta privada.
context.isSpectatorState=()=>true;render();assert.equal(h.children.length,0);
assert.equal(nodes.get('#drawPile').disabled,true);
console.log('✓ V40.69.8.8: mão DOM por ID, sem recriação desnecessária, sem teclas duplicadas, nova sala e observador seguros.');

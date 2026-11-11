'use strict';
// V40.69.8.4.3 — evita deslocamento vertical da mão após penalidade de 7.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
assert(html.includes('mobile7-4069843'),'cache de CSS/JS precisa ser atualizado para os celulares após o deploy');
assert(!/\.felt:has\(#sevenPenalty:not\(\.hidden\)\)\s*\{\s*height\s*:/s.test(css),'penalidade de sete não pode aumentar a altura da mesa');
assert(css.includes('.felt:has(#sevenPenalty:not(.hidden)) .center-zone'),'penalidade deve usar o espaço interno da mesa');
assert(css.includes('overflow-anchor: none'),'layout deve evitar salto por scroll anchoring');
assert(!/\.scrollIntoView\(/.test(app.replace(/\/\/[^\n]*/g,'')),'foco automático não deve rolar a página verticalmente');
const start=app.indexOf('function focusCardWithinHandHorizontally(');
const end=app.indexOf('\nfunction renderHand()',start);
assert(start>=0&&end>start,'auxiliar de rolagem horizontal não encontrado');
let scheduled=[];
const context={setTimeout:(cb,delay)=>scheduled.push({cb,delay})};
vm.createContext(context);
vm.runInContext(app.slice(start,end),context);
const focus=context.focusCardWithinHandHorizontally;
assert.strictEqual(typeof focus,'function');
function fakeHand({left=50,right=300,scrollLeft=0,scrollWidth=900,clientWidth=250,cardLeft=340,cardRight=405}={}){
 let lastCall=null;
 const card={getBoundingClientRect:()=>({left:cardLeft,right:cardRight})};
 const hand={clientWidth,scrollWidth,scrollLeft,
   querySelector:selector=>selector==='.playing-card.burnable'||selector==='.playing-card.double-focus-owner'?card:null,
   getBoundingClientRect:()=>({left,right}),
   scrollTo:options=>{lastCall=options;hand.scrollLeft=options.left;}
 };
 return {hand,getCall:()=>lastCall};
}
function flush(){while(scheduled.length)scheduled.shift().cb();}
{
 const {hand,getCall}=fakeHand();
 focus(hand,'.playing-card.burnable',40);
 assert.strictEqual(scheduled[0].delay,40);
 flush();
 assert(getCall()?.left>0,'deve rolar horizontalmente para carta fora da vista');
 assert.strictEqual(getCall()?.behavior,'smooth');
 assert(!Object.hasOwn(getCall(),'top')&&!Object.hasOwn(getCall(),'block'),'não pode deslocar página verticalmente');
}
{
 const {hand,getCall}=fakeHand({cardLeft:90,cardRight:155,scrollLeft:77});
 focus(hand,'.playing-card.double-focus-owner',60);flush();
 assert.strictEqual(getCall(),null,'carta já visível não deve provocar qualquer rolagem');
 assert.strictEqual(hand.scrollLeft,77);
}
{
 const {hand,getCall}=fakeHand({cardLeft:20,cardRight:90,scrollLeft:150});
 focus(hand,'.playing-card.double-focus-owner',60);flush();
 assert(getCall()?.left<150,'carta à esquerda deve voltar ao campo visível');
}
{
 const {hand,getCall}=fakeHand({scrollWidth:250,clientWidth:250});
 focus(hand,'.playing-card.burnable',40);flush();
 assert.strictEqual(getCall(),null,'mão sem overflow não precisa rolar');
}
{
 const {hand,getCall}=fakeHand();hand.querySelector=()=>null;
 focus(hand,'.playing-card.burnable',40);flush();
 assert.strictEqual(getCall(),null,'renderização substituída não deve causar erro');
}
assert(app.includes("focusCardWithinHandHorizontally(h,'.playing-card.burnable',40)"),'Queima deve usar foco horizontal');
assert(app.includes("focusCardWithinHandHorizontally(h,'.playing-card.double-focus-owner',60)"),'Dupla deve usar foco horizontal');
console.log('✓ V40.69.8.4.3: penalidade de 7 sem crescimento da mesa; foco horizontal sem saltos, na Queima e Dupla.');

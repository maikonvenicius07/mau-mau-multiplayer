'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const code=fs.readFileSync(path.join(root,'public/controls-positioning.js'),'utf8');
assert(html.includes('controls-positioning.js?v=53.12-mobile-left-stack'),'novo cache do organizador');
assert(app.includes('window.MauControlsLayout?.onGameState?.(state.status,state.code,spectator)'),'mudança de estado informada ao organizador');
for(const id of ['liveCameraBtn','liveMicBtn','quickReactionsWidget','pileSideBtn']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'controle sem duplicidade: '+id);
}

const makeClassList=(arr=[])=>{
 const set=new Set(arr);
 return {contains:x=>set.has(x),add:x=>set.add(x),remove:x=>set.delete(x)};
};
const makeEl=(id,w,h,classes=[])=>({
 id,offsetWidth:w,offsetHeight:h,style:{},classList:makeClassList(classes),
 getClientRects(){return [{}]},
 getBoundingClientRect(){return {left:Number.parseFloat(this.style.left)||10,top:Number.parseFloat(this.style.top)||120,right:(Number.parseFloat(this.style.left)||10)+w,bottom:(Number.parseFloat(this.style.top)||120)+h,width:w,height:h}}});
const game=makeEl('game',390,840);
const camera=makeEl('liveCameraBtn',44,42,['hidden']);
const mic=makeEl('liveMicBtn',68,40);
const emoji=makeEl('quickReactionsWidget',48,48);
const pile=makeEl('pileSideBtn',54,40);
const topbar={getBoundingClientRect(){return {bottom:110}}};
const els={game,liveCameraBtn:camera,liveMicBtn:mic,quickReactionsWidget:emoji,pileSideBtn:pile};
const callbacks={};
const env={
 innerWidth:390,innerHeight:840,
 window:{innerWidth:390,innerHeight:840,addEventListener(type,fn){callbacks[type]=fn}},
 document:{getElementById:id=>els[id],querySelector:selector=>selector==='.topbar'?topbar:null},
 localStorage:{getItem(){return JSON.stringify({x:350,y:122})}},
 getComputedStyle(){return {display:'block'}},
 requestAnimationFrame(fn){fn()},
 MutationObserver:class{observe(){}},
};
vm.runInNewContext(code,env);
const controller=env.window.MauControlsLayout;
assert(controller,'controlador disponível');
controller.onGameState('lobby','SALA1',false);
const list=[camera,mic,emoji,pile];
for(let i=1;i<list.length;i++){
 const prev=list[i-1],cur=list[i];
 assert.equal(cur.style.left,'14px','todos alinhados à esquerda');
 assert(Number.parseFloat(cur.style.top)>=Number.parseFloat(prev.style.top)+prev.offsetHeight+2,'ordem sem sobreposição');
}
assert(camera.style.top.endsWith('px'),'câmera reservada mesmo oculta');
// Durante a rodada, o jogador pode mover um botão sem perder sua posição.
pile.style.top='366px';
controller.onGameState('lobby','SALA1',false);
assert.equal(pile.style.top,'366px','lobby não força reposição a cada atualização');
controller.onGameState('playing','SALA1',false);
assert(Number.parseFloat(pile.style.top)<300,'nova rodada devolve a coluna à posição de referência');
pile.style.top='358px';
controller.onGameState('playing','SALA1',false);
assert.equal(pile.style.top,'358px','render normal mantém arraste do jogador');
controller.onGameState('playing','SALA2',false);
assert(Number.parseFloat(pile.style.top)<300,'outra sala reestabelece disposição');
pile.style.top='360px';
controller.onGameState('playing','SALA2',true);
assert.equal(pile.style.top,'360px','modo observador não recebe ajuste do jogador');
console.log('✓ V53.12: quatro controles em coluna no celular, novo jogo, arraste preservado e observador isolado.');

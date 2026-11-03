'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
assert(!html.includes('id="soundHomeBtn"'),'controle duplicado não deve aparecer na tela inicial');
assert(html.includes('id="soundBtn"'),'falta controle na partida');
assert(html.includes('aria-pressed="false"'),'botão precisa expor estado acessível');
assert(html.includes('mute51.6.2-home-clean'),'atualização dos arquivos estáticos deve invalidar cache');
assert(css.includes('.game-sound-top-btn'),'estilo do botão de jogo deve permanecer');
assert(!app.includes('soundHomeBtn'),'referências ao botão removido não devem permanecer');
assert(app.includes("$('#soundBtn').onclick=toggleGameSound"),'botão da sala deve usar mesmo estado');
assert(app.includes('gameSoundOutput(ac)'), 'áudio do jogo deve usar um canal dedicado');
assert(app.includes('const audio=document.createElement(\'audio\');audio.autoplay=true'),'voz ao vivo deve permanecer inalterada');
const snippet=app.slice(app.indexOf('function gameSoundOutput(ac)'),app.indexOf('// V40.48 — MINHA MÚSICA LOCAL'));
assert(snippet.includes('function toggleGameSound()'),'funções de volume não localizadas');
const buttons=Object.fromEntries(['soundBtn'].map(id=>{
 const label={textContent:''};const icon={value:'',replaceChildren(v){this.value=String(v)}};
 const attrs={};const classes={};
 return [id,{label,icon,attrs,classes,title:'',querySelector(sel){return sel==='.game-sound-icon'?icon:sel==='.game-sound-label'?label:null},setAttribute(k,v){attrs[k]=v},classList:{toggle(k,v){classes[k]=v}}}];
}));
let cancelled=0;let musicSyncCalls=0;const values={};const notices=[];
const context={
 soundOn:true,
 localMusicSpeechDuckCount:2,
 syncLocalMusicVoiceState(){musicSyncCalls++},
 document:{getElementById:id=>buttons[id]||null,createTextNode:v=>v},
 localStorage:{setItem:(k,v)=>{values[k]=v}},
 window:{speechSynthesis:{cancel(){cancelled++}}},
 toast:msg=>notices.push(msg),
};
vm.createContext(context);vm.runInContext(snippet,context);
const outputGains=[];
const ctx={destination:{name:'audio-destination'},createGain(){const node={gain:{value:0},connect(destination){this.destination=destination}};outputGains.push(node);return node}};
const master=context.gameSoundOutput(ctx);
assert.equal(master.gain.value,1);
assert.equal(master.destination,ctx.destination);
context.toggleGameSound();
assert.equal(context.soundOn,false);
assert.equal(master.gain.value,0,'sons que já estão tocando também devem ficar mudos');
assert.equal(values.maumauSound,'off');
assert.equal(cancelled,1,'narrador já ativo deve ser interrompido');
assert.equal(context.localMusicSpeechDuckCount,0,'cancelamento de narrador deve liberar pausa da música pessoal');
assert.equal(musicSyncCalls,1);
for(const button of Object.values(buttons)){
 assert.equal(button.attrs['aria-pressed'],'true');
 assert.equal(button.label.textContent,'Jogo silenciado');
 assert.equal(button.icon.value,'🔇');
}
context.toggleGameSound();
assert.equal(master.gain.value,1);
assert.equal(values.maumauSound,'on');
assert.equal(cancelled,1,'ativar o som não deveria cancelar nenhuma voz');
assert.equal(outputGains.length,1,'não criar canais duplicados de áudio');
for(const button of Object.values(buttons)){
 assert.equal(button.attrs['aria-pressed'],'false');
 assert.equal(button.label.textContent,'Som ligado');
 assert.equal(button.icon.value,'🔊');
}
assert.equal(notices.length,2);
console.log('✓ V51.6.1: botão da partida funcional, preferência persistida e silêncio imediato, sem alterar voz ao vivo.');

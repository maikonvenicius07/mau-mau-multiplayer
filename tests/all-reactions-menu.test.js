const fs=require('fs');
const path=require('path');
const pkg=require('../package.json');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');

if(pkg.version!=='40.20.0') throw new Error('Versão V40.20 não aplicada.');
if(!html.includes('id="allReactionsBtn"')) throw new Error('Botão 😊 para todas as reações ausente.');
if(!html.includes('id="allReactionsPanel"')) throw new Error('Painel de todas as reações ausente.');
for(const effect of ['applause','laugh','angry','horn','drum','victory','wow','jogaBoca']){
  if(!html.includes(`data-effect="${effect}"`)) throw new Error(`Efeito ${effect} ausente do painel.`);
}
if(!app.includes('function toggleAllReactionsPanel()')) throw new Error('Abertura/fechamento do painel não implementada.');
if(!app.includes('function positionAllReactionsPanel()')) throw new Error('Posicionamento inteligente do painel não implementado.');
if(!app.includes("if(btn.closest('#allReactionsPanel'))closeAllReactionsPanel()")) throw new Error('Painel não fecha após escolher uma reação.');
if(!css.includes('.all-reactions-grid')) throw new Error('Grade de todas as reações sem estilo.');
console.log('✓ V40.20: botão 😊 abre todas as reações e fecha após a escolha.');

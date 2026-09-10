const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

if(!html.includes('id="quickReactionsBar"')) throw new Error('Barra de reações rápidas não encontrada.');
if(!html.includes('data-effect="laugh" class="quick-reaction-btn"')) throw new Error('Atalho rápido de risada ausente.');
if(!html.includes('data-effect="angry" class="quick-reaction-btn"')) throw new Error('Atalho rápido de raiva ausente.');
if(!html.includes('data-effect="jogaBoca" class="quick-reaction-btn quick-reaction-speaker"')) throw new Error('Atalho rápido do alto-falante ausente.');
if(!app.includes("angry:{emoji:'😡',label:'Raiva'}")) throw new Error('Efeito de raiva não cadastrado no app.');
if(!app.includes("effect==='angry'")) throw new Error('Som do efeito de raiva não implementado.');
if(!server.includes("'angry'")) throw new Error('Servidor não permite o efeito de raiva.');
if(!css.includes('.quick-reactions-bar')) throw new Error('CSS da barra de reações rápidas ausente.');
console.log('✓ atalhos rápidos visíveis V40.18');

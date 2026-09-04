const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

if(!app.includes("jogaBoca:{emoji:'📢',label:'JOGA BOCA ABERTA!'")) throw new Error('Catálogo do efeito JOGA BOCA ABERTA ausente.');
if(!app.includes('function speakJogaBocaAberta()')) throw new Error('Função de fala JOGA BOCA ABERTA ausente.');
if(!app.includes("new SpeechSynthesisUtterance('JOGA BOCA ABERTA!')")) throw new Error('Texto falado incorreto.');
if(!app.includes('utterance.volume=1')) throw new Error('Volume máximo da fala não configurado.');
if(!app.includes("effect==='jogaBoca'")) throw new Error('Efeito social não executa fala.');
if(!html.includes('data-effect="jogaBoca"')) throw new Error('Botão do efeito não existe na interface.');
if(!server.includes("'jogaBoca'")) throw new Error('Servidor não aceita o novo efeito.');
console.log('✓ efeito falado JOGA BOCA ABERTA V25');

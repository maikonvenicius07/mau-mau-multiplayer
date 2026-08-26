const fs=require('fs');
const path=require('path');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const required=['play','draw','yourTurn','pass','burn','quick','double','reverse','skip','suit','seven','penalty','mau','round','winner','champion','chat','error'];
for(const x of required){
  if(!app.includes(`type==='${x}'`) && !app.includes(`return '${x}'`)) throw new Error(`Som ausente: ${x}`);
}
if(!app.includes("localStorage.setItem('maumauSound'")) throw new Error('Preferência de som não persistida.');
if(!app.includes("document.addEventListener('pointerdown'")) throw new Error('AudioContext não é desbloqueado por gesto.');
if(!html.includes('EFEITOS SONOROS') && !html.includes('MAU-MAU FALADO')) throw new Error('Identificação dos efeitos sonoros ausente.');
console.log('✓ contrato de efeitos sonoros V20');

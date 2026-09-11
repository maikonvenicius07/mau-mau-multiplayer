'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const pkg=require(path.join(root,'package.json'));
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert.equal(pkg.version,'40.23.0');
assert(!html.includes('burnOpportunityNotice'),'banner inferior de Queima não foi removido');
assert(!html.includes('doubleOpportunityNotice'),'banner inferior de Carta Dupla não foi removido');
assert(!app.includes('QUEIMA DISPONÍVEL — use o botão flutuante'),'texto antigo de Queima ainda existe');
assert(!app.includes('CARTA DUPLA DISPONÍVEL — use o botão flutuante'),'texto antigo de Carta Dupla ainda existe');
assert(html.includes('id="floatingBurnBtn"'),'botão flutuante de Queima deve permanecer');
assert(html.includes('id="floatingDoubleBtn"'),'botão flutuante de Carta Dupla deve permanecer');
console.log('✓ V40.17: avisos inferiores removidos sem retirar as ações flutuantes.');

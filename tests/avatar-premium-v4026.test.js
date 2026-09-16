'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const pkg=require(path.join(root,'package.json'));
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
assert.ok(/^40\./.test(pkg.version));
for(const id of ['telaazul','caldo','anao','anaocabecao','vesgo','magreloverde']){
  const f=path.join(root,'public','assets','avatars',`${id}.webp`);
  assert(fs.existsSync(f),`avatar premium ${id} ausente`);
  const size=fs.statSync(f).size;
  assert(size>9000,`avatar premium ${id} parece vazio ou inválido`);
  assert(size<32000,`avatar premium ${id} não foi otimizado para mobile`);
}
assert(app.includes("label:'Hulk Magrelo'"),'novo nome Hulk Magrelo ausente no catálogo');
assert(html.includes('Hulk Magrelo'),'novo nome Hulk Magrelo ausente no seletor');
console.log('✓ V40.26: seis avatares premium padronizados e otimizados.');

'use strict';
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
for(const id of ['rankingOpen','rankingOpen2','rankingDialog','rankingBody','rankingMine','rankingScopeLabel']){
  if(!html.includes(`id="${id}"`)) throw new Error(`Ranking V24: faltou #${id}`);
}
for(const token of ['/api/ranking','/api/profile','permanentPlayerKey()','data-rank-period','data-rank-mode']){
  if(!js.includes(token) && !html.includes(token)) throw new Error(`Ranking V24: faltou ${token}`);
}
console.log('✓ ranking UI V24');

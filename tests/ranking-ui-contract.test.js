'use strict';
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const store=fs.readFileSync(path.join(__dirname,'..','ranking-store.js'),'utf8');
for(const id of ['rankingOpen','rankingOpen2','rankingDialog','rankingBody','rankingMine','rankingScopeLabel']){
  if(!html.includes(`id="${id}"`)) throw new Error(`Ranking V40.8: faltou #${id}`);
}
for(const mode of ['data-rank-mode="official"','data-rank-mode="training"']){
  if(!html.includes(mode)) throw new Error(`Ranking V40.8: faltou ${mode}`);
}
for(const period of ['day','week','month','season','history']){
  if(!html.includes(`data-rank-period="${period}"`)) throw new Error(`Ranking V40.8: faltou período ${period}`);
}
if(!html.includes('<th>Vitórias</th>')) throw new Error('Ranking V40.8 precisa mostrar Vitórias');
for(const forbidden of ['<th>Jogos</th>','<th>Aproveit.</th>','<th>Média</th>','<th>Melhor</th>']){
  if(html.includes(forbidden)) throw new Error(`Ranking V40.8 não deve classificar/exibir ${forbidden}`);
}
for(const token of ['/api/ranking','/api/profile','permanentPlayerKey()','rankingMode=\'official\'']){
  if(!js.includes(token) && !server.includes(token)) throw new Error(`Ranking V40.8: faltou ${token}`);
}
if(!store.includes("matchId:`${room.code}-${room.createdAt}-${matchSerial}`")) throw new Error('matchId da revanche não usa matchSerial');
if(!store.includes("RANKING_GENERATION = 'v40.8-season1'")) throw new Error('migração única da Temporada 1 ausente');
if(!store.includes('DENSE_RANK() OVER (ORDER BY wins DESC)')) throw new Error('empates em vitórias precisam compartilhar posição');
console.log('✓ V40.8: UI do ranking OFICIAL/TREINO + Hoje/Semana/Mês/Temporada/Histórico conferida.');

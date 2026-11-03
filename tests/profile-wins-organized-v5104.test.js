'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const start=app.indexOf('function profileStatsWinMonthInfo(');
const end=app.indexOf('async function loadProfileStats()',start);
assert(start>0&&end>start,'Helper de agrupamento de vitórias não encontrado');
const helpers=app.slice(start,end);
const context={
  esc:(v)=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  profileStatsDate:(v)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Porto_Velho',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v)),
  profileStatsNumber:(v)=>Number(v).toLocaleString('pt-BR'),
  Date,Intl,Number,Array,
};
vm.runInNewContext(`${helpers}\nthis.render=profileStatsWinEntries`,context);
const {render}=context;
const wins=[];
for(let i=0;i<5;i++)wins.push({finishedAt:`2026-10-20T${String(i+10).padStart(2,'0')}:00:00Z`,score:20+i});
for(let i=0;i<5;i++)wins.push({finishedAt:`2026-10-10T${String(i+10).padStart(2,'0')}:00:00Z`,score:40+i});
for(let i=0;i<10;i++)wins.push({finishedAt:`2026-09-15T${String(i+10).padStart(2,'0')}:00:00Z`,score:60+i});
const count=(html)=>[...html.matchAll(/class="profile-stats-game"/g)].length;
const full=render(wins,'season');
assert.equal(count(full),20,'Temporada deve mostrar todas as vinte vitórias');
assert(full.includes('Outubro de 2026')&&full.includes('Setembro de 2026'),'Meses devem aparecer como separadores');
assert(full.includes('10 vitórias'),'O cabeçalho mensal deve indicar a quantidade correta');
assert.equal([...full.matchAll(/class="profile-stats-month"/g)].length,2,'Deve haver dois separadores mensais');
assert.equal(count(render(wins.slice(0,5),'week')),5,'Semana deve mostrar cinco vitórias');
assert.equal(count(render(wins.slice(0,10),'month')),10,'Mês deve mostrar dez vitórias');
assert(!render(wins.slice(0,10),'month').includes('profile-stats-month'),'Não adicionar divisórias no filtro mês');
assert(!render(wins.slice(0,5),'season').includes('profile-stats-month'),'Não adicionar divisor com um só mês');
assert(render([], 'season').includes('Nenhuma vitória registrada'),'Sem vitórias deve ter mensagem clara');
assert.equal(count(render([{finishedAt:'2026-10-20T15:00:00Z',score:10}],'season')),1);
assert(html.includes('id="profileStatsWinsCount"'),'Interface deve mostrar contador total de vitórias');
assert(css.includes('.profile-stats-month'),'CSS precisa dos separadores');
assert(html.includes('profile51.0.4'),'JS/CSS devem alterar identificador de cache');
assert(app.includes('profileStatsWinEntries(recent,profileStatsPeriod)'),'O carregamento deve usar o agrupamento');
assert(app.includes('profileStatsNumber(recent.length)'),'Contador deve refletir vitórias devolvidas no filtro');
console.log('✓ V51.0.4: 5/10/20 vitórias intactas, grupos por mês e total no cabeçalho.');

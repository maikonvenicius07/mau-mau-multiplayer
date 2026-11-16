'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const bracketSource=fs.readFileSync(path.join(root,'tournament-bracket.js'),'utf8');

// Simulate the DOM: display only textContent, never interpret player names as HTML.
class Node{
  constructor(tag){this.tag=tag;this.children=[];this.label='';this.className='';this.attributes={};}
  set textContent(v){this.label=String(v);this.children=[];}
  get textContent(){return this.label+this.children.map(x=>x.textContent).join('');}
  append(...items){this.children.push(...items);}
}
function all(node,tag){return [node,...node.children.flatMap(x=>all(x,tag))].filter(x=>x.tag===tag);}
const start=ui.indexOf('  // V40.69.8.15 — Resultado completo');
const end=ui.indexOf("  const champions=document.getElementById('tournamentResultsInfo');",start);
assert(start>=0&&end>start,'Funções do Ranking de torneios devem existir');
const sandbox={document:{createElement:tag=>new Node(tag)}};
vm.runInNewContext(ui.slice(start,end)+'\nthis.show=renderTournamentRankingResults;',sandbox);

const finalistNames=['maikon2','Joel','Maikon Gianizelli','Jogador 4','Jogador 5','Jogador 6','<img src=x onerror=alert(1)>'];
const cup={id:'copa-teste',name:'Copa Teste',champion:{stage:'final',names:[{name:'maikon2'}],
  standings:finalistNames.map((name,i)=>({name,position:i+1,score:[37,93,0,123,127,152,190][i],forfeited:i===6}))},
  stages:[
    {stage:'qualifier',label:'Classificatórias',tables:[{number:1,result:{results:[{position:1,name:'Jogador da fase anterior',score:12}]}}]},
    {stage:'final',label:'Grande final',tables:[{number:1,result:{results:[]}}]}
  ]};
const rootNode=new Node('div');sandbox.show(rootNode,cup);
const cards=all(rootNode,'article');assert.equal(cards.length,1);
const tables=all(rootNode,'table');assert.equal(tables.length,2,'tabela final e tabela das fases anteriores');
const rows=all(tables[0],'tbody').flatMap(t=>t.children);
assert.equal(rows.length,7,'não limitar a classificação aos cinco primeiros');
assert.equal(rows[0].textContent,'🥇 1ºmaikon237');
assert.equal(rows[1].textContent,'🥈 2ºJoel93');
assert.equal(rows[2].textContent,'🥉 3ºMaikon Gianizelli0');
assert(rows[6].textContent.includes('Desclassificado por desistência'));
assert(rootNode.textContent.includes('Jogador da fase anterior'));
assert.equal(all(rootNode,'details').length,1,'histórico de outras fases deve ficar recolhido');
assert(!ui.includes('innerHTML'),'não introduzir risco de HTML em nomes de jogadores');
assert(!rootNode.children.some(x=>x.tag==='img'),'nome com tags HTML deve permanecer texto');
const single=new Node('div');sandbox.show(single,{name:'Copa simples',champion:{names:[{name:'Ana'}],stage:'qualifier',standings:[{name:'Ana',position:1,score:10},{name:'Beto',position:2,score:20}]},stages:[{stage:'qualifier',tables:[]}]});
assert.equal(all(single,'table').length,1);
assert.equal(all(single,'details').length,0);
assert.equal(all(single,'tbody')[0].children.length,2);
const legacy=new Node('div');sandbox.show(legacy,{name:'Antigo',champion:{names:[{name:'Campeão'}]}});
assert(legacy.textContent.includes('não está disponível'),'legado sem resultados não deve fabricar classificação');
assert(css.includes('.ranking-cup-table'));
assert(html.includes('tournamentResultsInfo'));

// Public API returns stage history but never private keys, room code or tokens.
const routeStart=server.indexOf("app.get('/api/tournaments/champions'");
const routeEnd=server.indexOf('// V51.3 - sorteio persistente',routeStart);
assert(routeStart>0&&routeEnd>routeStart);
let handler=null,response=null;
const publicBracket={champion:cup.champion,stages:cup.stages};
const apiCtx={
  app:{get:(name,fn)=>{assert.equal(name,'/api/tournaments/champions');handler=fn;}},
  ensureTournamentBracketReady:async()=>true,
  tournamentCatalog:{list:async()=>[{id:'copa-teste',name:'Copa Teste'}]},
  tournamentDraw:{get:async()=>[{number:1,players:[{name:'Public'}]}]},
  tournamentBracket:{summary:async()=>publicBracket},console
};
vm.runInNewContext(server.slice(routeStart,routeEnd),apiCtx);
(async()=>{
  const res={setHeader:()=>{},json:value=>response=value,status:code=>{throw Error('HTTP '+code)}};
  await handler({},res);
  assert.equal(response.completed.length,1);
  assert.equal(response.completed[0].stages.length,2);
  assert.deepEqual(Array.from(response.completed[0].champion.standings).map(p=>p.name),finalistNames);
  assert(!JSON.stringify(response).includes('playerKey'),'não revelar identificadores privados');
  assert(!JSON.stringify(response).includes('roomCode'),'não revelar código de sala');
  assert(!JSON.stringify(response).includes('token'),'não revelar credenciais');
  assert(bracketSource.includes('forfeited:!!p.forfeited'),'final deve mostrar desclassificação sem alterar pontos');
  console.log('✓ V40.69.8.15: classificação completa no Ranking, todas as fases, proteção de privacidade e sem alterar vitórias.');
})().catch(error=>{console.error(error);process.exitCode=1;});

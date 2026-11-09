'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const start=app.indexOf('function renderScore(){');
const end=app.indexOf('\nfunction renderCenter(){',start);
assert(start>=0&&end>start,'renderScore existente');
const renderCode=app.slice(start,end);
const sample=[
 {id:'a',name:'Maikon Gianizelli',avatar:'person',score:12,roundScore:3,isBot:false},
 {id:'b',name:'Máquina',avatar:'bot',score:0,roundScore:0,isBot:true}
];
const scoreboard={innerHTML:''};
const render=new Function('$','state','avatarHTML','esc',`${renderCode};return renderScore;`)(
  ()=>scoreboard,{players:sample},(avatar)=>`<span>${avatar}</span>`,str=>String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
);
render();
assert(scoreboard.innerHTML.includes('score-title-desktop'),'título desktop mantido');
assert(scoreboard.innerHTML.includes('score-title-mobile'),'título móvel compacto');
assert(scoreboard.innerHTML.includes('🏆 Placar'),'cabeçalho curto');
assert(!scoreboard.innerHTML.includes('deslize ↔'),'instrução lateral removida');
assert(scoreboard.innerHTML.includes('aria-label="Pontuação acumulada dos jogadores"'),'lista acessível');
assert(scoreboard.innerHTML.includes('Maikon Gianizelli'),'nome do jogador visível');
assert(scoreboard.innerHTML.includes('BOT'),'identificação de bot preservada');
assert(scoreboard.innerHTML.includes('<strong>12</strong>'),'pontuação acumulada inalterada');
assert(scoreboard.innerHTML.includes('<strong>0</strong>'),'pontuação bot inalterada');
assert.equal((scoreboard.innerHTML.match(/class="score-row"/g)||[]).length,2,'um registro por jogador');
assert.equal((html.match(/id="scoreboard"/g)||[]).length,1,'não cria segundo placar');
assert.equal((html.match(/id="scoreToggleBtn"/g)||[]).length,1,'não duplica botão');
assert(html.includes('v53.8-vertical-mobile-score'),'cache invalidado');
const cssV538=css.slice(css.lastIndexOf('V53.8 — PLACAR VERTICAL COMPACTO'));
assert(cssV538.includes('@media (max-width:768px)'), 'breakpoint 768 px');
assert(cssV538.includes('flex-direction:column!important'), 'linha vertical por jogador');
assert(cssV538.includes('overflow-x:hidden!important'), 'sem rolagem horizontal no placar');
assert(cssV538.includes('overflow-y:auto!important'), 'rolagem vertical quando necessária');
assert(cssV538.includes('minmax(0,1fr)'), 'nome reduz sem empurrar pontuação');
assert(cssV538.includes('text-overflow:ellipsis!important'), 'nome longo cortado com reticências');
assert(cssV538.includes('#game.spectator-mode'), 'observador contemplado');
assert(cssV538.includes('#game:not(.spectator-mode)'), 'jogador contemplado');
assert(app.includes('compactScoreTitle?\'🏆 Placar\':\'🏆 Placar acumulado\''),'título do observador responsivo');
assert(app.includes("else if(typeof openSpectatorDrawer==='function')"),'placar observador aberto uma vez ao entrar');
// Confere que o X do observador não será desfeito por renderizações posteriores.
const contextStart=app.indexOf('  const contextKey=`${state.code||');
const contextEnd=app.indexOf('  const players=state.players||[];',contextStart);
assert(contextStart>=0&&contextEnd>contextStart,'contexto de entrada existente');
const contextLogic=app.slice(contextStart,contextEnd);
let openCount=0;
const runObserverContext=new Function('state','previous','openSpectatorDrawer',
  `let renderContextKey=previous;let force=false;const spectator=true;const renderSignatures=new Set();let playerAuxOpen=null;${contextLogic};return renderContextKey;`);
const roomState={code:'TESTE1',me:{id:'watcher'},matchSerial:1};
const open=()=>{openCount++};
const firstKey=runObserverContext(roomState,'',open);
assert.equal(openCount,1,'abre automaticamente ao entrar como observador');
runObserverContext(roomState,firstKey,open);
assert.equal(openCount,1,'não reabre o placar fechado a cada atualização');
runObserverContext({...roomState,matchSerial:2},firstKey,open);
assert.equal(openCount,2,'nova partida pode começar com placar aberto');
console.log('✓ V53.8: título compacto, uma linha por jogador, pontuação, observador e desktop preservados');

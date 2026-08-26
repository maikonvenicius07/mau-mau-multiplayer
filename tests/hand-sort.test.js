const fs=require('fs');
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
function ok(cond,msg){if(!cond)throw new Error(msg)}
ok(html.includes('id="sortHandBtn"'),'botão de organização da mão ausente');
ok(html.includes('V36 • AÇÃO RÁPIDA NÃO ROUBA A VEZ'),'identificação V36 ausente');
ok(app.includes("const handSortStorage='maumauHandSortV1'"),'preferência de ordenação não persistida');
ok(app.includes('function compareHandCards(a,b)'),'comparador de cartas ausente');
ok(app.includes("handSort==='suit'"),'modo por naipe ausente');
ok(app.includes('const visibleHand=[...state.me.hand].sort(compareHandCards)'),'renderização não usa mão ordenada');
ok(app.includes("$('#sortHandBtn').onclick=toggleHandSort"),'botão não ligado à alternância');
ok(css.includes('.sort-hand-btn'),'estilo do botão de organização ausente');
console.log('✓ V36: organização visual da mão por número ou por naipe conferida.');

const fs=require('fs');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');
function ok(c,m){if(!c)throw new Error(m)}
ok(html.includes('id="pileSideBtn"'),'botão pileSideBtn ausente');
ok(css.includes('.pile-side-toggle'),'estilo do botão ausente');
ok(app.includes("const pileSideStorage='maumauPileSideV1'"),'persistência ausente');
ok(app.includes("discard.style.setProperty('order','1','important')"),'modo baralho à direita ausente');
ok(app.includes("draw.style.setProperty('order','1','important')"),'modo baralho à esquerda ausente');
ok(app.includes("$('#pileSideBtn').onclick=togglePileSide"),'evento do botão ausente');
console.log('✓ V28: botão alterna carta da mesa/baralho nos dois sentidos e salva preferência.');

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const pkg=require('../package.json');

assert.equal(pkg.version,'40.16.0');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');

assert(app.includes("queueIndex===1"),'regra que identifica o próximo jogador ausente');
assert(app.includes('next-turn-arrow'),'seta do próximo jogador ausente no render');
assert(app.includes("arrowGlyph=spot[1]<50?'↑':'↓'"),'seta não aponta visualmente para o avatar conforme a posição');
assert(app.includes("d.classList.add('next-turn-seat')"),'destaque do assento do próximo jogador ausente');
assert(css.includes('.next-turn-arrow'),'estilo da seta PRÓXIMO ausente');
assert(css.includes('.player-card.next-turn'),'destaque visual do próximo jogador ausente');
assert(css.includes('@keyframes nextTurnBounce'),'animação da seta ausente');
assert(css.includes('@media(prefers-reduced-motion:reduce){.next-turn-arrow{animation:none}}'),'redução de movimento da seta ausente');

console.log('✓ V40.16: seta animada identifica e destaca o próximo jogador da fila.');

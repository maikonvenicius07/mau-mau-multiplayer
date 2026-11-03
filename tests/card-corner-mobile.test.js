
'use strict';
const assert=require('assert');
const fs=require('fs');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
assert(app.includes('class="corner-rank"'),'valor da carta não está separado do naipe no markup');
assert(app.includes('class="corner-suit"'),'naipe da carta não está separado do valor no markup');
assert(css.includes('.playing-card .corner-rank'),'CSS do valor da carta ausente');
assert(css.includes('.playing-card .corner-suit'),'CSS do naipe da carta ausente');
assert(css.includes('V35 — melhorar leitura das cartas na mão no mobile'),'ajuste de legibilidade mobile ausente');
assert(css.includes('margin-left:0'),'cartas continuam excessivamente sobrepostas no mobile');
console.log('✓ V37: valor/naipe separados e mão mobile legível.');

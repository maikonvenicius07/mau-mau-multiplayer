'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

assert(html.includes('styles.css?v=40.69.2-v49.9.1-chat-reacoes-iguais'), 'cache-busting V49.9.1 ausente');
assert(css.includes('V49.9.1 — FIGURINHAS DO CHAT IGUAIS AO PAINEL REAÇÕES'), 'bloco V49.9.1 ausente');
assert(css.includes('#chatView .sticker-effect-grid .sticker-reaction'), 'seletor das figurinhas do chat ausente');
assert(css.includes('height:76px!important'), 'altura desktop deve acompanhar o painel Reações');
assert(css.includes('font-size:29px!important'), 'símbolos desktop devem acompanhar o painel Reações');
assert(css.includes('font-size:9px!important'), 'texto desktop deve acompanhar o painel Reações');
assert(css.includes('height:68px!important'), 'altura mobile deve acompanhar o painel Reações');
assert(css.includes('font-size:25px!important'), 'símbolos mobile devem acompanhar o painel Reações');
assert(css.includes('font-size:8px!important'), 'texto mobile deve acompanhar o painel Reações');
assert(css.includes('grid-column:auto!important'), 'JOGA BOCA deve permanecer dentro da grade 3x3');
console.log('V49.9.1 chat/reactions parity: OK');

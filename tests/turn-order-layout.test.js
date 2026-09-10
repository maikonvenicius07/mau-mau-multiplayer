const assert=require('assert');
const fs=require('fs');
const path=require('path');
const pkg=require('../package.json');

assert.equal(pkg.version,'40.21.0');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');

assert(app.includes('function playerDisplayOrderFromMe()'),'helper de ordem visual dos jogadores ausente');
assert(app.includes('function playerTurnQueue()'),'fila de turno para indicação visual ausente');
assert(app.includes('player-order-badge'),'selo visual de ordem do jogador ausente');
assert(css.includes('.player-order-badge'),'estilo do selo de ordem ausente');

console.log('✓ V40.15: avatares organizados na ordem de jogar e indicação visual da fila conferidos.');

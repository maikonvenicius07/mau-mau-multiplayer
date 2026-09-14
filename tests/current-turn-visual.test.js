const assert=require('assert');
const fs=require('fs');
const path=require('path');
const pkg=require('../package.json');

assert.equal(pkg.version,'40.24.0');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','game-engine.js'),'utf8');

assert(app.includes("state.currentPlayerId===p.id"),'render não usa currentPlayerId para marcar o jogador atual');
assert(app.includes("p.id===state.me.id?'SUA VEZ':`VEZ DE ${p.name||'JOGADOR'}`"),'texto SUA VEZ / VEZ DE [NOME] ausente');
assert(app.includes("d.classList.add('current-turn-seat')"),'assento atual não recebe classe de destaque');
assert(app.includes('current-turn-indicator'),'indicador visual de turno ausente');
assert(app.includes('aria-current="true"'),'jogador atual não recebe indicação acessível');
assert(css.includes('.current-turn-indicator'),'CSS do indicador de turno ausente');
assert(css.includes('@keyframes currentPlayerPulse'),'pulso leve do jogador atual ausente');
assert(!css.includes('@keyframes currentPlayerPulse{from{filter:brightness(1);transform:'),'pulso não deve mover o avatar');
assert(css.includes('.current-turn-dot'),'ponto luminoso do turno ausente');
assert(server.includes('currentPlayerId: room.currentPlayer >= 0 ? room.players[room.currentPlayer]?.id : null'),'estado público não expõe currentPlayerId real do motor');
console.log('✓ V40.24: destaque visual acompanha currentPlayerId real do servidor.');

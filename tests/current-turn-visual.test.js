const assert=require('assert');
const fs=require('fs');
const path=require('path');
const pkg=require('../package.json');

assert.ok(/^40\./.test(pkg.version));
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','game-engine.js'),'utf8');

assert(app.includes("state.currentPlayerId===p.id"),'render não usa currentPlayerId para marcar o jogador atual');
assert(app.includes("current?.id===state.me.id?'✨ SUA VEZ'"),'aviso central SUA VEZ / VEZ DE [NOME] ausente');
assert(app.includes("d.classList.add('current-turn-seat')"),'assento atual não recebe classe de destaque');
assert(!app.includes('const currentTurnIndicator=isCurrent?'),'aviso de turno duplicado sobre o jogador');
assert(app.includes('aria-current="true"'),'jogador atual não recebe indicação acessível');
assert(css.includes('.player-card.active'),'destaque do jogador ativo ausente');
assert(css.includes('@keyframes currentPlayerPulse'),'pulso leve do jogador atual ausente');
assert(!css.includes('@keyframes currentPlayerPulse{from{filter:brightness(1);transform:'),'pulso não deve mover o avatar');
assert(app.includes("if(isCurrent)d.classList.add('current-turn-seat')"),'classe do jogador ativo ausente');
assert(server.includes('currentPlayerId: room.currentPlayer >= 0 ? room.players[room.currentPlayer]?.id : null'),'estado público não expõe currentPlayerId real do motor');
console.log('✓ V40.24: destaque visual acompanha currentPlayerId real do servidor.');

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert(app.includes("$('#meLabel').textContent='🃏 Suas cartas'"), 'titulo da mao ainda repete nome do jogador');
assert(app.includes("$('#handCount').textContent=spectator?'':` • ${state.me.hand.length} carta(s)`"), 'contador da mao nao foi preservado para celular');
assert(css.includes('#game .hand-owner #handCount{display:none}'), 'contador duplicado aparece no desktop');
assert(css.includes('@media(max-width:900px){#game .hand-owner #handCount{display:inline}}'), 'contador ausente no celular');
assert(html.includes('<strong id="meLabel">🃏 Suas cartas</strong>'), 'rotulo inicial da mao incorreto');
assert(!app.includes('const currentTurnIndicator=isCurrent?'), 'existe aviso redundante acima do assento ativo');
assert(app.includes('const nextArrow=nextTurn?'), 'indicacao de proximo jogador foi removida');
assert(app.includes('const orderBadge=!isCurrent&&!nextTurn&&orderText?'), 'selo PRÓXIMO duplicado no cartao');
assert(app.includes('aria-current="true"'), 'acessibilidade do jogador ativo foi removida');
assert(css.includes('#game .player-card.active'), 'destaque visual do jogador ativo nao foi preservado');
assert(app.includes('const countWord=p.cardCount===1'), 'quantidade de cartas do assento foi removida');
console.log('✓ Dados da area de jogadores sem duplicacoes; turno e cartas preservados.');

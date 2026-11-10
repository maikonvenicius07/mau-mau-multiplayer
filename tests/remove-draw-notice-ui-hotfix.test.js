'use strict';

// Hotfix visual: o aviso azul pós-compra foi retirado da mesa.
// A decisão de jogar ou passar continua no motor de jogo (nenhuma regra alterada).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'game-engine.js'), 'utf8');

for (const [file, source] of [['index.html', html], ['app.js', js], ['styles.css', css]]) {
  assert(!source.includes('drawChoice'), `${file} não deve conter o elemento do aviso azul`);
  assert(!source.includes('draw-choice'), `${file} não deve conter estilos obsoletos do aviso`);
}
assert(!html.includes('🃏 Carta comprada: você pode jogar QUALQUER carta válida'), 'a mensagem original deve ser removida integralmente');
assert(html.includes('id="drawPile"'), 'o botão de compra deve continuar na interface');
assert(html.includes('id="passTurnBtn"'), 'o botão Passar a vez deve continuar na interface');
assert(js.includes('const canPassNormal='), 'a liberação do passe continua regida pela compra');
assert(engine.includes('function drawAction(') && engine.includes('function passTurn('), 'as regras de compra e passe permanecem no motor');
console.log('✓ Hotfix: aviso azul completamente removido sem remover ações Comprar/Passar.');

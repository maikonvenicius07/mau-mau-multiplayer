'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
// Menu principal enxuto: só Ranking; Meu Perfil fica exclusivamente dentro dele.
const landing = html.match(/<div class="landing-links">([\s\S]*?)<\/div>/);
assert(landing, 'Atalhos do menu inicial ausentes');
assert(landing[1].includes('id="rankingOpen"'), 'Ranking deve permanecer no menu');
assert(!landing[1].includes('profileStatsOpen'), 'Meu Perfil duplicado no menu inicial');
assert(html.includes('id="profileStatsOpenRanking"'), 'Meu Perfil deve permanecer dentro do Ranking');
// Cada jogador tem indicação explícita dentro da coluna existente e é clicável.
assert(app.includes('class="rank-player rank-profile-trigger"'));
assert(app.includes('class="rank-profile-cta"'));
assert(app.includes('👤 Ver perfil'));
assert(app.includes('aria-label="Ver perfil de ${esc(r.name)}"'));
assert(app.includes('openProfileStatsForPlayer(player.playerKey)'));
assert(app.includes("$('#rankingDialog')"), 'Retorno ao Ranking deve continuar previsto');
assert(css.includes('.ranking-table .rank-profile-cta'));
assert(html.includes('profile51.0.3'), 'CSS deve ter versão atualizada');
assert(html.includes('camera50.2-profile51.0.3'), 'JS deve ter versão atualizada');
assert(!app.includes("$('#profileStatsOpen').onclick"));
console.log('✓ V51.0.2: botão Ver perfil visível e Meu Perfil somente dentro do Ranking.');

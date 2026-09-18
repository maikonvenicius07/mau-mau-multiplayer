'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

assert.strictEqual(pkg.version, '40.65', 'package.json deve identificar V40.65');
assert.strictEqual(pkg.engines && pkg.engines.node, '22.22.0', 'Node deve permanecer fixado em 22.22.0');
assert.ok(pkg.scripts && pkg.scripts['lock:generate'], 'script lock:generate deve existir');
assert.ok(pkg.scripts && pkg.scripts['verify:lock'], 'script verify:lock deve existir');
assert.ok(pkg.scripts.verify.includes('npm run verify:lock'), 'verify deve conferir o lockfile');

const render = read('render.yaml');
assert.ok(render.includes('npm ci --no-audit --no-fund'), 'Render deve preferir npm ci quando houver lockfile');
assert.ok(render.includes('[ -f package-lock.json ]'), 'Render deve ter bootstrap seguro enquanto o lock ainda não foi commitado');

const verify = read('.github/workflows/verify.yml');
assert.ok(verify.includes('npm ci --no-audit --no-fund'), 'GitHub Verify deve usar npm ci com lockfile');
assert.ok(verify.includes('package-lock.json'), 'GitHub Verify deve detectar o lockfile');

const generator = read('.github/workflows/generate-lockfile.yml');
assert.ok(generator.includes('npm run lock:generate'), 'workflow deve gerar o package-lock pelo npm');
assert.ok(generator.includes('npm ci --no-audit --no-fund'), 'workflow deve provar que o lock funciona com npm ci');
assert.ok(generator.includes('npm run verify'), 'workflow deve executar a suíte antes de commitar o lock');
assert.ok(generator.includes('git push'), 'workflow deve tentar persistir o package-lock no repositório');
assert.ok(generator.includes('actions/upload-artifact@v4'), 'workflow deve guardar artefato de fallback');

const checkLock = read('scripts/check-lockfile.js');
assert.ok(checkLock.includes('lockfileVersion'), 'validador deve conferir lockfileVersion');
assert.ok(checkLock.includes('REQUIRE_PACKAGE_LOCK'), 'validador deve distinguir bootstrap de validação obrigatória');
assert.ok(checkLock.includes('node_modules/${name}'), 'validador deve conferir dependências diretas resolvidas');

console.log('✓ V40.65: bootstrap seguro gera package-lock no GitHub; npm ci é usado no Render/CI após o lock e a árvore direta é validada.');

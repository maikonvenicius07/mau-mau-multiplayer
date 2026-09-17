'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.join(__dirname,'..');
const pkg=require('../package.json');
const render=fs.readFileSync(path.join(root,'render.yaml'),'utf8');
const nodeVersion=fs.readFileSync(path.join(root,'.node-version'),'utf8').trim();
const workflow=fs.readFileSync(path.join(root,'.github','workflows','verify.yml'),'utf8');
const npmrc=fs.readFileSync(path.join(root,'.npmrc'),'utf8');

assert.strictEqual(pkg.version,'40.58.2');
assert.strictEqual(pkg.engines.node,'22.22.0','Node precisa permanecer fixado para deploy reproduzível');
assert.strictEqual(nodeVersion,'22.22.0','.node-version divergente do package.json');
assert(render.includes('npm install --no-audit --no-fund && npm run verify'),'Render deve testar antes de publicar');
assert(workflow.includes('node-version: 22.22.0'),'GitHub Actions deve usar a mesma versão do Node');
assert(workflow.includes('npm run verify'),'GitHub Actions deve executar a suíte completa');
assert(npmrc.includes('save-exact=true'),'novas dependências devem ser salvas com versão exata');
console.log('✓ V40.56: Node fixado, Render verifica antes do deploy e CI do GitHub configurada.');

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

function fail(message) {
  console.error(`[lock] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(lockPath)) {
  if (process.env.REQUIRE_PACKAGE_LOCK === '1') {
    fail('package-lock.json é obrigatório nesta etapa, mas não foi encontrado.');
  }
  console.log('[lock] package-lock.json ainda não existe: modo bootstrap V40.65. O GitHub irá gerá-lo e validá-lo automaticamente.');
  process.exit(0);
}

let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
} catch (err) {
  fail(`package-lock.json inválido: ${err.message}`);
}

if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 3) {
  fail(`lockfileVersion ${lock.lockfileVersion ?? 'ausente'} não é aceito; esperado >= 3.`);
}

const rootEntry = lock.packages && lock.packages[''];
if (!rootEntry) fail('entrada raiz packages[""] ausente.');
if (rootEntry.name !== pkg.name) fail(`nome raiz divergente: ${rootEntry.name} != ${pkg.name}.`);
if (rootEntry.version !== pkg.version) fail(`versão raiz divergente: ${rootEntry.version} != ${pkg.version}.`);

const expected = pkg.dependencies || {};
const lockedRoot = rootEntry.dependencies || {};
for (const [name, version] of Object.entries(expected)) {
  if (lockedRoot[name] !== version) {
    fail(`dependência raiz ${name} divergente: lock=${lockedRoot[name] ?? 'ausente'} package=${version}.`);
  }
  const nodeEntry = lock.packages[`node_modules/${name}`];
  if (!nodeEntry) fail(`entrada node_modules/${name} ausente no lockfile.`);
  if (nodeEntry.version !== version) {
    fail(`versão resolvida de ${name} divergente: ${nodeEntry.version} != ${version}.`);
  }
  if (!nodeEntry.integrity || !nodeEntry.resolved) {
    fail(`${name} não possui resolved/integrity completos no lockfile.`);
  }
}

console.log(`[lock] package-lock.json válido (v${lock.lockfileVersion}); ${Object.keys(expected).length} dependências diretas fixadas para ${pkg.version}.`);

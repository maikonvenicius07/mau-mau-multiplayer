'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir)
  .filter(name => name.endsWith('.test.js'))
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error('Nenhum teste *.test.js encontrado.');
  process.exit(1);
}

console.log(`Executando ${files.length} testes...`);
const failures=[];
let passed=0;
for (const file of files) {
  const fullPath = path.join(testsDir, file);
  // Testes nunca devem herdar o PostgreSQL real do ambiente de deploy.
  // Cada teste deve usar armazenamento temporário/local explicitamente.
  const testEnv = { ...process.env, DATABASE_URL: '' };
  const result = spawnSync(process.execPath, [fullPath], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: testEnv
  });

  if (result.error) {
    console.error(`Falha ao iniciar ${file}:`, result.error.message);
    failures.push(file);
    continue;
  }
  if (result.status !== 0) {
    console.error(`Teste falhou: ${file}`);
    failures.push(file);
    continue;
  }
  passed++;
}

if (failures.length) {
  console.error(`✖ Suíte: ${passed} aprovados, ${failures.length} falharam.`);
  for(const file of failures) console.error(`  ✖ ${file}`);
  process.exitCode=1;
} else {
  console.log(`✓ Suíte completa: ${passed} testes aprovados.`);
}

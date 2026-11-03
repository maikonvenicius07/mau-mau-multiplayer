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
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`Teste falhou: ${file}`);
    process.exit(result.status || 1);
  }
}

console.log(`✓ Suíte completa: ${files.length} testes aprovados.`);

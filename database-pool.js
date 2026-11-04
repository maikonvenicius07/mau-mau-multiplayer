'use strict';

// Fase 6A — um pool PostgreSQL por processo do servidor.
// A injeção é explícita para não compartilhar conexões entre instâncias de teste
// nem criar um Pool quando DATABASE_URL está ausente (modo JSON).
function createAppDatabasePool(databaseUrl, {PoolClass}={}) {
  if (!String(databaseUrl||'').trim()) return null;
  const Pool = PoolClass || require('pg').Pool;
  return new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === 'disable' ? false : {rejectUnauthorized:false},
    // Preserva os defaults de 'pg' (max=10, idleTimeoutMillis=10000).
    // Antes, cada um dos quatro armazenamentos criava seu próprio pool.
  });
}

module.exports={createAppDatabasePool};

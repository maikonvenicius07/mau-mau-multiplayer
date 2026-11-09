'use strict';

const fs = require('node:fs');

// TLS seguro por padrão. Conexões internas sem TLS exigem PGSSLMODE=disable
// explicitamente (nunca por um parâmetro oculto em DATABASE_URL).
function createDatabasePoolConfig(databaseUrl,{env=process.env}={}) {
  const raw=String(databaseUrl||'').trim();
  if(!raw)throw new Error('DATABASE_URL ausente.');
  const mode=String(env.PGSSLMODE||'verify-full').trim().toLowerCase();
  if(!['disable','require','verify-full'].includes(mode))
    throw new Error('PGSSLMODE inválido: use verify-full, require ou disable.');
  const url=new URL(raw);
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL precisa usar postgresql://.');
  const urlMode=String(url.searchParams.get('sslmode')||'').toLowerCase();
  if(urlMode==='no-verify')throw new Error('sslmode=no-verify não é permitido: configure uma CA confiável.');
  if(urlMode==='disable'&&mode!=='disable')
    throw new Error('DATABASE_URL solicita sslmode=disable: configure PGSSLMODE=disable explicitamente apenas em rede interna confiável.');
  if(mode==='disable'&&urlMode&&urlMode!=='disable')
    throw new Error('Conflito: PGSSLMODE=disable e DATABASE_URL exige TLS. Revise a configuração da conexão.');
  if(urlMode&&!['require','verify-full','disable'].includes(urlMode))
    throw new Error('sslmode da DATABASE_URL não suportado.');
  // pg-connection-string substitui silenciosamente a configuração ssl quando
  // há sslmode na URL. Removemos o parâmetro para que rejectUnauthorized=true
  // não seja descartado pelo parser de conexão.
  if(urlMode)url.searchParams.delete('sslmode');
  for(const key of ['sslrootcert','sslcert','sslkey']){
    if(url.searchParams.has(key))throw new Error(`${key} na DATABASE_URL não é suportado: configure PGSSLROOTCERT ou o certificado por variável segura.`);
  }
  const connectionString=urlMode?url.toString():raw;
  if(mode==='disable')return {connectionString,ssl:false};
  const caPath=String(env.PGSSLROOTCERT||'').trim();
  const caInline=String(env.DATABASE_SSL_CA||'').trim();
  if(caPath&&caInline)throw new Error('Escolha somente PGSSLROOTCERT ou DATABASE_SSL_CA.');
  const ca=caPath?fs.readFileSync(caPath,'utf8'):(caInline?caInline.replace(/\\n/g,'\n'):null);
  return {connectionString,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})}};
}

// Um pool por processo; stores independentes podem usar a mesma política TLS.
function createAppDatabasePool(databaseUrl, {PoolClass,env}={}) {
  if (!String(databaseUrl||'').trim()) return null;
  const Pool = PoolClass || require('pg').Pool;
  return new Pool(createDatabasePoolConfig(databaseUrl,{env}));
}

module.exports={createDatabasePoolConfig,createAppDatabasePool};

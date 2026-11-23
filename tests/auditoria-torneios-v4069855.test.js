'use strict';
// Regressão do hotfix V40.69.8.55 (compatível com versões seguintes).
// Diagnóstico claro quando o Render recebe fontes de versões misturadas.
// Sem acesso ao banco de produção.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {TournamentCatalog}=require('../tournament-catalog');
const {contentVersion,versionedIndex}=require('../static-asset-versioning');

(async()=>{
  const row=(id,status)=>({id,name:id,capacity:4,rounds:5,status,startAt:null,createdBy:'owner',createdAt:'2026-11-23T12:00:00.000Z'});
  const catalog=new TournamentCatalog({databaseUrl:'',pool:null});
  catalog.local=[row('draft','draft'),row('open','open'),row('closed','closed'),row('cancelled','cancelled')];
  assert.equal((await catalog.list()).length,4,'listagem pública preserva todos os status');
  assert.deepEqual((await catalog.list({status:'closed'})).map(x=>x.id),['closed']);
  assert.deepEqual((await catalog.list({status:'invalid'})).length,4,'status desconhecido não elimina torneios');

  const calls=[];
  const fakePool={query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:params?.length? [row('closed','closed')]:[row('draft','draft'),row('closed','closed')]};
  }};
  const pgCatalog=new TournamentCatalog({databaseUrl:'',pool:fakePool});
  assert.equal((await pgCatalog.list({status:'closed'})).length,1);
  assert.match(calls[0].sql,/WHERE status=\$1/);
  assert.deepEqual(calls[0].params,['closed'],'filtro deve ser parametrizado');
  assert.equal((await pgCatalog.list()).length,2);
  assert.doesNotMatch(calls[1].sql,/WHERE status=\$1/,'consulta pública permanece sem filtro');
  assert.deepEqual(calls[1].params,[]);

  const base=path.resolve(__dirname,'..'),server=fs.readFileSync(path.join(base,'server.js'),'utf8');
  // NÃO comparar o texto completo do servidor com assert.match(): em caso de
  // arquivos desencontrados, isso imprime centenas de milhares de caracteres
  // de código no log do Render e torna o diagnóstico pouco legível.
  const versionMatch=server.match(/\bconst\s+RELEASE_VERSION\s*=\s*['"]V40\.69\.8\.(\d+)['"]/);
  assert.ok(versionMatch && Number(versionMatch[1])>=55,
    '[BUILD/MISTURA_DE_VERSOES] server.js não corresponde à série V40.69.8.55+. '
    +'Publique o ZIP COMPLETO na raiz do repositório e confirme que server.js foi atualizado.');

  // A otimização precisa estar ligada ao reconciliador, não apenas aparecer
  // em algum trecho isolado de server.js. Aceitamos espaços e aspas variantes
  // para que mudanças de formatação não bloqueiem um deploy legítimo.
  const reconcileStart=server.search(/\basync\s+function\s+reconcileTournamentProgress\s*\(\s*\)\s*\{/);
  const reconcileEnd=reconcileStart<0?-1:server.indexOf('const tournamentProgressTimer=',reconcileStart);
  const reconcileSource=reconcileStart>=0 && reconcileEnd>reconcileStart
    ?server.slice(reconcileStart,reconcileEnd):'';
  const hasSelectiveList=/\b(?:const|let)\s+events\s*=\s*await\s+tournamentCatalog\s*\.\s*list\s*\(\s*\{\s*status\s*:\s*['"]closed['"]\s*\}\s*\)/.test(reconcileSource);
  assert.ok(hasSelectiveList,
    '[BUILD/MISTURA_DE_VERSOES] O reconciliador de server.js não usa '
    +"tournamentCatalog.list({status:'closed'}). "
    +'Não elimine esta verificação: atualize server.js e tournament-catalog.js '
    +'JUNTOS com os arquivos de testes. Consulte docs/CORRECAO_BUILD_RENDER_V40_69_8_56.md.');

  const html=versionedIndex(path.join(base,'public'));
  for(const name of ['media-session.js','controls-positioning.js','tournament-schedule.js','tournament-auto-refresh.js']){
    const file=fs.readFileSync(path.join(base,'public',name));
    assert(html.includes(`${name}?v=${contentVersion(file)}`),`${name} deve usar hash de conteúdo`);
  }
  assert(html.includes('/socket.io/socket.io.js'),'script dinâmico do Socket.IO deve permanecer intocado');
  console.log('✓ V40.69.8.56: pacote coerente, seleção SQL segura, listagem intacta e assets versionados.');
})().catch(error=>{console.error(error);process.exitCode=1});

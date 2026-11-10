'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RankingStore,RANKING_GENERATION}=require('../ranking-store');

function sample(id,won=true){return {matchId:id,roomCode:'TEST10',mode:'official',rounds:5,
  startedAt:'2026-11-09T12:00:00Z',finishedAt:'2026-11-09T12:30:00Z',results:[
    {playerKey:'a',name:'Alice',avatar:'macaco',score:10,position:1,won},
    {playerKey:'b',name:'Bruno',avatar:'macaco',score:20,position:2,won:!won},
  ]};}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mau-rank-preserve-'));
  try {
    const file=path.join(dir,'rank.json');
    const past={version:1,rankingGeneration:'ranking-geracao-legacy',currentSeasonId:1,
      matches:[sample('m-antigo'),sample('m-antigo-2',false)]};
    fs.writeFileSync(file,JSON.stringify(past));
    const before=fs.readFileSync(file);
    const store=new RankingStore({databaseUrl:null,filePath:file});
    await store.init();
    const afterMigration=JSON.parse(fs.readFileSync(file));
    assert.deepEqual(afterMigration.matches,past.matches,'init não pode alterar partidas antigas');
    assert.equal(afterMigration.rankingGeneration,RANKING_GENERATION,'marcador compatível com rollback legado');
    assert.equal(afterMigration.previousRankingGeneration,'ranking-geracao-legacy');
    assert.deepEqual(fs.readFileSync(`${file}.pre-v406982.bak`),before,'backup integral da base JSON anterior');
    assert.equal(store.backend.data.matches.length,2);
    assert.equal(await store.recordMatch(sample('m-antigo')),false,'retry não conta duas vezes');
    assert.equal(await store.recordMatch(sample('m-novo')),true);
    const fresh=JSON.parse(fs.readFileSync(file));
    assert.equal(fresh.matches.length,3,'incluir sem apagar resultados anteriores');
    assert.deepEqual(fresh.matches.slice(0,2),past.matches,'nenhuma partida antiga foi modificada');
    assert.equal(fresh.rankingGeneration,RANKING_GENERATION,'marcador atual sem perder vitórias');
    assert.equal(fresh.previousRankingGeneration,'ranking-geracao-legacy','marcador anterior auditável');
    const again=new RankingStore({databaseUrl:null,filePath:file});
    await again.init();
    assert.equal(again.backend.data.matches.length,3,'reinício deve recuperar tudo');
    const leaderboard=await again.getLeaderboard({period:'season',mode:'official'});
    assert.equal(leaderboard.find(x=>x.playerKey==='a').wins,2);
    assert.equal(leaderboard.find(x=>x.playerKey==='b').wins,1);
    assert.equal(await again.recordMatch({...sample('empty'),results:[]}),false,'partida vazia não entra no ranking');
    assert.equal(again.backend.data.matches.length,3);

    const originalPersist=again.backend.persist;
    again.backend.persist=()=>{throw new Error('disco cheio');};
    await assert.rejects(()=>again.recordMatch(sample('m-retry')),/disco cheio/);
    assert.equal(again.backend.data.matches.length,3,'falha ao persistir não pode confirmar em memória');
    again.backend.persist=originalPersist;
    assert.equal(await again.recordMatch(sample('m-retry')),true,'mesma partida deve poder ser reenviada');
    assert.equal(again.backend.data.matches.length,4);

    const corruptFile=path.join(dir,'corrupt.json');
    fs.writeFileSync(corruptFile,'{"matches":[');
    const corruptBytes=fs.readFileSync(corruptFile);
    const broken=new RankingStore({databaseUrl:null,filePath:corruptFile});
    await assert.rejects(()=>broken.init(),/histórico preservado/i);
    assert.deepEqual(fs.readFileSync(corruptFile),corruptBytes,'JSON corrompido não pode ser zerado');

    const badShapeFile=path.join(dir,'wrong-shape.json');
    fs.writeFileSync(badShapeFile,JSON.stringify({version:1,notMatches:'error'}));
    const badShape=new RankingStore({databaseUrl:null,filePath:badShapeFile});
    await assert.rejects(()=>badShape.init(),/histórico preservado/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(badShapeFile)),{version:1,notMatches:'error'});

    // Mais de 20 mil partidas históricas: nenhum corte automático.
    const longFile=path.join(dir,'large.json');
    fs.writeFileSync(longFile,JSON.stringify({version:2,rankingGeneration:RANKING_GENERATION,
      matches:Array.from({length:20001},(_,i)=>({matchId:`old-${i}`,results:[{playerKey:'a',won:true}]}))}));
    const large=new RankingStore({databaseUrl:null,filePath:longFile});
    await large.init();
    assert.equal(await large.recordMatch(sample('new-final')),true);
    assert.equal(JSON.parse(fs.readFileSync(longFile)).matches.length,20002,'não descartar vitórias antigas por limite de memória');

    // Banco PostgreSQL simulado; protege contra mudanças de geração sem usar um banco real.
    const statements=[];
    let metaValue='ranking-anterior';
    const client={
      async query(sql,params){
        const query=String(sql);statements.push({sql:query,params});
        if (/SELECT meta_value FROM mm_ranking_meta/.test(query)) return {rows:[{meta_value:metaValue}]};
        return {rows:[],rowCount:1};
      },
      release(){},
    };
    const pool={connect:async()=>client};
    const pg=new RankingStore({pool});
    await pg.init();
    await pg.init();
    const allSql=statements.map(x=>x.sql).join('\n');
    assert(!/\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE)\s+mm_(?:matches|match_results|seasons|players)/i.test(allSql),
      'init PostgreSQL jamais pode eliminar dados históricos');
    assert(statements.some(x=>/ranking_generation_before_v406982/.test(x.sql)),
      'preservar marcador anterior para auditoria');
    assert(statements.some(x=>/ON CONFLICT\(meta_key\) DO UPDATE SET meta_value=EXCLUDED.meta_value/.test(x.sql)),
      'normalizar geração sem apagar vitórias evita reset em rollback');
    assert(statements.some(x=>/ON CONFLICT\(season_id\) DO NOTHING/.test(x.sql)),
      'nomes/datas de temporadas históricas não podem ser alterados');
    assert(statements.filter(x=>/\bCOMMIT\b/.test(x.sql)).length===2,'migração idempotente em dois boots');
    assert.equal(await pg.recordMatch({matchId:'sem-resultados',results:[]}),false,
      'não gravar partida sem participantes');
    assert.equal(statements.filter(x=>/INSERT INTO mm_matches\(/.test(x.sql)).length,0);
    console.log('✓ V40.69.8.2: histórico preservado em JSON e PostgreSQL simulado; reinício, retry, sem reset e sem poda.');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

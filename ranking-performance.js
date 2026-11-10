'use strict';

// V40.69.8.3 — cálculo exclusivamente de leitura, derivado de resultados persistidos.
// O prior de vitórias esperado reflete o número de participantes registrados por mesa.
// Se um histórico possuir apenas um participante, usa-se 1/2 e sinaliza-se a limitação.
const DEFAULT_MINIMUMS = Object.freeze({day:3,week:5,month:10,season:20,history:30});
function configInteger(value, fallback, low, high) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return fallback;
  const n=Number(text);
  return Number.isSafeInteger(n) && n>=low && n<=high ? n : fallback;
}
function performanceSettings(period, env=process.env) {
  const normalized=Object.hasOwn(DEFAULT_MINIMUMS,period)?period:'day';
  return {
    period:normalized,
    minimumGames:configInteger(env[`RANK_MIN_${normalized.toUpperCase()}`],DEFAULT_MINIMUMS[normalized],1,10000),
    priorGames:configInteger(env.RANK_PERFORMANCE_PRIOR_GAMES,10,1,1000),
    method:'posterior de vitórias com expectativa conforme participantes registrados; empates compartilham crédito',
  };
}
function aggregatePerformanceMatches(matches) {
  const byPlayer=new Map();
  for (const match of matches) {
    const results=Array.isArray(match?.results)?match.results.filter(r=>r?.playerKey):[];
    const participantCount=new Set(results.map(r=>r.playerKey)).size;
    const winners=results.filter(r=>r.won).length;
    for (const result of results) {
      const key=String(result.playerKey);
      const row=byPlayer.get(key)||{playerKey:key,name:result.name||'Jogador',avatar:result.avatar||'macaco',games:0,wins:0,winCredits:0,expectedWins:0,uncertainGames:0};
      row.name=result.name||row.name;
      row.avatar=result.avatar||row.avatar;
      row.games++;
      if (result.won) {row.wins++;row.winCredits+=1/Math.max(winners,1);}
      row.expectedWins+=1/Math.max(participantCount,2);
      if (participantCount<2) row.uncertainGames++;
      byPlayer.set(key,row);
    }
  }
  return [...byPlayer.values()];
}
function rankPerformanceRows(rows,settings) {
  const k=settings.priorGames,minimum=settings.minimumGames;
  const result=rows.map(r=>{
    const games=Number(r.games)||0,wins=Number(r.wins)||0;
    const credits=Number(r.winCredits)||0,expected=Number(r.expectedWins)||0;
    const baseline=games?expected/games:.5;
    const adjusted=(credits+k*baseline)/(games+k);
    // Índice relativo: 50 pontos = desempenho esperado para o tamanho das mesas;
    // 0 = nenhuma vitória, 100 = vitória em todas as mesas. Evita privilegiar
    // duelos (expectativa 50%) em relação a mesas de 4/5 (25%/20%).
    const index=adjusted>=baseline
      ? 50+50*(adjusted-baseline)/(1-baseline)
      : 50*adjusted/baseline;
    return {
      playerKey:r.playerKey,name:r.name||'Jogador',avatar:r.avatar||'macaco',
      games,wins,winRate:games?Number((100*wins/games).toFixed(1)):0,
      adjustedRate:Number((100*adjusted).toFixed(2)),
      performanceIndex:Number(index.toFixed(2)),
      expectedRate:Number((100*baseline).toFixed(1)),
      winCredits:Number(credits.toFixed(4)),
      uncertainGames:Number(r.uncertainGames)||0,
      provisional:games<minimum,minimumGames:minimum,gamesNeeded:Math.max(0,minimum-games),
      _score:index,
    };
  }).sort((a,b)=> Number(a.provisional)-Number(b.provisional) || b._score-a._score || b.games-a.games || b.wins-a.wins || String(a.name).localeCompare(String(b.name),'pt-BR') || String(a.playerKey).localeCompare(String(b.playerKey)));
  let rank=0,previous=null;
  for(const row of result){
    if(row.provisional){row.rank=null;} else {
      if(previous===null || Math.abs(row._score-previous)>1e-10) rank++;
      row.rank=rank; previous=row._score;
    }
    delete row._score;
  }
  return result;
}
module.exports={DEFAULT_MINIMUMS,performanceSettings,aggregatePerformanceMatches,rankPerformanceRows};

'use strict';

// V40.69.8.5 — Títulos exclusivamente derivados de partidas oficiais completas.
// Não há mutação de histórico, concessão manual de vitórias ou rating paralelo.
// Os cortes são em 00:00 de Rondônia (UTC-04, sem horário de verão).
const OFFSET_MS=4*60*60*1000;
const MIN_MONTH=10;
const MIN_YEAR=30;
const MAX_RD=200;
function configuredNumber(value,fallback,min,max){
  const n=Number(value);
  return String(value??'').trim()&&Number.isInteger(n)&&n>=min&&n<=max?n:fallback;
}

function windows(now=Date.now(),env=process.env){
  const local=new Date(now-OFFSET_MS);
  const year=local.getUTCFullYear(),month=local.getUTCMonth();
  return {
    month:{start:Date.UTC(year,month,1)+OFFSET_MS,end:Date.UTC(year,month+1,1)+OFFSET_MS,label:`${String(month+1).padStart(2,'0')}/${year}`,minimum:configuredNumber(env.RANK_AWARD_MIN_MONTH,MIN_MONTH,1,500)},
    year:{start:Date.UTC(year,0,1)+OFFSET_MS,end:Date.UTC(year+1,0,1)+OFFSET_MS,label:String(year),minimum:configuredNumber(env.RANK_AWARD_MIN_YEAR,MIN_YEAR,1,500)}
  };
}
function summarize(snapshot,window,maxRD=MAX_RD){
  const entries=[];
  for(const [playerKey,events] of snapshot.events){
    const selected=events.filter(e=>e.at>=window.start&&e.at<window.end);
    if(!selected.length)continue;
    const final=selected[selected.length-1];
    const player=snapshot.players.get(playerKey);
    const games=selected.length,wins=selected.filter(e=>e.won).length;
    const rating=final.ratingAfter,rd=final.rdAfter;
    if(!Number.isFinite(rating)||!Number.isFinite(rd))continue;
    const delta=selected.reduce((sum,e)=>sum+e.delta,0);
    const eligible=games>=window.minimum&&rd<=maxRD;
    const avg=delta/games;
    const deviation=Math.sqrt(selected.reduce((n,e)=>n+(e.delta-avg)**2,0)/games);
    entries.push({playerKey,name:player?.name||'Jogador',avatar:player?.avatar||'macaco',games,wins,winRate:wins/games,
      rating:Number(rating.toFixed(1)),rd:Number(rd.toFixed(1)),conservative:Number((rating-2*rd).toFixed(1)),
      gain:Number(delta.toFixed(1)),deviation:Number(deviation.toFixed(1)),
      consistencyScore:Number((100*wins/games-0.5*deviation).toFixed(1)),eligible});
  }
  return entries;
}
function choose(rows,sort,qualify=()=>true){
  return [...rows].filter(r=>r.eligible&&qualify(r)).sort((a,b)=>sort(a,b)||a.playerKey.localeCompare(b.playerKey))[0]||null;
}
function rankAwards(snapshot,{now=Date.now(),env=process.env}={}){
  const dates=windows(now,env);
  const maxRD=configuredNumber(env.RANK_AWARD_MAX_RD,MAX_RD,30,350);
  const monthly=summarize(snapshot,dates.month,maxRD),yearly=summarize(snapshot,dates.year,maxRD);
  const rankSkill=(a,b)=>b.conservative-a.conservative||b.rating-a.rating||b.games-a.games;
  const rankWins=(a,b)=>b.wins-a.wins||b.winRate-a.winRate||b.games-a.games;
  const rankReveal=(a,b)=>b.gain-a.gain||b.conservative-a.conservative;
  // Consistência: alta taxa de vitórias com pouca oscilação de rating por jogo.
  // Só elegíveis com resultado acima da expectativa inicial de 1500.
  const rankStable=(a,b)=>b.consistencyScore-a.consistencyScore||a.deviation-b.deviation||b.conservative-a.conservative;
  const pick=(title,period,rows,sort,qualify)=>({title,period,periodLabel:dates[period].label,
    minimumGames:dates[period].minimum,winner:choose(rows,sort,qualify)});
  return [
    pick('👑 Rei do Mês','month',monthly,rankSkill),
    pick('🏆 Rei do Ano','year',yearly,rankSkill),
    pick('🥇 Mais Vitorioso','month',monthly,rankWins),
    pick('🚀 Revelação','month',monthly,rankReveal,r=>r.gain>0),
    pick('🎯 Mais Consistente','month',monthly,rankStable,r=>r.conservative>=1500),
  ];
}
module.exports={windows,summarize,rankAwards};

'use strict';
// A pontuação menor classifica. Nunca anunciar vaga definitiva se o corte
// envolver empate que ainda depende do sorteio oficial da próxima fase.
function outcomeForPlayer(results,quota,playerKey){
  if(!Array.isArray(results)||!Number.isInteger(quota)||quota<1||!playerKey)return null;
  const ranked=results.filter(p=>p&&!p.forfeited&&p.playerKey)
    .sort((a,b)=>Number(a.score)-Number(b.score)||Number(a.position)-Number(b.position));
  const index=ranked.findIndex(p=>p.playerKey===playerKey);
  if(index<0)return null;
  const cutoff=ranked[quota-1];
  if(!cutoff)return {status:'qualified'}; // todos os não-desistentes avançam
  const score=Number(ranked[index].score),limit=Number(cutoff.score);
  if(!Number.isFinite(score)||!Number.isFinite(limit))return {status:'pending'};
  if(score===limit && ranked.length>quota && ranked.some((p,i)=>i>=quota&&Number(p.score)===limit))
    return {status:'pending'};
  return {status:index<quota?'qualified':'eliminated'};
}
module.exports={outcomeForPlayer};

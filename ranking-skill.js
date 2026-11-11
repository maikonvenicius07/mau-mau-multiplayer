'use strict';

// V40.69.8.4: adaptação de Glicko-2 para mesas de 2–5 participantes humanos.
// Cada mesa é uma única observação por jogador: os confrontos internos têm
// peso 1/(N-1). É uma aproximação por comparações pareadas correlacionadas,
// e NÃO trata os N-1 adversários como partidas estatisticamente independentes.
// Nunca altera dados históricos nem o ranking de vitórias.
const {performanceSettings}=require('./ranking-performance');

const SCALE=173.7178;
const INITIAL_RATING=1500;
const INITIAL_RD=350;
const INITIAL_SIGMA=0.06;
const DEFAULT_TAU=0.5;
const DEFAULT_MAX_RD=200;
const DEFAULT_HISTORY_LIMIT=200000;
const MAX_ITERATIONS=100;
const EPSILON=1e-6;

function skillSettings(period,env=process.env){
  const minimum=performanceSettings(period,env).minimumGames;
  const clamp=(value,fallback,min,max)=>{
    const n=Number(value);
    return String(value??'').trim() && Number.isFinite(n)&&n>=min&&n<=max?n:fallback;
  };
  const startAt=String(env.RANK_SKILL_START_AT||'').trim();
  const ratingStartAt=/T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/i.test(startAt) && Number.isFinite(Date.parse(startAt))
    ?new Date(startAt).toISOString():null;
  return {period,minimumGames:minimum,ratingStartAt,maxRD:clamp(env.RANK_SKILL_MAX_RD,DEFAULT_MAX_RD,30,350),
    tau:clamp(env.RANK_SKILL_TAU,DEFAULT_TAU,.2,1.2),
    method:'Glicko-2 pareado ponderado por mesa; classificação conservadora rating − 2×RD',
    calculation:'ratings globais persistentes derivados de partidas registradas, sem redefinição por período',
    maxHistoryRows:Math.floor(clamp(env.RANK_SKILL_MAX_HISTORY_ROWS,DEFAULT_HISTORY_LIMIT,1000,2000000))};
}
function g(phi){return 1/Math.sqrt(1+3*phi*phi/(Math.PI*Math.PI));}
function expected(mu,muOpponent,phiOpponent){return 1/(1+Math.exp(-g(phiOpponent)*(mu-muOpponent)));}
function volatilityUpdate(phi,sigma,v,delta,tau=DEFAULT_TAU){
  const a=Math.log(sigma*sigma);
  const f=(x)=>{
    const ex=Math.exp(x),denom=phi*phi+v+ex;
    return ex*(delta*delta-phi*phi-v-ex)/(2*denom*denom)-(x-a)/(tau*tau);
  };
  let A=a,B;
  if(delta*delta>phi*phi+v) B=Math.log(delta*delta-phi*phi-v);
  else{
    let k=1;
    B=a-k*tau;
    while(f(B)<0 && k<MAX_ITERATIONS){k++;B=a-k*tau;}
  }
  let fA=f(A),fB=f(B);
  for(let i=0;i<MAX_ITERATIONS&&Math.abs(B-A)>EPSILON;i++){
    const C=A+(A-B)*fA/(fB-fA);
    if(!Number.isFinite(C))return sigma;
    const fC=f(C);
    if(fC*fB<=0){A=B;fA=fB;} else fA/=2;
    B=C;fB=fC;
  }
  const updated=Math.exp(A/2);
  return Number.isFinite(updated)&&updated>0?updated:sigma;
}
function initialState(){return {rating:INITIAL_RATING,rd:INITIAL_RD,volatility:INITIAL_SIGMA,totalGames:0,totalWins:0};}
function updateGlicko2(player,opponents,tau=DEFAULT_TAU){
  if(!opponents.length)return {...player};
  const mu=(player.rating-INITIAL_RATING)/SCALE,phi=player.rd/SCALE;
  let info=0,change=0;
  for(const opp of opponents){
    const muJ=(opp.rating-INITIAL_RATING)/SCALE,phiJ=opp.rd/SCALE;
    const gj=g(phiJ),ej=expected(mu,muJ,phiJ),w=opp.weight??1;
    info+=w*gj*gj*ej*(1-ej);
    change+=w*gj*(opp.score-ej);
  }
  if(!(info>0))return {...player};
  const v=1/info,delta=v*change;
  const sigma=volatilityUpdate(phi,player.volatility,v,delta,tau);
  const phiStar=Math.sqrt(phi*phi+sigma*sigma);
  const newPhi=1/Math.sqrt(1/(phiStar*phiStar)+1/v);
  const newMu=mu+newPhi*newPhi*change;
  return {rating:INITIAL_RATING+SCALE*newMu,rd:Math.min(INITIAL_RD,SCALE*newPhi),volatility:sigma,
    totalGames:player.totalGames,totalWins:player.totalWins};
}
function eligibleResults(match){
  if(!Array.isArray(match?.results) || match.results.length<2||match.results.length>5)return null;
  const keys=new Set();
  for(const r of match.results){
    if(!r||typeof r.playerKey!=='string'||!r.playerKey.trim()||keys.has(r.playerKey)||
       !Number.isInteger(Number(r.position))||Number(r.position)<1||Number(r.position)>10)return null;
    keys.add(r.playerKey);
  }
  return match.results;
}
function matchTime(match){const v=Date.parse(match?.finishedAt);return Number.isFinite(v)?v:null;}
function calculateSkillHistory(matches,{tau=DEFAULT_TAU,maxHistoryRows=DEFAULT_HISTORY_LIMIT,now=Date.now()}={}){
  const valid=[];let skipped=0;
  for(const match of matches){
    const at=matchTime(match);
    if(at===null||at>now||!eligibleResults(match)){skipped++;continue;}
    valid.push({match,at});
  }
  valid.sort((a,b)=>a.at-b.at || String(a.match.matchId).localeCompare(String(b.match.matchId)));
  const players=new Map(),events=new Map();let ratedMatches=0;
  const seenIds=new Set();
  for(const {match,at} of valid){
    const id=String(match.matchId||'');
    if(!id||seenIds.has(id)){skipped++;continue;}
    seenIds.add(id);
    const results=match.results;
    const before=new Map(results.map(r=>[r.playerKey,players.get(r.playerKey)||initialState()]));
    // Aplicação simultânea evita que o primeiro na lista tenha vantagem temporal.
    const updated=new Map();
    for(const r of results){
      const adversaries=results.filter(o=>o.playerKey!==r.playerKey).map(o=>({
        ...before.get(o.playerKey),
        score:Number(r.position)<Number(o.position)?1:Number(r.position)>Number(o.position)?0:0.5,
        weight:1/(results.length-1),
      }));
      const next=updateGlicko2(before.get(r.playerKey),adversaries,tau);
      next.totalGames++;
      if(r.won)next.totalWins++;
      updated.set(r.playerKey,next);
    }
    for(const r of results){
      const key=r.playerKey,prior=before.get(key),state=updated.get(key);
      players.set(key,{...state,playerKey:key,name:r.name||players.get(key)?.name||'Jogador',avatar:r.avatar||players.get(key)?.avatar||'macaco'});
      if(!events.has(key))events.set(key,[]);
      events.get(key).push({at,seasonId:Number(match.seasonId)||1,delta:state.rating-prior.rating,won:!!r.won,
        ratingAfter:state.rating,rdAfter:state.rd});
    }
    ratedMatches++;
  }
  return {players,events,ratedMatches,skippedMatches:skipped};
}
function skillLeaderboardView(snapshot,{period='season',periodStart=null,minimumGames=10,maxRD=DEFAULT_MAX_RD,seasonId=1}={}){
  const rows=[];
  for(const [playerKey,state] of snapshot.players){
    const all=snapshot.events.get(playerKey)||[];
    const eligible=all.filter(e=>(period==='history'||(period==='season'?e.seasonId===seasonId:e.seasonId===seasonId&&(!periodStart||e.at>=Date.parse(periodStart)))));
    if(!eligible.length)continue;
    const games=eligible.length,wins=eligible.reduce((n,e)=>n+Number(e.won),0);
    const periodDelta=eligible.reduce((n,e)=>n+e.delta,0);
    const provisional=games<minimumGames||state.rd>maxRD;
    rows.push({playerKey,name:state.name,avatar:state.avatar,
      rating:Number(state.rating.toFixed(1)),rd:Number(state.rd.toFixed(1)),volatility:Number(state.volatility.toFixed(5)),
      conservative:Number((state.rating-2*state.rd).toFixed(1)),
      games,wins,totalGames:state.totalGames,totalWins:state.totalWins,
      periodDelta:Number(periodDelta.toFixed(1)),provisional,minimumGames,
      gamesNeeded:Math.max(0,minimumGames-games),uncertain:state.rd>maxRD,
      rank:null});
  }
  rows.sort((a,b)=>Number(a.provisional)-Number(b.provisional)||b.conservative-a.conservative||b.rating-a.rating||b.games-a.games||String(a.name).localeCompare(String(b.name),'pt-BR')||a.playerKey.localeCompare(b.playerKey));
  let rank=0,prev=null;
  for(const r of rows){
    if(r.provisional)continue;
    if(prev===null||r.conservative!==prev)rank++;
    prev=r.conservative;r.rank=rank;
  }
  return rows;
}
module.exports={INITIAL_RATING,INITIAL_RD,INITIAL_SIGMA,skillSettings,initialState,updateGlicko2,calculateSkillHistory,skillLeaderboardView,eligibleResults};

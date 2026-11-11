'use strict';

// A promessa de persistência de uma partida pode ficar pendente durante uma
// falha de rede/banco. A revanche não deve ficar silenciosamente bloqueada
// para sempre; o resultado continua protegido por matchId idempotente.
function finalizationTimeoutMs(env=process.env) {
  const value=Number(env.RANKING_FINALIZATION_TIMEOUT_MS);
  return Number.isFinite(value)&&value>=10000&&value<=120000?Math.floor(value):30000;
}

function retryDelayMs(failures) {
  const exponent=Math.max(0,Math.min(4,(Number(failures)||1)-1));
  return Math.min(60000,15000*(2**exponent));
}

function withTimeout(promise, {timeoutMs=30000,getStage=()=>'persistência'}={}) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_,reject)=>{
      timer=setTimeout(()=>{
        const error=new Error(`Prazo excedido na etapa ${getStage()} do registro do ranking.`);
        error.code='RANKING_FINALIZATION_TIMEOUT';
        reject(error);
      },timeoutMs);
      timer.unref?.();
    }),
  ]).finally(()=>clearTimeout(timer));
}

module.exports={finalizationTimeoutMs,retryDelayMs,withTimeout};

'use strict';

// A falha de inicialização do PostgreSQL não pode deixar o ranking
// permanentemente indisponível até o próximo restart do Render.
// Uma única tentativa ocorre por vez; falhas são limitadas por cooldown.
function createRetryableInitialization({initialize,onSuccess=()=>{},onFailure=()=>{},cooldownMs=10000,clock=Date.now}={}){
  if(typeof initialize!=='function')throw new TypeError('initialize deve ser uma função');
  let ready=false;
  let pending=null;
  let retryAt=0;
  async function ensureReady(){
    if(ready)return true;
    if(pending)return pending;
    if(clock()<retryAt)return false;
    pending=Promise.resolve().then(initialize).then(()=>{
      ready=true;
      onSuccess();
      return true;
    }).catch(error=>{
      retryAt=clock()+Math.max(1000,Number(cooldownMs)||10000);
      try{onFailure(error);}catch{}
      return false;
    }).finally(()=>{pending=null;});
    return pending;
  }
  return {ensureReady,isReady:()=>ready};
}
module.exports={createRetryableInitialization};

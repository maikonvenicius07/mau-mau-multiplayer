'use strict';

function truthy(value){
  return ['1','true','yes','on'].includes(String(value||'').trim().toLowerCase());
}
function falsy(value){
  return ['0','false','no','off'].includes(String(value||'').trim().toLowerCase());
}
function isProductionLike(env=process.env){
  return String(env.NODE_ENV||'').toLowerCase()==='production' || truthy(env.RENDER) || !!String(env.RENDER_SERVICE_ID||'').trim();
}
function databaseRequired(env=process.env){
  const explicit=env.MAUMAU_REQUIRE_DATABASE;
  if(truthy(explicit))return true;
  if(falsy(explicit))return false;
  return isProductionLike(env);
}
function withTimeout(promise,timeoutMs,label='verificação'){
  const ms=Math.max(250,Math.min(10000,Number(timeoutMs)||2000));
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label} excedeu ${ms} ms`)),ms);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise),timeout]).finally(()=>clearTimeout(timer));
}
async function probeStore(name,store,readyPromise,timeoutMs){
  let initialized=false;
  try{initialized=!!(await withTimeout(readyPromise,timeoutMs,`${name}: inicialização`));}
  catch(error){return {ok:false,kind:String(store?.kind||'unknown'),initialized:false,reason:'init-timeout',message:String(error?.message||error).slice(0,160)};}
  if(!initialized)return {ok:false,kind:String(store?.kind||'unknown'),initialized:false,reason:'init-failed'};
  if(typeof store?.healthCheck!=='function')return {ok:false,kind:String(store?.kind||'unknown'),initialized:true,reason:'probe-unavailable'};
  try{
    const result=await withTimeout(store.healthCheck(),timeoutMs,`${name}: banco`);
    const ok=result===true || result?.ok===true;
    return {ok,kind:String(store?.kind||'unknown'),initialized:true,reason:ok?null:'probe-failed'};
  }catch(error){
    return {ok:false,kind:String(store?.kind||'unknown'),initialized:true,reason:'probe-error',message:String(error?.message||error).slice(0,160)};
  }
}
async function evaluateReadiness({rankingStore,roomSnapshotStore,rankingReady,roomSnapshotsReady,env=process.env,timeoutMs=2000}={}){
  const required=databaseRequired(env);
  const [ranking,roomSnapshots]=await Promise.all([
    probeStore('ranking',rankingStore,rankingReady,timeoutMs),
    probeStore('snapshots',roomSnapshotStore,roomSnapshotsReady,timeoutMs),
  ]);
  const wrongBackend=required && (ranking.kind!=='postgres'||roomSnapshots.kind!=='postgres');
  const ok=!wrongBackend && ranking.ok && roomSnapshots.ok;
  return {
    ok,
    status:ok?'ready':'degraded',
    databaseRequired:required,
    reason:wrongBackend?'database-required':(!ranking.ok?'ranking-unavailable':(!roomSnapshots.ok?'snapshots-unavailable':null)),
    ranking,
    roomSnapshots,
  };
}

module.exports={truthy,falsy,isProductionLike,databaseRequired,withTimeout,probeStore,evaluateReadiness};

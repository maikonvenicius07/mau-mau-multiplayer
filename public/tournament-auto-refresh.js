/* V40.69.8.18 — Lightweight refresh cycle for the tournament dialog. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MauMauTournamentAutoRefresh=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const DEFAULT_INTERVAL=15000;
  const DEFAULT_LIST_INTERVAL=60000;
  function create({refreshDetails,refreshList,canRefresh=()=>true,onError=()=>{},
    schedule=setTimeout,cancel=clearTimeout,clock=()=>Date.now(),
    interval=DEFAULT_INTERVAL,listInterval=DEFAULT_LIST_INTERVAL}={}){
    if(typeof refreshDetails!=='function'||typeof refreshList!=='function')throw new TypeError('Refresh callbacks required');
    // Uma consulta em andamento pode terminar APÓS pause(). A pausa precisa
    // impedir também o rearmamento feito pelo finally de tick().
    let running=false,paused=false,timer=null,working=false,lastListRefresh=clock();
    function clear(){if(timer!==null){cancel(timer);timer=null;}}
    function queue(delay){
      clear();
      if(running&&!paused)timer=schedule(()=>{timer=null;void tick();},delay);
    }
    async function tick(){
      if(!running||paused)return;
      if(working||!canRefresh()){queue(interval);return;}
      working=true;
      try{
        await refreshDetails();
        if(running&&canRefresh()&&clock()-lastListRefresh>=listInterval){
          await refreshList();
          lastListRefresh=clock();
        }
      }catch(error){if(running)onError(error);}
      finally{working=false;if(running&&!paused)queue(interval);}
    }
    return {
      start(){if(running)return;running=true;paused=false;lastListRefresh=clock();queue(interval);},
      stop(){running=false;paused=false;clear();},
      pause(){paused=true;clear();},
      resume(){if(!running)return;paused=false;if(!working)queue(0);},
      get running(){return running;},
      get working(){return working;}
    };
  }
  return {create,DEFAULT_INTERVAL,DEFAULT_LIST_INTERVAL};
});

/* MAU-MAU CANDEIAS V53.12 — controles móveis alinhados na lateral esquerda.
 * No celular: câmera, microfone, reações e Trocar lados, nesta ordem, ao entrar
 * na sala e ao começar uma rodada. Mantém o arraste individual após posicionar.
 * Computador: conserva o organizador V53.5 sem alterar as posições personalizadas.
 */
(function(){
  'use strict';
  const game=document.getElementById('game');
  const mic=document.getElementById('liveMicBtn');
  const camera=document.getElementById('liveCameraBtn');
  const pile=document.getElementById('pileSideBtn');
  const reactions=document.getElementById('quickReactionsWidget');
  if(!game||!mic||!camera||!pile)return;
  const GAP=10,MARGIN=10;
  let pending=false,mobileArranged=false,lastContext='',lastStatus='';

  function mobile(){
    return window.innerWidth<=700 || (window.innerWidth<=900&&window.innerHeight<=500);
  }
  function hasSavedPosition(type){
    try{
      if(type==='mic')return !!localStorage.getItem('maumauLiveMicPositionV1');
      if(type==='pile')return !!localStorage.getItem('maumauPileSidePositionV1');
      if(type==='camera')return !!localStorage.getItem('mau-mau-camera-v502-pos:button:'+(innerWidth<=900?'mobile':'desktop'));
    }catch{}
    return false;
  }
  function visible(el){
    return !el.classList.contains('hidden')&&getComputedStyle(el).display!=='none'&&el.getClientRects().length>0;
  }
  function rect(el,x,y){return{x,y,w:el.offsetWidth||44,h:el.offsetHeight||42};}
  function topLimit(){
    return Math.max(58,document.querySelector('.topbar')?.getBoundingClientRect().bottom||58)+10;
  }
  function clamp(el,x,y,top){
    const w=el.offsetWidth||44,h=el.offsetHeight||42;
    const maxX=Math.max(MARGIN,innerWidth-w-MARGIN);
    const maxY=Math.max(top,innerHeight-h-MARGIN);
    return rect(el,Math.min(maxX,Math.max(MARGIN,x)),Math.min(maxY,Math.max(top,y)));
  }
  function overlaps(a,b){
    return a.x<b.x+b.w+GAP&&a.x+a.w+GAP>b.x&&
      a.y<b.y+b.h+GAP&&a.y+a.h+GAP>b.y;
  }
  function free(candidate,occupied){return occupied.every(other=>!overlaps(candidate,other));}
  function current(el,top){const b=el.getBoundingClientRect();return clamp(el,b.left,b.top,top);}
  function place(el,type,preferred,occupied,top){
    if(!visible(el))return null;
    let target=hasSavedPosition(type)?current(el,top):clamp(el,preferred.x,preferred.y,top);
    if(!free(target,occupied)){
      target=clamp(el,preferred.x,preferred.y,top);
      if(!free(target,occupied)){
        const step=Math.max(40,Math.ceil(target.h)+GAP+4);
        let found=false;
        for(let y=top;y<=innerHeight-target.h-MARGIN&&!found;y+=step){
          for(const x of [MARGIN,Math.max(MARGIN,innerWidth-target.w-MARGIN)]){
            const candidate=clamp(el,x,y,top);
            if(free(candidate,occupied)){target=candidate;found=true;break;}
          }
        }
      }
    }
    el.style.left=Math.round(target.x)+'px';
    el.style.top=Math.round(target.y)+'px';
    el.style.right='auto';el.style.bottom='auto';
    occupied.push(target);
    return target;
  }
  function draggableNow(){
    return [mic,camera,pile,reactions].filter(Boolean).some(el=>el.classList.contains('dragging'));
  }
  function arrangeMobile(){
    // Mesmo com a câmera inicialmente oculta, reserva-se a primeira posição.
    // Assim a câmera aparece no lugar correto quando for habilitada.
    const controls=[
      {el:camera,height:42},
      {el:mic,height:42},
      {el:reactions,height:50},
      {el:pile,height:44}
    ].filter(item=>!!item.el);
    const top=topLimit(),left=window.innerWidth<=360?10:14;
    const heights=controls.map(item=>item.el.offsetHeight||item.height);
    const available=Math.max(0,window.innerHeight-top-14);
    const idealGap=6;
    const gap=Math.max(2,Math.min(idealGap,
      Math.floor((available-heights.reduce((a,b)=>a+b,0))/Math.max(1,controls.length-1))));
    let y=top;
    for(let i=0;i<controls.length;i++){
      const {el}=controls[i],width=el.offsetWidth||54;
      // Não grava nas preferências: arraste manual continua salvando normalmente.
      el.style.left=Math.round(Math.max(8,Math.min(left,innerWidth-width-8)))+'px';
      el.style.top=Math.round(y)+'px';
      el.style.right='auto';el.style.bottom='auto';
      y+=heights[i]+gap;
    }
    mobileArranged=true;
  }
  function arrange(){
    pending=false;
    if(game.classList.contains('hidden')||game.classList.contains('spectator-mode'))return;
    if(draggableNow())return;
    if(mobile()){
      if(!mobileArranged)arrangeMobile();
      return;
    }
    const top=topLimit(),occupied=[];
    // Computador: manter o organizador da V53.5.
    const m=place(mic,'mic',{x:MARGIN,y:top},occupied,top);
    if(!m)return;
    place(pile,'pile',{x:m.x+m.w+24,y:m.y+12},occupied,top);
    place(camera,'camera',{x:m.x,y:m.y+m.h+22},occupied,top);
  }
  function schedule(){
    if(pending)return;
    pending=true;requestAnimationFrame(arrange);
  }
  function resetMobile(){mobileArranged=false;schedule();}
  function onGameState(status,roomCode,spectator){
    const context=String(roomCode||'')+':'+(spectator?'S':'P');
    // Alinhar ao entrar em outra sala e ao distribuir as cartas para a rodada.
    // Atualizações normais do jogo não desfazem o arraste escolhido pelo jogador.
    const changed=context!==lastContext;
    const starting=!spectator&&status==='playing'&&lastStatus!=='playing';
    lastContext=context;lastStatus=status;
    if(!spectator&&mobile()&&(changed||starting))resetMobile();
  }
  const observer=new MutationObserver(schedule);
  observer.observe(game,{attributes:true,attributeFilter:['class']});
  observer.observe(camera,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',resetMobile);
  window.addEventListener('orientationchange',resetMobile);
  window.addEventListener('pageshow',resetMobile);
  // O duplo toque pode restaurar a posição do botão individual; não desmanchar
  // a coluna no meio da rodada enquanto o jogador ajusta sua preferência.
  window.MauControlsLayout={arrange,schedule,onGameState,resetMobile};
  schedule();
})();

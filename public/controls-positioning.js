/* MAU-MAU CANDEIAS V53.5 — evita sobreposicao de microfone, camera e Trocar lados.
 * Somente posicionamento visual; as posicoes arrastadas continuam salvas pelos
 * controles originais. Reorganiza apenas valores sem preferencia salva ou em colisao.
 */
(function(){
  'use strict';
  const game=document.getElementById('game');
  const mic=document.getElementById('liveMicBtn');
  const camera=document.getElementById('liveCameraBtn');
  const pile=document.getElementById('pileSideBtn');
  if(!game||!mic||!camera||!pile)return;
  const GAP=10, MARGIN=10;
  let pending=false;

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
  function rect(el,x,y){
    return {x,y,w:el.offsetWidth||44,h:el.offsetHeight||42};
  }
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
    return a.x<b.x+b.w+GAP && a.x+a.w+GAP>b.x &&
      a.y<b.y+b.h+GAP && a.y+a.h+GAP>b.y;
  }
  function free(candidate,occupied){
    return occupied.every(other=>!overlaps(candidate,other));
  }
  function current(el,top){
    const b=el.getBoundingClientRect();
    return clamp(el,b.left,b.top,top);
  }
  function place(el,type,preferred,occupied,top){
    if(!visible(el))return null;
    let target=hasSavedPosition(type)?current(el,top):clamp(el,preferred.x,preferred.y,top);
    if(!free(target,occupied)){
      // Uma posicao antiga pode coincidir com a de outro controle. Primeiro
      // recupera a disposicao de referencia e so depois procura uma vaga livre.
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
        // Se um aparelho for excepcionalmente pequeno, prioriza o limite da
        // janela, sem permitir que o botao fique inacessivel fora da tela.
      }
    }
    el.style.left=Math.round(target.x)+'px';
    el.style.top=Math.round(target.y)+'px';
    el.style.right='auto';
    el.style.bottom='auto';
    occupied.push(target);
    return target;
  }
  function arrange(){
    pending=false;
    if(game.classList.contains('hidden')||game.classList.contains('spectator-mode'))return;
    // Nao reposicionar enquanto o jogador estiver arrastando algum controle.
    if([mic,camera,pile].some(el=>el.classList.contains('dragging')))return;
    const top=topLimit(),occupied=[];
    // Referencia da imagem: microfone no alto a esquerda;
    // Trocar lados a direita; camera abaixo do microfone.
    const m=place(mic,'mic',{x:MARGIN,y:top},occupied,top);
    if(!m)return;
    place(pile,'pile',{x:m.x+m.w+24,y:m.y+12},occupied,top);
    place(camera,'camera',{x:m.x,y:m.y+m.h+22},occupied,top);
  }
  function schedule(){
    if(pending)return;
    pending=true;
    requestAnimationFrame(arrange);
  }
  const observer=new MutationObserver(schedule);
  observer.observe(game,{attributes:true,attributeFilter:['class']});
  observer.observe(camera,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',schedule);
  window.addEventListener('orientationchange',schedule);
  window.addEventListener('pageshow',schedule);
  // Um duplo toque devolve o controle a sua posicao original; nesse caso,
  // verificar novamente se a posicao provocou sobreposicao com outro botao.
  for(const el of [mic,pile,camera])el.addEventListener('dblclick',schedule);
  window.MauControlsLayout={arrange,schedule};
  schedule();
})();

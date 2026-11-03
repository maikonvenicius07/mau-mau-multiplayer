/* MAU-MAU CANDEIAS V50.2 — câmera flutuante, botão e prévia arrastáveis.
 * Apenas as coordenadas x/y são gravadas no navegador (localStorage).
 * Não acessa, grava, transmite nem persiste áudio ou vídeo.
 */
(function(){
  'use strict';

  const BTN_ID='liveCameraBtn';
  const PREVIEW_ID='cameraSelfPreview';
  const PREFIX='mau-mau-camera-v502-pos:';
  const items=[
    {id:BTN_ID,kind:'button',defaultY:145},
    {id:PREVIEW_ID,kind:'preview',defaultY:197}
  ];
  function device(){return window.innerWidth<=900?'mobile':'desktop';}
  function key(item){return PREFIX+item.kind+':'+device();}
  function topLimit(){
    const topbar=document.querySelector('.topbar');
    return Math.max(8,(topbar?.getBoundingClientRect()?.bottom||58)+8);
  }
  function clamp(el,x,y){
    const margin=8;
    const w=el.offsetWidth||(el.id===PREVIEW_ID?92:100);
    const h=el.offsetHeight||(el.id===PREVIEW_ID?92:42);
    const maxX=Math.max(margin,window.innerWidth-w-margin);
    const maxY=Math.max(margin,window.innerHeight-h-margin);
    const minY=Math.min(topLimit(),maxY);
    return {
      x:Math.min(maxX,Math.max(margin,Number(x)||0)),
      y:Math.min(maxY,Math.max(minY,Number(y)||0))
    };
  }
  function move(el,x,y,save=false,item=null){
    const pos=clamp(el,x,y);
    el.style.left=Math.round(pos.x)+'px';
    el.style.top=Math.round(pos.y)+'px';
    el.style.right='auto';
    el.style.bottom='auto';
    if(save&&item){
      try{localStorage.setItem(key(item),JSON.stringify({x:Math.round(pos.x),y:Math.round(pos.y)}))}catch{}
    }
  }
  function defaultPosition(el,item){
    return {
      x:Math.max(8,window.innerWidth-(el.offsetWidth||(item.kind==='preview'?92:100))-12),
      y:item.kind==='preview'&&device()==='mobile'?193:item.defaultY
    };
  }
  function restore(el,item){
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem(key(item))||'null')}catch{}
    if(!saved||!Number.isFinite(Number(saved.x))||!Number.isFinite(Number(saved.y))){
      saved=defaultPosition(el,item);
    }
    move(el,saved.x,saved.y);
  }
  function makeDraggable(el,item){
    let drag=null;
    let blockClickUntil=0;
    // Captura ocorre antes do click de ligar/desligar em camera-video.js.
    if(item.kind==='button')el.addEventListener('click',event=>{
      if(Date.now()<blockClickUntil){
        event.preventDefault();
        event.stopImmediatePropagation();
        blockClickUntil=0;
      }
    },true);

    el.addEventListener('pointerdown',event=>{
      if(event.button!==undefined&&event.button!==0)return;
      if(el.disabled)return;
      const rect=el.getBoundingClientRect();
      drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,
        startX:rect.left,startY:rect.top,moved:false};
      try{el.setPointerCapture?.(event.pointerId)}catch{}
    });
    el.addEventListener('pointermove',event=>{
      if(!drag||drag.pointerId!==event.pointerId)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<6)return;
      drag.moved=true;
      el.classList.add('dragging');
      move(el,drag.startX+dx,drag.startY+dy);
      if(event.cancelable)event.preventDefault();
    });
    function finish(event){
      if(!drag||drag.pointerId!==event.pointerId)return;
      if(drag.moved){
        move(el,parseFloat(el.style.left),parseFloat(el.style.top),true,item);
        if(item.kind==='button')blockClickUntil=Date.now()+450;
      }
      el.classList.remove('dragging');
      const id=drag.pointerId;
      drag=null;
      try{el.releasePointerCapture?.(id)}catch{}
    }
    el.addEventListener('pointerup',finish);
    el.addEventListener('pointercancel',finish);
    restore(el,item);
  }

  const attached=[];
  for(const item of items){
    const el=document.getElementById(item.id);
    if(el){makeDraggable(el,item);attached.push({el,item})}
  }
  // Recalcula limites quando a câmera/prévia deixa de estar oculta.
  // Elementos .hidden têm largura 0 até a câmera ser habilitada.
  function reclamp(kind){
    const target=attached.find(x=>x.item.kind===kind);
    if(!target)return;
    const {el,item}=target;
    const rect=el.getBoundingClientRect();
    const clamped=clamp(el,rect.left,rect.top);
    const changed=Math.abs(rect.left-clamped.x)>1||Math.abs(rect.top-clamped.y)>1;
    move(el,clamped.x,clamped.y,changed,item);
  }
  window.MauCameraFloating={reclamp};

  let lastDevice=device();
  window.addEventListener('resize',()=>{
    const deviceNow=device();
    for(const {el,item} of attached){
      if(deviceNow!==lastDevice)restore(el,item);
      else move(el,el.getBoundingClientRect().left,el.getBoundingClientRect().top,true,item);
    }
    lastDevice=deviceNow;
  });
})();

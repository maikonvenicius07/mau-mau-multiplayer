/* MAU-MAU CANDEIAS — preferências de mídia somente nesta aba/sessão.
 * Guarda apenas intenção booleana (nunca áudio, vídeo, chaves de autenticação ou tracks).
 * sessionStorage sobrevive a F5, mas não concede permissões ao navegador.
 */
(function(root){
  'use strict';
  const KEY='maumauMediaSessionV1';
  let scope=null,desired={mic:false,camera:false},blocked=new Map(),handlers={};
  function read(){try{return JSON.parse(root.sessionStorage?.getItem(KEY)||'null')}catch{return null}}
  function write(){
    if(!scope)return;
    try{root.sessionStorage?.setItem(KEY,JSON.stringify({...scope,...desired}))}catch{}
  }
  function scopeTag(owner){
    const value=String(owner||'');if(!value)return '';
    // Hash de escopo para reduzir exposição em claro; não é mecanismo de autenticação.
    let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619)}
    return (hash>>>0).toString(36);
  }
  function joined(code,owner){
    const next={code:String(code||'').toUpperCase(),owner:scopeTag(owner)};
    const prior=read();
    scope=next;
    desired=prior?.code===next.code&&prior?.owner===next.owner&&!!next.code&&!!next.owner
      ?{mic:prior.mic===true,camera:prior.camera===true}:{mic:false,camera:false};
    blocked.clear();render();return {...desired};
  }
  function setDesired(kind,value){
    if(!Object.prototype.hasOwnProperty.call(desired,kind))return;
    desired[kind]=!!value;blocked.delete(kind);write();render();
  }
  function wanted(kind){return !!desired[kind]}
  function ready(kind){blocked.delete(kind);render()}
  function failed(kind,reason){
    if(!wanted(kind))return;
    blocked.set(kind,String(reason||'O navegador não conseguiu restaurar este dispositivo.'));
    render();
  }
  function clear(){
    try{root.sessionStorage?.removeItem(KEY)}catch{}
    scope=null;desired={mic:false,camera:false};blocked.clear();render();
  }
  function configure(next){handlers={...next};render()}
  function render(){
    const panel=root.document?.getElementById('mediaRestorePrompt');
    if(!panel)return;
    const missing=[...blocked.keys()].filter(wanted);
    panel.classList.toggle('hidden',missing.length===0);
    if(!missing.length)return;
    const label=missing.length===2?'Restaurar câmera e microfone':
      missing[0]==='camera'?'Restaurar câmera':'Restaurar microfone';
    const button=root.document.getElementById('mediaRestoreBtn');if(button)button.textContent=label;
    const detail=root.document.getElementById('mediaRestoreDetail');
    if(detail)detail.textContent=missing.map(kind=>`${kind==='mic'?'Microfone':'Câmera'}: ${blocked.get(kind)}`).join(' ');
  }
  async function retry(){
    const missing=[...blocked.keys()].filter(wanted);
    blocked.clear();render();
    // Inicia TODOS os pedidos na mesma interação: aguardar o microfone antes da
    // câmera perderia o gesto do usuário no Safari/iOS.
    const pending=missing.map(kind=>{
      try{return typeof handlers[kind]==='function'
        ?Promise.resolve(handlers[kind]()).catch(()=>failed(kind,'Autorize o dispositivo no navegador.'))
        :Promise.resolve()}
      catch{return Promise.resolve(failed(kind,'Autorize o dispositivo no navegador.'))}
    });
    await Promise.all(pending);
  }
  root.document?.getElementById('mediaRestoreBtn')?.addEventListener('click',retry);
  root.MauMediaSession={joined,setDesired,wanted,ready,failed,clear,configure,render};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.MauMediaSession;
})(typeof window!=='undefined'?window:globalThis);

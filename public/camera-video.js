/* MAU-MAU CANDEIAS V50.1 - câmeras opcionais e EFÊMERAS.
 * Não grava, fotografa, envia frames pelo Socket.IO, nem persiste mídia.
 * Só carrega o SDK externo quando uma câmera é ligada/visualizada.
 */
(function(){
  'use strict';
  const SDK_URL='https://cdnjs.cloudflare.com/ajax/libs/livekit-client/2.22.2/livekit-client.umd.min.js';
  const MAX_WIDTH=320, MAX_HEIGHT=240, FRAME_RATE=12;
  let socket=null, getState=()=>null, notice=()=>{}, enabled=false;
  let sdkPromise=null, room=null, connecting=null, roomCode='', joinedRoomCode='', publishing=false;
  let watchedIds=new Set(), spectatorWatchEnabled=true, busy=false, generation=0;
  const videoNodes=new Map(); // id de jogador -> elemento <video>, apenas em memória.
  let localPreview=null;

  function me(){return getState()?.me||null;}
  function code(){return String(joinedRoomCode||getState()?.code||'');}
  function isSpectator(){return getState()?.viewerRole==='SPECTATOR'||getState()?.me?.role==='SPECTATOR';}
  function playerByIdentity(identity){
    const raw=String(identity||'');
    return raw.startsWith('p_')?raw.slice(2):null;
  }
  function updateButton(){
    const button=document.getElementById('liveCameraBtn');if(!button)return;
    const active=!!getState()&&!!code();
    button.classList.toggle('hidden',!active);
    button.disabled=!enabled||busy||!socket?.connected;
    button.classList.toggle('camera-on',publishing);
    button.classList.toggle('camera-loading',busy);
    const label=document.getElementById('liveCameraLabel');
    if(label)label.textContent=!enabled?'CÂMERA INDISPONÍVEL':busy?'CONECTANDO...':isSpectator()?(spectatorWatchEnabled?'OCULTAR VÍDEOS':'VER VÍDEOS'):(publishing?'DESLIGAR CÂMERA':'LIGAR CÂMERA');
    button.title=!enabled?'Configure LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no Render.':isSpectator()?'Mostrar ou ocultar vídeos dos jogadores. Observadores não podem ligar câmera.':publishing?'Desligar câmera e voltar ao avatar.':'Ligar câmera ao vivo; a câmera não é gravada.';
    button.setAttribute('aria-label',button.title);
  }
  function removeVideo(id){
    const element=videoNodes.get(id);if(!element)return;
    try{element.pause();element.srcObject=null;element.remove();}catch{}
    videoNodes.delete(id);
  }
  function clearVideo(){
    for(const id of [...videoNodes.keys()])removeVideo(id);
    if(localPreview){try{localPreview.pause();localPreview.srcObject=null;localPreview.remove()}catch{}localPreview=null;}
    document.getElementById('cameraSelfPreview')?.classList.add('hidden');
  }
  function createVideo(id,track){
    if(!track?.mediaStreamTrack)return;
    removeVideo(id);
    const video=document.createElement('video');
    video.className='camera-video';video.muted=true;video.autoplay=true;video.playsInline=true;
    video.setAttribute('playsinline','');video.setAttribute('aria-label','Vídeo ao vivo do jogador');
    video.srcObject=new MediaStream([track.mediaStreamTrack]);
    videoNodes.set(id,video);
    renderIntoSeats();
    video.play().catch(()=>{});
  }
  function updateLocalVideo(){
    const localId=String(me()?.id||'');
    const track=room?.localParticipant?.getTrackPublication(window.LivekitClient?.Track?.Source?.Camera)?.track;
    if(!publishing||!track?.mediaStreamTrack||!localId){removeVideo(localId);return;}
    createVideo(localId,track);
  }
  function renderIntoSeats(){
    const ring=document.getElementById('playersRing');
    if(!ring||!getState())return;
    const valid=new Set((getState().players||[]).filter(p=>!p.isBot&&p.connected&&!p.autoControlled).map(p=>String(p.id)));
    for(const [id,video] of videoNodes){
      if(!valid.has(id) && id!==String(me()?.id||'')){removeVideo(id);continue;}
      const seats=[...ring.querySelectorAll('.player-seat')];
      const seat=seats.find(el=>el.dataset.cameraPlayerId===id);
      const avatar=seat?.querySelector('.player-card .avatar');
      if(avatar){avatar.classList.add('camera-streaming');if(video.parentElement!==avatar)avatar.appendChild(video);}
    }
    const holder=document.getElementById('cameraSelfPreview');
    const myId=String(me()?.id||''),myVideo=videoNodes.get(myId);
    if(holder){
      const visible=!!publishing&&!!myVideo&&window.innerWidth<=900;
      holder.classList.toggle('hidden',!visible);
      if(visible&&myVideo?.srcObject){
        if(!localPreview){localPreview=document.createElement('video');localPreview.className='camera-video';localPreview.muted=true;localPreview.autoplay=true;localPreview.playsInline=true;holder.appendChild(localPreview);}
        localPreview.srcObject=myVideo.srcObject;localPreview.play().catch(()=>{});
      }else if(localPreview){localPreview.pause();localPreview.srcObject=null;localPreview.remove();localPreview=null;}
    }
  }
  function loadSDK(){
    if(window.LivekitClient?.Room)return Promise.resolve(window.LivekitClient);
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src=SDK_URL;s.async=true;
      s.onload=()=>window.LivekitClient?.Room?resolve(window.LivekitClient):reject(new Error('SDK indisponível'));
      s.onerror=()=>reject(new Error('Não foi possível carregar o serviço de câmera'));
      document.head.appendChild(s);
    }).catch(err=>{sdkPromise=null;throw err;});
    return sdkPromise;
  }
  function token(){
    return new Promise((resolve,reject)=>{
      if(!socket?.connected)return reject(new Error('Conexão com o jogo indisponível'));
      socket.timeout(8000).emit('cameraToken',{},(err,response)=>{
        if(err)return reject(new Error('Tempo esgotado ao conectar câmera'));
        if(!response?.ok)return reject(new Error(response?.message||'Câmera não autorizada'));
        resolve(response);
      });
    });
  }
  async function ensureConnected(){
    if(!enabled||!code()||!socket?.connected)return;
    if(room&&roomCode===code()&&room.state==='connected')return room;
    if(connecting)return connecting;
    const seq=generation;
    connecting=(async()=>{
      const sdk=await loadSDK();
      const authorization=await token();
      if(seq!==generation||!code()||!socket?.connected)throw new Error('Sala alterada');
      const newRoom=new sdk.Room({adaptiveStream:true,stopLocalTrackOnUnpublish:true});
      const events=sdk.RoomEvent;
      newRoom.on(events.TrackSubscribed,(track,_publication,participant)=>{
        if(track.kind!==sdk.Track.Kind.Video)return;
        const id=playerByIdentity(participant?.identity);
        if(id)createVideo(id,track);
      });
      newRoom.on(events.TrackUnsubscribed,(_track,_publication,participant)=>{
        const id=playerByIdentity(participant?.identity);if(id)removeVideo(id);
      });
      newRoom.on(events.ParticipantDisconnected,participant=>{
        const id=playerByIdentity(participant?.identity);if(id)removeVideo(id);
      });
      newRoom.on(events.Disconnected,()=>{
        if(room===newRoom){
          room=null;publishing=false;socket?.emit('cameraPublishState',{active:false});
          clearVideo();updateButton();
        }
      });
      try{
        await newRoom.connect(authorization.url,authorization.token,{autoSubscribe:true});
        if(seq!==generation||!code()||!socket?.connected){await newRoom.disconnect();throw new Error('Sala alterada');}
        room=newRoom;roomCode=code();
        return room;
      }catch(e){try{await newRoom.disconnect()}catch{}throw e;}
    })().finally(()=>{connecting=null;});
    return connecting;
  }
  async function stopPublishing(){
    // O estado publico desliga antes de liberar hardware de camera.
    publishing=false;if(socket?.connected)socket.emit('cameraPublishState',{active:false});updateButton();
    try{await room?.localParticipant?.setCameraEnabled(false)}catch{}
    removeVideo(String(me()?.id||''));renderIntoSeats();
    if(!watchedIds.size && !isSpectator())closeRoom();
  }
  function closeRoom(){
    generation++; // cancela também conexão WebRTC ainda em andamento.
    const old=room;room=null;roomCode='';
    clearVideo();
    if(old){try{old.disconnect()}catch{}}
  }
  function stop(){
    generation++;publishing=false;watchedIds.clear();busy=false;joinedRoomCode='';
    if(socket?.connected)socket.emit('cameraPublishState',{active:false});
    closeRoom();updateButton();
  }
  async function toggle(){
    if(busy||!enabled||!socket?.connected||!code())return;
    if(isSpectator()){
      spectatorWatchEnabled=!spectatorWatchEnabled;
      if(spectatorWatchEnabled&&watchedIds.size)ensureConnected().catch(()=>notice('Câmeras indisponíveis.'));
      else if(!spectatorWatchEnabled)closeRoom();
      updateButton();return;
    }
    if(publishing){busy=true;updateButton();try{await stopPublishing()}finally{busy=false;updateButton()}return;}
    busy=true;updateButton();
    try{
      const current=await ensureConnected();
      if(!current)return;
      // Somente vídeo da câmera. Nenhum microfone é criado nesta implementação.
      await current.localParticipant.setCameraEnabled(true,{resolution:{width:MAX_WIDTH,height:MAX_HEIGHT},frameRate:FRAME_RATE});
      publishing=true;updateLocalVideo();
      socket.emit('cameraPublishState',{active:true});
      notice('📷 Câmera ligada. Sua imagem é transmitida ao vivo, sem gravação pelo jogo.');
    }catch(e){
      publishing=false;
      socket?.emit('cameraPublishState',{active:false});
      if(e?.name==='NotAllowedError')notice('Permita o acesso à câmera nas configurações do navegador.');
      else notice('Não foi possível ligar a câmera: '+String(e?.message||'verifique a conexão').slice(0,90));
      if(!watchedIds.size)closeRoom();
    }finally{busy=false;updateButton();}
  }
  function onPresence(payload){
    if(!payload||payload.code!==code())return;
    watchedIds=new Set((payload.playerIds||[]).map(String));
    if(!enabled)return;
    if(watchedIds.size && (!isSpectator()||spectatorWatchEnabled)){
      ensureConnected().catch(()=>{});
    }else if(!publishing)closeRoom();
    updateButton();
  }
  function onJoined(newRoomCode){stop();joinedRoomCode=String(newRoomCode||'');if(socket?.connected)socket.emit('cameraPresenceRequest');updateButton();}
  function onState(){updateButton();}
  async function init(sock,options={}){
    socket=sock;getState=options.getState||getState;notice=options.toast||notice;
    socket.on('cameraPresence',onPresence);
    window.addEventListener('pagehide',stop);
    document.getElementById('liveCameraBtn')?.addEventListener('click',toggle);
    try{
      const response=await fetch('/api/camera/config',{credentials:'same-origin',cache:'no-store'});
      enabled=!!(await response.json())?.enabled;
    }catch{enabled=false}
    updateButton();
    if(code()&&socket.connected)socket.emit('cameraPresenceRequest');
  }
  window.MauCamera={init,onJoined,onState,onPresence,renderIntoSeats,stop};
})();

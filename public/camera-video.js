/* MAU-MAU CANDEIAS V50.4 (base V50.3) - câmera flutuante com troca frontal/traseira e webcams.
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
  let cameraWanted=false,restoreTimer=null,restoreAttempts=0,restoreDeferred=false;
  const videoNodes=new Map(); // id de jogador -> elemento <video>, apenas em memória.
  // FASE 2B: evita reconstruir o <video> quando LiveKit reapresenta a mesma faixa.
  const videoTrackRefs=new Map(); // identidade da MediaStreamTrack, sem persistência.
  let localPreview=null;
  let lastPreviewPlayAttemptAt=0; // Intervalo entre tentativas se autoplay permanecer pausado.
  let expandedPlayerId=null;
  let lastExpandedTrigger=null;
  function closeExpanded(restoreFocus=false){
    const panel=document.getElementById('cameraOpponentOverlay');
    const video=document.getElementById('cameraOpponentExpandedVideo');
    if(video){try{video.pause();video.srcObject=null;}catch{}}
    panel?.classList.add('hidden');
    expandedPlayerId=null;
    if(restoreFocus && lastExpandedTrigger?.isConnected)lastExpandedTrigger.focus?.();
    lastExpandedTrigger=null;
  }
  function syncExpanded(){
    if(!expandedPlayerId)return;
    const source=videoNodes.get(expandedPlayerId);
    if(!source?.srcObject){closeExpanded();return;}
    const dest=document.getElementById('cameraOpponentExpandedVideo');
    if(dest && dest.srcObject!==source.srcObject){
      dest.srcObject=source.srcObject;
      dest.play().catch(()=>{});
    }
  }
  function openExpanded(playerId,sourceElement){
    const id=String(playerId||'');
    if(!id||id===String(me()?.id||''))return;
    const video=videoNodes.get(id);
    const overlay=document.getElementById('cameraOpponentOverlay');
    const enlarged=document.getElementById('cameraOpponentExpandedVideo');
    if(!video?.srcObject||!overlay||!enlarged)return;
    expandedPlayerId=id;
    lastExpandedTrigger=sourceElement||null;
    const seat=document.querySelectorAll('.player-seat');
    const player=[...seat].find(el=>el.dataset.cameraPlayerId===id);
    const title=document.getElementById('cameraOpponentName');
    if(title)title.textContent=player?.dataset.playerName||'Adversário';
    enlarged.srcObject=video.srcObject;
    overlay.classList.remove('hidden');
    enlarged.play().catch(()=>{});
    document.getElementById('cameraOpponentClose')?.focus?.();
  }
  let cameraFacing='user'; // apenas estado em memória; NÃO é armazenado.
  const captureOptions=()=>({resolution:{width:MAX_WIDTH,height:MAX_HEIGHT},frameRate:FRAME_RATE});
  function onPhone(){
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'') ||
      !!(window.matchMedia?.('(pointer:coarse)').matches && window.innerWidth<=900);
  }
  function localCameraTrack(){
    const publication=room?.localParticipant?.getTrackPublication(window.LivekitClient?.Track?.Source?.Camera);
    return publication?.track||publication?.videoTrack||null;
  }
  function updateSwitchButton(){
    const control=document.getElementById('cameraSwitchBtn');
    if(control){
      const show=enabled&&publishing&&!isSpectator()&&!!localCameraTrack();
      control.classList.toggle('hidden',!show);
      control.disabled=busy||!socket?.connected;
      control.title=onPhone()?'Alternar câmera frontal e traseira':'Trocar webcam ou câmera conectada';
      control.setAttribute('aria-label',control.title);
    }
    document.getElementById('cameraSelfPreview')?.classList.toggle('camera-rear',cameraFacing==='environment');
  }

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
    const wasHidden=button.classList.contains('hidden');
    button.classList.toggle('hidden',!active);
    button.disabled=!enabled||busy||!socket?.connected;
    const cameraTransmitting=!!publishing&&!!localCameraTrack()?.mediaStreamTrack&&localCameraTrack().mediaStreamTrack.readyState!=='ended';
    button.classList.toggle('camera-on',cameraTransmitting);
    button.classList.toggle('camera-loading',busy);
    const label=document.getElementById('liveCameraLabel');
    if(label)label.textContent=!enabled?'CÂMERA INDISPONÍVEL':busy?'CONECTANDO...':isSpectator()?(spectatorWatchEnabled?'OCULTAR VÍDEOS':'VER VÍDEOS'):(cameraTransmitting?'DESLIGAR CÂMERA':cameraWanted?'RECONECTANDO...':'LIGAR CÂMERA');
    button.title=!enabled?'Configure LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no Render.':isSpectator()?'Mostrar ou ocultar vídeos dos jogadores. Observadores não podem ligar câmera.':cameraTransmitting?'Desligar câmera e voltar ao avatar.':cameraWanted?'Recuperando transmissão de vídeo.':'Ligar câmera ao vivo; a câmera não é gravada.';
    button.setAttribute('aria-label',button.title);
    if(active&&wasHidden)window.MauCameraFloating?.reclamp('button');
    updateSwitchButton();
  }
  function removeVideo(id){
    if(String(id)===expandedPlayerId)closeExpanded();
    const element=videoNodes.get(id);if(!element)return;
    const avatar=element.parentElement;
    if(avatar?.classList?.contains('avatar')){
      avatar.classList.remove('camera-streaming');
      avatar.removeAttribute('role');avatar.removeAttribute('aria-label');avatar.removeAttribute('tabindex');
      avatar.closest?.('.player-card')?.classList.remove('camera-seat');
      avatar.closest?.('.player-seat')?.classList.remove('camera-visible','camera-edge-left','camera-edge-right');
    }
    try{element.pause();element.srcObject=null;element.remove();}catch{}
    videoNodes.delete(id);
    videoTrackRefs.delete(id);
  }
  function clearVideo(){
    closeExpanded();
    for(const id of [...videoNodes.keys()])removeVideo(id);
    if(localPreview){try{localPreview.pause();localPreview.srcObject=null;localPreview.remove()}catch{}localPreview=null;}
    lastPreviewPlayAttemptAt=0;
    document.getElementById('cameraSelfPreview')?.classList.add('hidden');
    updateSwitchButton();
  }
  function createVideo(id,track){
    if(!track?.mediaStreamTrack)return;
    // Mesmo player + mesma faixa de vídeo: reaproveita o elemento e não
    // reinicia srcObject/play(). Para uma faixa nova preserva o fluxo anterior.
    if(videoNodes.has(id)&&videoTrackRefs.get(id)===track.mediaStreamTrack){
      renderIntoSeats();
      syncExpanded();
      return;
    }
    removeVideo(id);
    const video=document.createElement('video');
    video.className='camera-video';video.muted=true;video.autoplay=true;video.playsInline=true;
    video.setAttribute('playsinline','');video.setAttribute('aria-label','Vídeo ao vivo do jogador');
    video.srcObject=new MediaStream([track.mediaStreamTrack]);
    videoNodes.set(id,video);
    videoTrackRefs.set(id,track.mediaStreamTrack);
    renderIntoSeats();
    syncExpanded();
    video.play().catch(()=>{});
  }
  function updateLocalVideo(){
    const localId=String(me()?.id||'');
    const track=room?.localParticipant?.getTrackPublication(window.LivekitClient?.Track?.Source?.Camera)?.track;
    if(!publishing||!track?.mediaStreamTrack||!localId){removeVideo(localId);updateSwitchButton();return;}
    createVideo(localId,track);
    updateSwitchButton();
  }
  function renderIntoSeats(){
    const ring=document.getElementById('playersRing');
    const state=getState();
    if(!ring||!state)return;
    const myId=String(state.me?.id||'');
    const valid=new Set((state.players||[]).filter(p=>!p.isBot&&p.connected&&!p.autoControlled).map(p=>String(p.id)));
    // Uma busca de assentos por atualização (antes: uma busca por vídeo).
    const seatById=new Map([...ring.querySelectorAll('.player-seat')]
      .map(seat=>[seat.dataset.cameraPlayerId,seat]));
    for(const [id,video] of videoNodes){
      if(!valid.has(id) && id!==myId){removeVideo(id);continue;}
      const seat=seatById.get(id);
      const avatar=seat?.querySelector('.player-card .avatar');
      if(avatar){
        avatar.classList.add('camera-streaming');
        seat.classList?.add('camera-visible');
        const seatLeft=parseFloat(seat.style?.left||'50');
        if(seatLeft<22)seat.classList?.add('camera-edge-left');
        else if(seatLeft>78)seat.classList?.add('camera-edge-right');
        avatar.closest?.('.player-card')?.classList.add('camera-seat');
        if(video.parentElement!==avatar)avatar.appendChild(video);
        if(id!==myId){
          avatar.setAttribute('role','button');
          avatar.tabIndex=0;
          avatar.setAttribute('aria-label','Ampliar câmera de '+String(seat.dataset.playerName||'adversário'));
          // Os assentos sao reconstruidos nas atualizacoes da partida. Instala
          // os handlers apenas no elemento atual e nao no video WebRTC.
          if(!avatar.dataset.cameraExpandReady){
            avatar.dataset.cameraExpandReady='1';
            avatar.addEventListener('click',()=>openExpanded(id,avatar));
            avatar.addEventListener('keydown',event=>{
              if(event.key==='Enter'||event.key===' '){event.preventDefault();openExpanded(id,avatar);}
            });
          }
        }
      }
    }
    const holder=document.getElementById('cameraSelfPreview');
    const myVideo=videoNodes.get(myId);
    if(holder){
      // V50.2: prévia independente e arrastável em celular E computador.
      // O posicionamento é gerenciado por camera-floating.js, sem alterar a mídia.
      const visible=!!publishing&&!!myVideo;
      const wasHidden=holder.classList.contains('hidden');
      holder.classList.toggle('hidden',!visible);
      if(visible&&myVideo?.srcObject){
        const newPreview=!localPreview;
        if(newPreview){localPreview=document.createElement('video');localPreview.className='camera-video';localPreview.muted=true;localPreview.autoplay=true;localPreview.playsInline=true;holder.appendChild(localPreview);}
        // Atribuir o mesmo srcObject e chamar play() em cada render é custoso
        // no celular. Retoma somente ao trocar o stream ou se estiver pausado.
        const streamChanged=localPreview.srcObject!==myVideo.srcObject;
        if(streamChanged)localPreview.srcObject=myVideo.srcObject;
        const now=Date.now();
        // Em navegadores que impedem autoplay, evita uma nova tentativa
        // a cada render: outra tentativa somente após 3 segundos.
        if(streamChanged||(localPreview.paused===true&&now-lastPreviewPlayAttemptAt>=3000)){
          lastPreviewPlayAttemptAt=now;
          localPreview.play().catch(()=>{});
        }
        if(newPreview||wasHidden)window.MauCameraFloating?.reclamp('preview');
      }else if(localPreview){localPreview.pause();localPreview.srcObject=null;localPreview.remove();localPreview=null;lastPreviewPlayAttemptAt=0;}
    }
    syncExpanded();
    updateSwitchButton();
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
          generation++;room=null;roomCode='';publishing=false;
          if(socket?.connected)socket.emit('cameraPublishState',{active:false});
          clearVideo();updateButton();
          // A conexão LiveKit terminou: publicar novamente requer uma nova sala/token.
          if(cameraWanted)scheduleRestore(1500);
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
  function clearRestoreTimer(){if(restoreTimer)clearTimeout(restoreTimer);restoreTimer=null;}
  function scheduleRestore(delay=500){
    if(!cameraWanted||!socket?.connected||!joinedRoomCode||isSpectator()||publishing||restoreTimer)return;
    if(busy){restoreDeferred=true;return;}
    if(!enabled){window.MauMediaSession?.failed('camera','Serviço de câmera não configurado ou indisponível.');return;}
    if(restoreAttempts>=3){window.MauMediaSession?.failed('camera','Não foi possível recuperar o vídeo. Toque para tentar novamente.');return;}
    restoreTimer=setTimeout(()=>{restoreTimer=null;restore().catch(()=>{});},delay);
  }
  function watchLocalTrack(){
    const track=localCameraTrack()?.mediaStreamTrack;
    if(!track||track.readyState==='ended')throw new Error('A câmera não forneceu vídeo ativo.');
    // Quando o SO retira a câmera em segundo plano, não manter ícone verde.
    if(!track.__mauCameraWatch){
      try{Object.defineProperty(track,'__mauCameraWatch',{value:true,configurable:true})}catch{}
      track.addEventListener?.('ended',()=>{
        if(localCameraTrack()?.mediaStreamTrack!==track||!publishing)return;
        publishing=false;if(socket?.connected)socket.emit('cameraPublishState',{active:false});
        updateLocalVideo();updateButton();if(cameraWanted)scheduleRestore(1800);
      },{once:true});
    }
  }
  async function restore({userGesture=false}={}){
    if(userGesture){restoreAttempts=0;clearRestoreTimer();}
    if(!cameraWanted||publishing||busy||!joinedRoomCode||!socket?.connected||isSpectator())return;
    if(!enabled){window.MauMediaSession?.failed('camera','Serviço de câmera indisponível.');return;}
    if(restoreAttempts>=3){window.MauMediaSession?.failed('camera','Não foi possível recuperar a câmera automaticamente.');return;}
    const seq=generation;restoreAttempts++;busy=true;updateButton();
    let retry=false;
    try{
      const current=await ensureConnected();
      if(!current||seq!==generation||!cameraWanted||!socket?.connected)return;
      // Faixa encerrada pelo SO não pode ser reaproveitada como publicação ativa.
      if(localCameraTrack()?.mediaStreamTrack?.readyState==='ended')
        await current.localParticipant.setCameraEnabled(false);
      await current.localParticipant.setCameraEnabled(true,captureOptions());
      if(seq!==generation||room!==current||!cameraWanted||!socket?.connected){
        await current.localParticipant.setCameraEnabled(false).catch(()=>{});return;
      }
      watchLocalTrack();
      publishing=true;restoreAttempts=0;updateLocalVideo();
      socket.emit('cameraPublishState',{active:true});
      window.MauMediaSession?.ready('camera');
    }catch(error){
      if(seq!==generation||!cameraWanted)return;
      publishing=false;socket?.emit('cameraPublishState',{active:false});
      const permanent=['NotAllowedError','SecurityError','NotFoundError','NotReadableError','OverconstrainedError'].includes(String(error?.name||''));
      if(permanent){
        const permission=['NotAllowedError','SecurityError'].includes(String(error?.name||''));
        window.MauMediaSession?.failed('camera',permission?'Autorize o uso da câmera no navegador.':'Câmera indisponível ou ocupada por outro aplicativo.');
      }else if(restoreAttempts>=3){
        window.MauMediaSession?.failed('camera','Falha de rede ou de conexão com o serviço de vídeo.');
      }else retry=true;
      if(!watchedIds.size)closeRoom();
    }finally{
      if(seq===generation){busy=false;updateButton();}
      else if(!publishing){busy=false;updateButton();}
      if(restoreDeferred){restoreDeferred=false;scheduleRestore(1500);}
      else if(retry&&cameraWanted)scheduleRestore(2700+restoreAttempts*900);
    }
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
  function stop({keepWanted=false}={}){
    clearRestoreTimer();restoreDeferred=false;restoreAttempts=0;if(!keepWanted)cameraWanted=false;
    generation++;publishing=false;watchedIds.clear();busy=false;joinedRoomCode='';cameraFacing='user';
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
    if(publishing){
      cameraWanted=false;clearRestoreTimer();restoreAttempts=0;window.MauMediaSession?.setDesired('camera',false);
      busy=true;updateButton();try{await stopPublishing()}finally{busy=false;updateButton()}return;
    }
    if(cameraWanted){
      cameraWanted=false;clearRestoreTimer();restoreAttempts=0;
      window.MauMediaSession?.setDesired('camera',false);
      if(!watchedIds.size)closeRoom();
      updateButton();notice('📷 Reconexão da câmera cancelada.');return;
    }
    cameraWanted=true;restoreAttempts=0;window.MauMediaSession?.setDesired('camera',true);
    const seq=generation;busy=true;updateButton();
    try{
      const current=await ensureConnected();
      if(!current)return;
      // Somente vídeo da câmera. Nenhum microfone é criado nesta implementação.
      await current.localParticipant.setCameraEnabled(true,captureOptions());
      if(seq!==generation||room!==current||!cameraWanted||!socket?.connected){await current.localParticipant.setCameraEnabled(false).catch(()=>{});return;}
      watchLocalTrack();
      cameraFacing=localCameraTrack()?.mediaStreamTrack?.getSettings?.()?.facingMode==='environment'?'environment':'user';
      publishing=true;updateLocalVideo();window.MauMediaSession?.ready('camera');
      socket.emit('cameraPublishState',{active:true});
      notice('📷 Câmera ligada. Sua imagem é transmitida ao vivo, sem gravação pelo jogo.');
    }catch(e){
      if(seq!==generation)return;
      publishing=false;socket?.emit('cameraPublishState',{active:false});
      window.MauMediaSession?.failed('camera',e?.name==='NotAllowedError'?'Autorize o uso da câmera no navegador.':String(e?.message||'Verifique conexão e permissão.').slice(0,105));
      if(e?.name==='NotAllowedError')notice('Permita o acesso à câmera nas configurações do navegador.');
      else notice('Não foi possível ligar a câmera: '+String(e?.message||'verifique a conexão').slice(0,90));
      if(!watchedIds.size)closeRoom();
    }finally{busy=false;updateButton();
      if(restoreDeferred){restoreDeferred=false;scheduleRestore(1500);}
    }
  }
  // V50.3: troca de dispositivo SEM criar uma segunda transmissão e SEM gravar.
  // LiveKit reinicia/substitui a mesma faixa de vídeo publicada, preservando a sala e o microfone.
  async function switchCamera(){
    if(busy||!enabled||!publishing||isSpectator()||!socket?.connected)return;
    const activeRoom=room;
    const seq=generation;
    const track=localCameraTrack();
    if(!track?.restartTrack)return notice('Esta câmera não oferece troca de dispositivo.');
    busy=true;updateButton();
    const previousFacing=cameraFacing;
    const original=track.mediaStreamTrack?.getSettings?.()||{};
    let changed=false;
    let lastError=null;
    try{
      let devices=[];
      try{
        devices=(await navigator.mediaDevices?.enumerateDevices?.()||[])
          .filter(device=>device.kind==='videoinput'&&device.deviceId);
      }catch{} // A lista pode ser incompleta em navegadores móveis.
      const currentId=original.deviceId||await track.getDeviceId?.();
      const desiredFacing=(original.facingMode==='environment'? 'user':
                           original.facingMode==='user'? 'environment':
                           cameraFacing==='user'?'environment':'user');
      if(onPhone()){
        try{
          await track.restartTrack({...captureOptions(),facingMode:desiredFacing});
          const result=track.mediaStreamTrack?.getSettings?.()||{};
          // Alguns aparelhos aceitam facingMode sem de fato mudar de câmera.
          changed=result.facingMode===desiredFacing ||
            (!!result.deviceId&&!!currentId&&result.deviceId!==currentId) ||
            (!result.facingMode&&!result.deviceId&&devices.length<2);
          if(changed)cameraFacing=desiredFacing;
        }catch(error){lastError=error;}
      }
      if(!changed){
        if(devices.length<2){
          if(!onPhone())throw new Error('Só uma câmera foi encontrada neste dispositivo.');
          throw lastError||new Error('Não foi possível alternar entre as câmeras deste celular.');
        }
        const currentIndex=devices.findIndex(d=>d.deviceId===currentId);
        // Preferir câmera traseira/frontal conforme o nome quando disponível.
        const words=desiredFacing==='environment'?/back|rear|traseir|ambiente|environment/i:/front|frontal|facetime|selfie|user/i;
        const preferred=devices.find(d=>d.deviceId!==currentId&&words.test(d.label||''));
        const next=preferred||devices[(currentIndex>=0?currentIndex+1:0)%devices.length];
        if(!next||next.deviceId===currentId)throw new Error('Não foi encontrada outra câmera disponível.');
        await track.restartTrack({...captureOptions(),deviceId:{exact:next.deviceId}});
        const result=track.mediaStreamTrack?.getSettings?.()||{};
        if(result.deviceId&&result.deviceId===currentId)
          throw new Error('O aparelho manteve a câmera anterior.');
        cameraFacing=result.facingMode==='environment'?'environment':
          result.facingMode==='user'?'user':desiredFacing;
        changed=true;
      }
      if(seq!==generation||activeRoom!==room||!publishing||!socket?.connected)return;
      updateLocalVideo(); // a nova MediaStreamTrack precisa atualizar a prévia após restartTrack().
      notice('📷 Câmera alterada.');
    }catch(error){
      cameraFacing=previousFacing;
      if(seq===generation&&activeRoom===room&&publishing){
        // Não troca o estado público da câmera. Se o aparelho falhou, o jogador pode religar.
        updateLocalVideo();
        notice('Não foi possível trocar a câmera: '+String(error?.message||'dispositivo indisponível').slice(0,105));
      }
    }finally{
      if(seq===generation){busy=false;updateButton();updateSwitchButton();}
    }
  }
  function onPresence(payload){
    if(!payload||payload.code!==code())return;
    watchedIds=new Set((payload.playerIds||[]).map(String));
    if(!enabled)return;
    if(watchedIds.size && (!isSpectator()||spectatorWatchEnabled)){
      ensureConnected().catch(()=>{});
    }else if(!publishing&&!cameraWanted&&!busy)closeRoom();
    updateButton();
  }
  function onJoined(newRoomCode,{restoreCamera=false,role='PLAYER'}={}){
    stop({keepWanted:true});joinedRoomCode=String(newRoomCode||'');
    cameraWanted=!!restoreCamera&&role==='PLAYER';restoreAttempts=0;
    if(socket?.connected)socket.emit('cameraPresenceRequest');
    updateButton();
    if(cameraWanted)scheduleRestore(450);
  }
  function onState(){
    const track=localCameraTrack()?.mediaStreamTrack;
    if(publishing&&(!track||track.readyState==='ended')){
      publishing=false;if(socket?.connected)socket.emit('cameraPublishState',{active:false});
      updateLocalVideo();
      if(cameraWanted)scheduleRestore(1500);
    }
    updateButton();
  }
  async function init(sock,options={}){
    socket=sock;getState=options.getState||getState;notice=options.toast||notice;
    socket.on('cameraPresence',onPresence);
    window.addEventListener('pagehide',stop);
    document.getElementById('liveCameraBtn')?.addEventListener('click',toggle);
    document.getElementById('cameraOpponentClose')?.addEventListener('click',()=>closeExpanded(true));
    document.getElementById('cameraOpponentOverlay')?.addEventListener('click',event=>{
      if(event.target.id==='cameraOpponentOverlay')closeExpanded(true);
    });
    document.addEventListener?.('keydown',event=>{
      if(event.key==='Escape'&&expandedPlayerId)closeExpanded(true);
    });
    const switchBtn=document.getElementById('cameraSwitchBtn');
    // Impede que o botão 🔄 também arraste a janela flutuante.
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click']){
      switchBtn?.addEventListener(type,event=>event.stopPropagation());
    }
    switchBtn?.addEventListener('click',switchCamera);
    try{
      const response=await fetch('/api/camera/config',{credentials:'same-origin',cache:'no-store'});
      enabled=!!(await response.json())?.enabled;
    }catch{enabled=false}
    updateButton();
    if(code()&&socket.connected)socket.emit('cameraPresenceRequest');
    if(cameraWanted)scheduleRestore(550);
  }
  window.MauCamera={init,onJoined,onState,onPresence,renderIntoSeats,stop,switchCamera,restore};
})();

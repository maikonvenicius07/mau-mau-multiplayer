const socket = io();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let passPending=false;
let state=null, pendingCard=null, pendingBurn=false, pendingDouble=null, soundOn=true, previousHandIds=new Set();
let chatMessages=[], unreadChat=0, activeSideTab='log';
const sessionKey='maumauSessionV1';

const suitGlyph={hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'};
const suitName={hearts:'Copas',diamonds:'Ouros',clubs:'Paus',spades:'Espadas'};
const specialName={A:'PULA',Q:'INVERTE',J:'ESCOLHE NAIPE','7':'+2',K:'ANTERIOR +1','8':'ANTERIOR +2'};
const effectCatalog={applause:{emoji:'👏',label:'Aplausos'},laugh:{emoji:'😂',label:'Risada'},horn:{emoji:'📯',label:'Corneta'},drum:{emoji:'🥁',label:'Tambores'},victory:{emoji:'🎉',label:'Vitória'},wow:{emoji:'😱',label:'Uau!'}};

function profile(){ return {name:$('#nameInput').value.trim()||'Jogador',avatar:$('#avatarSelect').value}; }
function saved(){try{return JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{return null}}
function saveSession(data){localStorage.setItem(sessionKey,JSON.stringify(data))}
function clearSession(){localStorage.removeItem(sessionKey)}
function setConnection(status){
  const chip=$('#connectionChip'); if(!chip) return;
  chip.className=`connection-chip ${status}`;
  chip.textContent=status==='online'?'● Online':status==='offline'?'● Sem conexão':'● Conectando';
}

function audioCtx(){
  try{
    const ac=audioCtx.ac||(audioCtx.ac=new (window.AudioContext||window.webkitAudioContext)());
    if(ac.state==='suspended') ac.resume().catch(()=>{});
    return ac;
  }catch{return null}
}
function tone(ac,freq,start,dur,type='sine',gain=.035){
  if(!ac)return;
  const o=ac.createOscillator(),g=ac.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,start);
  g.gain.setValueAtTime(gain,start);g.gain.exponentialRampToValueAtTime(.001,start+dur);
  o.connect(g).connect(ac.destination);o.start(start);o.stop(start+dur+.02);
}
function noiseBurst(ac,start,dur=.08,gain=.025){
  if(!ac)return;
  const len=Math.max(1,Math.floor(ac.sampleRate*dur));
  const buffer=ac.createBuffer(1,len,ac.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<len;i++) data[i]=(Math.random()*2-1)*(1-i/len);
  const src=ac.createBufferSource(),g=ac.createGain(),filter=ac.createBiquadFilter();
  src.buffer=buffer;filter.type='bandpass';filter.frequency.value=1500;filter.Q.value=.7;
  g.gain.value=gain;src.connect(filter).connect(g).connect(ac.destination);src.start(start);
}
function beep(type='play'){
  if(!soundOn) return;
  const ac=audioCtx(); if(!ac)return;
  const map={play:[420,.055],draw:[220,.06],special:[610,.08],burn:[760,.11],quick:[920,.075],winner:[880,.18],penalty:[150,.09],mau:[980,.12]};
  const [f,d]=map[type]||map.play;tone(ac,f,ac.currentTime,d,type==='winner'?'triangle':'sine',.035);
}
function playSocialEffect(effect){
  if(!soundOn)return;
  const ac=audioCtx(); if(!ac)return;
  const t=ac.currentTime+.02;
  if(effect==='applause'){
    for(let i=0;i<12;i++) noiseBurst(ac,t+i*.045+Math.random()*.018,.055,.018+Math.random()*.014);
  } else if(effect==='laugh'){
    [520,440,540,410,500,370].forEach((f,i)=>tone(ac,f,t+i*.095,.075,'sine',.028));
  } else if(effect==='horn'){
    [392,523,659].forEach((f,i)=>tone(ac,f,t+i*.12,.19,'sawtooth',.025));
  } else if(effect==='drum'){
    [0,.18,.36].forEach((off,i)=>{tone(ac,i===2?70:92,t+off,.14,'sine',.055);noiseBurst(ac,t+off,.045,.014)});
  } else if(effect==='victory'){
    [523,659,784,1046].forEach((f,i)=>tone(ac,f,t+i*.13,i===3?.34:.16,'triangle',.035));
  } else if(effect==='wow'){
    [280,360,470,620].forEach((f,i)=>tone(ac,f,t+i*.07,.12,'sine',.026));
  }
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}

$('#createBtn').onclick=()=>{
  if(!socket.connected) return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  clearSession();
  socket.emit('createRoom',{...profile(),token:crypto.randomUUID()});
};
$('#botGameBtn').onclick=()=>{
  if(!socket.connected) return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  clearSession();
  socket.emit('createRoom',{...profile(),token:crypto.randomUUID(),withBot:true});
};
$('#joinBtn').onclick=()=>{
  if(!socket.connected) return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  const code=$('#roomInput').value.trim().toUpperCase();
  if(!code) return toast('Informe o código da sala.');
  const sess=saved();
  const token=sess?.code===code&&sess?.token?sess.token:crypto.randomUUID();
  socket.emit('joinRoom',{...profile(),code,token});
};
$('#roomInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#joinBtn').click()});
$('#copyInvite').onclick=async()=>{const url=new URL(location.href);url.searchParams.set('room',state.code);await navigator.clipboard.writeText(url.toString());toast('Link da sala copiado.');};
$('#leaveBtn').onclick=()=>{
  if(!state) return;
  const duringRound=state.status==='playing';
  const message=duringRound
    ? 'Deseja sair da sala? A rodada atual será cancelada para os jogadores que permanecerem.'
    : 'Deseja sair desta sala?';
  if(!window.confirm(message)) return;
  if(!socket.connected){
    clearSession();
    returnToLanding('Você saiu da sala.');
    return;
  }
  socket.emit('leaveRoom');
};

$('#soundBtn').onclick=()=>{soundOn=!soundOn;$('#soundBtn').textContent=soundOn?'🔊':'🔇';if(soundOn)audioCtx()};
$('#chatToggleBtn').onclick=()=>{setSideTab('chat',true)};
$('#logTabBtn').onclick=()=>setSideTab('log',true);
$('#chatTabBtn').onclick=()=>setSideTab('chat',true);
$('#sideCloseBtn').onclick=()=>$('#sidePanel').classList.remove('open');
$('#chatForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!state||!socket.connected)return toast('Sem conexão com a sala.');
  const input=$('#chatInput'),text=input.value.trim();
  if(!text)return;
  socket.emit('chatMessage',{text});input.value='';input.focus();
});
$$('[data-effect]').forEach(btn=>btn.onclick=()=>{
  if(!state||!socket.connected)return toast('Sem conexão com a sala.');
  audioCtx();
  socket.emit('sendEffect',{effect:btn.dataset.effect});
});

$('#drawPile').onclick=()=>{if(canAct()) socket.emit('draw')};
$('#mauBtn').onclick=()=>socket.emit('declare',{type:'mau-mau'});
$('#batendoBtn').onclick=()=>socket.emit('declare',{type:'batendo'});
$('#endBurnBtn').onclick=()=>socket.emit('endBurn');
$('#passTurnBtn').onclick=()=>{
  if(passPending) return;
  passPending=true;
  $('#passTurnBtn').disabled=true;
  $('#passTurnBtn').textContent='⏳ Passando...';
  const afterBurn=state?.continuationPlayerId===state?.me?.id;
  toast(afterBurn
    ? (state?.me?.justDrawnCardId
      ? '⏭️ Passando a vez após a queima. A carta comprada ficará na sua mão.'
      : '⏭️ Passando a vez após a queima sem jogar outra carta.')
    : '⏭️ Passando a vez. A carta comprada ficará na sua mão.');
  socket.emit('passTurn');
};

const rules=$('#rulesDialog');
$('#rulesOpen').onclick=$('#rulesOpen2').onclick=()=>rules.showModal();
$('#rulesClose').onclick=()=>rules.close();

$$('#suitDialog [data-suit]').forEach(btn=>btn.onclick=()=>{
  const suit=btn.dataset.suit;$('#suitDialog').close();
  if(pendingDouble){
    socket.emit('playDoubleCard',{firstCardId:pendingDouble.cardIds[0],secondCardId:pendingDouble.cardIds[1],chosenSuit:suit});
    pendingDouble=null;pendingCard=null;pendingBurn=false;
    return;
  }
  socket.emit('playCard',{cardId:pendingCard.id,chosenSuit:suit});
  pendingCard=null;pendingBurn=false;
});

socket.on('joined',data=>{
  saveSession({code:data.code,token:data.token,name:profile().name,avatar:profile().avatar});
  $('#landing').classList.add('hidden');$('#game').classList.remove('hidden');
});
socket.on('state',s=>{
  const prev=state;
  state=s;
  if(passPending && state?.me && state.currentPlayerId !== state.me.id){
    passPending=false;
  }
  render();
  if(prev){
    const last=s.log.at(-1);
    const old=prev.log.at(-1);
    if(last&&last.id!==old?.id)beep(last.kind);
  }
});
socket.on('chatHistory',messages=>{chatMessages=Array.isArray(messages)?messages.slice(-60):[];unreadChat=0;renderChat();renderChatBadge()});
socket.on('chatMessage',message=>{
  chatMessages.push(message);if(chatMessages.length>60)chatMessages=chatMessages.slice(-60);
  const panelOpen=$('#sidePanel').classList.contains('open')||window.innerWidth>900;
  if(message.playerId!==state?.me?.id && (activeSideTab!=='chat'||!panelOpen)) unreadChat++;
  renderChat();renderChatBadge();
  if(activeSideTab==='chat'&&panelOpen) unreadChat=0,renderChatBadge();
});
socket.on('soundEffect',event=>{
  const fx=effectCatalog[event.effect];if(!fx)return;
  playSocialEffect(event.effect);showReaction(`${event.avatar||'🙂'} ${event.name||'Jogador'}`,fx.emoji,fx.label);
});
socket.on('passConfirmed',data=>{
  const next=state?.players?.find(p=>p.id===data?.nextPlayerId);
  toast(`✅ Vez passada${next?.name?`. Agora é a vez de ${next.name}.`:'.'}`);
});
socket.on('gameError',e=>{passPending=false;toast(e.message);render();});
socket.on('leftRoom',()=>{
  clearSession();
  returnToLanding('Você saiu da sala.');
});
socket.on('sessionReplaced',()=>toast('Esta sessão foi aberta em outra aba. Esta aba ficará inativa.'));
socket.on('connect',()=>{
  setConnection('online');
  const urlRoom=(new URLSearchParams(location.search).get('room')||'').toUpperCase();
  const sess=saved();

  // Um link de convite para outra sala tem prioridade sobre uma sessão antiga.
  if(urlRoom && (!sess?.code || sess.code !== urlRoom)){
    $('#roomInput').value=urlRoom;
    return;
  }
  if(sess?.code&&sess?.token){
    $('#nameInput').value=sess.name||'Jogador';$('#avatarSelect').value=sess.avatar||'🧑';
    socket.emit('joinRoom',{code:sess.code,token:sess.token,name:sess.name,avatar:sess.avatar});
  } else if(urlRoom) $('#roomInput').value=urlRoom;
});
socket.on('disconnect',()=>{setConnection('offline');toast('Conexão perdida. Tentando reconectar...');renderControls();});
socket.on('connect_error',()=>setConnection('offline'));
socket.io.on('reconnect_attempt',()=>setConnection('connecting'));

function returnToLanding(message=''){
  state=null;pendingCard=null;pendingBurn=false;pendingDouble=null;previousHandIds=new Set();chatMessages=[];unreadChat=0;activeSideTab='log';
  $('#sidePanel')?.classList.remove('open');renderChatBadge();
  try{
    const url=new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState({},'',url.pathname+(url.search||'')+url.hash);
  }catch{}
  $('#game').classList.add('hidden');
  $('#landing').classList.remove('hidden');
  $('#roomInput').value='';
  if(message) toast(message);
}


function setSideTab(tab,openMobile=false){
  activeSideTab=tab==='chat'?'chat':'log';
  $('#logTabBtn').classList.toggle('active',activeSideTab==='log');
  $('#chatTabBtn').classList.toggle('active',activeSideTab==='chat');
  $('#logView').classList.toggle('hidden',activeSideTab!=='log');
  $('#chatView').classList.toggle('hidden',activeSideTab!=='chat');
  if(openMobile) $('#sidePanel').classList.add('open');
  if(activeSideTab==='chat'){unreadChat=0;renderChatBadge();setTimeout(()=>$('#chatInput')?.focus(),30)}
}
function renderChatBadge(){
  const text=unreadChat>9?'9+':String(unreadChat);
  for(const el of [$('#chatBadge'),$('#chatTopBadge')]){if(!el)continue;el.textContent=text;el.classList.toggle('hidden',unreadChat===0)}
}
function renderChat(){
  const box=$('#chatMessages');if(!box)return;
  if(!chatMessages.length){box.innerHTML='<div class="chat-empty">Converse com os jogadores da sala.</div>';return}
  box.innerHTML=chatMessages.map(m=>{
    const mine=m.playerId===state?.me?.id;
    const time=new Date(m.at||Date.now()).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return `<div class="chat-message ${mine?'mine':''}"><div class="chat-meta">${esc(m.avatar||'🙂')} ${esc(m.name||'Jogador')} <span>${time}</span></div><div class="chat-bubble">${esc(m.text)}</div></div>`;
  }).join('');
  box.scrollTop=box.scrollHeight;
}
function showReaction(name,emoji,label){
  const layer=$('#reactionLayer');if(!layer)return;
  const el=document.createElement('div');el.className='reaction-pop';
  el.innerHTML=`<div class="reaction-emoji">${emoji}</div><div><strong>${esc(name)}</strong><span>${esc(label)}</span></div>`;
  layer.appendChild(el);setTimeout(()=>el.remove(),2100);
}

function canAct(){return !passPending&&socket.connected&&state?.status==='playing'&&state.currentPlayerId===state.me?.id}
function render(){
  if(!state)return;
  $('#landing').classList.add('hidden');$('#game').classList.remove('hidden');
  $('#roomCode').textContent=state.code;$('#roundText').textContent=`Rodada ${state.round}/${state.rounds}`;
  $('#directionText').textContent=state.direction===1?'↻ horário':'↺ anti-horário';$('#deckCount').textContent=state.deckCount;
  $('#meLabel').textContent=`${state.me.avatar} ${state.me.name}`;$('#handCount').textContent=`• ${state.me.hand.length} carta(s)`;
  renderPlayers();renderScore();renderCenter();renderHand();renderLog();renderControls();
}
function renderPlayers(){
  const ring=$('#playersRing');ring.innerHTML='';const n=state.players.length;
  const spots=n===2?[[50,12],[50,88]]:n===3?[[50,10],[18,72],[82,72]]:n===4?[[50,8],[12,50],[50,90],[88,50]]:[[50,7],[12,35],[22,84],[78,84],[88,35]];
  state.players.forEach((p,i)=>{
    const d=document.createElement('div');d.className='player-seat';d.style.left=spots[i][0]+'%';d.style.top=spots[i][1]+'%';
    const active=state.currentPlayerId===p.id?' active':'';const disc=p.connected?'':' disconnect';
    const you=p.id===state.me.id?' <span class="you-tag">(você)</span>':'';
    const bot=p.isBot?' <span class="bot-tag">BOT</span>':'';
    d.innerHTML=`<div class="player-card${active}${disc}"><span class="avatar">${p.avatar}</span><div class="player-meta"><div class="player-name">${p.host?'<span class="crown">★</span> ':''}${esc(p.name)}${bot}${you}</div><div class="player-stats">🂠 ${p.cardCount} • ${p.score} pts</div></div></div>`;
    ring.appendChild(d);
  });
}
function renderScore(){
  const box=$('#scoreboard');box.innerHTML='<div class="score-title">Placar acumulado</div>'+state.players.slice().sort((a,b)=>a.score-b.score).map(p=>`<div class="score-row"><span>${p.avatar}</span><span>${esc(p.name)}${p.isBot?' <small class="score-bot">BOT</small>':''}</span><span class="round-score">+${p.roundScore||0}</span><strong>${p.score}</strong></div>`).join('');
}
function renderCenter(){
  const top=state.topCard;$('#discardPile').innerHTML=top?cardHTML(top,false):'';
  const current=state.players.find(p=>p.id===state.currentPlayerId);
  let banner='Aguardando jogadores...';
  if(state.status==='playing') banner=state.paused?'⏸️ Partida pausada: aguardando reconexão':(current?.id===state.me.id?'✨ Sua vez':`Vez de ${current?.avatar||''} ${current?.name||''}`);
  if(state.status==='playing'&&!state.paused&&state.continuationPlayerId===state.me.id){
    if(state.me?.justDrawnCardId) banner='🔥 Após a queima: jogue a carta comprada ou passe e guarde-a';
    else if(state.me?.burnMustDraw) banner='🔥 Após a queima: sem carta compatível — compre 1 carta';
    else banner='🔥 Após a queima: jogue mais uma carta compatível ou passe a vez';
  }
  else if(state.status==='playing'&&!state.paused&&state.me?.burnableCardIds?.length&&state.me?.quickActionCardIds?.length) banner='🔥 QUEIMA ou ⚡ AÇÃO RÁPIDA disponível! Escolha sua reação';
  else if(state.status==='playing'&&!state.paused&&state.me?.burnableCardIds?.length) banner='🔥 QUEIMA DISPONÍVEL! Jogue a carta igual e decida se continua ou passa';
  else if(state.status==='playing'&&!state.paused&&state.me?.quickActionCardIds?.length) banner='⚡ AÇÃO RÁPIDA! Jogue a carta igual antes do próximo';
  else if(state.status==='playing'&&!state.paused&&state.currentPlayerId===state.me?.id&&state.me?.doublePairs?.length) banner='🃏🃏 CARTA DUPLA disponível! Use ×2 (somente carta normal)';
  if(state.status==='between-rounds'){const w=state.players.find(p=>p.id===state.winnerId);banner=`🏆 ${w?.name||'Jogador'} venceu a rodada`}
  if(state.status==='finished'){const min=Math.min(...state.players.map(p=>p.score));const ws=state.players.filter(p=>p.score===min);banner=`🏆 ${ws.map(p=>p.name).join(' e ')} ${ws.length>1?'empataram':'venceu'}!`}
  $('#turnBanner').textContent=banner;
  $('#suitRequest').classList.toggle('hidden',!state.requestedSuit);if(state.requestedSuit)$('#suitRequest').textContent=`Naipe pedido: ${suitGlyph[state.requestedSuit]} ${suitName[state.requestedSuit]}`;
  $('#sevenPenalty').classList.toggle('hidden',!state.pendingSeven);if(state.pendingSeven)$('#sevenPenalty').textContent=`⚠️ Cadeia de 7: comprar ${state.pendingSeven} ou rebater com outro 7`;
  const canChooseAfterDraw=state.status==='playing'&&!state.paused&&current?.id===state.me?.id&&!!state.me?.justDrawnCardId;
  $('#drawChoice').classList.toggle('hidden',!canChooseAfterDraw);
}

function renderHand(){
  const h=$('#hand');h.innerHTML='';
  const legal=new Set(state.me.legalCardIds),burn=new Set(state.me.burnableCardIds),quick=new Set(state.me.quickActionCardIds||[]);
  const doublePairs=state.me.doublePairs||[];
  // O botão ×2 aparece nas DUAS cópias da dupla, para o jogador não depender
  // de qual delas o servidor listou primeiro.
  const doubleByCard=new Map();
  doublePairs.forEach(pair=>(pair.cardIds||[]).forEach(id=>doubleByCard.set(id,pair)));
  state.me.hand.forEach(card=>{
    const wrap=document.createElement('div');wrap.innerHTML=cardHTML(card,true);const el=wrap.firstElementChild;
    if(!previousHandIds.has(card.id)) el.classList.add('deal-in');
    const ok=legal.has(card.id)&&canAct();
    const canBurn=burn.has(card.id)&&socket.connected&&!state.paused&&!state.me.justDrawnCardId;
    const canQuick=quick.has(card.id)&&socket.connected&&!state.paused&&!state.me.justDrawnCardId;
    el.classList.add(ok?'playable':'disabled');
    if(canBurn) el.classList.add('burnable');
    if(canQuick) el.classList.add('quickable');
    if(ok)el.onclick=()=>play(card,false);
    if(canBurn){const b=document.createElement('button');b.className='burn-btn';b.textContent='🔥';b.title='QUEIMAR: jogar esta carta igual à mesa; depois você pode jogar outra compatível ou passar';b.onclick=e=>{e.stopPropagation();play(card,true)};el.appendChild(b)}
    if(canQuick){const q=document.createElement('button');q.className='quick-btn';q.textContent='⚡';q.title='AÇÃO RÁPIDA: descartar esta carta igual sem tomar a vez';q.onclick=e=>{e.stopPropagation();playQuick(card)};el.appendChild(q)}
    const doublePair=doubleByCard.get(card.id);
    const canDouble=!!(doublePair&&canAct()&&!state.paused&&!state.me.justDrawnCardId&&!state.continuationPlayerId);
    if(canDouble){
      el.classList.add('double-available');
      const d=document.createElement('button');d.className='double-btn';d.textContent='×2';
      d.title='CARTA DUPLA: jogar as duas cartas idênticas juntas';
      d.onclick=e=>{e.stopPropagation();playDouble(doublePair)};el.appendChild(d);
    }
    if(card.id===state.me.justDrawnCardId)el.style.outline='3px solid #65dc96';
    h.appendChild(el);
  });
  const myTurn=canAct();
  const burnOpportunity=(state.me.burnableCardIds||[]).length>0;
  const quickOpportunity=(state.me.quickActionCardIds||[]).length>0;
  const doubleOpportunity=(state.me.doublePairs||[]).length>0;
  // Mau-Mau pode ser anunciado fora da vez quando uma reação válida deixará 1 carta.
  const canDeclareMau=(state.me.hand.length===2&&(myTurn||burnOpportunity||quickOpportunity))||(state.me.hand.length===3&&(burnOpportunity||doubleOpportunity));
  $('#mauBtn').disabled=!canDeclareMau;$('#batendoBtn').disabled=!canBatendo();
  // V18: a continuação da queima é opcional.
  $('#endBurnBtn').classList.add('hidden');

  const passBlockedBySeven=state.pendingSeven>0;
  const inBurn=state.continuationPlayerId===state.me.id;
  const boughtThisTurn=!!state.me.justDrawnCardId;
  const legalAfterBurn=(state.me.legalCardIds||[]).length>0;

  // Regra normal: só passa depois de comprar.
  // Regra especial da queima:
  //   - se já há carta compatível, pode jogar OU passar sem comprar;
  //   - se não há carta compatível, primeiro compra 1;
  //   - depois da compra, pode jogar a comprada OU passar e guardá-la.
  const canPassBurn=!!(inBurn&&(boughtThisTurn||legalAfterBurn));
  const canPassNormal=!!(!inBurn&&boughtThisTurn);
  const canPassTurn=!!(myTurn&&!state.paused&&!passBlockedBySeven&&(canPassBurn||canPassNormal));

  $('#passTurnBtn').classList.toggle('hidden',state.status!=='playing');
  $('#passTurnBtn').disabled=!canPassTurn;
  $('#passTurnBtn').textContent=passPending?'⏳ Passando...':'⏭️ Passar a vez';
  $('#passTurnBtn').title=canPassTurn
    ? (inBurn
      ? (boughtThisTurn
        ? 'Passar após a queima e guardar a carta comprada.'
        : 'Passar após a queima sem jogar uma segunda carta.')
      : 'Passar a vez após a compra obrigatória de 1 carta.')
    : passBlockedBySeven
      ? 'Resolva primeiro a cadeia de 7: rebata ou compre a penalidade.'
      : inBurn&&state.me.burnMustDraw
        ? 'Você não tem carta compatível após a queima. Compre 1 carta antes de passar.'
        : myTurn
          ? 'Para passar a vez normal, primeiro compre 1 carta do monte.'
          : 'Aguarde sua vez.';

  // Compra normal: uma carta por turno.
  // Após a queima, a compra só é habilitada quando não existe carta compatível.
  const burnDrawBlocked=inBurn&&!boughtThisTurn&&!state.me.burnMustDraw;
  $('#drawPile').disabled=!!(passPending
    ||(myTurn&&boughtThisTurn&&!state.pendingSeven)
    ||(myTurn&&burnDrawBlocked));
  $('#drawPile').title=boughtThisTurn
    ? (inBurn
      ? 'Você já comprou após a queima. Jogue a carta comprada se quiser ou passe e guarde-a.'
      : 'Você já comprou nesta vez. Jogue a carta comprada se puder ou passe a vez.')
    : inBurn
      ? (state.me.burnMustDraw
        ? 'Comprar 1 carta porque não há continuação compatível.'
        : 'Você já tem carta compatível: jogue-a ou passe a vez sem comprar.')
      : 'Comprar 1 carta';
  previousHandIds=new Set(state.me.hand.map(c=>c.id));
}
function renderLog(){const l=$('#log');l.innerHTML=state.log.slice().reverse().map(x=>`<div class="log-item ${x.kind}">${esc(x.message)}</div>`).join('')}
function renderControls(){
  const box=$('#hostControls');
  if(!state?.me){box.innerHTML='';return}
  const me=state.players.find(p=>p.id===state.me.id);box.innerHTML='';
  const connected=state.players.filter(p=>p.connected).length;
  const disconnected=state.players.length-connected;

  const host=state.players.find(p=>p.host);
  const connectedHost=state.players.find(p=>p.host&&p.connected);
  const canTakeHost=!connectedHost;
  const canStart=(me?.host||canTakeHost)&&(state.status==='lobby'||state.status==='between-rounds');
  const bots=state.players.filter(p=>p.isBot);

  if(canStart){
    if(me?.host){
      const botBar=document.createElement('div');botBar.className='bot-controls';
      const addBot=document.createElement('button');addBot.className='bot-control-btn';addBot.textContent='🤖 Adicionar máquina';
      addBot.disabled=!socket.connected||state.players.length>=5||(state.status==='between-rounds'&&state.round>=3);
      addBot.onclick=()=>socket.emit('addBot');
      botBar.appendChild(addBot);
      if(bots.length){
        const removeBot=document.createElement('button');removeBot.className='bot-control-btn remove';removeBot.textContent='− Remover máquina';
        removeBot.disabled=!socket.connected;removeBot.onclick=()=>socket.emit('removeBot');botBar.appendChild(removeBot);
      }
      box.appendChild(botBar);
    }
    const b=document.createElement('button');
    const normalLabel=state.status==='lobby'?'Iniciar 1ª rodada':`Iniciar rodada ${state.round+1}`;
    b.textContent=me?.host?normalLabel:`Assumir sala e ${normalLabel.toLowerCase()}`;
    const blocked=!socket.connected||connected<2||(state.status==='between-rounds'&&disconnected>0);
    b.disabled=blocked;
    b.onclick=()=>{
      if(!socket.connected) return toast('Sem conexão com o servidor.');
      b.disabled=true;b.textContent='Iniciando...';
      socket.emit('startRound');
    };
    box.appendChild(b);
    const info=document.createElement('div');info.className='host-status';
    if(connected<2) info.textContent='Aguardando pelo menos mais 1 jogador conectado.';
    else if(disconnected>0&&state.status==='lobby') info.textContent=`${disconnected} jogador(es) desconectado(s) será(ão) removido(s) automaticamente.`;
    else if(disconnected>0) info.textContent='Aguarde os jogadores desconectados reconectarem.';
    else if(!me?.host) info.textContent='O anfitrião está desconectado. Você pode assumir a sala e iniciar.';
    else info.textContent=`${connected} jogador(es) conectado(s). Pronto para iniciar.`;
    box.appendChild(info);
    if(state.status==='between-rounds'&&state.round<3){const s=document.createElement('div');s.className='wait';s.textContent='Novos jogadores ainda podem entrar antes do início da próxima rodada.';box.appendChild(s)}
  } else if(state.status==='lobby') {
    const hostName=host?`${host.avatar} ${esc(host.name)}`:'outro jogador';
    box.innerHTML=`<div class="wait">Aguardando o anfitrião ★ ${hostName} iniciar a partida.<br><small>O jogador marcado com ★ controla o início da rodada.</small></div>`;
  }
}
function play(card,burn){
  pendingCard=card;pendingBurn=burn;
  if(burn){
    socket.emit('burnMatch',{cardId:card.id});
    pendingCard=null;pendingBurn=false;
    return;
  }
  // O Valete jogado normalmente pede o naipe quando ainda restarem cartas.
  if(card.rank==='J'&&state.me.hand.length>1){$('#suitDialog').showModal();return}
  socket.emit('playCard',{cardId:card.id});
  pendingCard=null;pendingBurn=false;
}
function playQuick(card){
  if(!card||!socket.connected||state?.paused)return;
  socket.emit('quickAction',{cardId:card.id});
}

function playDouble(pair){
  if(!pair?.cardIds?.length||pair.cardIds.length<2)return;
  pendingDouble=pair;
  const first=state.me.hand.find(c=>c.id===pair.cardIds[0]);
  const remainingAfter=state.me.hand.length-2;
  if(first?.rank==='J'&&remainingAfter>0){$('#suitDialog').showModal();return}
  socket.emit('playDoubleCard',{firstCardId:pair.cardIds[0],secondCardId:pair.cardIds[1]});
  pendingDouble=null;
}
function canBatendo(){
  return state.me.hand.length===2 && ((state.me.burnFinishableCardIds||[]).length>0 || (state.me.doublePairs||[]).length>0);
}
function cardHTML(c,small){const red=c.suit==='hearts'||c.suit==='diamonds';return `<div class="playing-card ${red?'red-suit':'black-suit'}"><div class="corner">${c.rank}<br>${suitGlyph[c.suit]}</div><div class="suit-big">${suitGlyph[c.suit]}</div><div class="corner bottom">${c.rank}<br>${suitGlyph[c.suit]}</div>${specialName[c.rank]?`<div class="special-tag">${specialName[c.rank]}</div>`:''}</div>`}
function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}

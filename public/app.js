const socket = io();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let state=null, pendingCard=null, pendingBurn=false, soundOn=true, previousHandIds=new Set();
const sessionKey='maumauSessionV1';

const suitGlyph={hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'};
const suitName={hearts:'Copas',diamonds:'Ouros',clubs:'Paus',spades:'Espadas'};
const specialName={A:'PULA',Q:'INVERTE',J:'ESCOLHE NAIPE','7':'+2',K:'ANTERIOR +1','8':'ANTERIOR +2'};

function profile(){ return {name:$('#nameInput').value.trim()||'Jogador',avatar:$('#avatarSelect').value}; }
function saved(){try{return JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{return null}}
function saveSession(data){localStorage.setItem(sessionKey,JSON.stringify(data))}
function clearSession(){localStorage.removeItem(sessionKey)}
function setConnection(status){
  const chip=$('#connectionChip'); if(!chip) return;
  chip.className=`connection-chip ${status}`;
  chip.textContent=status==='online'?'● Online':status==='offline'?'● Sem conexão':'● Conectando';
}

function beep(type='play'){
  if(!soundOn) return;
  try{
    const ac=beep.ac||(beep.ac=new (window.AudioContext||window.webkitAudioContext)());
    const o=ac.createOscillator(), g=ac.createGain();
    const map={play:[420,.055],draw:[220,.06],special:[610,.08],burn:[760,.11],winner:[880,.18],penalty:[150,.09],mau:[980,.12]};
    const [f,d]=map[type]||map.play;o.frequency.value=f;o.type=type==='winner'?'triangle':'sine';g.gain.setValueAtTime(.035,ac.currentTime);g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+d);o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+d);
  }catch{}
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}

$('#createBtn').onclick=()=>{
  if(!socket.connected) return toast('Sem conexão com o servidor. Aguarde alguns segundos.');
  clearSession();
  socket.emit('createRoom',{...profile(),token:crypto.randomUUID()});
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
$('#soundBtn').onclick=()=>{soundOn=!soundOn;$('#soundBtn').textContent=soundOn?'🔊':'🔇'};
$('#drawPile').onclick=()=>{if(canAct()) socket.emit('draw')};
$('#mauBtn').onclick=()=>socket.emit('declare',{type:'mau-mau'});
$('#batendoBtn').onclick=()=>socket.emit('declare',{type:'batendo'});
$('#endBurnBtn').onclick=()=>socket.emit('endBurn');
$('#passDrawBtn').onclick=()=>socket.emit('passAfterDraw');

const rules=$('#rulesDialog');
$('#rulesOpen').onclick=$('#rulesOpen2').onclick=()=>rules.showModal();
$('#rulesClose').onclick=()=>rules.close();

$$('#suitDialog [data-suit]').forEach(btn=>btn.onclick=()=>{
  const suit=btn.dataset.suit;$('#suitDialog').close();
  if(pendingBurn) socket.emit('burnPair',{cardId:pendingCard.id,chosenSuit:suit});
  else socket.emit('playCard',{cardId:pendingCard.id,chosenSuit:suit});
  pendingCard=null;pendingBurn=false;
});

socket.on('joined',data=>{
  saveSession({code:data.code,token:data.token,name:profile().name,avatar:profile().avatar});
  $('#landing').classList.add('hidden');$('#game').classList.remove('hidden');
});
socket.on('state',s=>{const prev=state;state=s;render();if(prev){const last=s.log.at(-1);const old=prev.log.at(-1);if(last&&last.id!==old?.id)beep(last.kind)}});
socket.on('gameError',e=>{toast(e.message);renderControls();});
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
  state=null;pendingCard=null;pendingBurn=false;previousHandIds=new Set();
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

function canAct(){return socket.connected&&state?.status==='playing'&&state.currentPlayerId===state.me?.id}
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
    d.innerHTML=`<div class="player-card${active}${disc}"><span class="avatar">${p.avatar}</span><div class="player-meta"><div class="player-name">${p.host?'<span class="crown">★</span> ':''}${esc(p.name)}${you}</div><div class="player-stats">🂠 ${p.cardCount} • ${p.score} pts</div></div></div>`;
    ring.appendChild(d);
  });
}
function renderScore(){
  const box=$('#scoreboard');box.innerHTML='<div class="score-title">Placar acumulado</div>'+state.players.slice().sort((a,b)=>a.score-b.score).map(p=>`<div class="score-row"><span>${p.avatar}</span><span>${esc(p.name)}</span><span class="round-score">+${p.roundScore||0}</span><strong>${p.score}</strong></div>`).join('');
}
function renderCenter(){
  const top=state.topCard;$('#discardPile').innerHTML=top?cardHTML(top,false):'';
  const current=state.players.find(p=>p.id===state.currentPlayerId);
  let banner='Aguardando jogadores...';
  if(state.status==='playing') banner=state.paused?'⏸️ Partida pausada: aguardando reconexão':(current?.id===state.me.id?'✨ Sua vez':`Vez de ${current?.avatar||''} ${current?.name||''}`);
  if(state.status==='between-rounds'){const w=state.players.find(p=>p.id===state.winnerId);banner=`🏆 ${w?.name||'Jogador'} venceu a rodada`}
  if(state.status==='finished'){const min=Math.min(...state.players.map(p=>p.score));const ws=state.players.filter(p=>p.score===min);banner=`🏆 ${ws.map(p=>p.name).join(' e ')} ${ws.length>1?'empataram':'venceu'}!`}
  $('#turnBanner').textContent=banner;
  $('#suitRequest').classList.toggle('hidden',!state.requestedSuit);if(state.requestedSuit)$('#suitRequest').textContent=`Naipe pedido: ${suitGlyph[state.requestedSuit]} ${suitName[state.requestedSuit]}`;
  $('#sevenPenalty').classList.toggle('hidden',!state.pendingSeven);if(state.pendingSeven)$('#sevenPenalty').textContent=`⚠️ Cadeia de 7: comprar ${state.pendingSeven} ou rebater com outro 7`;
}
function renderHand(){
  const h=$('#hand');h.innerHTML='';const legal=new Set(state.me.legalCardIds),burn=new Set(state.me.burnableCardIds);
  state.me.hand.forEach(card=>{
    const wrap=document.createElement('div');wrap.innerHTML=cardHTML(card,true);const el=wrap.firstElementChild;
    if(!previousHandIds.has(card.id)) el.classList.add('deal-in');
    const ok=legal.has(card.id)&&canAct();el.classList.add(ok?'playable':'disabled');
    if(ok)el.onclick=()=>play(card,false);
    if(burn.has(card.id)&&canAct()&&!state.me.justDrawnCardId){const b=document.createElement('button');b.className='burn-btn';b.textContent='🔥';b.title='Queimar duas cartas iguais';b.onclick=e=>{e.stopPropagation();play(card,true)};el.appendChild(b)}
    if(card.id===state.me.justDrawnCardId)el.style.outline='3px solid #65dc96';
    h.appendChild(el);
  });
  const myTurn=canAct();$('#mauBtn').disabled=!(myTurn&&state.me.hand.length===2);$('#batendoBtn').disabled=!(myTurn&&canBatendo());
  $('#endBurnBtn').classList.toggle('hidden',!(myTurn&&state.continuationPlayerId===state.me.id));
  $('#passDrawBtn').classList.toggle('hidden',!(myTurn&&state.me.justDrawnCardId));
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

  if(canStart){
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
  // O J não pode ser queimado; se jogado normalmente e não for a última carta, pede naipe.
  if(card.rank==='J'&&state.me.hand.length>1){$('#suitDialog').showModal();return}
  if(burn)socket.emit('burnPair',{cardId:card.id});else socket.emit('playCard',{cardId:card.id});
}
function canBatendo(){const h=state.me.hand;if(h.length!==2)return false;return h[0].rank===h[1].rank&&h[0].suit===h[1].suit&&!['A','7','8','J','Q','K'].includes(h[0].rank)}
function cardHTML(c,small){const red=c.suit==='hearts'||c.suit==='diamonds';return `<div class="playing-card ${red?'red-suit':'black-suit'}"><div class="corner">${c.rank}<br>${suitGlyph[c.suit]}</div><div class="suit-big">${suitGlyph[c.suit]}</div><div class="corner bottom">${c.rank}<br>${suitGlyph[c.suit]}</div>${specialName[c.rank]?`<div class="special-tag">${specialName[c.rank]}</div>`:''}</div>`}
function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}

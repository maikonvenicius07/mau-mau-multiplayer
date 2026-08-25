const socket = io();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let passPending=false;
let state=null, pendingCard=null, pendingBurn=false, pendingDouble=null, soundOn=localStorage.getItem('maumauSound')!=='off', previousHandIds=new Set();
let chatMessages=[], unreadChat=0, activeSideTab='log';
const sessionKey='maumauSessionV1';
const playerKeyStorage='maumauPlayerKeyV1';
let rankingPeriod='day', rankingMode='human';
const pileSideStorage='maumauPileSideV1';
let pileSide=localStorage.getItem(pileSideStorage)==='deck-left'?'deck-left':'deck-right';
const handSortStorage='maumauHandSortV1';
let handSort=localStorage.getItem(handSortStorage)==='suit'?'suit':'rank';

const rankSortOrder={A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13};
const suitSortOrder={hearts:1,diamonds:2,clubs:3,spades:4};
function compareHandCards(a,b){
  const rankA=rankSortOrder[a.rank]??99,rankB=rankSortOrder[b.rank]??99;
  const suitA=suitSortOrder[a.suit]??99,suitB=suitSortOrder[b.suit]??99;
  if(handSort==='suit') return suitA-suitB||rankA-rankB||String(a.id).localeCompare(String(b.id));
  return rankA-rankB||suitA-suitB||String(a.id).localeCompare(String(b.id));
}
function updateHandSortButton(){
  const btn=$('#sortHandBtn');if(!btn)return;
  if(handSort==='suit'){
    btn.textContent='♠ Naipe';
    btn.title='Organização atual: por naipe. Clique para organizar por número.';
  }else{
    btn.textContent='🔢 Número';
    btn.title='Organização atual: por número. Clique para organizar por naipe.';
  }
  btn.setAttribute('aria-label',btn.title);
}
function toggleHandSort(){
  handSort=handSort==='rank'?'suit':'rank';
  localStorage.setItem(handSortStorage,handSort);
  updateHandSortButton();
  if(state?.me) renderHand();
  toast(handSort==='rank'?'🔢 Mão organizada por número.':'♠ Mão organizada por naipe.');
}

function applyPileSide(mode=pileSide){
  pileSide=mode==='deck-left'?'deck-left':'deck-right';
  const draw=$('#drawPile'),discard=$('#discardPile'),btn=$('#pileSideBtn');
  if(draw&&discard){
    const piles=draw.parentElement;
    // Ordem forçada por JS para não depender de media queries ou cache de regras antigas.
    if(piles) piles.style.setProperty('flex-direction','row','important');
    if(pileSide==='deck-right'){
      discard.style.setProperty('order','1','important');
      draw.style.setProperty('order','2','important');
    }else{
      draw.style.setProperty('order','1','important');
      discard.style.setProperty('order','2','important');
    }
  }
  if(btn){
    btn.dataset.side=pileSide;
    btn.title=pileSide==='deck-right'
      ? 'Atual: carta da mesa à esquerda e baralho à direita. Clique para inverter.'
      : 'Atual: baralho à esquerda e carta da mesa à direita. Clique para inverter.';
    btn.setAttribute('aria-label',btn.title);
  }
  localStorage.setItem(pileSideStorage,pileSide);
}

function togglePileSide(){
  applyPileSide(pileSide==='deck-right'?'deck-left':'deck-right');
  toast(pileSide==='deck-right'
    ? '🃏 Carta da mesa à esquerda • baralho à direita.'
    : '🂠 Baralho à esquerda • carta da mesa à direita.');
}

const suitGlyph={hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'};
const suitName={hearts:'Copas',diamonds:'Ouros',clubs:'Paus',spades:'Espadas'};
const specialName={A:'PULA',Q:'INVERTE',J:'ESCOLHE NAIPE','7':'+2',K:'ANTERIOR +1','8':'ANTERIOR +2'};
const effectCatalog={applause:{emoji:'👏',label:'Aplausos'},laugh:{emoji:'😂',label:'Risada'},horn:{emoji:'📯',label:'Corneta'},drum:{emoji:'🥁',label:'Tambores'},victory:{emoji:'🎉',label:'Vitória'},wow:{emoji:'😱',label:'Uau!'},jogaBoca:{emoji:'📢',label:'JOGA BOCA ABERTA!'}};

const avatarCatalog={
  macaco:{label:'Macaco',src:'assets/avatars/macaco.webp',grupo:'Animais'},
  boi:{label:'Boi',src:'assets/avatars/boi.webp',grupo:'Animais'},
  jacare:{label:'Jacaré',src:'assets/avatars/jacare.webp',grupo:'Animais'},
  veado:{label:'Veado',src:'assets/avatars/veado.webp',grupo:'Animais'},
  cachorro:{label:'Cachorro',src:'assets/avatars/cachorro.webp',grupo:'Animais'},
  preta:{label:'Tela Preta',src:'assets/avatars/preta.webp',grupo:'Mascotes'},
  costela:{label:'Costela',src:'assets/avatars/costela.webp',grupo:'Mascotes'},
  perna:{label:'Perna',src:'assets/avatars/perna.webp',grupo:'Mascotes'},
  homem:{label:'Homem',src:'assets/avatars/homem.webp',grupo:'Pessoas'},
  mulher:{label:'Mulher',src:'assets/avatars/mulher.webp',grupo:'Pessoas'},
};
function avatarInfo(value){return avatarCatalog[value]||null}
function avatarHTML(value,size='md'){
  const info=avatarInfo(value);
  if(info) return `<img class="avatar-photo avatar-${size}" src="${info.src}" alt="${info.label}" title="${info.label}" />`;
  return `<span class="avatar-emoji avatar-${size}">${esc(value||'🂡')}</span>`;
}
function setAvatarSelection(value='macaco'){
  const chosen=avatarCatalog[value]?value:'macaco';
  const input=$('#avatarSelect');if(input)input.value=chosen;
  $$('.avatar-option').forEach(btn=>{
    const active=btn.dataset.avatar===chosen;
    btn.classList.toggle('selected',active);
    btn.setAttribute('aria-checked',active?'true':'false');
  });
}

function permanentPlayerKey(){
  let key=localStorage.getItem(playerKeyStorage);
  if(!key){
    key=(crypto.randomUUID?crypto.randomUUID():`plr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(playerKeyStorage,key);
  }
  return key;
}
function profile(){ return {name:$('#nameInput').value.trim()||'Jogador',avatar:$('#avatarSelect').value,playerKey:permanentPlayerKey()}; }
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
function playGameSound(type='play'){
  if(!soundOn) return;
  const ac=audioCtx(); if(!ac)return;
  const t=ac.currentTime+.015;
  const seq=(notes,shape='sine',gain=.032)=>notes.forEach(([freq,off,dur])=>tone(ac,freq,t+off,dur,shape,gain));
  if(type==='play'){
    noiseBurst(ac,t,.035,.018); tone(ac,420,t,.045,'triangle',.024);
  } else if(type==='draw'){
    noiseBurst(ac,t,.085,.026); tone(ac,210,t+.02,.07,'sine',.022);
  } else if(type==='yourTurn'){
    seq([[660,0,.07],[880,.09,.10]],'triangle',.032);
  } else if(type==='pass'){
    seq([[430,0,.055],[330,.07,.075]],'sine',.024);
  } else if(type==='burn'){
    noiseBurst(ac,t,.16,.03); seq([[520,0,.06],[760,.055,.08],[1040,.12,.12]],'sawtooth',.026);
  } else if(type==='quick'){
    seq([[980,0,.045],[1320,.05,.065],[880,.10,.055]],'square',.018);
  } else if(type==='double'){
    noiseBurst(ac,t,.032,.018); noiseBurst(ac,t+.105,.032,.018); seq([[470,0,.045],[470,.105,.045]],'triangle',.025);
  } else if(type==='reverse'){
    seq([[660,0,.07],[520,.08,.07],[660,.16,.09]],'triangle',.027);
  } else if(type==='skip'){
    seq([[620,0,.045],[310,.065,.075]],'square',.019);
  } else if(type==='suit'){
    seq([[523,0,.07],[659,.075,.07],[784,.15,.10]],'sine',.027);
  } else if(type==='seven'){
    seq([[310,0,.07],[245,.08,.08],[185,.17,.12]],'sawtooth',.022);
  } else if(type==='penalty'){
    seq([[180,0,.10],[135,.11,.13]],'sawtooth',.022);
  } else if(type==='mau'){
    seq([[740,0,.07],[980,.08,.07],[1240,.16,.15]],'triangle',.036);
  } else if(type==='opponentMau'){
    // Alerta forte e inconfundível quando um adversário realmente fica com 1 carta.
    noiseBurst(ac,t,.18,.052); noiseBurst(ac,t+.23,.16,.048);
    seq([[880,0,.11],[1175,.12,.13],[880,.27,.11],[1320,.40,.22]],'square',.065);
    seq([[440,.03,.18],[587,.30,.18]],'sawtooth',.038);
  } else if(type==='round'){
    for(let i=0;i<7;i++) noiseBurst(ac,t+i*.055,.045,.014+Math.random()*.006);
    seq([[392,.05,.08],[523,.16,.08],[659,.27,.11]],'triangle',.018);
  } else if(type==='winner'){
    seq([[523,0,.11],[659,.12,.11],[784,.24,.11],[1046,.36,.28]],'triangle',.038);
  } else if(type==='champion'){
    seq([[523,0,.12],[659,.12,.12],[784,.24,.12],[1046,.36,.18],[1318,.55,.30]],'triangle',.043);
    for(let i=0;i<10;i++) noiseBurst(ac,t+.18+i*.055,.045,.012);
  } else if(type==='chat'){
    seq([[720,0,.045],[900,.055,.065]],'sine',.018);
  } else if(type==='error'){
    seq([[180,0,.11],[150,.08,.14]],'square',.018);
  } else {
    tone(ac,420,t,.055,'sine',.028);
  }
}
function soundForLog(entry){
  if(!entry)return null;
  const m=String(entry.message||'');
  if(entry.kind==='champion') return 'champion';
  if(entry.kind==='winner') return 'winner';
  if(entry.kind==='burn') return 'burn';
  if(entry.kind==='quick') return 'quick';
  if(entry.kind==='mau') return 'mau';
  if(entry.kind==='penalty') return 'penalty';
  if(entry.kind==='draw') return 'draw';
  if(entry.kind==='round') return 'round';
  if(entry.kind==='turn' && /passou a vez/i.test(m)) return 'pass';
  if(entry.kind==='play' && /CARTA DUPLA/i.test(m)) return 'double';
  if(entry.kind==='play') return 'play';
  if(entry.kind==='special'){
    if(/Dama|inverteu o sentido/i.test(m)) return 'reverse';
    if(/Ás|perdeu a vez/i.test(m)) return 'skip';
    if(/escolheu|naipe/i.test(m)) return 'suit';
    if(/7|cadeia/i.test(m)) return 'seven';
    if(/Rei|Oito|comprou/i.test(m)) return 'penalty';
    return 'play';
  }
  return null;
}
function speakMauMau(){
  if(!soundOn || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance==='undefined') return;
  try{
    // Evita sobreposição caso dois avisos sejam disparados quase ao mesmo tempo.
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance('Mau-Mau!');
    utterance.lang='pt-BR';
    utterance.rate=.92;
    utterance.pitch=1.12;
    utterance.volume=1;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const ptBr=voices.find(v=>String(v.lang||'').toLowerCase()==='pt-br');
    const pt=voices.find(v=>String(v.lang||'').toLowerCase().startsWith('pt'));
    if(ptBr||pt) utterance.voice=ptBr||pt;
    window.speechSynthesis.speak(utterance);
  }catch{}
}
function speakOpponentMauMau(name='Adversário'){
  if(!soundOn || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance==='undefined') return;
  try{
    window.speechSynthesis.cancel();
    const safeName=String(name||'Adversário').slice(0,24);
    const utterance=new SpeechSynthesisUtterance(`Atenção! ${safeName} está de Mau-Mau! Uma carta!`);
    utterance.lang='pt-BR';
    utterance.rate=.86;
    utterance.pitch=.96;
    utterance.volume=1;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const ptBr=voices.find(v=>String(v.lang||'').toLowerCase()==='pt-br');
    const pt=voices.find(v=>String(v.lang||'').toLowerCase().startsWith('pt'));
    if(ptBr||pt) utterance.voice=ptBr||pt;
    window.speechSynthesis.speak(utterance);
  }catch{}
}
function speakJogaBocaAberta(){
  if(!soundOn || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance==='undefined') return;
  try{
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance('JOGA BOCA ABERTA!');
    utterance.lang='pt-BR';
    // Volume máximo permitido pelo navegador. Ritmo mais lento e voz firme
    // deixam a frase mais destacada nos celulares e computadores.
    utterance.rate=.78;
    utterance.pitch=1.02;
    utterance.volume=1;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const ptBr=voices.find(v=>String(v.lang||'').toLowerCase()==='pt-br');
    const pt=voices.find(v=>String(v.lang||'').toLowerCase().startsWith('pt'));
    if(ptBr||pt) utterance.voice=ptBr||pt;
    window.speechSynthesis.speak(utterance);
  }catch{}
}
function announceOpponentMauMau(player){
  if(!player || player.id===state?.me?.id) return;
  playGameSound('opponentMau');
  showReaction(player.name||'Adversário','🚨','MAU-MAU! • 1 CARTA',player.avatar);
  setTimeout(()=>speakOpponentMauMau(player.name||'Adversário'),280);
}
function detectOpponentMauMau(prev,next){
  if(!prev?.players || !next?.players || next.status!=='playing') return;
  for(const player of next.players){
    if(player.id===next.me?.id || player.finishedRound || player.cardCount!==1) continue;
    const before=prev.players.find(p=>p.id===player.id);
    if(before && before.cardCount>1){
      announceOpponentMauMau(player);
    }
  }
}
function beep(type='play'){ playGameSound(type); }
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
  } else if(effect==='jogaBoca'){
    // Chamada forte antes da fala para o efeito se destacar na mesa.
    noiseBurst(ac,t,.20,.075);
    [330,440,660,880].forEach((f,i)=>tone(ac,f,t+i*.07,.15,'sawtooth',.060));
    setTimeout(()=>speakJogaBocaAberta(),180);
  }
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}


const rankPeriodLabel={day:'Hoje',month:'Mês',year:'Ano',all:'Geral'};
const rankModeLabel={human:'Pessoas',bot:'Com máquina'};
function rankMedal(rank){return rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':String(rank)}
function pct(wins,games){return games?`${((wins/games)*100).toFixed(1).replace('.',',')}%`:'0%'}
function scoreFmt(value){return Number(value||0).toFixed(1).replace('.',',')}
async function loadRanking(){
  const body=$('#rankingBody'), mine=$('#rankingMine');
  if(!body||!mine)return;
  body.innerHTML='<tr><td colspan="7" class="ranking-empty">Carregando ranking...</td></tr>';
  mine.innerHTML='<span class="ranking-loading">Consultando seu perfil...</span>';
  $('#rankingScopeLabel').textContent=`${rankPeriodLabel[rankingPeriod]} • ${rankModeLabel[rankingMode]}`;
  try{
    const [rankRes,profileRes]=await Promise.all([
      fetch(`/api/ranking?period=${encodeURIComponent(rankingPeriod)}&mode=${encodeURIComponent(rankingMode)}`),
      fetch(`/api/profile?playerKey=${encodeURIComponent(permanentPlayerKey())}&period=${encodeURIComponent(rankingPeriod)}&mode=${encodeURIComponent(rankingMode)}`)
    ]);
    const rank=await rankRes.json(), prof=await profileRes.json();
    if(!rank.ok) throw new Error(rank.message||'Ranking indisponível.');
    if(!rank.rows?.length){
      body.innerHTML='<tr><td colspan="7" class="ranking-empty">Ainda não há partidas concluídas neste ranking.</td></tr>';
    }else{
      body.innerHTML=rank.rows.map(r=>`<tr class="${r.playerKey===permanentPlayerKey()?'ranking-me-row':''}"><td class="rank-pos" data-label="Posição">${rankMedal(r.rank)}</td><td data-label="Jogador"><div class="rank-player">${avatarHTML(r.avatar,'sm')}<span>${esc(r.name)}</span></div></td><td data-label="Jogos">${r.games}</td><td data-label="Vitórias"><strong>${r.wins}</strong></td><td data-label="Aproveit.">${pct(r.wins,r.games)}</td><td data-label="Média">${scoreFmt(r.avgScore)}</td><td data-label="Melhor">${r.bestScore??'-'}</td></tr>`).join('');
    }
    if(prof.ok&&prof.stats){
      const r=prof.stats;
      mine.innerHTML=`<div class="mine-avatar">${avatarHTML(r.avatar,'md')}</div><div><small>SEU DESEMPENHO</small><strong>${esc(r.name)}</strong><span>${r.wins} vitória(s) em ${r.games} partida(s) • ${pct(r.wins,r.games)} • média ${scoreFmt(r.avgScore)} pts</span></div>${r.rank?`<div class="mine-rank">${rankMedal(r.rank)}<small>posição</small></div>`:''}`;
    }else{
      mine.innerHTML='<div class="ranking-new-player">🎯 Você ainda não possui resultado neste período e modalidade.</div>';
    }
  }catch(e){
    body.innerHTML=`<tr><td colspan="7" class="ranking-empty">${esc(e.message||'Não foi possível carregar o ranking.')}</td></tr>`;
    mine.innerHTML='<div class="ranking-new-player">Tente novamente em alguns instantes.</div>';
  }
}
function openRanking(){
  const dlg=$('#rankingDialog'); if(!dlg)return;
  dlg.showModal(); loadRanking();
}
$$('[data-rank-period]').forEach(btn=>btn.onclick=()=>{
  rankingPeriod=btn.dataset.rankPeriod;
  $$('[data-rank-period]').forEach(x=>x.classList.toggle('active',x===btn));
  loadRanking();
});
$$('[data-rank-mode]').forEach(btn=>btn.onclick=()=>{
  rankingMode=btn.dataset.rankMode;
  $$('[data-rank-mode]').forEach(x=>x.classList.toggle('active',x===btn));
  loadRanking();
});
$('#rankingOpen').onclick=openRanking;
$('#rankingOpen2').onclick=openRanking;
$('#rankingClose').onclick=()=>$('#rankingDialog').close();

$$('.avatar-option').forEach(btn=>btn.onclick=()=>setAvatarSelection(btn.dataset.avatar));
setAvatarSelection($('#avatarSelect')?.value||'macaco');

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

applyPileSide();
$('#pileSideBtn').onclick=togglePileSide;
updateHandSortButton();
$('#sortHandBtn').onclick=toggleHandSort;

$('#soundBtn').textContent=soundOn?'🔊':'🔇';
$('#soundBtn').onclick=()=>{soundOn=!soundOn;localStorage.setItem('maumauSound',soundOn?'on':'off');$('#soundBtn').textContent=soundOn?'🔊':'🔇';toast(soundOn?'🔊 Efeitos sonoros ativados.':'🔇 Efeitos sonoros desativados.');if(soundOn){audioCtx();playGameSound('yourTurn')}};
document.addEventListener('pointerdown',()=>audioCtx(),{once:true});
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
    if(last&&last.id!==old?.id){
      const fx=soundForLog(last);
      if(fx){
        playGameSound(fx);
        // O anúncio falado simples continua para o próprio jogador. Para adversários,
        // o alerta mais forte é disparado quando a mão realmente chega a 1 carta.
        if(fx==='mau' && last.playerId===s.me?.id) speakMauMau();
      }
    }
    detectOpponentMauMau(prev,s);
    const becameMyTurn=prev.currentPlayerId!==s.currentPlayerId && s.status==='playing' && !s.paused && s.currentPlayerId===s.me?.id;
    if(becameMyTurn) setTimeout(()=>playGameSound('yourTurn'),120);
  }
});
socket.on('chatHistory',messages=>{chatMessages=Array.isArray(messages)?messages.slice(-60):[];unreadChat=0;renderChat();renderChatBadge()});
socket.on('chatMessage',message=>{
  chatMessages.push(message);if(chatMessages.length>60)chatMessages=chatMessages.slice(-60);
  const panelOpen=$('#sidePanel').classList.contains('open')||window.innerWidth>900;
  if(message.playerId!==state?.me?.id && (activeSideTab!=='chat'||!panelOpen)) unreadChat++;
  renderChat();renderChatBadge();
  if(activeSideTab==='chat'&&panelOpen) unreadChat=0,renderChatBadge();
  if(message.playerId!==state?.me?.id) playGameSound('chat');
});
socket.on('soundEffect',event=>{
  const fx=effectCatalog[event.effect];if(!fx)return;
  playSocialEffect(event.effect);showReaction(event.name||'Jogador',fx.emoji,fx.label,event.avatar);
});
socket.on('passConfirmed',data=>{
  const next=state?.players?.find(p=>p.id===data?.nextPlayerId);
  toast(`✅ Vez passada${next?.name?`. Agora é a vez de ${next.name}.`:'.'}`);
});
socket.on('gameError',e=>{passPending=false;playGameSound('error');toast(e.message);render();});
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
    $('#nameInput').value=sess.name||'Jogador';setAvatarSelection(sess.avatar||'macaco');
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
    return `<div class="chat-message ${mine?'mine':''}"><div class="chat-meta">${avatarHTML(m.avatar,'xs')} <b>${esc(m.name||'Jogador')}</b> <span>${time}</span></div><div class="chat-bubble">${esc(m.text)}</div></div>`;
  }).join('');
  box.scrollTop=box.scrollHeight;
}
function showReaction(name,emoji,label,avatar=null){
  const layer=$('#reactionLayer');if(!layer)return;
  const el=document.createElement('div');el.className='reaction-pop';
  el.innerHTML=`<div class="reaction-emoji">${emoji}</div>${avatar?avatarHTML(avatar,'sm'):''}<div><strong>${esc(name)}</strong><span>${esc(label)}</span></div>`;
  layer.appendChild(el);setTimeout(()=>el.remove(),2100);
}

function canAct(){return !passPending&&socket.connected&&state?.status==='playing'&&state.currentPlayerId===state.me?.id}
function render(){
  if(!state)return;
  $('#landing').classList.add('hidden');$('#game').classList.remove('hidden');
  $('#roomCode').textContent=state.code;$('#roundText').textContent=`Rodada ${state.round}/${state.rounds}`;
  $('#directionText').textContent=state.direction===1?'↻ horário':'↺ anti-horário';$('#deckCount').textContent=state.deckCount;
  $('#meLabel').innerHTML=`${avatarHTML(state.me.avatar,'sm')} <span>${esc(state.me.name)}</span>`;$('#handCount').textContent=`• ${state.me.hand.length} carta(s)`;
  renderPlayers();renderScore();renderCenter();renderHand();renderLog();renderControls();
}
function renderPlayers(){
  const ring=$('#playersRing');ring.innerHTML='';const n=state.players.length;
  const mobile=window.innerWidth<=900;
  const desktopSpots=n===2?[[50,12],[50,88]]:n===3?[[50,10],[18,72],[82,72]]:n===4?[[50,8],[12,50],[50,90],[88,50]]:[[50,7],[12,35],[22,84],[78,84],[88,35]];
  // No celular, a própria posição fica escondida (a mão já identifica você),
  // e os adversários ocupam a parte superior/lateral da mesa para liberar o centro.
  const opponents=state.players.filter(p=>p.id!==state.me.id);
  const mobileSpots=opponents.length===1?[[50,12]]:
    opponents.length===2?[[25,13],[75,13]]:
    opponents.length===3?[[18,18],[50,10],[82,18]]:
    [[17,18],[39,9],[61,9],[83,18]];
  let oi=0;
  state.players.forEach((p,i)=>{
    const d=document.createElement('div');d.className='player-seat'+(p.id===state.me.id?' self-seat':'');
    const spot=mobile?(p.id===state.me.id?[50,90]:mobileSpots[oi++]):desktopSpots[i];
    d.style.left=spot[0]+'%';d.style.top=spot[1]+'%';d.dataset.playerName=p.name||'Jogador';
    const active=state.currentPlayerId===p.id?' active':'';const disc=p.connected?'':' disconnect';
    const you=p.id===state.me.id?' <span class="you-tag">(você)</span>':'';
    const bot=p.isBot?' <span class="bot-tag">BOT</span>':'';
    const countClass=p.cardCount===1?' mau-count':p.cardCount===2?' warning-count':'';
    const countWord=p.cardCount===1?'CARTA':'CARTAS';
    d.innerHTML=`<div class="player-card${active}${disc}${countClass}"><span class="avatar">${avatarHTML(p.avatar,'md')}</span><div class="player-meta"><div class="player-name">${p.host?'<span class="crown">★</span> ':''}${esc(p.name)}${bot}${you}</div><div class="player-stats">${p.score} pts</div></div><div class="card-count-badge${countClass}" aria-label="${p.cardCount} ${countWord.toLowerCase()}"><strong>${p.cardCount}</strong><span>${countWord}</span></div></div>`;
    ring.appendChild(d);
  });
}
function renderScore(){
  const box=$('#scoreboard');box.innerHTML='<div class="score-title">Placar acumulado</div>'+state.players.slice().sort((a,b)=>a.score-b.score).map(p=>`<div class="score-row"><span class="score-avatar">${avatarHTML(p.avatar,'sm')}</span><span>${esc(p.name)}${p.isBot?' <small class="score-bot">BOT</small>':''}</span><span class="round-score">+${p.roundScore||0}</span><strong>${p.score}</strong></div>`).join('');
}
function renderCenter(){
  const top=state.topCard;$('#discardPile').innerHTML=top?cardHTML(top,false):'';
  const current=state.players.find(p=>p.id===state.currentPlayerId);
  let banner='Aguardando jogadores...';
  if(state.status==='playing') banner=state.paused?'⏸️ Partida pausada: aguardando reconexão':(current?.id===state.me.id?'✨ Sua vez':`Vez de ${current?.name||'Jogador'}`);
  if(state.status==='playing'&&!state.paused&&state.continuationPlayerId===state.me.id){
    if(state.me?.justDrawnCardId) banner='🔥 Após a queima: jogue qualquer carta válida ou passe e guarde a comprada';
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
  const visibleHand=[...state.me.hand].sort(compareHandCards);
  visibleHand.forEach(card=>{
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
    const canDouble=!!(doublePair&&canAct()&&!state.paused&&!state.continuationPlayerId);
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
  //   - depois da compra, pode jogar qualquer carta válida OU passar e guardar a comprada.
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
      ? 'Você já comprou após a queima. Jogue qualquer carta válida ou passe e guarde a comprada.'
      : 'Você já comprou nesta vez. Jogue qualquer carta válida da mão ou passe a vez.')
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
    const hostName=host?`${avatarHTML(host.avatar,'xs')} ${esc(host.name)}`:'outro jogador';
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

let mobileResizeTimer;window.addEventListener('resize',()=>{clearTimeout(mobileResizeTimer);mobileResizeTimer=setTimeout(()=>{if(state)renderPlayers()},120)});
window.addEventListener('orientationchange',()=>setTimeout(()=>{if(state)renderPlayers()},180));

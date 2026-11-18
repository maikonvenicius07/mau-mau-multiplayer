'use strict';
// V51.6 — acompanhamento visual de fases sem alterar as regras do jogo.
(() => {
  const byId=id=>document.getElementById(id);
  const button=byId('tournamentOpenHome'),dialog=byId('tournamentDialog'),close=byId('tournamentClose');
  const name=byId('tournamentName'),state=byId('tournamentStatus'),date=byId('tournamentDate');
  const action=byId('tournamentJoin'),list=byId('tournamentPlayers'),picker=byId('tournamentPicker');
  const panel=byId('tournamentAdminPanel'),adminName=byId('tournamentAdminName');
  const capacity=byId('tournamentAdminCapacity'),start=byId('tournamentAdminStart');
  const create=byId('tournamentAdminCreate'),save=byId('tournamentAdminSave');
  const toggle=byId('tournamentAdminToggle'),cancel=byId('tournamentAdminCancel'),remove=byId('tournamentAdminDelete'),forceDeleteTest=byId('tournamentAdminForceDeleteTest'),message=byId('tournamentAdminMessage');
  const drawButton=byId('tournamentDrawButton'),tablesPanel=byId('tournamentTables'),tablesList=byId('tournamentTableList'),adminHint=byId('tournamentAdminHint');
  if(!button||!dialog||!close||!name||!state||!date||!action||!list||!picker||!panel)return;
  let pending=false,config=null,items=[],drawnTables=[],canCreate=false,myTable=null,gameStates={},currentStage='qualifier',bracket=null;
  let pendingTableEntry=null,entryFeedback=null;
  // Auto-refresh must not erase unsaved tournament settings or duplicate requests.
  let adminEditing=false,lastSelectedPayload=null,detailsInFlight=null,detailsInFlightId='';
  const autoStatus=byId('tournamentAutoStatus');
  // V40.69.8.23 — horário agendado é diferente do prazo de espera da mesa.
  const schedule=window.MauMauTournamentSchedule;
  const scheduleClock=schedule?.clock(()=>typeof performance!=='undefined'?performance.now():Date.now());
  const schedulePanel=byId('tournamentSchedulePanel'),scheduleDate=byId('tournamentScheduleDate');
  const scheduleTime=byId('tournamentScheduleTime'),scheduleState=byId('tournamentScheduleState');
  const scheduleRegistration=byId('tournamentScheduleRegistration'),scheduleMessage=byId('tournamentScheduleMessage');
  const scheduleZone=byId('tournamentScheduleZone'),scheduleChanged=byId('tournamentScheduleChanged');
  const scheduleCountdown=byId('tournamentScheduleCountdown'),scheduleClockText=byId('tournamentScheduleClock');
  const overviewSchedule=byId('tournamentOverviewSchedule');
  const lastKnownSchedule=new Map(),scheduleNoticeById=new Map();
  let scheduleInProgress=false;
  function tickTournamentSchedule(){
    if(!dialog.open||!config||!schedule||!scheduleClockText||!scheduleCountdown)return;
    const when=schedule.timestamp(config.startAt),now=scheduleClock?.now();
    const active=config.status!=='cancelled'&&!bracket?.champion&&!scheduleInProgress&&when!==null&&now!==null;
    scheduleCountdown.hidden=!active;
    if(!active)return;
    const remaining=schedule.countdown(when,now);
    scheduleClockText.textContent=remaining.expired?'Horário programado atingido':remaining.text;
    scheduleCountdown.classList.toggle('is-due',remaining.expired);
    if(remaining.expired){
      const msg=scheduleMessage;
      if(msg)msg.textContent=config.registered?
        'O horário previsto chegou. Sua inscrição está confirmada. Aguarde o organizador; as partidas só começam manualmente.':
        'O horário previsto chegou. O início das partidas continua manual.';
    }
  }
  function renderSchedule(result){
    if(!schedule||!config||!schedulePanel)return;
    const previous=lastKnownSchedule.get(config.id);
    const newTime=config.startAt||null;
    if(previous!==undefined&&previous!==newTime){
      const updated=schedule.format(newTime);
      scheduleNoticeById.set(config.id,updated?
        `⚠ Horário alterado pelo organizador: ${updated.date}, às ${updated.time} (${updated.zone}).`:
        '⚠ O organizador retirou a data e o horário programados.');
    }
    if(scheduleChanged){
      const notice=scheduleNoticeById.get(config.id);
      scheduleChanged.textContent=notice||'';
      scheduleChanged.hidden=!notice;
    }
    lastKnownSchedule.set(config.id,newTime);
    const inProgress=(result.tables||[]).some(t=>{
      const g=result.games?.[t.number];
      return g?.finished||g?.liveStatus==='playing'||g?.liveStatus==='between-rounds';
    });
    scheduleInProgress=inProgress;
    const info=schedule.state({startAt:newTime,status:config.status,registered:config.registered,
      started:inProgress,finished:!!result.bracket?.champion,nowMs:scheduleClock?.now()});
    if(scheduleDate)scheduleDate.textContent=info.date?.date||'A definir';
    if(scheduleTime)scheduleTime.textContent=info.date?.time||'A definir';
    if(scheduleZone)scheduleZone.textContent=info.date?.zone||schedule.ZONE_LABEL;
    if(scheduleState)scheduleState.textContent='Situação: '+info.statusLabel;
    if(scheduleRegistration)scheduleRegistration.textContent='Sua inscrição: '+info.registrationLabel;
    if(scheduleMessage)scheduleMessage.textContent=info.message;
    if(overviewSchedule)overviewSchedule.textContent=info.date?
      `📅 Início programado: ${info.date.date} às ${info.date.time} (${info.date.zone}).`:
      '📅 Data e horário do torneio ainda não definidos.';
    schedulePanel.hidden=false;
    tickTournamentSchedule();
  }
  // O prazo é absoluto e persistido no servidor. Atualizar o texto a cada
  // segundo não dispara consultas HTTP nem reinicia a contagem.
  function tickTableWaits(){
    if(!dialog.open)return;
    for(const el of tablesList?.querySelectorAll('[data-wait-deadline]')||[]){
      const deadline=Number(el.dataset.waitDeadline||0);
      const sec=Math.max(0,Math.ceil((deadline-Date.now())/1000));
      const present=Number(el.dataset.waitPresent||0);
      el.textContent=sec>0?'⏳ Início manual liberado em '+String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0'):
        present===1?'⌛ Tempo encerrado. Se ninguém mais entrar, o jogador presente vence por ausência.':present<2?'⌛ Tempo encerrado. Aguardando pelo menos dois jogadores na mesa do torneio.':
        '⌛ Tempo encerrado. O anfitrião pode iniciar manualmente.';
      el.classList.toggle('tournament-wait-urgent',sec<=60);
    }
  }
  if(typeof setInterval==='function')setInterval(()=>{tickTableWaits();tickTournamentSchedule();},1000);

  function setAutoStatus(label,failed=false){
    if(!autoStatus)return;
    if(autoStatus.textContent!==label)autoStatus.textContent=label;
    autoStatus.classList.toggle('tournament-auto-status-error',failed);
  }
  const statusText={draft:'Em preparação',open:'Inscrições abertas',closed:'Inscrições encerradas',cancelled:'Cancelado'};
  function formatDate(v){return v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Porto_Velho',dateStyle:'short',timeStyle:'short'})+' (RO)':'Data ainda não definida';}
  function setBusy(value){pending=value;action.disabled=value||!config?.registrationOpen||(!config?.registered&&config?.spotsRemaining===0);create.disabled=value||!canCreate;for(const btn of [save,toggle,cancel])btn.disabled=value||!config?.canManage||config.status==='cancelled';
    if(remove)remove.disabled=value||!config?.canManage;
    if(forceDeleteTest){forceDeleteTest.hidden=!(config?.canManage&&['closed','cancelled'].includes(config?.status)&&/(?:^|[\s_-])teste(?:$|[\s_-])/i.test(config.name||''));forceDeleteTest.disabled=value||forceDeleteTest.hidden;}
    if(drawButton)drawButton.disabled=value||!config?.canManage||config.status!=='closed'||config.enrolled<2||drawnTables.length>0;}
  function setFields(t){
    adminName.value=t.name||'';capacity.value=t.capacity||20;
    if(t.startAt){const d=new Date(t.startAt);const inRO=new Date(d.getTime()-4*60*60*1000);start.value=inRO.toISOString().slice(0,16);}
    else start.value='';
  }
  const overview=byId('tournamentOverview'),stageList=byId('tournamentStages'),refresh=byId('tournamentRefresh');
  let lastOpenedPhase=null;
  function renderOverview(){
    if(!overview||!stageList)return;
    const expandedStages=new Set(Array.from(stageList.querySelectorAll('details[open]'),node=>node.dataset.stageKey));
    stageList.replaceChildren();
    const dashboard=window.MauMauTournamentDashboard;
    const stages=dashboard?.summarize({bracket,currentStage,currentTables:drawnTables,games:gameStates})||[];
    overview.hidden=!stages.length;
    const newlyAssignedPhase=lastOpenedPhase!==currentStage;
    for(const stage of stages){
      const details=document.createElement('details');details.className='tournament-stage-overview';
      details.dataset.stageKey=stage.stage;
      // Mostra automaticamente as mesas do NOVO sorteio uma vez; depois
      // preserva a escolha do usuário ao expandir/fechar cada etapa.
      details.open=expandedStages.has(stage.stage)||(newlyAssignedPhase&&stage.stage===currentStage);
      const heading=document.createElement('summary');
      const label=document.createElement('strong');label.textContent=stage.label;
      const stat=document.createElement('span');
      stat.textContent=(stage.stage!=='qualifier'&&stage.total>1?'🎲 Novo sorteio · ':'')+stage.finished+' de '+stage.total+' mesas concluídas';
      heading.append(label,stat);details.append(heading);
      const cards=document.createElement('div');cards.className='tournament-stage-cards';
      for(const table of stage.tables){
        const entry=document.createElement('div');entry.className='tournament-stage-table';
        const line=document.createElement('div');line.className='tournament-stage-table-line';
        const title=document.createElement('strong');title.textContent='Mesa '+table.number;
        const status=document.createElement('span');status.className='tournament-state tournament-state-'+table.status;
        status.textContent=table.label;
        line.append(title,status);entry.append(line);
        if(table.wait&&table.status!=='finished'&&table.status!=='playing'){
          const extra=document.createElement('small');extra.className='tournament-wait-stage';
          extra.textContent=`⏳ ${table.wait.present} de ${table.wait.expected} presentes`;entry.append(extra);
        }
        if(table.expectedPlayers!=null&&table.status!=='finished'){
          const connected=document.createElement('small');
          connected.textContent=table.connectedPlayers+' de '+table.expectedPlayers+' jogadores conectados';entry.append(connected);
        }
        if(table.result?.results?.length){
          const standings=document.createElement('ul');standings.className='tournament-stage-standings';
          for(const p of table.result.results){
            const li=document.createElement('li');
            let note='';
            if(p.forfeited)note=' · Desclassificado por desistência';
            else if(p.advanced===true)note=' · Classificado';
            else if(p.advanced===false)note=' · Eliminado';
            li.textContent=p.position+'º '+p.name+' · '+p.score+' pontos'+note;
            if(p.advanced===true)li.className='tournament-advanced';
            standings.append(li);
          }
          entry.append(standings);
        }
        cards.append(entry);
      }
      details.append(cards);stageList.append(details);
    }
    lastOpenedPhase=currentStage;
  }
  function render(result){
    config=result.tournament;name.textContent='🏆 '+config.name;
    state.textContent=`${config.enrolled} de ${config.capacity} inscritos • ${statusText[config.status]||'Em preparação'}`;
    date.textContent='Início previsto: '+formatDate(config.startAt);
    list.replaceChildren();
    if(!result.players?.length){const li=document.createElement('li');li.textContent='Nenhum jogador inscrito ainda.';list.append(li);}
    for(const p of result.players||[]){const li=document.createElement('li');li.textContent=p.name;list.append(li);}
    action.textContent=config.registered?'Cancelar minha inscrição':'Inscrever-me';
    if(!config.registrationOpen)action.textContent='Inscrições indisponíveis';
    else if(!config.registered&&config.spotsRemaining===0)action.textContent='Vagas esgotadas';
    drawnTables=result.tables||[];
    myTable=result.myTable??null;gameStates=result.games||{};
    bracket=result.bracket||null;currentStage=bracket?.currentStage||'qualifier';
    renderSchedule(result);
    const stagesLabel={qualifier:'Classificatórias',quarter:'Quartas de final',semi:'Semifinais',final:'Grande final'};
    if(tablesPanel){const heading=tablesPanel.querySelector('h3');if(heading)heading.textContent='🎲 '+(stagesLabel[currentStage]||'Mesas sorteadas');}
    const progress=document.getElementById('tournamentProgress');
    if(progress){progress.replaceChildren();
      if(bracket?.champion){const t=document.createElement('strong');t.className='tournament-champion';
        t.textContent='🏆 '+(bracket.champion.names.length>1?'Campeões: ':'Campeão: ')+bracket.champion.names.map(x=>x.name).join(', ');progress.append(t);}
      else if(bracket?.stages?.length){const p=document.createElement('p');
        if(currentStage==='final'){
          p.textContent='🏆 GRANDE FINAL FORMADA! Os finalistas devem voltar à tela principal, abrir TORNEIOS e clicar em ENTRAR NA MINHA MESA. A sala é aberta na primeira entrada autorizada. O início da partida é manual; o relógio de cinco minutos NÃO inicia sozinho.';
        }else if(currentStage!=='qualifier'){
          p.textContent='🎲 '+(drawnTables.length>1?'Novo sorteio realizado: consulte sua mesa abaixo.':'Mesa única da nova fase formada.')+' Os classificados entram manualmente por ENTRAR NA MINHA MESA. A partida começa apenas após o início manual.';
        }else{
          p.textContent='Fase atual: '+(stagesLabel[currentStage]||currentStage)+'. A próxima fase será criada automaticamente quando todas as mesas terminarem.';
        }
        progress.append(p);}
    }
    renderOverview();
    canCreate=Boolean(result.canCreate);
    if(adminHint)adminHint.hidden=canCreate;
    // O torneio inicial legado pertence ao sistema, não ao usuário autenticado.
    // Indique como criar um campeonato próprio em vez de deixá-lo preso no rascunho.
    if(message&&canCreate&&!config.canManage){
      message.textContent='Este torneio pertence a outra conta ou é o campeonato inicial do sistema. Para administrá-lo, crie o seu próprio torneio usando o formulário abaixo.';
    }

    if(tablesPanel&&tablesList){tablesPanel.hidden=drawnTables.length===0;tablesList.replaceChildren();
      for(const t of drawnTables){
        const card=document.createElement('div');card.className='tournament-table-card';
        if(currentStage==='final')card.classList.add('tournament-final-card');
        const title=document.createElement('h4');title.textContent=(currentStage==='final'?'🏆 GRANDE FINAL — ':'Mesa ')+t.number+' · '+t.players.length+' jogadores';card.append(title);
        const ol=document.createElement('ol');for(const player of t.players){const li=document.createElement('li');li.textContent=player.name;ol.append(li);}card.append(ol);
        const game=gameStates[t.number];
        const needsRecovery=game?.availability==='recovery-required'||game?.availability==='snapshot-review';
        if(currentStage==='final'&&!game?.finished){
          const help=document.createElement('div');help.className='tournament-final-guidance';
          const present=Number(game?.wait?.present||game?.connectedPlayers||0);
          if(needsRecovery){
            help.classList.add('needs-recovery');
            help.textContent='⚠ FINAL PRECISA DE RECUPERAÇÃO. '+(game.availabilityMessage||'A mesa não está disponível.')+
              ' Os classificados não devem criar uma sala comum para jogar a final.';
          }else if(present>=2){
            help.textContent='✅ FINAL PRONTA: jogadores conectados na mesa oficial. O anfitrião deve clicar em INICIAR 1ª RODADA.';
          }else{
            help.textContent=`🎮 GRANDE FINAL: ${present} de ${t.players.length} presentes na mesa oficial. `+
              'Cada finalista deve abrir TORNEIOS e clicar em ENTRAR NA MINHA MESA; a vaga já está reservada. ' +
              'O início da partida é manual e exige pelo menos dois participantes.';
          }
          card.append(help);
        }
        if(needsRecovery){
          const notice=document.createElement('div');notice.className='tournament-recovery-alert';
          notice.textContent=game.availabilityMessage||'Mesa não está disponível para entrada automática.';
          card.append(notice);
          if(game.repairAllowed&&config.canManage){
            const repair=document.createElement('button');repair.type='button';repair.className='tournament-repair-final';
            repair.textContent='⚠ RECUPERAR MESA DA FINAL';
            repair.addEventListener('click',()=>{
              if(!window.confirm('A mesa antiga da final não está disponível e não há estado de partida recuperável. Reabrir a mesa pode perder jogadas que não foram salvas. Deseja continuar?'))return;
              if(window.prompt('Para confirmar, digite RECRIAR FINAL:')!=='RECRIAR FINAL')return;
              if(typeof socket==='undefined'||!socket.connected){message.textContent='Conecte-se para recuperar a mesa.';return;}
              repair.disabled=true;message.textContent='Solicitando recuperação segura da final...';
              socket.emit('repairTournamentFinal',{tournamentId:config.id,tableNumber:t.number,confirm:true});
              setTimeout(()=>{repair.disabled=false;},5000);
            });
            card.append(repair);
          }else{
            const note=document.createElement('p');note.className='tournament-note';
            note.textContent=game.availability==='snapshot-review'? 
              'Existe estado competitivo preservado. Não é seguro reiniciar. Solicite ao organizador uma análise do armazenamento.':
              'Avise o organizador para verificar a recuperação da final. Os resultados anteriores não serão apagados automaticamente.';
            card.append(note);
          }
        }
        if(game?.wait&&!game?.finished&&!needsRecovery&&game.liveStatus!=='playing'&&game.liveStatus!=='between-rounds'&&game.liveStatus!=='finished'){
          const details=document.createElement('div');details.className='tournament-wait-detail';
          const count=document.createElement('strong');count.textContent=`Aguardando jogadores: ${game.wait.present} de ${game.wait.expected}`;
          details.append(count);
          const clock=document.createElement('div');clock.dataset.waitDeadline=String(game.wait.deadlineAt);clock.dataset.waitPresent=String(game.wait.present||0);
          clock.className='tournament-wait-clock';details.append(clock);
          if(game.wait.requiresAttention){const warning=document.createElement('small');warning.textContent='Nenhum participante compareceu. É necessária uma decisão do organizador; não há vitória automática sem jogador.';details.append(warning);}
          else if(game.wait.absent?.length){const names=document.createElement('small');names.textContent='Ausentes: '+game.wait.absent.join(', ');details.append(names);}
          card.append(details);
        }
        if(game?.finished){
          const result=document.createElement('div');result.className='tournament-table-result';
          const h=document.createElement('strong');h.textContent=game.result?.complete===false?'⚠️ Resultado parcial (participante ausente)':'🏆 Resultado da mesa';result.append(h);
          for(const p of game.result?.results||[]){const line=document.createElement('p');
            line.textContent=`${p.position}º ${p.name} — ${p.score} pontos${p.won?' 🏆':''}`;result.append(line);}
          card.append(result);
        }else if(t.number===myTable&&!needsRecovery){
          const note=document.createElement('p');note.className='tournament-note';
          note.textContent=currentStage==='qualifier'?'🎮 Sua vaga nas classificatórias está reservada.':
            '🏆 Você está classificado! Após concluir a fase anterior, use o botão abaixo para entrar nesta mesa. Sua vaga está reservada.';
          card.append(note);
          // Recuperação explícita caso a convocação Socket.IO tenha sido
          // perdida durante F5, mudança de fase ou conexão oscilante.
          const enter=document.createElement('button');enter.type='button';
          enter.className='tournament-enter-table';enter.textContent='🎮 ENTRAR NA MINHA MESA';
          const entryStatus=document.createElement('p');
          entryStatus.className='tournament-entry-feedback';entryStatus.setAttribute?.('role','status');
          const entryKey=config.id+':'+currentStage+':'+t.number;
          if(pendingTableEntry?.key===entryKey){
            pendingTableEntry.button=enter;pendingTableEntry.status=entryStatus;
            enter.disabled=true;entryStatus.textContent='Conectando à sua mesa oficial...';
          }else if(entryFeedback?.key===entryKey&&Date.now()-entryFeedback.at<90000){
            entryStatus.textContent=entryFeedback.message;
            entryStatus.classList.toggle('is-error',!entryFeedback.ok);
          }
          enter.addEventListener('click',()=>{
            if(pendingTableEntry?.key===entryKey)return;
            if(typeof socket==='undefined'||!socket.connected){
              entryStatus.textContent='Sem conexão com o servidor. Verifique a internet e tente novamente.';
              entryStatus.classList.add('is-error');return;
            }
            enter.disabled=true;entryStatus.textContent='Conectando à sua mesa oficial...';
            entryStatus.classList.remove('is-error');
            const request={key:entryKey,button:enter,status:entryStatus};
            pendingTableEntry=request;
            socket.emit('enterTournamentTable',{tournamentId:config.id,stage:currentStage,tableNumber:t.number,automatic:false});
            setTimeout(()=>{
              if(pendingTableEntry!==request)return;
              pendingTableEntry=null;request.button.disabled=false;
              request.status.textContent='O servidor não confirmou a entrada. Verifique a conexão e tente novamente.';
              request.status.classList.add('is-error');
            },38000);
          });
          card.append(enter,entryStatus);
        }else if(!needsRecovery){
          // Observadores podem entrar assim que a sala é criada, inclusive no lobby.
          const available=game?.liveStatus==='lobby'||game?.liveStatus==='playing'||game?.liveStatus==='between-rounds';
          if(available){
            const watch=document.createElement('button');watch.type='button';
            watch.className='tournament-watch-table';watch.textContent='👁️ ASSISTIR AO TORNEIO';
            watch.addEventListener('click',()=>{
              if(typeof socket==='undefined'||!socket.connected){message.textContent='Conecte-se para assistir à mesa.';return;}
              watch.disabled=true;message.textContent='Entrando como observador...';
              socket.emit('watchTournamentTable',{tournamentId:config.id,stage:currentStage,tableNumber:t.number});
              setTimeout(()=>{watch.disabled=false;},2500);
            });
            card.append(watch);
            const watchers=document.createElement('small');watchers.className='tournament-watch-count';
            watchers.textContent=`👁️ ${Number(game?.spectatorCount||0)}/${Number(game?.spectatorLimit||5)} assistindo`;
            card.append(watchers);
          }else{
            const note=document.createElement('p');note.className='tournament-note';
            note.textContent=game?.created?'Mesa em recuperação. Observação disponível quando reaparecer.':'Aguardando criação da mesa pelos inscritos.';
            card.append(note);
          }
        }
        tablesList.append(card);
      }
      tickTableWaits();
    }
    panel.hidden=!canCreate;
    if(canCreate){
      if(config.canManage){if(!adminEditing)setFields(config);}
      else if(!adminEditing){adminName.value='';capacity.value=20;start.value='';}
      toggle.textContent=config.status==='open'?'Encerrar inscrições':'Abrir inscrições';
      toggle.disabled=pending||!config.canManage||config.status==='cancelled';save.disabled=pending||!config.canManage||config.status==='cancelled';cancel.disabled=pending||!config.canManage||config.status==='cancelled';
      if(remove)remove.disabled=pending||!config.canManage;
      for(const btn of [save,toggle,cancel,remove])if(btn)btn.hidden=!config.canManage;
      if(forceDeleteTest){
        const eligible=!!config.canManage&&['closed','cancelled'].includes(config.status)&&/(?:^|[\s_-])teste(?:$|[\s_-])/i.test(config.name||'');
        forceDeleteTest.hidden=!eligible;forceDeleteTest.disabled=pending||!eligible;
      }
      if(drawButton?.parentElement)drawButton.parentElement.hidden=!config.canManage;
      create.disabled=pending;
    }
    action.disabled=pending||!config.registrationOpen||(!config.registered&&config.spotsRemaining===0);
    if(drawButton)drawButton.disabled=pending||!config.canManage||config.status!=='closed'||config.enrolled<2||drawnTables.length>0;
  }
  async function request(url,options={}){
    const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
    const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.message||'Não foi possível concluir a operação.');return data;
  }
  async function loadList(selectId='',{silent=false}={}){
    const response=await request('/api/tournaments');
    // A response arriving after the dialog was closed must not reopen or redraw it.
    if(!dialog.open)return;
    const previous=picker.value;
    const updatedItems=response.tournaments||[];
    const changed=JSON.stringify(updatedItems)!==JSON.stringify(items)||Boolean(response.canCreate)!==canCreate;
    items=updatedItems;canCreate=Boolean(response.canCreate);
    if(!silent||changed){
      picker.replaceChildren();
      for(const t of items){
        const opt=document.createElement('option');opt.value=t.id;
        const programmed=schedule?.format(t.startAt);
        opt.textContent=t.name+' — '+(programmed?`${programmed.date}, ${programmed.time} (RO)`:'Data a definir')+' — '+(statusText[t.status]||t.status);
        picker.append(opt);
      }
      if(!items.length){const opt=document.createElement('option');opt.textContent='Nenhum torneio cadastrado';opt.value='';picker.append(opt);}
      picker.value=items.some(t=>t.id===(selectId||previous))?(selectId||previous):(items[0]?.id||'');
    }
    panel.hidden=!canCreate;create.disabled=!canCreate;
    if(adminHint)adminHint.hidden=canCreate;
    if(!picker.value){
      config=null;lastSelectedPayload=null;
      if(overview)overview.hidden=true;if(stageList)stageList.replaceChildren();
      name.textContent='🏆 Torneios';state.textContent='Nenhum torneio cadastrado.';list.replaceChildren();action.disabled=true;
      if(schedulePanel)schedulePanel.hidden=true;
      if(!adminEditing){adminName.value='';capacity.value=20;start.value='';}
      for(const btn of [save,toggle,cancel,remove,forceDeleteTest])if(btn)btn.hidden=true;
      if(drawButton?.parentElement)drawButton.parentElement.hidden=true;
      setBusy(false);return;
    }
    if(!silent||changed||picker.value!==previous)await loadSelected({silent});
    if(!silent&&typeof socket!=='undefined'&&socket.connected)socket.emit('locateTournamentSeat');
  }
  async function loadSelected({silent=false}={}){
    const id=picker.value;
    if(!id)return;
    // A manual click and a timer firing together share the same request.
    if(detailsInFlight&&detailsInFlightId===id)return detailsInFlight;
    if(!silent&&!config)state.textContent='Carregando...';
    const task=(async()=>{
      const result=await request('/api/tournament?id='+encodeURIComponent(id));
      if(!dialog.open||picker.value!==id)return;
      // O carimbo de relógio muda a cada resposta, mas NÃO é uma mudança de
      // torneio: evita reconstruir formulários e fases a cada 15 segundos.
      if(scheduleClock) scheduleClock.sync(result.serverNow);
      const {serverNow,...stable}=result;
      const fingerprint=JSON.stringify(stable);
      if(fingerprint!==lastSelectedPayload||config?.id!==id){
        const position=dialog.scrollTop;
        render(result);
        lastSelectedPayload=fingerprint;
        dialog.scrollTop=position;
      }
      tickTournamentSchedule();
      setAutoStatus('Atualização automática ativa');
    })();
    detailsInFlight=task;detailsInFlightId=id;
    try{return await task;}
    finally{if(detailsInFlight===task){detailsInFlight=null;detailsInFlightId='';}}
  }
  function fields(){
    // datetime-local expresses a wall-clock time in Rondônia (UTC-04).
    const d=start.value?new Date(start.value+':00-04:00'):null;
    if(d&&!Number.isFinite(d.getTime()))throw new Error('Data inválida.');
    return {name:adminName.value.trim(),capacity:Number(capacity.value),startAt:d?d.toISOString():null};
  }
  async function adminRequest(kind){
    if(pending||panel.hidden)return;
    if(!config&&kind!=='create')return;
    if(kind==='cancel'&&!confirm('Cancelar este torneio? Ele continuará no histórico, mas as inscrições serão encerradas.'))return;
    if(kind==='delete'&&!confirm('Excluir DEFINITIVAMENTE este torneio, todas as inscrições e as mesas sorteadas? Esta ação não pode ser desfeita.'))return;
    if(kind==='forceDeleteTest'){
      if(!window.confirm('EXCLUSÃO DE TESTE TRAVADO: serão apagadas inscrições, classificação, histórico e resultados deste torneio TESTE. Não há como desfazer. Deseja continuar?'))return;
      if(window.prompt('Confirme a exclusão definitiva digitando EXCLUIR TORNEIO TESTE:')!=='EXCLUIR TORNEIO TESTE')return;
    }
    const payload=kind==='forceDeleteTest'?{confirmation:'EXCLUIR TORNEIO TESTE'}:kind==='create'?fields():kind==='save'?fields():kind==='delete'?null:{status:kind==='cancel'?'cancelled':config.status==='open'?'closed':'open'};
    setBusy(true);message.textContent='Salvando...';
    try{
      const data=await request(kind==='create'?'/api/tournaments':'/api/tournaments/'+encodeURIComponent(config.id)+(kind==='forceDeleteTest'?'/force-delete-test':''),{
        method:kind==='create'||kind==='forceDeleteTest'?'POST':kind==='delete'?'DELETE':'PATCH',
        ...(payload===null?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})});
      adminEditing=false;lastSelectedPayload=null;
      await loadList((kind==='delete'||kind==='forceDeleteTest')?'':data.tournament.id);
      message.textContent=kind==='forceDeleteTest'?'Torneio TESTE travado excluído. As convocações antigas foram encerradas.':kind==='delete'?'Torneio e inscrições excluídos.':kind==='create'?'Torneio criado. Abra as inscrições quando estiver pronto.':'Alteração salva.';
    }catch(e){message.textContent=e.message;}
    finally{setBusy(false);}
  }
  if(typeof socket!=='undefined'){
    socket.on('joined',data=>{
      if(data?.source==='tournament'||data?.source==='tournament-resume')pendingTableEntry=null;
      if((data?.source==='tournament'||data?.source==='tournament-resume'||data?.tournamentWatch)&&dialog.open)dialog.close();
    });
    socket.on('tournamentTableEntryResult',data=>{
      if(!data||data.ok!==false||!config||data.tournamentId!==config.id)return;
      const key=data.tournamentId+':'+data.stage+':'+data.tableNumber;
      const detail=String(data.message||'Não foi possível entrar na mesa.');
      entryFeedback={key,message:'⚠ '+detail,ok:false,at:Date.now()};
      if(pendingTableEntry?.key===key){
        pendingTableEntry.button.disabled=false;
        pendingTableEntry.status.textContent=entryFeedback.message;
        pendingTableEntry.status.classList.add('is-error');
        pendingTableEntry=null;
      }
      if(dialog.open)message.textContent=detail;
    });
    socket.on('gameError',data=>{
      if(dialog.open&&['Conectando à sua mesa...','Entrando como observador...'].includes(message.textContent))
        message.textContent=data?.message||'Não foi possível entrar na mesa.';
    });
    socket.on('tournamentFinalRepairResult',data=>{
      if(!dialog.open)return;
      message.textContent=data?.message||'Confira novamente o andamento da final.';
      if(data?.ok)loadSelected({silent:true}).catch(()=>{});
    });
    socket.on('tournamentTableResume',data=>{
      if(!data?.code)return;
      if(dialog.open)dialog.close();
      socket.emit('joinRoom',{code:data.code,resumeIntent:'tournament'});
    });
  }
  // Only poll while the tournament dialog is open and the page is visible.
  const autoRefresh=window.MauMauTournamentAutoRefresh?.create({
    refreshDetails:()=>loadSelected({silent:true}),
    refreshList:()=>loadList('',{silent:true}),
    canRefresh:()=>dialog.open&&!document.hidden&&navigator.onLine!==false&&!pending,
    onError:()=>setAutoStatus('Atualização indisponível; use Atualizar.',true)
  });
  button.addEventListener('click',()=>{
    if(!dialog.open)dialog.showModal();
    setAutoStatus('Atualização automática ativa');
    autoRefresh?.start();
    loadList().catch(e=>{state.textContent=e.message;setAutoStatus('Atualização indisponível; use Atualizar.',true);});
  });
  dialog.addEventListener('close',()=>autoRefresh?.stop());
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)autoRefresh?.pause();else autoRefresh?.resume();
  });
  window.addEventListener('offline',()=>{autoRefresh?.pause();setAutoStatus('Sem conexão; atualização pausada.');});
  window.addEventListener('online',()=>{setAutoStatus('Atualização automática ativa');autoRefresh?.resume();});
  if(typeof socket!=='undefined')socket.on('connect',()=>autoRefresh?.resume());
  // Do not overwrite the organizer's form during background refreshes.
  for(const field of [adminName,capacity,start])field?.addEventListener('input',()=>{adminEditing=true;});
  // V40.69.8.15 — Resultado completo do torneio dentro do Ranking.
  // A pontuação e a posição são as registradas, sem recalcular o ranking oficial.
  function appendRankingStandings(container,standings){
    if(!Array.isArray(standings)||!standings.length){
      const info=document.createElement('p');info.className='ranking-cup-muted';
      info.textContent='A classificação detalhada não está disponível para esta mesa.';container.append(info);return;
    }
    const table=document.createElement('table');table.className='ranking-cup-table';
    const head=document.createElement('thead');const headRow=document.createElement('tr');
    for(const label of ['Posição','Jogador','Pontos']){
      const cell=document.createElement('th');cell.scope='col';cell.textContent=label;headRow.append(cell);
    }
    head.append(headRow);table.append(head);
    const body=document.createElement('tbody');
    // Não limitar a 5 jogadores; a posição gravada pelo jogo é a fonte de verdade.
    for(const player of standings){
      const row=document.createElement('tr');
      const position=Number(player.position);
      if(position===1)row.className='ranking-cup-first';
      if(player.forfeited)row.className+=' ranking-cup-forfeited';
      const place=document.createElement('td');
      const medal=position===1?'🥇 ':position===2?'🥈 ':position===3?'🥉 ':'';
      place.textContent=medal+(Number.isInteger(position)&&position>0?position+'º':'—');
      const nameCell=document.createElement('td');nameCell.textContent=String(player.name||'Jogador');
      if(player.forfeited){const hint=document.createElement('small');hint.textContent=' · Desclassificado por desistência';nameCell.append(hint);}
      const score=document.createElement('td');score.textContent=Number.isFinite(Number(player.score))?Number(player.score).toLocaleString('pt-BR'):'—';
      row.append(place,nameCell,score);body.append(row);
    }
    table.append(body);container.append(table);
  }
  function renderTournamentRankingResults(target,cup){
    const card=document.createElement('article');card.className='ranking-cup-card';
    const title=document.createElement('h3');title.textContent='🏆 '+String(cup.name||'Torneio');card.append(title);
    const winner=document.createElement('p');winner.className='ranking-cup-winner';
    const names=Array.isArray(cup.champion?.names)?cup.champion.names.map(p=>p.name).join(', '):'';
    winner.textContent=(cup.champion?.names?.length>1?'Campeões: ':'Campeão: ')+(names||'Não identificado');card.append(winner);
    const stageList=Array.isArray(cup.stages)?cup.stages:[];
    const isMultiStage=stageList.length>1;
    const subheading=document.createElement('h4');
    subheading.textContent=isMultiStage?'Classificação da final':'Classificação final do torneio';card.append(subheading);
    appendRankingStandings(card,cup.champion?.standings);
    // Para campeonatos com várias mesas, os resultados anteriores ficam disponíveis
    // por fase. Não criamos uma classificação geral fictícia entre mesas distintas.
    const previous=stageList.filter(stage=>stage.stage!==cup.champion?.stage&&stage.tables?.some(t=>t.result?.results?.length));
    if(previous.length){
      const details=document.createElement('details');details.className='ranking-cup-earlier';
      const summary=document.createElement('summary');summary.textContent='Ver resultados das outras fases';details.append(summary);
      for(const stage of previous){
        const heading=document.createElement('h5');heading.textContent=stage.label||'Fase anterior';details.append(heading);
        for(const table of stage.tables||[]){
          if(!table.result?.results?.length)continue;
          const tableHeading=document.createElement('p');tableHeading.className='ranking-cup-table-label';
          tableHeading.textContent='Mesa '+table.number;details.append(tableHeading);
          appendRankingStandings(details,table.result.results);
        }
      }
      card.append(details);
    }
    target.append(card);
  }
  const champions=document.getElementById('tournamentResultsInfo');
  if(champions)champions.addEventListener('toggle',async()=>{
    if(!champions.open)return;
    const target=document.getElementById('tournamentChampionsList');if(!target)return;
    target.textContent='Consultando campeonatos...';
    try{const response=await request('/api/tournaments/champions');target.replaceChildren();
      if(!response.completed?.length){target.textContent='Nenhum torneio concluído até o momento.';return;}
      for(const cup of response.completed)renderTournamentRankingResults(target,cup);
    }catch(e){target.textContent='Não foi possível consultar os resultados dos torneios.';}
  });
  if(refresh)refresh.addEventListener('click',async()=>{
    if(pending||!picker.value)return;
    refresh.disabled=true;refresh.textContent='Atualizando...';
    try{await loadSelected();}
    catch(e){state.textContent=e.message;}
    finally{refresh.disabled=false;refresh.textContent='↻ Atualizar';}
  });
  close.addEventListener('click',()=>dialog.close());
  picker.addEventListener('change',()=>{
    adminEditing=false;lastSelectedPayload=null;
    loadSelected().catch(e=>state.textContent=e.message);
  });
  action.addEventListener('click',async()=>{
    if(pending||!config||!config.registrationOpen)return;
    setBusy(true);state.textContent='Aguarde...';
    try{await request('/api/tournament/registration',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:config.registered?'leave':'join',tournamentId:config.id})});
      lastSelectedPayload=null;await loadSelected({silent:true});
      // A confirmação é permanente no cartão de programação, não depende de toast.
      if(scheduleMessage&&config?.registered)
        scheduleMessage.textContent=schedule?.state({startAt:config.startAt,registered:true,status:config.status}).message||'Sua inscrição está confirmada.';
    }
    catch(e){state.textContent=e.message;}
    finally{setBusy(false);}
  });
  if(drawButton)drawButton.addEventListener('click',async()=>{
    if(pending||panel.hidden||!config?.canManage||config.status!=='closed'||config.enrolled<2||drawnTables.length)return;
    if(!confirm('Sortear as mesas agora? O sorteio não poderá ser repetido neste torneio.'))return;
    setBusy(true);message.textContent='Sorteando mesas...';
    try{await request('/api/tournaments/'+encodeURIComponent(config.id)+'/draw',{method:'POST'});
      await loadSelected();message.textContent='Mesas sorteadas e salvas.';}
    catch(e){message.textContent=e.message;}finally{setBusy(false);}
  });
  create.addEventListener('click',()=>adminRequest('create'));
  save.addEventListener('click',()=>adminRequest('save'));
  toggle.addEventListener('click',()=>adminRequest('toggle'));
  cancel.addEventListener('click',()=>adminRequest('cancel'));
  if(remove)remove.addEventListener('click',()=>adminRequest('delete'));
  if(forceDeleteTest)forceDeleteTest.addEventListener('click',()=>adminRequest('forceDeleteTest'));
})();

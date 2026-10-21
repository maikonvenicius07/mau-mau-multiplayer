'use strict';
// V51.3 — sorteio de mesas e administração de torneios no menu inicial, sem alterar o motor do jogo.
(() => {
  const byId=id=>document.getElementById(id);
  const button=byId('tournamentOpenHome'),dialog=byId('tournamentDialog'),close=byId('tournamentClose');
  const name=byId('tournamentName'),state=byId('tournamentStatus'),date=byId('tournamentDate');
  const action=byId('tournamentJoin'),list=byId('tournamentPlayers'),picker=byId('tournamentPicker');
  const panel=byId('tournamentAdminPanel'),adminName=byId('tournamentAdminName');
  const capacity=byId('tournamentAdminCapacity'),start=byId('tournamentAdminStart');
  const create=byId('tournamentAdminCreate'),save=byId('tournamentAdminSave');
  const toggle=byId('tournamentAdminToggle'),cancel=byId('tournamentAdminCancel'),message=byId('tournamentAdminMessage');
  const drawButton=byId('tournamentDrawButton'),tablesPanel=byId('tournamentTables'),tablesList=byId('tournamentTableList'),adminHint=byId('tournamentAdminHint');
  if(!button||!dialog||!close||!name||!state||!date||!action||!list||!picker||!panel)return;
  let pending=false,config=null,items=[],drawnTables=[];
  const statusText={draft:'Em preparação',open:'Inscrições abertas',closed:'Inscrições encerradas',cancelled:'Cancelado'};
  function formatDate(v){return v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Porto_Velho',dateStyle:'short',timeStyle:'short'})+' (RO)':'Data ainda não definida';}
  function setBusy(value){pending=value;action.disabled=value||!config?.registrationOpen||(!config?.registered&&config?.spotsRemaining===0);create.disabled=value;for(const btn of [save,toggle,cancel])btn.disabled=value||!config||config.status==='cancelled';
    if(drawButton)drawButton.disabled=value||!config||config.status!=='closed'||config.enrolled<2||drawnTables.length>0;}
  function setFields(t){
    adminName.value=t.name||'';capacity.value=t.capacity||20;
    if(t.startAt){const d=new Date(t.startAt);const inRO=new Date(d.getTime()-4*60*60*1000);start.value=inRO.toISOString().slice(0,16);}
    else start.value='';
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
    if(adminHint)adminHint.hidden=Boolean(result.isAdmin);
    if(tablesPanel&&tablesList){tablesPanel.hidden=drawnTables.length===0;tablesList.replaceChildren();
      for(const t of drawnTables){const card=document.createElement('div');card.className='tournament-table-card';
        const title=document.createElement('h4');title.textContent='Mesa '+t.number+' · '+t.players.length+' jogadores';card.append(title);
        const ol=document.createElement('ol');for(const player of t.players){const li=document.createElement('li');li.textContent=player.name;ol.append(li);}card.append(ol);tablesList.append(card);}
    }
    panel.hidden=!result.isAdmin;
    if(result.isAdmin){setFields(config);toggle.textContent=config.status==='open'?'Encerrar inscrições':'Abrir inscrições';
      toggle.disabled=pending||config.status==='cancelled';save.disabled=pending||config.status==='cancelled';cancel.disabled=pending||config.status==='cancelled';}
    action.disabled=pending||!config.registrationOpen||(!config.registered&&config.spotsRemaining===0);
    if(drawButton)drawButton.disabled=pending||!result.isAdmin||config.status!=='closed'||config.enrolled<2||drawnTables.length>0;
  }
  async function request(url,options={}){
    const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
    const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.message||'Não foi possível concluir a operação.');return data;
  }
  async function loadList(selectId=''){
    const response=await request('/api/tournaments');items=response.tournaments||[];
    picker.replaceChildren();
    for(const t of items){const opt=document.createElement('option');opt.value=t.id;opt.textContent=t.name+' — '+(statusText[t.status]||t.status);picker.append(opt);}
    if(!items.length){const opt=document.createElement('option');opt.textContent='Nenhum torneio cadastrado';opt.value='';picker.append(opt);}
    picker.value=items.some(t=>t.id===selectId)?selectId:(items[0]?.id||'');
    panel.hidden=!response.isAdmin;
    if(adminHint)adminHint.hidden=Boolean(response.isAdmin);
    if(!picker.value){config=null;name.textContent='🏆 Torneios';state.textContent='Nenhum torneio cadastrado.';list.replaceChildren();action.disabled=true;return;}
    await loadSelected();
  }
  async function loadSelected(){if(!picker.value)return;
    state.textContent='Carregando...';const result=await request('/api/tournament?id='+encodeURIComponent(picker.value));render(result);
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
    const payload=kind==='create'?fields():kind==='save'?fields():{status:kind==='cancel'?'cancelled':config.status==='open'?'closed':'open'};
    setBusy(true);message.textContent='Salvando...';
    try{
      const data=await request(kind==='create'?'/api/tournaments':'/api/tournaments/'+encodeURIComponent(config.id),{
        method:kind==='create'?'POST':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      message.textContent=kind==='create'?'Torneio criado. Abra as inscrições quando estiver pronto.':'Alteração salva.';
      await loadList(data.tournament.id);
    }catch(e){message.textContent=e.message;}
    finally{setBusy(false);}
  }
  button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();loadList().catch(e=>state.textContent=e.message);});
  close.addEventListener('click',()=>dialog.close());
  picker.addEventListener('change',()=>loadSelected().catch(e=>state.textContent=e.message));
  action.addEventListener('click',async()=>{
    if(pending||!config||!config.registrationOpen)return;
    setBusy(true);state.textContent='Aguarde...';
    try{const data=await request('/api/tournament/registration',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:config.registered?'leave':'join',tournamentId:config.id})});render(data);}
    catch(e){state.textContent=e.message;}
    finally{setBusy(false);}
  });
  if(drawButton)drawButton.addEventListener('click',async()=>{
    if(pending||panel.hidden||!config||config.status!=='closed'||config.enrolled<2||drawnTables.length)return;
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
})();

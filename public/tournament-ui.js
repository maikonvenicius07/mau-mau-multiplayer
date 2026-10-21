'use strict';
// V51.1.1 — inscrição simples acessível pelo menu inicial, sem alterar as regras.
(() => {
  const button=document.getElementById('tournamentOpenHome');
  const dialog=document.getElementById('tournamentDialog');
  const close=document.getElementById('tournamentClose');
  const name=document.getElementById('tournamentName');
  const state=document.getElementById('tournamentStatus');
  const date=document.getElementById('tournamentDate');
  const action=document.getElementById('tournamentJoin');
  const list=document.getElementById('tournamentPlayers');
  if(!button||!dialog||!close||!name||!state||!date||!action||!list)return;
  let pending=false;
  let config=null;
  function render(result){
    config=result.tournament;
    name.textContent=config.name;
    state.textContent=`${config.enrolled} de ${config.capacity} inscritos • ${config.registrationOpen?'Inscrições abertas':'Inscrições fechadas'}`;
    date.textContent=config.startAt ? `Início previsto: ${new Date(config.startAt).toLocaleString('pt-BR',{timeZone:'America/Porto_Velho',dateStyle:'short',timeStyle:'short'})} (RO)` : 'Data do torneio ainda não definida';
    list.replaceChildren();
    if(!result.players?.length){const li=document.createElement('li');li.textContent='Nenhum jogador inscrito ainda.';list.append(li);}
    for(const p of result.players||[]){const li=document.createElement('li');li.textContent=p.name;list.append(li);}
    action.textContent=config.registered?'Cancelar minha inscrição':'Inscrever-me';
    action.disabled=pending||!config.registrationOpen||(!config.registered&&config.spotsRemaining===0);
    if(!config.registrationOpen)action.textContent='Aguardando abertura das inscrições';
    else if(!config.registered&&config.spotsRemaining===0)action.textContent='Vagas esgotadas';
  }
  async function fetchData(){
    state.textContent='Carregando...';
    const res=await fetch('/api/tournament',{credentials:'same-origin',cache:'no-store'});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.message||'Não foi possível consultar.');
    render(data);
  }
  button.addEventListener('click',()=>{
    if(!dialog.open)dialog.showModal();
    fetchData().catch(e=>state.textContent=e.message);
  });
  close.addEventListener('click',()=>dialog.close());
  action.addEventListener('click',async()=>{
    if(pending||!config||!config.registrationOpen)return;
    pending=true;action.disabled=true;state.textContent='Aguarde...';
    try{
      const res=await fetch('/api/tournament/registration',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:config.registered?'leave':'join'})
      });
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.message||'Não foi possível atualizar a inscrição.');
      render(data);
    }catch(e){state.textContent=e.message;}
    finally{pending=false;if(config?.registrationOpen)action.disabled=!!(!config.registered&&config.spotsRemaining===0);}
  });
})();

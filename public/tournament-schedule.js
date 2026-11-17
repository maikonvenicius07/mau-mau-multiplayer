'use strict';
// V40.69.8.23 — datas públicas em horário de Rondônia e contagem ancorada no servidor.
// O relógio é APENAS informativo: não altera início manual ou cronômetro da mesa.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MauMauTournamentSchedule=api;
})(typeof window!=='undefined'?window:null,function(){
  const ZONE='America/Porto_Velho';
  const ZONE_LABEL='Horário de Rondônia (UTC−04)';
  function timestamp(value){
    if(!value)return null;
    const result=Date.parse(String(value));
    return Number.isFinite(result)?result:null;
  }
  function format(value){
    const t=timestamp(value);
    if(t===null)return null;
    const parts=new Intl.DateTimeFormat('pt-BR',{
      timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date(t));
    const f=type=>parts.find(p=>p.type===type)?.value||'';
    return {date:`${f('day')}/${f('month')}/${f('year')}`,
      time:`${f('hour')}h${f('minute')}`,zone:ZONE_LABEL};
  }
  function countdown(targetMs,nowMs){
    if(!Number.isFinite(targetMs)||!Number.isFinite(nowMs))return null;
    const seconds=Math.max(0,Math.ceil((targetMs-nowMs)/1000));
    const day=Math.floor(seconds/86400),hour=Math.floor((seconds%86400)/3600),
      minute=Math.floor((seconds%3600)/60),second=seconds%60;
    const pad=n=>String(n).padStart(2,'0');
    return {seconds,expired:seconds===0,
      text:(day?`${day}d `:'')+`${pad(hour)}h ${pad(minute)}min ${pad(second)}s`};
  }
  function clock(monotonicNow){
    let base=null,received=null;
    const current=typeof monotonicNow==='function'?monotonicNow:()=>performance.now();
    return {
      sync(serverNow){
        const value=Number(serverNow);
        if(!Number.isFinite(value)||value<=0)return false;
        base=value;received=current();return true;
      },
      now(){return base===null?null:base+Math.max(0,current()-received);},
      ready(){return base!==null;}
    };
  }
  function state({startAt,status,registered,started=false,finished=false,nowMs=null}={}){
    const date=format(startAt),target=timestamp(startAt);
    const timer=target!==null&&Number.isFinite(nowMs)?countdown(target,nowMs):null;
    const statusLabel=finished?'Finalizado':status==='cancelled'?'Cancelado':started?'Em andamento':
      status==='closed'?'Aguardando início':status==='open'?'Inscrições abertas':'Em preparação';
    const registrationLabel=registered?'Confirmada':status==='open'?'Não inscrito':'Não inscrito / indisponível';
    const message=registered?(date?
      `Você está inscrito neste torneio. O início está programado para ${date.time} (${ZONE_LABEL}). Esteja disponível no horário informado.`:
      'Sua inscrição está confirmada. O organizador ainda não definiu a data e o horário.'):
      date?`Início previsto para ${date.date}, às ${date.time} (${ZONE_LABEL}).`:
        'O organizador ainda não definiu a data e o horário.';
    return {date,timer,statusLabel,registrationLabel,message};
  }
  return {ZONE,ZONE_LABEL,timestamp,format,countdown,clock,state};
});

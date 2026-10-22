/* V51.6 - Painel leve de acompanhamento. Apenas dados públicos e resultados consolidados. */
(function(root,factory){
  const value=factory();
  if(typeof module==='object'&&module.exports)module.exports=value;
  else root.MauMauTournamentDashboard=value;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const LABELS={qualifier:'Classificatórias',quarter:'Quartas de final',semi:'Semifinais',final:'Grande final'};
  function tableStatus(table,game={}){
    if(table.finished||game.finished)return 'finished';
    if(game.liveStatus==='playing'||game.liveStatus==='between-rounds')return 'playing';
    if(game.liveStatus==='lobby')return 'lobby';
    if(table.created||game.created)return 'created';
    return 'waiting';
  }
  const STATUS_LABEL={finished:'Concluída',playing:'Em andamento',lobby:'Aguardando início',created:'Sala criada',waiting:'Aguardando jogadores'};
  function summarize({bracket,currentStage='qualifier',currentTables=[],games={}}={}){
    let stages=Array.isArray(bracket?.stages)?bracket.stages.filter(s=>Array.isArray(s.tables)&&s.tables.length):[];
    if(currentTables.length){
      const current=stages.find(s=>s.stage===currentStage);
      if(current){
        // Results are created one-by-one; keep not-yet-played tables visible.
        const recorded=new Map(current.tables.map(t=>[t.number,t]));
        stages=stages.map(s=>s!==current?s:{...s,tables:currentTables.map(t=>recorded.get(t.number)||t)});
      }else stages.push({stage:currentStage,label:LABELS[currentStage],tables:currentTables});
    }
    return stages.map(stage=>{
      const isCurrent=stage.stage===currentStage;
      const tables=stage.tables.map(t=>{
        const status=tableStatus(t,isCurrent?games[t.number]:{});
        const result=t.result||((isCurrent?games[t.number]:{})||{}).result||null;
        return {number:t.number,status,label:STATUS_LABEL[status],players:t.players||[],result,
          connectedPlayers:isCurrent?games[t.number]?.connectedPlayers:null,
          expectedPlayers:isCurrent?games[t.number]?.expectedPlayers:null};
      });
      const finished=tables.filter(t=>t.status==='finished').length;
      const active=tables.filter(t=>t.status==='playing').length;
      return {stage:stage.stage,label:stage.label||LABELS[stage.stage]||stage.stage,tables,finished,active,
        total:tables.length,completed:finished===tables.length};
    });
  }
  return {LABELS,STATUS_LABEL,tableStatus,summarize};
});

'use strict';
// V40.69.8.22 — regra pura de liberação manual do início. O horário vem do sorteio/criação da fase
// persistido, nunca do relógio da aba nem da entrada/reconexão de um jogador.
const WAIT_MS=2*60*1000;
function timestamp(value){
  if(value instanceof Date)return value.getTime();
  if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value))return Date.parse(value)||0;
  const n=Number(value);return Number.isFinite(n)&&n>0?n:0;
}
function deadlineAt(value){const ms=timestamp(value);return ms>0?ms+WAIT_MS:null;}
function decide({roster=[],present=[],deadline=null,now=Date.now(),started=false}={}){
  const keys=new Set(roster.map(p=>p.playerKey).filter(Boolean));
  const presentKeys=new Set(present.filter(k=>keys.has(k)));
  const missing=roster.filter(p=>!presentKeys.has(p.playerKey));
  const expired=Number.isFinite(Number(deadline))&&Number(deadline)>0&&now>=Number(deadline);
  const full=keys.size>=2&&missing.length===0&&presentKeys.size===keys.size;
  if(started)return {action:'already-started',present:presentKeys.size,expected:keys.size,missing,expired};
  if(full)return {action:'ready',present:presentKeys.size,expected:keys.size,missing,expired};
  if(!expired)return {action:'wait',present:presentKeys.size,expected:keys.size,missing,expired};
  if(presentKeys.size>=2)return {action:'ready',present:presentKeys.size,expected:keys.size,missing,expired};
  if(presentKeys.size===1)return {action:'needs-attention',present:1,expected:keys.size,missing,expired};
  // Sem concorrente, não há vencedor legítimo: não inventar classificação.
  return {action:'needs-attention',present:0,expected:keys.size,missing,expired};
}
module.exports={WAIT_MS,timestamp,deadlineAt,decide};

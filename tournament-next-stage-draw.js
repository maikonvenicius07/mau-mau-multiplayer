'use strict';
// Novo sorteio a cada fase com mais de uma mesa. O resultado persistido nunca
// é embaralhado novamente; esta validação não modifica critérios de avanço.
const {distribute}=require('./tournament-draw');

function fail(message){return Object.assign(new Error(message),{status:409});}

function planNextStageDraw(qualified, randomInt){
  if(!Array.isArray(qualified)||qualified.length<2)
    throw fail('A fase seguinte não possui pelo menos dois classificados elegíveis. Verifique as desistências.');
  const keys=qualified.map(p=>p?.playerKey);
  if(keys.some(key=>typeof key!=='string'||!key)||new Set(keys).size!==keys.length)
    throw fail('Há classificação duplicada ou sem identificação. O sorteio foi bloqueado.');
  // Mesa única: todos os classificados já jogam juntos, sem sorteio desnecessário.
  const tables=qualified.length<=5
    ? [{number:1,players:qualified.map((p,i)=>({playerKey:p.playerKey,name:p.name,seat:i+1}))}]
    : distribute(qualified,randomInt);
  assertDrawIntegrity(tables,qualified);
  return tables;
}

function assertDrawIntegrity(tables,qualified){
  if(!Array.isArray(tables)||!Array.isArray(qualified)||!qualified.length)
    throw fail('Sorteio da fase inválido.');
  const expected=Math.ceil(qualified.length/5);
  if(tables.length!==expected)throw fail('Quantidade de mesas incompatível com os classificados.');
  const known=new Set(qualified.map(p=>p.playerKey)),seen=new Set();
  const sizes=[];
  tables.forEach((table,i)=>{
    if(table.number!==i+1||!Array.isArray(table.players)||table.players.length<2||table.players.length>5)
      throw fail('Mesa inválida no sorteio da próxima fase.');
    sizes.push(table.players.length);
    table.players.forEach((p,seat)=>{
      if(!known.has(p.playerKey)||seen.has(p.playerKey)||p.seat!==seat+1)
        throw fail('Sorteio inválido: vaga duplicada, ausente ou atribuída a outro jogador.');
      seen.add(p.playerKey);
    });
  });
  if(seen.size!==qualified.length||Math.max(...sizes)-Math.min(...sizes)>1)
    throw fail('Sorteio incompleto ou mesas desbalanceadas.');
  return true;
}

// Quando a fase já existe, NÃO repetir o sorteio (inclusive em caso de empate
// no limite, cujo desempate é aleatório). Validar pela origem de cada vaga.
function assertExistingStageDraw(previousTables,quota,existingTables){
  const eligible=[];
  const sources=new Map();
  let expected=0;
  for(const table of previousTables){
    const players=table.result.results.filter(p=>!p.forfeited);
    const keys=new Set(players.map(p=>p.playerKey));
    sources.set(table.number,{keys,quota:Math.min(quota,players.length),count:0});
    expected+=Math.min(quota,players.length);
    eligible.push(...players);
  }
  if(expected<2)throw fail('Não há classificados suficientes para continuar o torneio.');
  const found=existingTables.flatMap(table=>table.players);
  if(found.length!==expected)throw fail('Fase sorteada parcialmente: número de vagas incompatível. Não refaça o sorteio.');
  // Uma chave só pertence a uma mesa anterior; garante a quota POR mesa de origem.
  const origin=new Map();
  for(const [number,entry] of sources){
    for(const key of entry.keys){if(origin.has(key))throw fail('Jogador duplicado na fase anterior.');origin.set(key,number);}
  }
  for(const p of found){
    const number=origin.get(p.playerKey);
    if(number===undefined)throw fail('Jogador não classificado encontrado na nova fase.');
    sources.get(number).count++;
  }
  for(const entry of sources.values())if(entry.count!==entry.quota)
    throw fail('Distribuição da fase não respeita a classificação de cada mesa anterior.');
  assertDrawIntegrity(existingTables,found);
  return true;
}
module.exports={planNextStageDraw,assertDrawIntegrity,assertExistingStageDraw};

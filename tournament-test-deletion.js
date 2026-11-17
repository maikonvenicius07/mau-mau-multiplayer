'use strict';
// V40.69.8.28 — explicit clean-up of an owner's TEST tournament, never automatic.
const CONFIRMATION='EXCLUIR TORNEIO TESTE';
function isTestName(name){return /(?:^|[\s_-])teste(?:$|[\s_-])/i.test(String(name||''));}
function verify({name,status,owner,confirmation}){
  const fail=message=>{throw Object.assign(new Error(message),{status:403});};
  if(!owner)fail('Somente o criador pode excluir um torneio de teste travado.');
  if(!isTestName(name))fail('A exclusão excepcional é exclusiva de torneios identificados como TESTE.');
  if(!['closed','cancelled'].includes(status))fail('Encerre as inscrições antes de excluir este torneio de teste.');
  if(confirmation!==CONFIRMATION)fail('Confirmação obrigatória não informada.');
  return true;
}
module.exports={CONFIRMATION,isTestName,verify};

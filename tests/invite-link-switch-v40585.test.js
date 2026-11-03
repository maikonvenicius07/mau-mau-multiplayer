'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(app.includes("joinRoomByCode(code,{fromLink:true})"),'botão do convite por link deve usar o fluxo explícito de link');
assert(app.includes("switchIntent:fromLink?'link':null"),'cliente deve preservar a indicação de que a entrada veio de link');
const inviteBranchStart=app.indexOf("if(urlRoom&&(!sess?.code||sess.code!==urlRoom)){");
assert(inviteBranchStart>=0,'ramo de URL para sala diferente ausente');
const inviteBranch=app.slice(inviteBranchStart,inviteBranchStart+650);
assert(inviteBranch.includes('accountSeatResumePending=false'),'link de sala diferente deve impedir auto-resume antigo antes da confirmação');
assert(!inviteBranch.includes("socket.emit('resumeActiveSeat')"),'link diferente não pode retomar automaticamente a sala velha');
assert(server.includes('prepareForRoomSwitch(socket,code);'),'entrada efetiva via código/link deve passar pelo ciclo comum de troca de sala');
assert(server.includes('abandonOtherPlayerMembershipsForSwitch(socket,exceptCode'),'troca confirmada deve cancelar vínculos antigos');
assert(server.includes('requireNoOtherActivePlayerRoom(socket,exceptCode);'),'servidor deve confirmar que restou somente a sala escolhida');
console.log('✓ V40.59: link de outra sala tem prioridade e, após confirmação, cancela a reconexão automática da sala anterior.');

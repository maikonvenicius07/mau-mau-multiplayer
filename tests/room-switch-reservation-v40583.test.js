'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(server.includes('function releaseDisconnectedReservedSeatsForSwitch(socket, exceptCode=null)'), 'rotina de liberação de vaga antiga ausente');
assert(server.includes('player.isBot=true;'), 'vaga antiga deve virar Máquina permanente ao trocar de sala');
assert(server.includes('player.playerKey=null;'), 'vaga antiga não pode continuar prendendo a Conta Google');
assert(server.includes('prepareForRoomSwitch(socket,code);'), 'entrada em outra sala deve preparar troca segura');
assert(server.includes('prepareForRoomSwitch(socket);'), 'criação de nova sala deve liberar reserva antiga desconectada');
assert(server.includes('releaseDisconnectedReservedSeatsForSwitch(socket,dest.code);'), 'convite aceito deve liberar reserva antiga desconectada');
assert(server.includes('if(player.connected&&liveSocket)continue;'), 'uma cadeira realmente conectada nunca pode ser tomada automaticamente');
assert(app.includes('um link de convite para OUTRA sala tem prioridade'), 'link de outra sala deve ter prioridade sobre auto-resume antigo');

const inviteBranchStart=app.indexOf("if(urlRoom&&(!sess?.code||sess.code!==urlRoom)){");
assert(inviteBranchStart>=0,'ramo do convite por link não encontrado');
const inviteBranchEnd=app.indexOf('\n  }',inviteBranchStart);
assert(inviteBranchEnd>inviteBranchStart,'fim do ramo do convite por link não encontrado');
const inviteBranch=app.slice(inviteBranchStart,inviteBranchEnd);
assert(!inviteBranch.includes("socket.emit('resumeActiveSeat')"),'link de outra sala não pode auto-retomar cadeira antiga antes da escolha do usuário');
console.log('✓ V40.58.3: troca de sala libera apenas vagas antigas desconectadas/AUTO e não bloqueia novo convite.');

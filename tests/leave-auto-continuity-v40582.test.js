'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(server.includes("await abandonHumanSeatDurably(room,leaving,{reason:'saiu voluntariamente da sala',socket});"),'SAIR deve abandonar definitivamente a vaga humana com confirmação durável');
assert(server.includes('convertHumanSeatToPermanentBot(room,player,reason);'),'em rodada ativa, a cadeira deve virar Máquina comum para preservar a partida dos demais');
assert(server.includes('RoomLifecycle.removeHumanSeat(room,player.id);'),'fora de rodada ativa, o humano deve ser removido da sala');
assert(server.includes('if(deleteRoomIfNoHumanMembers(room))return {changed:true,deleted:true};'),'último humano que sai deve provocar exclusão da sala');
assert(!server.includes("socket.emit('leftRoom',{keepSeat:true"),'SAIR não pode preservar reserva de reconexão');
assert(!server.includes('if (wasPlaying) cancelCurrentRoundAfterLeave'),'SAIR de um jogador não deve reiniciar/cancelar a rodada dos demais');
assert(app.includes('sua reserva de reconexão será cancelada'),'confirmação deve explicar que SAIR cancela a reconexão automática');
assert(app.includes('clearSession();\n  returnToLanding'),'cliente deve apagar o token/código local depois da saída voluntária confirmada');
console.log('✓ V40.59: SAIR é abandono definitivo; a mesa dos demais continua com Máquina comum e a reserva automática é cancelada.');

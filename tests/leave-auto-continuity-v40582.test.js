'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(server.includes("await abandonHumanSeatDurably(room,leaving,{reason:room.tournament?'abandonou definitivamente o torneio':'saiu voluntariamente da sala',socket});"),'sala comum mantém abandono definitivo; torneio exige abandono explícito');
assert(server.includes('convertHumanSeatToPermanentBot(room,player,reason);'),'em rodada ativa, a cadeira deve virar Máquina comum para preservar a partida dos demais');
assert(server.includes('RoomLifecycle.removeHumanSeat(room,player.id);'),'fora de rodada ativa, o humano deve ser removido da sala');
assert(server.includes('if(deleteRoomIfNoHumanMembers(room))return {changed:true,deleted:true};'),'último humano que sai deve provocar exclusão da sala');
assert(server.includes("if(room.tournament&&mode==='temporary')"),'SAIR DA MESA em torneio deve preservar reserva de reconexão');
assert(!server.includes('if (wasPlaying) cancelCurrentRoundAfterLeave'),'SAIR de um jogador não deve reiniciar/cancelar a rodada dos demais');
assert(app.includes('uma Máquina poderá assumir sua vaga'),'sala normal continua explicando a troca por Máquina');
assert(app.includes('else clearSession();'),'cliente apaga token apenas em saída definitiva');
console.log('✓ V40.59/V40.69.8.48: sala normal mantém abandono definitivo; torneio diferencia saída temporária e definitiva.');

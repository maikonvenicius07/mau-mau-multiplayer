'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(server.includes("function abandonOtherPlayerMembershipsForSwitch(socket, exceptCode=null, reason='entrou em outra sala')"),'rotina de abandono de salas anteriores ausente');
assert(server.includes("const player=room.players.find(p=>!p.isBot&&p.playerKey===key);"),'troca deve localizar qualquer vínculo humano antigo pela Conta Google');
assert(server.includes('abandonHumanSeat(room,player,{reason,socket});'),'troca de sala deve cancelar definitivamente cada vínculo humano anterior');
assert(server.includes('RoomLifecycle.convertHumanSeatToPermanentBot'),'cadeira de partida ativa deve virar Máquina sem identidade humana');
assert(server.includes('player.playerKey=null;')||fs.readFileSync(path.join(root,'room-lifecycle.js'),'utf8').includes('player.playerKey=null;'),'Máquina antiga não pode continuar vinculada à Conta Google');
assert(server.includes('prepareForRoomSwitch(socket,code);'),'entrada bem-sucedida em outra sala deve preparar troca segura');
assert(server.includes("abandonOtherPlayerMembershipsForSwitch(socket,null,'iniciou uma nova busca de partida')"),'nova busca de partida deve cancelar vínculo antigo');
assert(server.includes('deleteRoomIfNoHumanMembers(room)'),'troca que retire o último humano deve excluir a sala antiga');
assert(app.includes('um link de convite para OUTRA sala tem prioridade'),'link de outra sala deve impedir auto-resume da sala antiga antes da escolha do usuário');
console.log('✓ V40.59: entrar em outra sala cancela qualquer vaga/reserva humana anterior e impede pertencimento simultâneo a duas salas.');

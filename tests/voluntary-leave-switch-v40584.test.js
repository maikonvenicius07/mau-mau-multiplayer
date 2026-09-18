'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const life=fs.readFileSync(path.join(root,'room-lifecycle.js'),'utf8');

assert(server.includes("socket.on('leaveRoom', async (ack) =>"),'leaveRoom deve aceitar confirmação do servidor');
assert(server.includes("confirmLeave({keepSeat:false,roomCode:code});"),'servidor deve confirmar que a vaga não ficou reservada');
assert(server.includes("socket.on('abandonReservedSeat'"),'SAIR clicado offline deve poder ser confirmado ao recuperar conexão');
assert(life.includes('player.reconnectEligible=false;'),'abandono voluntário deve limpar elegibilidade de reconexão');
assert(life.includes('player.playerKey=null;'),'cadeira convertida em Máquina deve perder a identidade Google');
assert(app.includes("socket.timeout(5000).emit('leaveRoom'"),'cliente deve aguardar confirmação real do SAIR');
assert(app.includes("btn.textContent='⏳ Saindo...'"),'interface deve indicar saída em andamento');
assert(app.includes('pendingVoluntaryLeaveKey'),'SAIR enquanto offline deve ser persistido como intenção voluntária');
assert(app.includes("socket.timeout(5000).emit('abandonReservedSeat'"),'na reconexão, intenção offline deve cancelar a reserva antes de auto-resume');
console.log('✓ V40.59: saída voluntária online/offline cancela a reserva, limpa a identidade da vaga e exige código para voltar.');

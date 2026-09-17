'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(server.includes('player.voluntaryLeftAt=Date.now();'),'saída voluntária deve ser marcada explicitamente no servidor');
assert(server.includes('const voluntaryLeft=Number(player.voluntaryLeftAt||0)>0;'),'troca de sala deve reconhecer a saída voluntária');
assert(server.includes('if(player.connected&&liveSocket&&!voluntaryLeft)continue;'),'socket antigo não pode bloquear uma saída voluntária já confirmada');
assert(server.includes('player.voluntaryLeftAt=null;'),'vaga convertida/reconectada deve limpar a marca de saída');
assert(server.includes("socket.on('leaveRoom', (ack) =>"),'leaveRoom deve aceitar confirmação do servidor');
assert(server.includes("ack({ok:true"),'servidor deve confirmar saída bem-sucedida');
assert(app.includes("socket.timeout(5000).emit('leaveRoom'"),'cliente deve aguardar confirmação de saída');
assert(app.includes("btn.textContent='⏳ Saindo...'"),'interface deve indicar saída em andamento');
assert(app.includes('leaveRoomPending=false;'),'estado de saída deve ser liberado ao receber leftRoom');
console.log('✓ V40.58.5: saída voluntária é confirmada, resiliente a socket antigo e libera troca de sala sem perder continuidade por Máquina.');

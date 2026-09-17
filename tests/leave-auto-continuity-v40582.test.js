'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(server.includes('function handoffActiveSeatToAuto(room, player)'), 'handoff AUTO da saída voluntária ausente');
assert(server.includes('player.autoControlled=true;'), 'saída voluntária deve marcar a cadeira humana como AUTO');
assert(server.includes("socket.emit('leftRoom',{keepSeat:true"), 'saída ativa deve preservar sessão/cadeira para retorno');
assert(!server.includes('if (wasPlaying) cancelCurrentRoundAfterLeave'), 'saída voluntária não pode mais cancelar a rodada');
assert(app.includes('A Máquina assumirá sua vaga e a partida continuará normalmente'), 'confirmação de saída ainda não explica continuidade com AUTO');
assert(app.includes("if(!data?.keepSeat)clearSession();"), 'cliente deve preservar código/token quando a cadeira fica em AUTO');
console.log('✓ V40.58.4: sair durante partida preserva cadeira/mão e entrega a vaga à Máquina sem reiniciar a rodada.');

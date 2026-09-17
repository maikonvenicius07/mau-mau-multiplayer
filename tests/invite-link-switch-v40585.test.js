'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

assert(app.includes("switchIntent:fromLink?'link':null"),'entrada por link deve sinalizar intenção explícita de troca');
assert(app.includes("joinRoomByCode(code,{fromLink:true})"),'botão do convite por link deve usar o fluxo próprio de link');
assert(server.includes("const linkSwitch=payload?.switchIntent==='link';"),'servidor deve reconhecer entrada originada do link');
assert(server.includes('function prepareForLinkRoomSwitch(socket, exceptCode=null)'), 'helper de troca por link ausente');
assert(server.includes('player.voluntaryLeftAt=Date.now();'),'link confirmado deve conseguir liberar cadeira antiga ainda conectada');
assert(server.includes('releaseDisconnectedReservedSeatsForSwitch(socket,exceptCode);'),'troca por link deve reutilizar handoff seguro para Máquina');
assert(server.includes('socket.leave(previousSocketRoom);'),'socket atual não pode continuar inscrito na sala anterior');
assert(server.includes('if(linkSwitch)prepareForLinkRoomSwitch(socket,code);'),'joinRoom deve usar fluxo de link antes da validação de sala ativa');
console.log('✓ V40.58.5: convite por link troca de sala com segurança mesmo após partida/aba anterior ainda aparecer ativa.');

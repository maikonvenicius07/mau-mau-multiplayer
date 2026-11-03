'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Retention=require('../retention-policy');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');

assert.strictEqual(Retention.ALL_HUMANS_OFFLINE_EXPIRY_MS,5*60*1000,'regra dos 5 minutos totalmente offline deve ser preservada');

assert(server.includes('connectedTransfer=!!(player.connected&&liveSocket)'), 'reconexão precisa reconhecer a microjanela em que o socket antigo ainda está vivo');
assert(server.includes("retireReplacedSocket(player.socketId,{roomCode:room.code})"), 'socket antigo deve ser aposentado quando a mesma conta reassume a cadeira');
assert(server.includes("socket.emit('roomSwitchRequired'"), 'servidor deve solicitar confirmação antes de trocar de sala');
assert(server.includes("action:'join-room'"), 'entrada manual em outra sala deve exigir confirmação');
assert(server.includes("action:'create-room'"), 'criação de nova sala com cadeira ativa deve exigir confirmação');
assert(server.includes("action:'join-spectator'"), 'entrada como observador em outra sala deve exigir confirmação');
assert(server.includes("action:'accept-invite'"), 'convite com entrada imediata deve exigir confirmação');
assert(server.includes("action:'claim-invite'"), 'ocupação de vaga reservada por convite deve exigir confirmação');
assert(server.includes("await abandonOtherPlayerMembershipsForSwitch"), 'abandono voluntário continua centralizado no servidor');

assert(app.includes('!priorRoomSession.playerKey&&user?.playerKey'), 'sessão local legada sem playerKey deve ser migrada em vez de apagada no refresh');
assert(app.includes("socket.on('roomSwitchRequired'"), 'frontend deve abrir a confirmação enviada pelo servidor');
assert(app.includes("socket.emit('resumeActiveSeat')"), 'opção de voltar deve retomar a sala antiga');
assert(app.includes('accountSeatResumeAttempts<2'), 'cliente deve repetir a busca da cadeira por uma pequena janela de corrida');
assert(html.includes('id="roomSwitchDialog"'), 'diálogo de confirmação de troca de sala deve existir');
assert(html.includes('id="roomSwitchReturnBtn"'), 'diálogo deve oferecer VOLTAR À PARTIDA');
assert(html.includes('id="roomSwitchContinueBtn"'), 'diálogo deve oferecer SAIR E CONTINUAR');

console.log('✓ PRE-APK: F5 preserva identidade/cadeira, troca de sala exige confirmação e regra offline de 5 minutos foi mantida.');

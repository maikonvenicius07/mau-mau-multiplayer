
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const pkg=require(path.join(root,'package.json'));

assert.ok(/^40\./.test(pkg.version));
assert(app.includes('LIVE_VOICE_RELAY_SAMPLE_RATE=16000'),'relay deve usar voz mono 16 kHz');
assert(app.includes("socket.volatile.emit('liveVoiceRelayPcm'"),'cliente não envia relay de compatibilidade em modo volatile');
assert(app.includes("socket.on('liveVoiceRelayPcm',playLiveVoiceRelayPcm)"),'cliente não reproduz relay do observador');
assert(app.includes("if(isSpectatorState()||peer?.role==='SPECTATOR')return"),'WebRTC P2P ainda está sendo usado no caminho do observador');
assert(app.includes('Number(state?.spectatorCount||0)>0'),'jogador não ativa relay quando há observador na mesa');
assert(app.includes("document.addEventListener('pointerdown',()=>{audioCtx();"),'toque na tela deve reativar a saída de áudio do relay');
assert(server.includes("socket.on('liveVoiceRelayPcm'"),'servidor não recebe PCM do relay');
assert(server.includes('actor.role===ROLE_SPECTATOR'),'servidor não diferencia voz do observador');
assert(server.includes('Player → somente observadores'),'relay de jogador deve ser direcionado somente aos observadores');
assert(server.includes('pcm.length>16000'),'relay não limita tamanho dos pacotes');
assert(app.includes("LIVE_VOICE_RELAY_CODEC='mulaw8'"),'relay leve mulaw8 ausente');
assert(server.includes('liveVoiceRelayAllowed'),'relay não possui limite de taxa');
console.log('✓ V40.50: voz envolvendo observador usa relay leve/volatile pelo servidor, sem depender de P2P/TURN.');

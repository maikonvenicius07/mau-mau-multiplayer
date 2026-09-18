'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const pkg=require(path.join(root,'package.json'));

assert.strictEqual(pkg.version,'40.60.0');
assert(html.includes('app.js?v=40.60.0')&&html.includes('styles.css?v=40.60.0'),'cache-busting V40.58.4 ausente');

// Arquivos/configuração recuperados da V40.56/V40.54.1.
for(const rel of ['.node-version','.npmrc','.github/workflows/verify.yml']){
  assert(fs.existsSync(path.join(root,rel)),`${rel} precisa existir`);
}
assert(env.includes('ROOM_SNAPSHOT_TTL_MS=28800000'),'ROOM_SNAPSHOT_TTL_MS ausente');
assert(env.includes('VOICE_TURN_SECRET='),'VOICE_TURN_SECRET ausente');
assert(env.includes('VOICE_TURN_TTL_SECONDS=3600'),'VOICE_TURN_TTL_SECONDS ausente');

// Socket antigo deve ser aposentado de verdade, não apenas avisado.
assert(server.includes('function retireReplacedSocket(socketId,{roomCode=null}={})'),'helper de encerramento do socket substituído ausente');
assert(server.includes("stale.emit('sessionReplaced')"),'socket antigo deve receber aviso de substituição');
assert(server.includes('stale.data.roomCode=null'),'socket antigo deve perder vínculo com a sala');
assert(server.includes('stale.data.playerId=null'),'socket antigo deve perder identidade de jogador');
assert(server.includes('stale.data.spectatorId=null'),'socket antigo deve perder identidade de observador');
assert(server.includes('stale.disconnect(true)'),'socket antigo deve ser desconectado pelo servidor');
assert(!/io\.to\([^\n]+\)\.emit\('sessionReplaced'\)/.test(server),'não deve restar substituição que apenas avise sem aposentar o socket');

// Chat/efeitos/áudio rápido só podem usar o socket proprietário atual.
assert(server.includes('spectator&&spectator.connected&&spectator.socketId===socket.id'),'observador social precisa validar socket atual');
assert(server.includes('player&&player.connected&&!player.isBot&&player.socketId===socket.id'),'jogador social precisa validar socket atual');
assert(server.includes("!player || !player.connected || player.isBot || player.socketId !== socket.id"),'Áudio Rápido precisa validar socket atual');

// Partida ativa não pode expirar pela regra histórica de 6 horas.
assert(server.includes("const activeMatch=room.status==='playing' || (room.status==='between-rounds' && Number(room.round||0)>0)"),'detecção de partida ativa ausente na limpeza');
assert(server.includes('if(!activeMatch && allHumansGone && now-room.createdAt>6*60*60*1000)'),'limpeza de 6 h não pode remover partida ativa');

console.log('✓ V40.60.0: deploy restaurado, socket substituído encerrado e partida ativa preservada sem limite de 6 h.');

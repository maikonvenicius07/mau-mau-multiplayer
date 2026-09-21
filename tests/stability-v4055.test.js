'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..');
const pkg=require('../package.json');
const Engine=require('../game-engine');
const {buildRoomSnapshot,hydrateSnapshotAvatars}=require('../room-snapshot-store');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const snapshots=fs.readFileSync(path.join(root,'room-snapshot-store.js'),'utf8');

assert.strictEqual(pkg.version,'40.69');
assert(server.includes('connectionStateRecovery'),'Connection State Recovery do Socket.IO ausente');
assert(server.includes('maxDisconnectionDuration: RetentionPolicy.RECONNECT_GRACE_MS')||server.includes('maxDisconnectionDuration: 60 * 1000'),'janela nativa de recuperação deve ser 60 s');
assert(server.includes('skipMiddlewares: false'),'autenticação deve ser revalidada na recuperação');
assert(server.includes('if(!socket.recovered)'),'dados recuperados do socket estão sendo apagados');
assert(/maxHttpBufferSize:\s*400000/.test(server),'limite global de pacote não foi reduzido para 400 KB');
assert(/QUICK_AUDIO_MAX_BYTES\s*=\s*250\s*\*\s*1024/.test(server),'servidor ainda aceita Áudio Rápido acima de 250 KB');
assert(/QUICK_AUDIO_MAX_BYTES=250\*1024/.test(app),'cliente ainda aceita Áudio Rápido acima de 250 KB');

const data='data:image/webp;base64,'+Buffer.alloc(60000,7).toString('base64');
const room=Engine.createRoom('STAB55',{socketId:'a',token:'ta',name:'A',avatar:data,playerKey:'g_a'});
Engine.addPlayer(room,{socketId:'b',token:'tb',name:'B',avatar:data,playerKey:'g_b'});
room.chat=[{id:'c1',avatar:data,text:'oi'}];
room.roundReview={id:'r1',winnerAvatar:data,players:[{id:'p1',avatar:data}]};
const built=buildRoomSnapshot(room);
assert(built.snapshot&&built.avatarAssets instanceof Map,'snapshot separado de assets não foi criado');
assert.strictEqual(built.avatarAssets.size,1,'mesma figurinha deveria ser armazenada uma única vez por hash');
const raw=JSON.stringify(built.snapshot);
assert(!raw.includes('data:image/'),'Base64 ainda ficou dentro do JSON do snapshot');
assert(raw.includes('custom-avatar:'),'snapshot deveria conter referência de avatar');
const hydrated=hydrateSnapshotAvatars(built.snapshot,built.avatarAssets);
assert.strictEqual(hydrated.players[0].avatar,data,'avatar não foi restaurado a partir do asset separado');
assert.strictEqual(hydrated.chat[0].avatar,data,'avatar histórico do chat não foi restaurado');
assert.strictEqual(hydrated.roundReview.winnerAvatar,data,'avatar da conferência não foi restaurado');
assert(snapshots.includes('mm_room_avatar_assets'),'tabela separada de assets de avatar ausente');
assert(snapshots.includes('persistedAssetSignatures'),'controle para evitar regravação de Base64 ausente');
assert(snapshots.includes('ON CONFLICT(room_code,avatar_ref) DO NOTHING'),'asset por hash pode ser regravado desnecessariamente');

console.log(`✓ V40.55: recuperação nativa, Áudio Rápido 250 KB e snapshot sem Base64 repetida (${raw.length} chars + 1 asset).`);

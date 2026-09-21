'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Safety=require('../input-safety');
const Engine=require('../game-engine');
const {restoreRoomSnapshot,SNAPSHOT_VERSION}=require('../room-snapshot-store');
const pkg=require('../package.json');

assert.strictEqual(pkg.version,'40.68.1','package.json deve identificar V40.64');

const hugeAvatar='data:image/webp;base64,'+'A'.repeat(300000);
const validAvatar='data:image/webp;base64,'+'A'.repeat(8000);
const invalidAvatar='data:image/svg+xml;base64,'+'A'.repeat(2000);
const hugeName='  Orlando\u0000   '+ 'X'.repeat(50000);
const hugeChat='Olá\u0000   mundo   '+'Y'.repeat(50000);

assert.strictEqual(Safety.cleanAvatar(hugeAvatar),'macaco','avatar acima do limite deve cair para o padrão');
assert.strictEqual(Safety.cleanAvatar(invalidAvatar),'macaco','tipo de imagem não permitido deve ser recusado');
assert.strictEqual(Safety.cleanAvatar({x:1}),'macaco','objeto não pode virar avatar textual');
assert.strictEqual(Safety.cleanAvatar(validAvatar),validAvatar,'avatar WEBP válido dentro do limite deve ser preservado');
assert.strictEqual(Safety.cleanPresenceName(hugeName).length<=24,true,'nome deve ficar limitado a 24 caracteres');
assert(!Safety.cleanPresenceName(hugeName).includes('\u0000'),'nome deve remover controles');
assert.strictEqual(Safety.cleanPresenceName({name:'objeto'}),'Jogador','objeto não pode virar nome [object Object]');
assert.strictEqual(Safety.cleanChatText(hugeChat).length<=180,true,'chat deve ficar limitado a 180 caracteres');
assert(!Safety.cleanChatText(hugeChat).includes('\u0000'),'chat deve remover controles');
assert.strictEqual(Safety.cleanChatText({text:'objeto'}),'','objeto não pode virar mensagem de chat');
assert.strictEqual(Safety.cleanRoomCode(' abc234 '),'ABC234','código válido deve ser normalizado');
assert.strictEqual(Safety.cleanRoomCode('ABC234-lixo'),'','código com sufixo deve ser recusado');
assert.deepStrictEqual(Safety.firstSafeStrings(Array(1000).fill('abc'),{maxItems:12,maxLength:3}).length,12,'listas de entrada devem ser limitadas antes do processamento');

// Defesa em profundidade no motor: mesmo chamadas fora do Socket.IO não podem
// manter avatar/nome gigantes no estado da sala.
const room=Engine.createRoom('SAFE64',{socketId:'s1',token:'t1',name:hugeName,avatar:hugeAvatar,playerKey:'g1'});
assert(room.players[0].name.length<=24,'motor deve limitar nome');
assert.strictEqual(room.players[0].avatar,'🂡','motor deve rejeitar avatar gigante com fallback local');
const raw=JSON.stringify(Engine.roomPublicState(room,room.players[0].id));
assert(raw.length<20000,`estado não deveria crescer com payload de avatar abusivo: ${raw.length}`);

// Snapshot legado também é higienizado no restore.
const snapshot={
  snapshotVersion:SNAPSHOT_VERSION,code:'SAFE65',status:'lobby',round:0,
  rules:{rounds:5,allowLateJoinUntilRound:3},players:[{id:'p1',socketId:null,token:'t1',name:hugeName,avatar:hugeAvatar,playerKey:'g1',isBot:false,host:true,connected:false,hand:[],score:0,roundScore:0,roundHistory:[]}],
  chat:[{id:'c1',name:hugeName,avatar:hugeAvatar,text:hugeChat,role:'PLAYER'}],log:[],turnAudit:[],replayReadyPlayerIds:[]
};
const restored=restoreRoomSnapshot(snapshot,{now:1000,reconnectGraceMs:60000});
assert(restored,'snapshot deve restaurar');
assert(restored.players[0].name.length<=24&&restored.players[0].avatar==='macaco','perfil legado deve ser saneado no restore');
assert(restored.chat[0].text.length<=180&&restored.chat[0].avatar==='macaco','chat legado deve ser saneado no restore');

// Contrato do servidor: todos os caminhos críticos usam o módulo compartilhado.
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert(server.includes("const InputSafety = require('./input-safety')"),'servidor deve usar sanitização compartilhada');
assert(server.includes('name:cleanPresenceName(payload?.name || socket.data.auth.name)'),'createRoom deve sanear nome');
assert(server.includes('avatar:cleanAvatar(payload?.avatar)'),'createRoom/joinRoom devem sanear avatar');
assert(server.includes('p.name=cleanPresenceName(payload.name)')&&server.includes('p.avatar=cleanAvatar(payload.avatar)'),'updateProfile deve sanear perfil');
assert(server.includes('InputSafety.cleanCardId(payload?.cardId)'),'ações de carta devem limitar IDs recebidos');
assert(server.includes('InputSafety.firstSafeStrings(payload?.targetSocketIds,{maxItems:12,maxLength:120})'),'relay de voz deve limitar lista antes de processar');
assert(server.includes('InputSafety.firstSafeStrings(requestedRefs,{maxItems:16,maxLength:64,filter:AvatarWire.isCustomAvatarRef})'),'requisição de assets deve limitar refs antes de processar');
assert(server.includes('maxHttpBufferSize: 400000'),'limite global de payload Socket.IO deve permanecer ativo');

console.log('✓ V40.64: avatar, nome, chat, IDs e listas de entrada validados no servidor e no motor.');

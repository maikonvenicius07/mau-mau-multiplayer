'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {AuthIdentityStore}=require('../auth-identity-store');
const {plainRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');

(async()=>{
  const root=path.join(__dirname,'..');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

  // Sessões: mudança de senha deve incrementar a versão persistida.
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mau-v499-'));
  const store=new AuthIdentityStore({databaseUrl:'',filePath:path.join(tmp,'auth.json')});
  await store.init();
  const created=await store.registerEmailPassword({email:'v499@example.com',password:'Senha#123',name:'V499'});
  assert.strictEqual(created.user.sessionVersion,1);
  assert.strictEqual(await store.getSessionVersion(created.user.playerKey),1);
  const reset=await store.issueEmailPasswordResetCode({email:'v499@example.com',now:1000});
  const changed=await store.resetEmailPasswordWithCode({email:'v499@example.com',code:reset.code,newPassword:'NovaSenha#456',now:2000});
  assert.strictEqual(changed.sessionVersion,2,'troca de senha deve revogar sessões anteriores');
  assert.strictEqual(await store.getSessionVersion(created.user.playerKey),2);
  await store.close();
  fs.rmSync(tmp,{recursive:true,force:true});

  // Resultado final pendente pode sobreviver a restart apenas para retry do ranking.
  const finalRoom={code:'ABC123',status:'finished',rankingRecorded:false,rankingRecording:false,players:[{id:'p1',playerKey:'u_1',isBot:false,host:true,connected:true,hand:[],name:'A',avatar:'macaco'}]};
  const snap=plainRoomSnapshot(finalRoom);
  assert(restoreRoomSnapshot(snap,{now:5000,reconnectGraceMs:60000}),'snapshot final pendente deve ser restaurável para retry');
  snap.rankingRecorded=true;
  assert.strictEqual(restoreRoomSnapshot(snap,{now:5000,reconnectGraceMs:60000}),null,'snapshot final já gravado não deve voltar');

  assert(server.includes("function authIp(req){return String(req.ip"),'rate limit deve usar req.ip com trust proxy');
  assert(server.includes("const UI_VERSION = '49.9.2'"),'versão visual V49.9.2 ausente');
  assert(server.includes('rulesVersion:RULES_VERSION')&&server.includes('uiVersion:UI_VERSION'),'health deve expor versões separadas');
  assert(server.includes('auth-session-secret-required'),'produção deve reprovar readiness sem AUTH_SESSION_SECRET');
  assert(server.includes('authFromCookieHeaderVerified'),'sessões devem ser comparadas com versão persistida');
  assert(server.includes('disconnectStaleAuthSockets(user.playerKey)'),'troca de senha deve derrubar sockets antigos');
  assert(server.includes('roomSnapshotStore.saveNow(room)).then(()=>rankingReady'),'resultado final deve persistir antes do ranking');
  assert(server.includes('falha ao salvar transição crítica'),'transições críticas devem usar persistência imediata');

  // Decisão do usuário: V49.9 NÃO altera a política de logs do observador.
  assert(server.includes('roomSpectatorState'),'modo observador deve permanecer existente');

  console.log('✓ V49.9: sessões revogáveis, persistência crítica, retry do ranking, readiness e versões validados; logs do observador preservados.');
})().catch(e=>{console.error(e);process.exit(1);});

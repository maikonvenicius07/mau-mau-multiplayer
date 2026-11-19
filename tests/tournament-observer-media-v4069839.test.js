'use strict';
// Testes de contrato e eventos Socket.IO isolados: NÃO substituem áudio/vídeo reais no navegador.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const client=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const camera=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
function chunk(a,b){const start=server.indexOf(a),end=server.indexOf(b,start+a.length);assert(start>=0&&end>start,`${a} / ${b}`);return server.slice(start,end)}
const room={code:'TBL001',status:'playing',tournament:{id:'tor-1'},players:[
 {id:'p1',name:'Jogador',socketId:'player',connected:true,isBot:false}
 ],spectators:[
 {id:'s_1',name:'Observador 1',socketId:'observer1',connected:true},
 {id:'s_2',name:'Observador 2',socketId:'observer2',connected:true},
 ]};
const rooms=new Map([[room.code,room]]);
const handlers=new Map();const sent=[];const errors=[];
const users={
 player:{id:'player',data:{roomCode:'TBL001',role:'PLAYER',playerId:'p1',auth:{playerKey:'account-1'}},connected:true},
 observer1:{id:'observer1',data:{roomCode:'TBL001',role:'SPECTATOR',spectatorId:'s_1',auth:{playerKey:'account-2'}},connected:true},
 observer2:{id:'observer2',data:{roomCode:'TBL001',role:'SPECTATOR',spectatorId:'s_2',auth:{playerKey:'account-3'}},connected:true},
 outsider:{id:'outsider',data:{roomCode:null,role:null,auth:{playerKey:'account-4'}},connected:true},
};
for(const [id,socket] of Object.entries(users)){
 socket.on=(event,fn)=>handlers.set(`${id}:${event}`,fn);
 socket.emit=(event,payload)=>sent.push({to:id,event,payload});
 socket.to=code=>({emit:(event,payload)=>sent.push({to:`room-${code}-except-${id}`,event,payload})});
}
let current=users.player;
const io={sockets:{sockets:new Map(Object.values(users).map(x=>[x.id,x]))},
 to:id=>({emit:(event,payload)=>sent.push({to:id,event,payload})})};
const sandbox={rooms,ROLE_SPECTATOR:'SPECTATOR',ROLE_PLAYER:'PLAYER',ensureSpectators:r=>r.spectators,
 spectatorForSocket:(r,s)=>r.spectators.find(x=>x.id===s.data.spectatorId),
 io,crypto,Buffer,Date,Map,Set,String,Number,JSON,
 socket:current, err:(s,e)=>errors.push({socket:s.id,message:e.message}),
 CAMERA_ENABLED:true,LIVEKIT_URL:'wss://video.example.com',LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'a'.repeat(32),
 abuseLimiter:{consume:()=>({allowed:true})},abuseSubject:()=>'',liveVoiceRelayRate:new Map(),
 InputSafety:{firstSafeStrings:(arr)=>Array.isArray(arr)?arr:[]},
 socialActorForSocket:(r,s)=>{
  if(s.data.role==='PLAYER')return r.players.find(x=>x.socketId===s.id)?{id:s.data.playerId,role:'PLAYER'}:null;
  if(s.data.role==='SPECTATOR')return r.spectators.find(x=>x.socketId===s.id)?{id:s.data.spectatorId,role:'SPECTATOR'}:null;
  return null;
 },
 sendCameraPresence:()=>{},console};
vm.createContext(sandbox);
vm.runInContext(chunk('const cameraPublishers=new Map();','const SERVICE_STARTED_AT = Date.now();'),sandbox);
vm.runInContext(chunk('const liveVoiceSenders = new Map();','io.use((socket,next)=>'),sandbox);
// Reusa os handlers reais: neles o socket é a referência específica de cada sessão.
const voiceHandlers=chunk("  socket.on('liveVoiceRefreshPeer'", "  socket.on('liveVoiceRelayPcm'");
const cameraHandlers=chunk("  socket.on('cameraToken'", "  socket.on('presenceProfile'");
sandbox.users=users;
for(const id of Object.keys(users)){
 vm.runInContext(`(function(socket){${voiceHandlers}
})(users[${JSON.stringify(id)}])`,sandbox);
 vm.runInContext(`(function(socket){${cameraHandlers}
})(users[${JSON.stringify(id)}])`,sandbox);
}
const invoke=(id,event,...args)=>{const fn=handlers.get(`${id}:${event}`);assert(fn,`${id}:${event}`);return fn(...args)};
const auth=id=>new Promise(resolve=>invoke(id,'cameraToken',{},resolve));
(async()=>{
 // Microfone: publicação + descoberta de peers nos dois sentidos.
 invoke('observer1','liveVoiceJoin');
 assert(!errors.length,JSON.stringify(errors));
 const peers=sent.find(x=>x.to==='observer1'&&x.event==='liveVoicePeers')?.payload?.peers||[];
 assert(peers.some(p=>p.role==='PLAYER'&&p.socketId==='player'));
 assert(peers.some(p=>p.role==='SPECTATOR'&&p.socketId==='observer2'));
 invoke('player','liveVoiceJoin');invoke('observer2','liveVoiceJoin');
 invoke('observer1','liveVoiceReady');
 assert(sent.some(x=>x.to==='observer1'&&x.event==='liveVoiceStatusSnapshot'));
 invoke('observer1','liveVoiceSignal',{kind:'offer',targetSocketId:'player',sessionId:'rtc1',sdp:{type:'offer',sdp:'v=0\n'+'.'.repeat(30)}});
 invoke('player','liveVoiceSignal',{kind:'offer',targetSocketId:'observer1',sessionId:'rtc2',sdp:{type:'offer',sdp:'v=0\n'+'.'.repeat(30)}});
 invoke('observer1','liveVoiceSignal',{kind:'offer',targetSocketId:'observer2',sessionId:'rtc3',sdp:{type:'offer',sdp:'v=0\n'+'.'.repeat(30)}});
 assert(sent.some(x=>x.to==='player'&&x.event==='liveVoiceSignal'&&x.payload.fromRole==='SPECTATOR'));
 assert(sent.some(x=>x.to==='observer1'&&x.event==='liveVoiceSignal'&&x.payload.fromRole==='PLAYER'));
 assert(sent.some(x=>x.to==='observer2'&&x.event==='liveVoiceSignal'&&x.payload.fromRole==='SPECTATOR'));
 invoke('outsider','liveVoiceJoin');assert(errors.some(x=>x.socket==='outsider'));
 // Câmera: publicação própria para observer de torneio; sem poderes de jogador.
 const token=await auth('observer1');assert.equal(token.ok,true);assert.equal(token.allowPublish,true);
 const claims=JSON.parse(Buffer.from(token.token.split('.')[1],'base64url'));
 assert.equal(claims.video.canPublish,true);assert.deepEqual(Array.from(claims.video.canPublishSources),['camera']);
 assert.equal(claims.sub,'s_s_1');
 invoke('observer1','cameraPublishState',{active:true});
 assert.equal(vm.runInContext("cameraPresenceFor('TBL001').includes('s_1')",sandbox),true);
 const other=await auth('outsider');assert.equal(other.ok,false);
 invoke('outsider','cameraPublishState',{active:true});
 assert.equal(vm.runInContext("cameraPresenceFor('TBL001').length",sandbox),1);
 invoke('observer1','cameraPublishState',{active:false});
 assert.equal(vm.runInContext("cameraPresenceFor('TBL001').length",sandbox),0);
 // Sala comum mantém observador câmera somente visualização, evitando mudança de contrato não solicitada.
 delete room.tournament;users.observer1.data.cameraLastTokenRequestAt=0;const normal=await auth('observer1');assert.equal(normal.ok,true);assert.equal(normal.allowPublish,false);
 room.tournament={id:'tor-1'};
 assert(client.includes("socket.emit('liveVoiceReady');"));
 assert(client.includes('const resumeLiveMic=rememberedMedia?'));
 assert(!camera.includes('||tournamentWatchMode)return;'));
 assert(camera.includes("raw.startsWith('p_')||raw.startsWith('s_')"));
 assert(camera.includes('cameraSpectatorStreams'));
 assert(html.includes('id="cameraSpectatorStreams"'));
 assert(!css.includes('#game.tournament-watch #liveCameraBtn'));
 assert(!css.includes('#game.tournament-watch #liveMicBtn'));
 console.log('✓ V40.69.8.39: sinalização bidirecional, observadores, câmera autorizada, isolamento e UI.');
})().catch(error=>{console.error(error);process.exitCode=1});

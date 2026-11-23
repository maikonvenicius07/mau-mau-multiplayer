'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {buildBestSeatIndex}=require('../presence-seat-index');

function oldSeat(rooms,key){
  let best=null;
  for(const room of rooms.values()){
    const player=room.players.find(p=>!p.isBot&&p.playerKey===key);
    if(!player)continue;
    const score=(player.connected?100:0)+(room.status==='playing'?40:room.status==='between-rounds'?30:room.status==='lobby'?20:10)+(room.round>0?5:0);
    if(!best||score>best.score)best={room,player,score};
  }
  return best;
}
function roomsFixture(){
  const rooms=new Map();const states=['lobby','playing','between-rounds','finished'];
  for(let i=0;i<180;i++){
    const players=[];
    for(let j=0;j<4;j++)players.push({playerKey:`user-${(i*3+j)%390}`,connected:(i+j)%4!==0,autoControlled:(i+j)%11===0,reconnectDeadlineAt:Date.now()+60000,isBot:(i+j)%19===0});
    if(i===10)players.push({...players[0],connected:true}); // Mesmo identificador: primeira cadeira prevalece.
    rooms.set(`room-${i}`,{code:`room-${i}`,players,status:states[i%4],round:i%3});
  }
  return rooms;
}
const rooms=roomsFixture();const idx=buildBestSeatIndex(rooms);
for(let i=0;i<420;i++){
  const key=`user-${i}`;const old=oldSeat(rooms,key),now=idx.get(key)||null;
  assert.equal(now?.room?.code||null,old?.room?.code||null,`sala de ${key}`);
  assert.equal(now?.player||null,old?.player||null,`cadeira de ${key}`);
  assert.equal(now?.score??null,old?.score??null,`prioridade de ${key}`);
}
assert.equal(buildBestSeatIndex(new Map()).size,0);

// Executar o controlador REAL da interface com um diálogo e timers simulados.
// O teste não depende de navegador ou rede, e valida pausa/retomada/fechamento.
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const start=source.indexOf('function requestPublicRooms(){');
const stop=source.indexOf('function watchPublicRoom(',start);
assert(start>0&&stop>start);
const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
const listeners={};const timers=new Map();let id=0,requests=0;
const ctx={authUser:{id:1},socket:{connected:true,emit(type){assert.equal(type,'requestPublicRooms');requests++;}},document:{hidden:false,addEventListener(name,fn){listeners[name]=fn;}},
  liveRoomsRefreshTimer:null,showAuthGate(){throw Error('Usuário autenticado não deve receber bloqueio.');},
  $:selector=>selector==='#liveRoomsDialog'?dialog:null,
  setInterval(fn,ms){assert.equal(ms,5000);const key=++id;timers.set(key,fn);return key;},
  clearInterval(key){timers.delete(key);}};
vm.createContext(ctx);
vm.runInContext(source.slice(start,stop),ctx);
const handlerStart=source.indexOf("$('#liveRoomsDialog')?.addEventListener('close'",stop);
const handlerEnd=source.indexOf("$('#liveRoomsDialog')?.addEventListener('cancel'",handlerStart);
assert(handlerStart>0&&handlerEnd>handlerStart);
ctx.$=selector=>selector==='#liveRoomsDialog'?{...dialog,addEventListener(name,fn){listeners[`dialog:${name}`]=fn;}}:null;
vm.runInContext(source.slice(handlerStart,handlerEnd),ctx);
ctx.$=selector=>selector==='#liveRoomsDialog'?dialog:null;
ctx.openLiveRooms();assert.equal(dialog.open,true);assert.equal(timers.size,1);assert.equal(requests,1);
for(const tick of timers.values())tick();assert.equal(requests,2);
ctx.document.hidden=true;listeners.visibilitychange();assert.equal(timers.size,0,'não consultar salas em segundo plano');
ctx.document.hidden=false;listeners.visibilitychange();assert.equal(timers.size,1);assert.equal(requests,3,'atualizar ao voltar');
dialog.close();listeners['dialog:close']();assert.equal(timers.size,0,'parar timer em fechamento nativo');
ctx.openLiveRooms();assert.equal(timers.size,1);ctx.closeLiveRooms();assert.equal(timers.size,0);
console.log('✓ V40.69.8.55: índice de presença equivale à busca anterior; painel de observação pausa em aba oculta e encerra timer ao fechar.');

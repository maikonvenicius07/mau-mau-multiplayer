'use strict';
// Microbenchmark sintético e reprodutível: mede somente busca de cadeiras,
// NÃO representa latência de rede, Render nem desempenho completo da aplicação.
const {performance}=require('node:perf_hooks');
const {buildBestSeatIndex}=require('../presence-seat-index');
const rooms=new Map(),players=[];
for(let i=0;i<180;i++){
  const list=[];
  for(let j=0;j<4;j++){
    const key=`p${(i*4+j)%480}`;
    list.push({playerKey:key,isBot:false,connected:(i+j)%5!==0});
  }
  rooms.set(i,{players:list,status:['playing','lobby','between-rounds','finished'][i%4],round:i%4});
}
for(let i=0;i<480;i++)players.push(`p${i}`);
function oldSeat(playerKey){
  let best=null;
  for(const room of rooms.values()){
    const player=room.players.find(p=>!p.isBot&&p.playerKey===playerKey);
    if(!player)continue;
    const score=(player.connected?100:0)+(room.status==='playing'?40:room.status==='between-rounds'?30:room.status==='lobby'?20:10)+(room.round>0?5:0);
    if(!best||score>best.score)best={room,player,score};
  }
  return best;
}
function legacy(){let checks=0;for(const key of players){const seat=oldSeat(key),statusSeat=oldSeat(key);checks+=(seat?.score||0)+(statusSeat?.score||0);}return checks;}
function optimized(){const idx=buildBestSeatIndex(rooms);let checks=0;for(const key of players){const seat=idx.get(key),statusSeat=idx.get(key);checks+=(seat?.score||0)+(statusSeat?.score||0);}return checks;}
if(legacy()!==optimized())throw Error('Saída diferente');
function measure(fn){for(let i=0;i<4;i++)fn();const samples=[];for(let i=0;i<15;i++){const start=performance.now();for(let j=0;j<8;j++)fn();samples.push((performance.now()-start)/8);}samples.sort((a,b)=>a-b);return samples[7];}
const before=measure(legacy),after=measure(optimized);
console.log(JSON.stringify({scenario:'480 jogadores online, 180 salas de 4, 2 consultas/cadeira por snapshot',beforeMs:Number(before.toFixed(3)),afterMs:Number(after.toFixed(3)),speedup:Number((before/after).toFixed(1)),note:'Medianas de 15 lotes (8 execuções), microbenchmark sintético Node.js; não é medição do Render.'},null,2));

'use strict';
// Proteção de ingresso durante o START simultâneo — extrai a função do servidor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=server.indexOf('async function joinSocketIntoRoom(');
const end=server.indexOf('\nfunction reserveInviteSeat(',start);
assert(start>=0&&end>start);
let wasAdded=false;
const room={code:'CUP123',status:'lobby',tournament:{id:'cup',phase:'final',tableNumber:1,rosterKeys:['a','b'],forfeits:[]},players:[{playerKey:'a',id:'a'}]};
const context={
 Error,Promise,crypto:{randomUUID:()=> 'uuid'},
 rooms:new Map([[room.code,room]]),
 tournamentRoundStartLocks:new Set(),
 roomJoinableNow:()=>true,
 prepareForRoomSwitch:async()=>{await Promise.resolve();room.status='playing';},
 removeFromMatchmaking:()=>{},
 Engine:{addPlayer:()=>{wasAdded=true;return {id:'x'};},reconnectPlayer:()=>{wasAdded=true;return {id:'x'};}},
};
vm.runInNewContext(server.slice(start,end),context);
const socket={data:{auth:{playerKey:'b',name:'Bia'}}};
(async()=>{
 await assert.rejects(context.joinSocketIntoRoom(socket,room,{source:'tournament'}),/mudou de estado/);
 assert.equal(wasAdded,false,'nenhuma cadeira nova após início de partida');
 console.log('✓ V40.69.8.36: entrada rejeitada se o torneio começou durante a espera de troca, sem incluir novo jogador.');
})().catch(e=>{console.error(e);process.exitCode=1;});

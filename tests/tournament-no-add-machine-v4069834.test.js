'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const page=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const Engine=require('../game-engine');

function makeNode(tag){
  return {tag,children:[],innerHTML:'',textContent:'',disabled:false,
    appendChild(child){this.children.push(child);return child;},
    setAttribute(name,value){this[name]=value;},
    append(...items){for(const item of items)this.appendChild(item);},
  };
}
function nodeTexts(node){
  return [String(node.textContent||''),String(node.innerHTML||''),...(node.children||[]).flatMap(nodeTexts)];
}
const renderSource=app.slice(app.indexOf('function renderControls(){'),app.indexOf('function play(card,burn){'));
assert(renderSource.startsWith('function renderControls(){'));
function render({tournament=false,withBot=false,status='lobby'}={}){
  const host=makeNode('hostControls');
  const player={id:'p1',name:'Ana',connected:true,host:true,isBot:false};
  const opponent={id:'p2',name:'Bruno',connected:true,host:false,isBot:false};
  const players=[player,opponent];
  if(withBot)players.push({id:'bot',name:'Máquina',isBot:true,connected:true,host:false});
  const state={me:{id:'p1'},players,status,round:status==='between-rounds'?1:0,
    rules:{rounds:5},isPublic:true,
    ...(tournament?{tournamentSchedule:{name:'Copa Oficial'},tournamentWait:status==='lobby'?{deadlineAt:Date.now()+300000}:null}:{})};
  const context={state,document:{createElement:makeNode},$:selector=>selector==='#hostControls'?host:null,
    socket:{connected:true,emit(){}},isSpectatorState:()=>false,
    isTournamentStartReady:()=>true,tournamentStartHint:()=> 'Aguardando início manual.',
    openRoundReview(){},requestPlayAgain(){},avatarHTML:()=>'',esc:s=>String(s)};
  vm.runInNewContext(`${renderSource}\nrenderControls();`,context);
  const texts=nodeTexts(host).join(' ');
  return {texts,host};
}
for(const status of ['lobby','between-rounds']){
  const {texts,host}=render({tournament:true,status});
  assert.match(texts,/Mesa de torneio/);
  assert.doesNotMatch(texts,/Adicionar máquina|Remover máquina|Nível do robô/,
    'Torneio nunca pode oferecer controles de máquinas');
  assert(!host.children.some(n=>n.className==='bot-controls'),'nenhuma barra de máquinas em torneio');
  assert.match(texts,/INICIAR PARTIDA|Iniciar rodada/,'botão de início manual continua disponível');
}
for(const options of [{},{withBot:true},{status:'between-rounds'}]){
  const {texts,host}=render(options);
  assert.match(texts,/Adicionar máquina/,'salas normais preservam máquinas');
  assert(host.children.some(n=>n.className==='bot-controls'));
  if(options.withBot)assert.match(texts,/Remover máquina|Nível do robô/);
}
const funcs=server.slice(server.indexOf('function nextBotInfo(room) {'),server.indexOf('// V40.59'));
assert(funcs.includes('function addBotToRoom(room)'));
const context={Engine,Error};
vm.runInNewContext(funcs,context);
function freshRoom(){return Engine.createRoom('TES123',{
  socketId:'socket-ana',token:'token-ana',name:'Ana',avatar:'macaco',playerKey:'key-ana',
});}
{
  const room=freshRoom();room.tournament={id:'cup-1',rosterKeys:['key-ana','key-bruno']};
  assert.throws(()=>context.addBotToRoom(room),/Máquinas não podem ocupar vagas em torneios/);
  assert.equal(room.players.length,1,'chamada interna não cria máquina em torneio');
}
{
  const room=freshRoom();context.addBotToRoom(room);
  assert.equal(room.players.filter(p=>p.isBot).length,1,'jogo comum continua aceitando máquinas');
}
const addHandler=server.slice(server.indexOf("  socket.on('addBot'"),server.indexOf('  // Dificuldade exclusiva',server.indexOf("  socket.on('addBot'")));
assert(addHandler.startsWith("  socket.on('addBot'"));
function dispatchAddBot(room){
  const callbacks=new Map();
  const sandbox={socket:{on:(event,fn)=>callbacks.set(event,fn)},
    withRoom:(_sock,fn)=>fn(room,room.players[0]),
    roomHasInviteCapacity:()=>true,addBotToRoom:context.addBotToRoom,
    broadcastPresence:()=>{},Error};
  vm.runInNewContext(addHandler,sandbox);
  callbacks.get('addBot')();
}
{
  const room=freshRoom();room.tournament={id:'cup-1',rosterKeys:['key-ana','key-bruno']};
  assert.throws(()=>dispatchAddBot(room),/Máquinas não podem ocupar vagas em torneios/,
    'evento Socket.IO deve ser bloqueado pelo servidor');
  assert.equal(room.players.length,1);
}
{
  const room=freshRoom();dispatchAddBot(room);
  assert.equal(room.players.filter(p=>p.isBot).length,1,'evento normal não sofre regressão');
}
assert(server.includes("if(room.tournament)throw new Error('Mesas de torneio não permitem manipular máquinas.')"));
assert(server.includes("if(room.tournament)throw new Error('Torneios não permitem alterar o nível da máquina.')"));
assert(server.includes("if(room.tournament)throw new Error('Máquinas nunca podem substituir participantes de torneio.')"));
assert(server.includes('room.botTimer || room.tournament) return'));
assert(page.includes('v4069834-no-tournament-bots'),'cache atualizado para publicação');
console.log('✓ V40.69.8.34: controles de máquinas ausentes em torneios, bloqueados no servidor; preservados nas mesas normais.');

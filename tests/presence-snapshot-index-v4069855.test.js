'use strict';
// Compatibilidade V40.69.8.58: valida o comportamento REAL dos snapshots
// de presença sem depender da posição de blocos de handlers Socket.IO.
// A versão anterior desse teste no GitHub extraía um handler por delimitadores
// textuais desatualizados e falhava antes de verificar a presença.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('function cleanPresenceName(value)');
const end = source.indexOf('\nfunction publicRoomCard(room) {', start);
assert(start >= 0 && end > start, 'Funções reais de presença foram localizadas no servidor');
assert(source.includes("socket.on('presenceProfile'"), 'Atualização do perfil de presença deve continuar ativa');
assert(source.includes("socket.emit('presenceSnapshot',buildPresenceSnapshot());"), 'Snapshot individual inicial deve permanecer');
assert(source.includes("lobbySnapshotDelivery.emitIfChanged(io,'presenceSnapshot',buildPresenceSnapshot())"), 'Broadcast filtrado por conteúdo deve permanecer');

const onlinePresence = new Map();
const rooms = new Map();
const context = {
  InputSafety: {
    cleanPresenceName: value => String(value || 'Jogador').slice(0, 80),
    cleanAvatar: value => String(value || 'macaco').slice(0, 80),
  },
  onlinePresence, rooms, Date, Map, Set,
};
vm.runInNewContext(`${source.slice(start, end)}\nthis.presence = { registerPresenceSocket, unregisterPresenceSocket, updatePresenceFromSocket, buildPresenceSnapshot };`, context, {timeout: 1000});
const {registerPresenceSocket, unregisterPresenceSocket, updatePresenceFromSocket, buildPresenceSnapshot} = context.presence;
const now = Date.now();
const seated = (playerKey, extras={}) => ({playerKey, isBot:false, name:playerKey, avatar:'macaco', connected:true, ...extras});
const bot = {isBot:true, name:'Robo', connected:true};
rooms.set('MULTI', {code:'MULTI',status:'playing',round:1,players:[
  seated('ana'), seated('bruno',{connected:false,reconnectDeadlineAt:now+30000,autoControlled:false}), bot,
]});
rooms.set('BOT', {code:'BOT',status:'playing',round:1,players:[seated('carla'),bot]});
rooms.set('FINISHED', {code:'FINISHED',status:'finished',round:2,players:[seated('davi')]});
function connect(playerKey, name=playerKey, id=playerKey+'-socket') {
  const socket = {id, data:{auth:{playerKey,name}}};
  registerPresenceSocket(socket);
  return socket;
}
const ana=connect('ana','Ana');
const carla=connect('carla','Carla');
const davi=connect('davi','Davi');
const eva=connect('eva','Eva');
updatePresenceFromSocket(eva,{name:'Eva Busca',avatar:'gato'});
onlinePresence.get('eva').searching=true;
let snap=buildPresenceSnapshot();
const get=(key)=>snap.players.find(p=>p.playerKey===key);
assert.equal(snap.onlineCount,4,'A contagem considera apenas contas com conexões ativas');
assert.equal(snap.players.length,5,'Inclui quatro conectados e uma vaga dentro do prazo de reconexão');
assert.equal(get('ana').status,'multiplayer');
assert.equal(get('ana').connected,true);
assert.equal(get('ana').inviteable,true);
assert.equal(get('bruno').status,'reconnecting');
assert.equal(get('bruno').connected,false);
assert.equal(get('bruno').inviteable,false);
assert.equal(get('carla').status,'bot');
assert.equal(get('davi').status,'available','Sala encerrada não torna jogador ocupado');
assert.equal(get('eva').status,'searching');
assert.equal(get('eva').name,'Eva Busca');
assert.equal(get('eva').avatar,'gato');
assert.deepEqual(Array.from(snap.players, p=>p.status),
  ['available','searching','reconnecting','bot','multiplayer'],
  'A ordem da lista permanece estável por estado');

const second=connect('ana','Ana','ana-segunda-aba');
assert.equal(buildPresenceSnapshot().onlineCount,4,'Duas abas não duplicam uma conta');
unregisterPresenceSocket(ana);
assert.equal(buildPresenceSnapshot().onlineCount,4,'Desconectar uma aba preserva a outra');
unregisterPresenceSocket(second);
snap=buildPresenceSnapshot();
assert.equal(snap.onlineCount,3,'Última aba desconectada remove conta online');
assert.equal(snap.players.some(p=>p.playerKey==='ana'),false);

rooms.get('MULTI').players.find(p=>p.playerKey==='bruno').reconnectDeadlineAt=Date.now()-1;
snap=buildPresenceSnapshot();
assert.equal(snap.players.some(p=>p.playerKey==='bruno'),false,'Prazo de reconexão expirado não permanece na lista');
assert.equal(snap.players.some(p=>p.playerKey==='Robo'),false,'Robôs não são jogadores online');
console.log('✓ V40.69.8.58: snapshot real de presença, busca, reconexão, partidas e múltiplas abas preservados.');

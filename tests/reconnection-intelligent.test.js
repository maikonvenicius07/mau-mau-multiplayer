'use strict';
const assert=require('assert');
const Engine=require('../game-engine');
const BotPlayer=require('../bot-player');
const {buildMatchRecord}=require('../ranking-store');

const room=Engine.createRoom('R391',{socketId:'s1',token:'t1',name:'Ana',avatar:'macaco',playerKey:'g_ana'});
const bruno=Engine.addPlayer(room,{socketId:'s2',token:'t2',name:'Bruno',avatar:'boi',playerKey:'g_bruno'});
Engine.startRound(room);
const ana=room.players[0];

// Durante a tolerância, a sala fica pausada e a identidade segue humana.
bruno.connected=false;bruno.socketId=null;bruno.autoControlled=false;bruno.reconnectDeadlineAt=Date.now()+60000;
let pub=Engine.roomPublicState(room,ana.id);
assert.equal(pub.paused,true,'sala deve pausar durante os 60 s');
assert.equal(pub.players.find(p=>p.id===bruno.id).autoControlled,false);
assert(pub.players.find(p=>p.id===bruno.id).reconnectDeadlineAt,'deadline deve ser público para contagem regressiva');

// Após o prazo, a mesma vaga entra em AUTO, sem virar isBot.
bruno.autoControlled=true;bruno.reconnectDeadlineAt=null;
pub=Engine.roomPublicState(room,ana.id);
const shown=pub.players.find(p=>p.id===bruno.id);
assert.equal(pub.paused,false,'sala deve voltar a andar quando a vaga entra em AUTO');
assert.equal(shown.autoControlled,true);
assert.equal(shown.isBot,false,'vaga humana não pode virar bot para ranking/identidade');
assert.equal(bruno.playerKey,'g_bruno');
assert.equal(buildMatchRecord(room).mode,'human','AUTO temporário não pode transformar ranking em partida com máquina');

// O mesmo motor da Máquina consegue decidir a jogada da vaga humana em AUTO.
room.currentPlayer=room.players.findIndex(p=>p.id===bruno.id);
assert.doesNotThrow(()=>BotPlayer.takeTurn(room,bruno,Engine));

// Reconectar devolve o controle e limpa metadados temporários.
const re=Engine.reconnectPlayer(room,'t2','s2-new');
assert.strictEqual(re,bruno);
assert.equal(bruno.connected,true);
assert.equal(bruno.autoControlled,false);
assert.equal(bruno.reconnectDeadlineAt,null);
assert.equal(bruno.disconnectedAt,null);
assert.equal(bruno.socketId,'s2-new');
console.log('✓ V39.1: pausa 60 s → AUTO temporário → retomada da mesma vaga');

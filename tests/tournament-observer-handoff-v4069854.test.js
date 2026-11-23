'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {canHandoffObserver}=require('../tournament-observer-handoff');
const allowed={role:'SPECTATOR',watchTournamentId:'cup-5',watchStage:'qualifier',
  tournamentId:'cup-5',stage:'final',automatic:true};
assert.equal(canHandoffObserver(allowed),true);
for(const patch of [{role:'PLAYER'},{watchTournamentId:'cup-2'},{stage:'qualifier'},
 {automatic:false},{watchStage:'final'},{watchStage:'nonsense'},{watchTournamentId:null}])
  assert.equal(canHandoffObserver({...allowed,...patch}),false,JSON.stringify(patch));
assert.equal(canHandoffObserver({...allowed,stage:'semi'}),true);
const root=path.join(__dirname,'..');const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
assert(server.includes('const watcher=socket.data.role===ROLE_SPECTATOR;'));
assert(server.includes('socket.data.tournamentWatchId=tournamentWatch?room.tournament.id:null;'));
assert(server.includes('watchStage:socket.data.tournamentWatchStage,tournamentId:id,stage:phase'));
assert(server.includes("if(!seat)throw new Error('Sua conta não foi sorteada para esta mesa.')"));
assert(server.includes('await prepareForRoomSwitch(socket,room.code)'));
assert(app.includes('function watchingPreviousTournamentPhase(data)'));
assert(app.includes('const watchingPrior=watchingPreviousTournamentPhase(data)'));
assert(app.includes('!idleRegularLobby&&!watchingPrior'));
assert(app.includes("socket.emit('enterTournamentTable'"));
console.log('✓ V40.69.8.54: observador classificado volta automaticamente à fase seguinte, com validação de conta, torneio e sorteio.');

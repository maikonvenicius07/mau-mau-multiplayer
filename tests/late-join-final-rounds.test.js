const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../game-engine');
const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
assert(s.includes("room.round>=room.rules.rounds)return false"));
assert(s.includes("room.round<=0||room.round>=room.rules.rounds"));
assert(ui.includes("state.round<Number(state.rules?.rounds||5)"));
const r=E.createRoom('LATE01',{name:'Host',socketId:'one',token:'a',playerKey:'a'});
assert.equal(r.rules.rounds,5);
for(const round of [2,3,4]){r.round=round;r.status='between-rounds';const p=E.addPlayer(r,{name:`Jogador ${round}`,socketId:`s${round}`,token:`t${round}`,playerKey:`key${round}`});assert(p);assert.equal(p.roundHistory.length,round);}
r.round=5;r.status='between-rounds';assert.throws(()=>E.addPlayer(r,{name:'Tarde',playerKey:'tarde'}),/última rodada/);
r.round=3;r.status='playing';assert.throws(()=>E.addPlayer(r,{name:'Meio',playerKey:'meio'}),/durante uma rodada/);
console.log('OK: entrada após rodadas 2, 3 e 4, bloqueio durante rodada e após última');

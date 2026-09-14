const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const pkg=require('../package.json');

assert.equal(pkg.version,'40.24.0');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');

function extractFunction(source,name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`${name} ausente`);
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'){
      depth--;
      if(depth===0)return source.slice(start,i+1);
    }
  }
  throw new Error(`fim de ${name} não encontrado`);
}

const displayFn=extractFunction(app,'playerDisplayOrderFromMe');
const queueFn=extractFunction(app,'playerTurnQueue');
const ctx={state:null};
vm.createContext(ctx);
vm.runInContext(`${displayFn};${queueFn};this.display=playerDisplayOrderFromMe;this.queue=playerTurnQueue;`,ctx);

const players=['p1','p2','p3','p4'].map(id=>({id}));
ctx.state={players,me:{id:'p3'},currentPlayerId:'p2',direction:-1};
const seatsAnti=Array.from(ctx.display(),p=>p.id);
const queueAnti=Array.from(ctx.queue(),p=>p.id);
ctx.state={players,me:{id:'p3'},currentPlayerId:'p2',direction:1};
const seatsClock=Array.from(ctx.display(),p=>p.id);
const queueClock=Array.from(ctx.queue(),p=>p.id);

assert.deepStrictEqual(seatsAnti,seatsClock,'inverter o sentido não pode trocar os assentos visuais');
assert.deepStrictEqual(seatsAnti,['p3','p2','p1','p4'],'ordem visual fixa deve manter a referência anti-horária inicial');
assert.notDeepStrictEqual(queueAnti,queueClock,'a fila real precisa continuar mudando quando direction é invertido');
assert.equal(seatsAnti[0],'p3','jogador local deve permanecer ancorado no assento inferior');
assert(app.includes('const visualDir=-1'),'ordem visual fixa não foi explicitamente separada de direction');
assert(app.includes('function playerTurnQueue()'),'fila de turno para indicação visual ausente');
assert(app.includes('syncFixedSeatAssignments(orderedPlayers)'),'mapa de assentos fixos não está sendo sincronizado');
assert(app.includes('function fixedPlayerSpot(player,mobile)'),'helper de assento fixo por jogador ausente');
assert(css.includes('.player-order-badge'),'estilo do selo de ordem ausente');

console.log('✓ V40.24: assentos permanecem fixos; direction altera somente a fila real de turno.');

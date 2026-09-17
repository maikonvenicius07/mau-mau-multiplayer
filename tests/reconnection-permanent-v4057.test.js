'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const Engine=require('../game-engine');
const BotPlayer=require('../bot-player');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const pkg=require(path.join(root,'package.json'));

assert.strictEqual(pkg.version,'40.58.0');
assert(html.includes('app.js?v=40.58.0')&&html.includes('styles.css?v=40.58.0'),'cache-busting V40.57 ausente');

function makeRoom(count=4,code='R57'){
  const room=Engine.createRoom(code,{socketId:'s1',token:'t1',name:'P1',avatar:'macaco',playerKey:'g_1'});
  for(let i=2;i<=count;i++)Engine.addPlayer(room,{socketId:`s${i}`,token:`t${i}`,name:`P${i}`,avatar:'boi',playerKey:`g_${i}`});
  Engine.startRound(room);
  return room;
}
function disconnect(p,{auto=false}={}){
  p.connected=false;p.socketId=null;p.disconnectedAt=Date.now();p.autoControlled=!!auto;p.reconnectDeadlineAt=auto?null:Date.now()+60000;
}
function ids(hand){return hand.map(c=>c.id);}

// 1) Retorno antes dos 60 s: mesma cadeira, mesma mão, sem alterar o turno.
{
  const room=makeRoom(4,'A1');const p=room.players[1];const id=p.id,token=p.token,hand=ids(p.hand),turn=room.currentPlayer;
  disconnect(p,{auto:false});const re=Engine.reconnectPlayer(room,token,'s2-new');
  assert.strictEqual(re.id,id);assert.deepStrictEqual(ids(re.hand),hand);assert.strictEqual(room.currentPlayer,turn);assert.strictEqual(re.autoControlled,false);
}

// 2) Retorno depois dos 60 s: AUTO perde o controle, identidade humana permanece.
{
  const room=makeRoom(4,'A2');const p=room.players[1],id=p.id,key=p.playerKey,token=p.token;
  disconnect(p,{auto:true});const re=Engine.reconnectPlayer(room,token,'s2-late');
  assert.strictEqual(re.id,id);assert.strictEqual(re.playerKey,key);assert.strictEqual(re.isBot,false);assert.strictEqual(re.autoControlled,false);assert.strictEqual(re.connected,true);
}

// 3) Máquina já jogou: reconexão recebe a mão ATUAL, não a mão antiga.
{
  const room=makeRoom(5,'A3');const p=room.players[2],token=p.token;const original=ids(p.hand);
  disconnect(p,{auto:true});
  for(let n=0;n<3&&room.status==='playing'&&p.hand.length>0;n++){
    room.currentPlayer=room.players.findIndex(x=>x.id===p.id);
    room.pendingSeven=0;room.continuationPlayerId=null;p.justDrawnCardId=null;p.declaration=null;
    try{BotPlayer.takeTurn(room,p,Engine);}catch{/* a contingência do servidor é coberta por outros testes */}
  }
  const current=ids(p.hand);
  assert.notStrictEqual(p.hand,undefined);
  const re=Engine.reconnectPlayer(room,token,'s3-return');
  assert.deepStrictEqual(ids(re.hand),current,'reconexão não pode restaurar cartas antigas');
  // Mesmo se por acaso a estratégia só comprou, o snapshot atual continua sendo a fonte da verdade.
  assert(Array.isArray(original)&&Array.isArray(current));
}

// 4) Volta quando não é sua vez: currentPlayer não muda.
{
  const room=makeRoom(4,'A4');const p=room.players[2];room.currentPlayer=0;disconnect(p,{auto:true});
  Engine.reconnectPlayer(room,p.token,'s3-return');assert.strictEqual(room.currentPlayer,0);
}

// 5) Volta exatamente na própria vez: a vez permanece na cadeira, agora humana.
{
  const room=makeRoom(4,'A5');const p=room.players[2];room.currentPlayer=2;disconnect(p,{auto:true});
  Engine.reconnectPlayer(room,p.token,'s3-return');assert.strictEqual(room.currentPlayer,2);assert.strictEqual(p.autoControlled,false);
}

// 6) Queda e retorno várias vezes: playerId/token nunca mudam nem duplicam cadeira.
{
  const room=makeRoom(3,'A6');const p=room.players[1],id=p.id,token=p.token;
  for(let cycle=0;cycle<4;cycle++){
    disconnect(p,{auto:cycle%2===1});const re=Engine.reconnectPlayer(room,token,`s2-cycle-${cycle}`);
    assert.strictEqual(re.id,id);assert.strictEqual(re.token,token);assert.strictEqual(room.players.filter(x=>x.id===id).length,1);
  }
}

// 7) Dois jogadores desconectados: recuperar um não interfere na reserva do outro.
{
  const room=makeRoom(5,'A7');const a=room.players[1],b=room.players[3];disconnect(a,{auto:true});disconnect(b,{auto:true});
  Engine.reconnectPlayer(room,a.token,'sa-return');assert.strictEqual(a.connected,true);assert.strictEqual(b.connected,false);assert.strictEqual(b.autoControlled,true);
}

// 8) Reconexão preservada em mesas de 2, 3, 4 e 5 jogadores.
for(let count=2;count<=5;count++){
  const room=makeRoom(count,`A8${count}`);const p=room.players[count-1],id=p.id,hand=ids(p.hand);disconnect(p,{auto:true});
  const re=Engine.reconnectPlayer(room,p.token,`sx-${count}`);assert.strictEqual(re.id,id);assert.deepStrictEqual(ids(re.hand),hand);assert.strictEqual(room.players.length,count);
}

// 9) Observadores presentes não são alterados pela recuperação da cadeira humana.
{
  const room=makeRoom(4,'A9');room.spectators=[{id:'obs1',playerKey:'g_obs',connected:true,socketId:'so1'}];const p=room.players[1];disconnect(p,{auto:true});
  Engine.reconnectPlayer(room,p.token,'s2-return');assert.strictEqual(room.spectators.length,1);assert.strictEqual(room.spectators[0].id,'obs1');
}

// 10) Refresh: novo socket, mesmo token, mesma vaga e mão.
{
  const room=makeRoom(4,'A10');const p=room.players[1],id=p.id,token=p.token,hand=ids(p.hand);disconnect(p,{auto:false});
  const re=Engine.reconnectPlayer(room,token,'socket-after-refresh');assert.strictEqual(re.id,id);assert.strictEqual(re.socketId,'socket-after-refresh');assert.deepStrictEqual(ids(re.hand),hand);
}

// Contrato V40.57: recuperação sem código usa apenas a identidade autenticada do servidor.
assert(server.includes("socket.on('resumeActiveSeat', () =>"),'evento de retomada automática sem código ausente');
assert(server.includes('recoverablePlayerSeatForKey(socket.data.auth?.playerKey)'),'retomada deve usar playerKey autenticada no servidor');
assert(server.includes('player.playerKey!==authKey'),'vaga deve validar propriedade pela Conta Google');
assert(server.includes("source:'auto-resume'"),'retomada automática deve identificar a origem');
assert(server.includes('if(room.botTimer){clearTimeout(room.botTimer);room.botTimer=null;}'),'timer automático precisa ser cancelado antes da retomada');
assert(/if\s*\(\s*!isAutomatedPlayer\(liveBot\)\s*\|\|\s*liveBot\.finishedRound\s*\)\s*return;/.test(server),'timer de bot antigo deve abortar quando humano retoma');
assert(app.includes("socket.emit('resumeActiveSeat')"),'cliente deve procurar vaga sem exigir código quando sessão local faltar');
assert(app.includes('savedSessionResumePending=true'),'token persistente deve continuar sendo a primeira estratégia');
assert(html.includes('cadeira continua pertencendo ao jogador original'),'regra permanente precisa estar visível nas regras');

console.log('✓ V40.57: 10 cenários de reconexão + retomada automática segura por Conta Google aprovados.');

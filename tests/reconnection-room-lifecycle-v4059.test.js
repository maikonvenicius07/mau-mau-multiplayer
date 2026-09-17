'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const Engine=require('../game-engine');
const Life=require('../room-lifecycle');
const {plainRoomSnapshot,restoreRoomSnapshot}=require('../room-snapshot-store');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

function roomWithHumans(count=3,code='R590'){
  const room=Engine.createRoom(code,{socketId:'s1',token:'t1',name:'P1',avatar:'macaco',playerKey:'g1'});
  for(let i=2;i<=count;i++)Engine.addPlayer(room,{socketId:`s${i}`,token:`t${i}`,name:`P${i}`,avatar:'boi',playerKey:`g${i}`});
  return room;
}
function start(count=3,code='R590'){
  const room=roomWithHumans(count,code);Engine.startRound(room);return room;
}
function fall(player,now=1000){Life.markInvoluntaryDisconnect(player,{now,graceMs:60000});}
function botInfo(n=1){return {name:n===1?'Máquina':`Máquina ${n}`,avatar:'preta'};}

// 1. Internet cai e volta antes de 60 s.
{
  const room=start(3,'T01'),p=room.players[0],id=p.id,token=p.token,hand=p.hand.map(c=>c.id);
  fall(p);assert(Life.canAutoReconnect(p));
  const resumed=Engine.reconnectPlayer(room,token,'s1-return');
  assert.strictEqual(resumed.id,id);assert.deepStrictEqual(resumed.hand.map(c=>c.id),hand);assert.strictEqual(resumed.reconnectEligible,false);
}

// 2. Internet cai e volta depois de 60 s.
{
  const room=start(3,'T02'),p=room.players[1],id=p.id,token=p.token;
  fall(p);assert(Life.markAutoTakeover(p));assert.strictEqual(p.autoControlled,true);assert.strictEqual(p.reconnectEligible,true);
  const resumed=Engine.reconnectPlayer(room,token,'s2-return');assert.strictEqual(resumed.id,id);assert.strictEqual(resumed.autoControlled,false);
}

// 3. Bot assume e depois o jogador retorna para a MESMA cadeira/mão atual.
{
  const room=start(4,'T03'),p=room.players[2],id=p.id,token=p.token;
  fall(p);Life.markAutoTakeover(p);const handNow=p.hand.map(c=>c.id);
  const resumed=Engine.reconnectPlayer(room,token,'s3-return');assert.strictEqual(resumed.id,id);assert.deepStrictEqual(resumed.hand.map(c=>c.id),handNow);
}

// 4. Fechar aplicativo sem querer = desconexão involuntária.
{
  const room=start(2,'T04'),p=room.players[0];fall(p);assert.strictEqual(p.reconnectEligible,true);assert(Life.canAutoReconnect(p));
}

// 5. Atualizar a página preserva token e a mesma vaga.
{
  const room=start(2,'T05'),p=room.players[0],token=p.token,id=p.id;fall(p);const resumed=Engine.reconnectPlayer(room,token,'refresh-socket');assert.strictEqual(resumed.id,id);
}

// 6. Sair voluntariamente cancela a reserva e transforma a cadeira ativa em bot normal.
{
  const room=start(3,'T06'),p=room.players[0],oldToken=p.token,oldKey=p.playerKey;
  fall(p);Life.markAutoTakeover(p);Life.convertHumanSeatToPermanentBot(p,botInfo(),{now:90000,token:'bot-new'});
  assert.strictEqual(p.isBot,true);assert.strictEqual(p.playerKey,null);assert.strictEqual(p.reconnectEligible,false);assert.notStrictEqual(p.token,oldToken);assert.notStrictEqual(p.playerKey,oldKey);
}

// 7. Desconecta e depois entra em outra sala: reserva antiga é cancelada.
{
  const old=start(3,'T07A'),p=old.players[0],oldKey=p.playerKey;fall(p);Life.markAutoTakeover(p);
  Life.convertHumanSeatToPermanentBot(p,botInfo(),{token:'bot-switch'});
  const newer=Engine.createRoom('T07B',{socketId:'new',token:'new-token',name:'P1',avatar:'macaco',playerKey:oldKey});
  assert(!old.players.some(x=>!x.isBot&&x.playerKey===oldKey));assert(newer.players.some(x=>x.playerKey===oldKey));
}

// 8. Tentar voltar à sala anterior: token antigo não recupera a cadeira; retorno passa a ser entrada normal por código.
{
  const room=start(3,'T08'),p=room.players[0],oldToken=p.token;
  Life.convertHumanSeatToPermanentBot(p,botInfo(),{token:'bot-replacement'});
  assert.strictEqual(Engine.reconnectPlayer(room,oldToken,'stale'),null);
  assert(server.includes("payload?.resumeIntent==='saved-session'"),'sessão salva inválida deve ser diferenciada de entrada normal por código');
  assert(server.includes('A reserva de reconexão desta sessão não é mais válida.'),'token antigo deve ser rejeitado como retomada');
}

// 9. Todos os jogadores saem voluntariamente: não há mais membros humanos.
{
  const room=start(3,'T09');
  [...room.players].filter(p=>!p.isBot).forEach((p,i)=>Life.convertHumanSeatToPermanentBot(p,botInfo(i+1),{token:`bot-${i}`}));
  assert.strictEqual(Life.hasHumanMembers(room),false);
}

// 10. Sala sem humanos é realmente removida e o snapshot temporário também.
{
  assert(server.includes('function deleteRoomIfNoHumanMembers(room)'),'helper de exclusão de sala vazia ausente');
  assert(server.includes('removeRoom(room.code);'),'sala sem humanos deve sair do Map principal');
  assert(server.includes('roomSnapshotStore.delete(code)'),'removeRoom deve excluir snapshot persistido');
}

// 11. Bot sozinho não mantém sala abandonada.
{
  const room=start(2,'T11');
  for(const p of room.players.filter(x=>!x.isBot))Life.convertHumanSeatToPermanentBot(p,botInfo(),{token:`bot-${p.id}`});
  assert(room.players.every(p=>p.isBot));assert.strictEqual(Life.hasHumanMembers(room),false);
  assert(server.includes('deleteRoomIfNoHumanMembers(room)'),'servidor deve apagar sala que ficou apenas com máquinas');
}

// 12. Dados antigos/token de sala excluída não recriam sala automaticamente.
{
  assert(server.includes("if(!room) throw new Error('Sala não encontrada.');"),'joinRoom deve exigir sala existente');
  assert(app.includes("resumeIntent:'saved-session'"),'cliente deve identificar tentativa automática por token salvo');
  const legacy=start(2,'T12');
  legacy.players.forEach(p=>{p.connected=false;p.voluntaryLeftAt=12345;});
  const restored=restoreRoomSnapshot(plainRoomSnapshot(legacy),{now:20000,reconnectGraceMs:60000});
  assert.strictEqual(restored,null,'snapshot antigo composto só por saídas voluntárias não pode recriar sala');
}

// 13. Dois jogadores perdem conexão ao mesmo tempo: reservas independentes.
{
  const room=start(4,'T13'),a=room.players[0],b=room.players[2];fall(a);fall(b);
  assert(Life.canAutoReconnect(a)&&Life.canAutoReconnect(b));Life.markAutoTakeover(a);Life.markAutoTakeover(b);
  Engine.reconnectPlayer(room,a.token,'a-return');assert.strictEqual(a.connected,true);assert.strictEqual(b.connected,false);assert.strictEqual(b.reconnectEligible,true);
}

// 14. Nova sala enquanto existe reserva antiga: apenas a nova mantém identidade humana.
{
  const old=start(3,'T14A'),p=old.players[1],key=p.playerKey;fall(p);Life.markAutoTakeover(p);
  Life.convertHumanSeatToPermanentBot(p,botInfo(),{token:'bot-final'});
  const fresh=Engine.createRoom('T14B',{socketId:'fresh',token:'fresh-token',name:'P2',avatar:'macaco',playerKey:key});
  const memberships=[old,fresh].flatMap(r=>r.players.filter(x=>!x.isBot&&x.playerKey===key).map(x=>r.code));
  assert.deepStrictEqual(memberships,['T14B']);
}

// Contratos extras que distinguem claramente queda, SAIR e troca de sala.
assert(server.includes('RoomLifecycle.markInvoluntaryDisconnect'),'disconnect deve marcar reserva involuntária explicitamente');
assert(server.includes('if(!player.reconnectEligible)throw new Error'),'auto-resume deve exigir reserva válida');
assert(server.includes('abandonOtherPlayerMembershipsForSwitch'),'troca de sala deve cancelar pertencimento anterior');
assert(server.includes("socket.on('abandonReservedSeat'"),'SAIR clicado offline deve ser confirmado depois no servidor');
assert(app.includes('pendingVoluntaryLeaveKey'),'cliente deve persistir intenção de SAIR se estiver offline');

console.log('✓ V40.59: 14 cenários obrigatórios de reconexão, abandono, troca e exclusão de sala aprovados.');

'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const {buildMatchRecord,rankingAvatarValue}=require('../ranking-store');

// 1) Ranking nunca recebe a imagem Base64 inteira.
const huge='data:image/webp;base64,'+'A'.repeat(1000);
assert.strictEqual(rankingAvatarValue(huge),'custom');
assert.strictEqual(rankingAvatarValue('macaco'),'macaco');
const match=buildMatchRecord({
  code:'T4044',createdAt:1,finishedAt:2,matchSerial:1,rules:{rounds:5},
  players:[{id:'p1',isBot:false,playerKey:'google:p1',name:'Teste',avatar:huge,score:0}],
});
assert.strictEqual(match.results[0].avatar,'custom');
assert(!JSON.stringify(match).includes('A'.repeat(100)),'Base64 vazou para o registro de ranking');
assert(app.includes("custom:{label:'Figurinha personalizada'"),'frontend não possui avatar genérico do ranking');

// 2) Sessão antiga não pode agir pela cadeira atual.
assert(server.includes("player.socketId !== socket.id"),'withRoom não valida o socket atual da cadeira');
assert(server.includes('Esta conexão foi substituída por uma sessão mais recente.'),'mensagem de sessão substituída ausente');

// 3) Uma conta não ocupa duas salas ativas.
assert(server.includes('function activePlayerRoomForKey('),'busca de sala ativa ausente');
assert(server.includes('function requireNoOtherActivePlayerRoom('),'trava central de sala ativa ausente');
assert((server.match(/requireNoOtherActivePlayerRoom\(/g)||[]).length>=6,'trava não foi aplicada aos principais fluxos de sala');

// 4) Segredo de sessão com o nome certo.
assert(env.includes('AUTH_SESSION_SECRET='),'.env.example não usa AUTH_SESSION_SECRET');
assert(!/^SESSION_SECRET=/m.test(env),'.env.example ainda expõe o nome antigo SESSION_SECRET');

// A regra especial Q2 não pode ser tocada por esta manutenção.
const engine=fs.readFileSync(path.join(root,'game-engine.js'),'utf8');
assert(engine.includes("if (ativos.length === 2)"),'regra específica da Q para 2 jogadores ausente');

console.log('✓ V40.44: ranking seguro, socket atual, sala única e AUTH_SESSION_SECRET validados; regras preservadas.');

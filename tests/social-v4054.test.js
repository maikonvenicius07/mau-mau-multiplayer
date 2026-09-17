'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {RankingStore}=require('../ranking-store');

(async()=>{
  const root=path.join(__dirname,'..');
  const pkg=require('../package.json');
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
  assert.strictEqual(pkg.version,'40.54.0');

  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-v4054-'));
  const store=new RankingStore({databaseUrl:'',filePath:path.join(dir,'ranking.json')});
  await store.init();
  await store.recordMatch({matchId:'m1',roomCode:'AAAAAA',mode:'official',rounds:5,startedAt:'2026-09-15T12:00:00.000Z',finishedAt:'2026-09-15T13:00:00.000Z',results:[
    {playerKey:'g_me',name:'Eu',avatar:'macaco',score:10,position:1,won:true},
    {playerKey:'g_a',name:'Ana',avatar:'mulher',score:20,position:2,won:false},
  ]});
  await store.recordMatch({matchId:'m2',roomCode:'BBBBBB',mode:'official',rounds:5,startedAt:'2026-09-16T12:00:00.000Z',finishedAt:'2026-09-16T13:00:00.000Z',results:[
    {playerKey:'g_me',name:'Eu',avatar:'macaco',score:30,position:2,won:false},
    {playerKey:'g_a',name:'Ana Nova',avatar:'homem',score:10,position:1,won:true},
    {playerKey:'g_b',name:'Beto',avatar:'boi',score:20,position:2,won:false},
  ]});
  const recent=await store.getRecentPlayers({playerKey:'g_me',limit:12});
  assert.strictEqual(recent.length,2,'deve listar dois jogadores recentes');
  assert.strictEqual(recent[0].playerKey,'g_a','jogador mais recente/agregado incorreto');
  assert.strictEqual(recent[0].gamesTogether,2,'quantidade de partidas juntos incorreta');
  assert.strictEqual(recent[0].name,'Ana Nova','nome mais recente do jogador deve ser preservado');
  assert.strictEqual(recent[1].playerKey,'g_b');

  assert(server.includes("socket.on('requestRecentPlayers'"),'evento de jogadores recentes ausente');
  assert(server.includes('rankingStore.getRecentPlayers'),'servidor não consulta histórico real');
  assert(html.includes('id="linkInviteBanner"')&&html.includes('id="linkInviteJoin"'),'cartão de convite por link ausente');
  assert(html.includes('id="recentPlayersTab"')&&html.includes('id="recentPlayersList"'),'aba Jogadores Recentes ausente');
  assert(app.includes('navigator.share')&&app.includes('roomInviteUrl'),'compartilhamento nativo/fallback de link ausente');
  assert(app.includes("socket.emit('requestRecentPlayers')")&&app.includes("socket.on('recentPlayersSnapshot'"),'cliente de recentes incompleto');
  assert(css.includes('.link-invite-banner')&&css.includes('.players-directory-tabs'),'estilos V40.54 ausentes');
  assert(html.includes('app.js?v=40.54')&&html.includes('styles.css?v=40.54'),'cache-busting V40.54 ausente');
  fs.rmSync(dir,{recursive:true,force:true});
  console.log('✓ V40.54: convite por link e jogadores recentes conferidos.');
})().catch(err=>{console.error(err);process.exit(1)});

'use strict';
// V40.69.8.23 — horário público, fuso RO, contador do servidor e início manual.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const Schedule=require('../public/tournament-schedule');
const get=f=>fs.readFileSync(path.join(root,f),'utf8');

function testClock(){
  const at='2026-11-22T23:30:00.000Z';
  const formatted=Schedule.format(at);
  assert.deepEqual(formatted,{date:'22/11/2026',time:'19h30',zone:'Horário de Rondônia (UTC−04)'});
  assert.equal(Schedule.format('2026-11-23T08:30:00+09:00').time,'19h30');
  assert.equal(Schedule.format(''),null);
  assert.equal(Schedule.format('invalid'),null);
  assert.equal(Schedule.timestamp('2030-01-01T00:00:00Z'),Date.UTC(2030,0,1));
  assert.equal(Schedule.countdown(Date.UTC(2026,10,23,0),Date.UTC(2026,10,22,21,44,30)).text,'02h 15min 30s');
  assert.equal(Schedule.countdown(3000,4000).text,'00h 00min 00s');
  assert.equal(Schedule.countdown(3000,4000).expired,true);
  let mono=10;
  const c=Schedule.clock(()=>mono);
  assert.equal(c.now(),null,'sem resposta do servidor não usar horário do celular');
  assert.equal(c.sync(1000000),true);
  mono+=1500;assert.equal(c.now(),1001500,'decorrer pelo relógio monotônico');
  assert.equal(c.sync('inválido'),false);assert.equal(c.now(),1001500);
  assert.equal(Schedule.state({startAt:at,registered:true,status:'closed',nowMs:Date.parse(at)-3000}).registrationLabel,'Confirmada');
  assert.match(Schedule.state({startAt:at,registered:true,status:'closed'}).message,/19h30/);
  assert.equal(Schedule.state({startAt:null,registered:true}).timer,null);
  assert.equal(Schedule.state({startAt:at,status:'closed',finished:true}).statusLabel,'Finalizado');
  assert.equal(Schedule.state({startAt:at,status:'cancelled'}).statusLabel,'Cancelado');
}
async function flush(){for(let i=0;i<40;i++)await Promise.resolve();}
async function testBrowser(){
  class Elem{
    constructor(tag='div'){
      this.tag=tag;this._text='';this.children=[];this.handlers={};this.dataset={};this.value='';this.open=false;
      this.hidden=false;this.disabled=false;this.scrollTop=23;this.className='';
      this.classList={toggle:()=>{}};this.parentElement={hidden:false};
    }
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    set textContent(value){this._text=String(value);this.children=[];}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(){this.children=[];this._text='';}
    querySelector(selector){return selector==='h3'?this.heading||(this.heading=new Elem('h3')):null;}
    querySelectorAll(selector){if(selector==='details[open]')return this.children.filter(c=>c.tag==='details'&&c.open);return [];}
    addEventListener(name,fn){this.handlers[name]=fn;}
    showModal(){this.open=true;}
    close(){this.open=false;this.handlers.close?.();}
  }
  const map=new Map();const el=id=>{if(!map.has(id))map.set(id,new Elem());return map.get(id);};
  const document={getElementById:el,createElement:tag=>new Elem(tag),hidden:false,addEventListener:()=>{}};
  let mono=0,now=Date.parse('2026-11-22T22:30:00.000Z'),
    scheduled='2026-11-22T23:30:00.000Z',registered=true;
  const intervals=[];
  const window={MauMauTournamentSchedule:Schedule,MauMauTournamentDashboard:{summarize:()=>[]},
    MauMauTournamentAutoRefresh:{create:()=>({start(){},stop(){},pause(){},resume(){}})},
    addEventListener:()=>{}};
  const fetch=async uri=>{
    if(uri==='/api/tournaments')return {ok:true,json:async()=>({ok:true,serverNow:now,canCreate:true,
      tournaments:[{id:'cup',name:'Copa de Teste',startAt:scheduled,status:'open'}]})};
    if(uri.startsWith('/api/tournament?'))return {ok:true,json:async()=>({ok:true,serverNow:now,canCreate:true,
      tournament:{id:'cup',name:'Copa de Teste',capacity:9,enrolled:3,registered,status:'open',
        registrationOpen:true,spotsRemaining:6,startAt:scheduled,canManage:false},
      players:[{name:'Ana'},{name:'Beto'},{name:'Carla'}],tables:[],games:{},myTable:null,bracket:{currentStage:'qualifier',stages:[]}})};
    throw Error(uri);
  };
  const ctx={document,window,fetch,performance:{now:()=>mono},navigator:{onLine:true},Date,
    setInterval:fn=>intervals.push(fn),setTimeout:()=>0,clearTimeout:()=>{},confirm:()=>true,console};
  vm.runInNewContext(get('public/tournament-ui.js'),ctx);
  el('tournamentOpenHome').handlers.click();await flush();
  assert.equal(el('tournamentSchedulePanel').hidden,false,'card shows to users');
  assert.equal(el('tournamentScheduleDate').textContent,'22/11/2026');
  assert.equal(el('tournamentScheduleTime').textContent,'19h30');
  assert.match(el('tournamentScheduleRegistration').textContent,/Confirmada/);
  assert.match(el('tournamentPicker').children[0].textContent,/22\/11\/2026, 19h30/);
  assert.match(el('tournamentScheduleClock').textContent,/01h 00min/);
  const previousClock=el('tournamentScheduleClock').textContent;
  mono=1000;for(const fn of intervals)fn();
  assert.notEqual(el('tournamentScheduleClock').textContent,previousClock,'ticker uses server anchored time');
  // The server response stamp changes, but unchanged tournament data must not redraw.
  now+=3000;
  el('tournamentAdminName').value='Não substituir meu texto';
  el('tournamentAdminName').handlers.input();
  await el('tournamentRefresh').handlers.click();await flush();
  assert.equal(el('tournamentAdminName').value,'Não substituir meu texto');
  scheduled='2026-11-23T00:30:00.000Z';now+=1000;
  await el('tournamentRefresh').handlers.click();await flush();
  assert.equal(el('tournamentScheduleTime').textContent,'20h30');
  assert.equal(el('tournamentScheduleChanged').hidden,false);
  assert.match(el('tournamentScheduleChanged').textContent,/Horário alterado/);
  mono+=7200000;for(const fn of intervals)fn();
  assert.equal(el('tournamentScheduleClock').textContent,'Horário programado atingido');
  assert.match(el('tournamentScheduleMessage').textContent,/manual/);
  assert(!get('public/tournament-ui.js').includes('socket.emit(\'startRound\''),'clock never starts game');
}
function testIntegration(){
  const server=get('server.js'),engine=get('game-engine.js'),app=get('public/app.js'),html=get('public/index.html');
  assert(server.includes('serverNow:Date.now()'));
  assert(server.includes('startAt:event.startAt,name:event.name'));
  assert(server.includes('room.tournament.startAt=tournament.startAt'));
  assert(engine.includes('tournamentSchedule:room.tournament?'));
  const Engine=require('../game-engine');
  const lobby=Engine.createRoom('SCH123',{socketId:'sock',token:'secret',name:'Ana',avatar:'macaco',playerKey:'private-key'});
  lobby.tournament={id:'cup',name:'Copa de Teste',startAt:'2026-11-22T23:30:00Z',
    rosterKeys:['private-key'],rosterNames:[{playerKey:'private-key',name:'Ana'}],waitDeadlineAt:null};
  const pub=Engine.roomPublicState(lobby,lobby.players[0].id);
  assert.equal(pub.tournamentSchedule.startAt,'2026-11-22T23:30:00Z');
  assert.equal(pub.tournamentSchedule.name,'Copa de Teste');
  assert.equal(typeof pub.tournamentSchedule.serverNow,'number');
  assert.equal(JSON.stringify(pub.tournamentSchedule).includes('private-key'),false);
  assert.equal(Engine.roomPublicState(Engine.createRoom('NORMAL',{name:'Beto',avatar:'macaco'})).tournamentSchedule,null);
  assert(app.includes('syncTournamentLobbySchedule()'));
  assert(app.includes('tournamentScheduleClock.sync(info.serverNow)'));
  assert(html.includes('id="tournamentSchedulePanel"'),
    'O horário programado continua disponível no painel Torneios.');
  // V40.69.8.35: a mesa exibe apenas o relógio de espera; o anúncio de
  // programação foi retirado do lobby, preservando os dados no painel Torneios.
  assert(html.includes('id="tournamentWaitClock"'),
    'O relógio compacto permanece visível na mesa do torneio.');
  assert(!html.includes('id="tournamentLobbySchedule"'),
    'O antigo anúncio de programação não deve voltar à mesa.');
  assert(html.includes('tournament-schedule.js?v=40.69.8.23'));
  assert(html.indexOf('tournament-schedule.js?v=40.69.8.23')<html.indexOf('app.js?v='));
  assert(get('public/styles.css').includes('.tournament-schedule-countdown'));
  // Programmed schedule must never be used as a game-start condition.
  assert(!server.includes('if(Date.now()>event.startAt)'));
}
(async()=>{testClock();await testBrowser();testIntegration();
 console.log('✓ V40.69.8.23: fuso Rondônia, horário público, inscrição, relógio servidor, alteração e início manual.');
})().catch(e=>{console.error(e);process.exitCode=1;});

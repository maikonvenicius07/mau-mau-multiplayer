'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create,DEFAULT_INTERVAL,DEFAULT_LIST_INTERVAL}=require('../public/tournament-auto-refresh');

async function flush(){for(let i=0;i<35;i++)await Promise.resolve();}
async function testScheduler(){
  assert.equal(DEFAULT_INTERVAL,15000);assert.equal(DEFAULT_LIST_INTERVAL,60000);
  let now=0,seq=0,eligible=true,details=0,lists=0;
  const timers=new Map();
  const schedule=(fn,delay)=>{const id=++seq;timers.set(id,{fn,at:now+delay});return id;};
  const cancel=id=>timers.delete(id);
  async function next(){
    const items=[...timers].sort((a,b)=>a[1].at-b[1].at);assert(items.length,'Timer not scheduled');
    const [id,timer]=items[0];timers.delete(id);now=timer.at;timer.fn();await flush();
  }
  const auto=create({refreshDetails:async()=>{details++;},refreshList:async()=>{lists++;},
    canRefresh:()=>eligible,schedule,cancel,clock:()=>now});
  assert.equal(timers.size,0);
  auto.start();auto.start();assert.equal(timers.size,1,'one timer only');
  await next();assert.equal(details,1);assert.equal(lists,0);
  await next();await next();await next();assert.equal(details,4);assert.equal(lists,1,'catalog checked only every 60 seconds');
  eligible=false;await next();assert.equal(details,4,'no calls while hidden/offline/busy');
  auto.pause();assert.equal(timers.size,0,'hidden dialog has no active timer');
  eligible=true;auto.resume();await next();assert.equal(details,5,'resume checks immediately');
  auto.stop();assert.equal(timers.size,0,'closing dialog cancels pending refresh');
  auto.resume();assert.equal(timers.size,0,'closed dialog cannot schedule timer');
  // If a network request is in flight, no parallel poll is allowed.
  let done,started=0;
  const gate=new Promise(resolve=>{done=resolve;});
  const busy=create({refreshDetails:()=>{started++;return gate;},refreshList:async()=>{},
    schedule,cancel,clock:()=>now});
  busy.start();await next();assert.equal(started,1);assert.equal(busy.working,true);
  busy.resume();assert.equal(timers.size,0,'resume must not duplicate an in-flight request');
  done();await flush();assert.equal(busy.working,false);assert.equal(timers.size,1);
  busy.stop();
  // Regressão V40.69.8.55: uma resposta HTTP que chegue após pause()
  // nunca deve rearmar o timer, inclusive em celulares com aba oculta.
  let releasePaused,pausedStarts=0;
  const pauseGate=new Promise(resolve=>{releasePaused=resolve;});
  const paused=create({refreshDetails:()=>{pausedStarts++;return pauseGate;},refreshList:async()=>{},
    schedule,cancel,clock:()=>now});
  paused.start();await next();assert.equal(pausedStarts,1);
  paused.pause();assert.equal(timers.size,0);
  releasePaused();await flush();
  assert.equal(timers.size,0,'pause during in-flight request must not re-arm timer');
  paused.resume();assert.equal(timers.size,1,'resume re-arms exactly one timer');
  await next();assert.equal(pausedStarts,2);
  paused.stop();assert.equal(timers.size,0);
  // Request failure does not stop later refresh cycles.
  let failures=0,attempts=0;
  const retry=create({refreshDetails:async()=>{attempts++;if(attempts===1)throw new Error('temporário');},
    refreshList:async()=>{},onError:()=>{failures++;},schedule,cancel,clock:()=>now});
  retry.start();await next();assert.equal(failures,1);await next();assert.equal(attempts,2);retry.stop();
}

async function testBrowser(){
  const root=path.resolve(__dirname,'..');
  const js=fs.readFileSync(path.join(root,'public/tournament-ui.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
  assert(html.includes('id="tournamentAutoStatus"'));
  assert(html.includes('tournament-auto-refresh.js?v=40.69.8.18'));
  assert(html.includes('tournament-ui.js?v=51.6-auto-refresh-40.69.8.18'));
  assert(css.includes('.tournament-auto-status'));
  assert(!js.includes('innerHTML'),'no HTML injection on names');
  const callbacks=new Map(),windowCallbacks=new Map(),timers=new Map();let timerId=0;
  class Elem{
    constructor(tag='div'){this.tag=tag;this.children=[];this.handlers={};this.dataset={};this.value='';
      this.hidden=false;this.open=false;this.disabled=false;this.scrollTop=30;this.className='';this._text='';
      this.classList={toggle:()=>{}};this.parentElement={hidden:false};}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    set textContent(v){this._text=String(v);this.children=[];}
    append(...values){this.children.push(...values);}
    replaceChildren(){this.children=[];this._text='';}
    querySelector(selector){if(selector==='h3')return this.heading||(this.heading=new Elem('h3'));return null;}
    querySelectorAll(selector){if(selector==='details[open]')return this.children.filter(c=>c.tag==='details'&&c.open);return [];}
    addEventListener(name,fn){this.handlers[name]=fn;}
    showModal(){this.open=true;}
    close(){this.open=false;this.handlers.close?.();}
  }
  const intervals=new Map();let nextInterval=0;
  const elements=new Map();const byId=id=>{if(!elements.has(id))elements.set(id,new Elem());return elements.get(id);};
  const document={getElementById:byId,createElement:tag=>new Elem(tag),hidden:false,
    addEventListener:(name,fn)=>callbacks.set(name,fn)};
  const window={MauMauTournamentDashboard:{summarize:({bracket})=>bracket?.stages||[]},
    MauMauTournamentAutoRefresh:{create:options=>create({...options,
      schedule:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},
      cancel:id=>timers.delete(id)})},
    addEventListener:(name,fn)=>windowCallbacks.set(name,fn)};
  const calls=[],auth={canCreate:true},tournament={id:'cup1',name:'Copa',enrolled:2,capacity:8,
    status:'open',registrationOpen:true,spotsRemaining:6,registered:false,canManage:true};
  let players=[{name:'Ana'},{name:'Beto'}];let statuses={1:{created:false}};
  const fetch=async url=>{
    calls.push(url);
    if(url==='/api/tournaments')return {ok:true,json:async()=>({ok:true,canCreate:auth.canCreate,tournaments:[{id:'cup1',name:'Copa',status:tournament.status}]})};
    if(url.startsWith('/api/tournament?'))return {ok:true,json:async()=>({ok:true,canCreate:auth.canCreate,tournament:{...tournament},players:[...players],
      tables:[{number:1,players:[{name:'Ana'},{name:'Beto'}]}],myTable:1,games:{...statuses},
      bracket:{currentStage:'qualifier',stages:[{stage:'qualifier',label:'Classificatórias',tables:[{number:1,players:[{name:'Ana'},{name:'Beto'}],...statuses[1]}]}]}})};
    throw new Error('Unexpected fetch: '+url);
  };
  const context={document,window,fetch,console,navigator:{onLine:true},Date,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>{const id=++nextInterval;intervals.set(id,{fn,delay});return id;},
    clearInterval:id=>intervals.delete(id),confirm:()=>true};
  vm.runInNewContext(js,context,{filename:'public/tournament-ui.js'});
  assert.equal(intervals.size,0,'clock must not run while dialog is closed');
  byId('tournamentOpenHome').handlers.click();await flush();
  assert.equal(intervals.size,1,'clock starts once only after dialog opens');
  assert.equal(byId('tournamentName').textContent,'🏆 Copa');
  assert.equal(byId('tournamentStages').children.length,1);
  assert.equal(timers.size,1,'one timer after opening');
  byId('tournamentStages').children[0].open=true;
  const listBefore=byId('tournamentStages').children[0];
  byId('tournamentAdminName').value='Meu torneio em rascunho';
  byId('tournamentAdminName').handlers.input();
  const scroll=byId('tournamentDialog').scrollTop;
  async function tick(){const entry=[...timers][0];assert(entry);timers.delete(entry[0]);entry[1].fn();await flush();}
  const before=calls.length;await tick();
  assert.equal(calls.length,before+1,'automatic GET after interval');
  assert.equal(byId('tournamentStages').children[0],listBefore,'no re-render for identical data');
  statuses={1:{created:true,liveStatus:'playing',connectedPlayers:2,expectedPlayers:2}};
  await tick();
  assert.equal(byId('tournamentStages').children[0].open,true,'expanded stage stays open');
  assert.equal(byId('tournamentAdminName').value,'Meu torneio em rascunho','unsaved admin form survives polling');
  assert.equal(byId('tournamentDialog').scrollTop,scroll,'scroll stays stable');
  document.hidden=true;callbacks.get('visibilitychange')();assert.equal(timers.size,0,'background tab stops timers');
  assert.equal(intervals.size,0,'background tab stops 1-second clock');
  document.hidden=false;callbacks.get('visibilitychange')();assert.equal(timers.size,1);
  assert.equal(intervals.size,1,'foreground tab restores clock exactly once');
  await tick();
  byId('tournamentDialog').close();assert.equal(timers.size,0,'closing stops timers');
  assert.equal(intervals.size,0,'closing stops the 1-second clock');
  assert.equal(byId('tournamentAutoStatus').textContent,'Atualização automática ativa');
}
(async()=>{await testScheduler();await testBrowser();console.log('✓ V40.69.8.18: atualização controlada, sem sobreposição, preservação da tela, pausa e retomada.');})()
  .catch(error=>{console.error(error);process.exitCode=1;});

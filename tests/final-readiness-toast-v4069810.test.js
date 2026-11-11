'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {probeIdentityReadiness}=require('../service-readiness');
const root=path.join(__dirname,'..');
(async()=>{
  // O monitor do Render mantém o processo vivo; o teste também deve manter o event loop
  // ativo para exercitar timeouts marcados com unref().
  const keepAlive=setInterval(()=>{},100);
  try{
  const never=new Promise(()=>{});
  const started=Date.now();
  const stuck=await probeIdentityReadiness({healthCheck:async()=>true},never,250);
  assert.deepEqual(stuck,{ok:false,reason:'identity-store-init-timeout'});
  assert(Date.now()-started<1600,'readiness não deve aguardar uma promessa infinita');
  assert.deepEqual(await probeIdentityReadiness({healthCheck:()=>never},Promise.resolve(true),250),{ok:false,reason:'identity-store-health-failed'});
  assert.deepEqual(await probeIdentityReadiness({healthCheck:async()=>true},Promise.resolve(true),250),{ok:true,reason:'ok'});
  assert.deepEqual(await probeIdentityReadiness({healthCheck:async()=>false},Promise.resolve(true),250),{ok:false,reason:'identity-store-health-failed'});
  assert.deepEqual(await probeIdentityReadiness({healthCheck:async()=>true},Promise.resolve(false),250),{ok:false,reason:'identity-store-init-failed'});
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert(server.includes('const identity=await probeIdentityReadiness(authIdentityStore,authIdentityReady,2000);'),'/ready deve utilizar probe com timeout');
  const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  const start=app.indexOf('let toastHideTimer=null;');
  const end=app.indexOf('\n\nlet rankingPlayerRows=',start);
  assert(start>0&&end>start,'gerenciamento de avisos deve existir');
  const active=new Map();let seq=0;
  const element={textContent:'',shown:false,classList:{add(){element.shown=true;},remove(){element.shown=false;}}};
  const sandbox={ $:()=>element, setTimeout(fn){const id=++seq;active.set(id,fn);return id;}, clearTimeout(id){active.delete(id);} };
  vm.createContext(sandbox);vm.runInContext(app.slice(start,end),sandbox);
  vm.runInContext('toast("primeiro")',sandbox);
  assert.equal(element.textContent,'primeiro');assert.equal(element.shown,true);
  vm.runInContext('toast("segundo")',sandbox);
  assert.equal(element.textContent,'segundo');assert.equal(element.shown,true);
  assert.equal(active.size,1,'um aviso novo deve cancelar o timeout do anterior');
  for(const cb of [...active.values()])cb();
  assert.equal(element.shown,false,'aviso mais recente deve desaparecer normalmente');
  console.log('✓ V40.69.8.10: readiness limitado mesmo com Promises pendentes e toast sem temporizadores conflitantes.');
  }finally{clearInterval(keepAlive);}
})().catch(e=>{console.error(e);process.exitCode=1;});

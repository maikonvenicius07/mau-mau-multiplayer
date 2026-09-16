'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const env=fs.readFileSync(path.join(root,'.env.example'),'utf8');
const pkg=require(path.join(root,'package.json'));

assert.strictEqual(pkg.version,'40.45.0');
assert(app.includes('function liveVoiceMutesMusic()'),'detector de microfone ativo ausente');
assert(app.includes('musicEngine.voiceDuck=liveVoiceMutesMusic()?0:'),'microfone ao vivo não zera a música');
assert(app.includes("socket.on('liveVoiceStatusSnapshot'"),'snapshot de microfone ausente');
assert((app.match(/refreshQuickAudioMusicDuck\(\);/g)||[]).length>=8,'estado de áudio não atualiza o mute musical');
assert(app.includes('if(!musicOn||!musicUnlocked||document.hidden||liveVoiceMutesMusic())return;'),'stinger não respeita microfone/segundo plano');
assert(!app.includes("Promise.allSettled(['landingUser','lobby','gameA','gameB','rock','tension','review','roundWin','champion']"),'catálogo inteiro ainda é pré-carregado');
assert(app.includes('function scheduleLikelyMusicPreload('),'pré-carga seletiva ausente');
assert(app.includes('musicEngine.buffers.size<=4'),'limite de buffers musicais ausente');
assert(app.includes("document.addEventListener('visibilitychange'"),'controle de música em segundo plano ausente');
assert(html.toLowerCase().includes('quando qualquer jogador ou observador liga o microfone ao vivo'),'explicação do mute por microfone ausente');
assert(env.includes('AUTH_SESSION_SECRET='),'correção da V40.44 não foi preservada');
assert(!/^SESSION_SECRET=/m.test(env),'nome antigo SESSION_SECRET reapareceu');

const engine=fs.readFileSync(path.join(root,'game-engine.js'),'utf8');
assert(engine.includes("if (ativos.length === 2)"),'regra especial da Dama com 2 jogadores foi alterada');
console.log('✓ V40.45: música sob demanda e mute total durante microfone ao vivo validados; regras preservadas.');

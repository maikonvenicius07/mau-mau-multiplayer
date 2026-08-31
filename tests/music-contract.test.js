const fs=require('fs');
const path=require('path');
function ok(cond,msg){if(!cond)throw new Error(msg)}
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const musicDir=path.join(root,'public','assets','music');
const tracks=['lobby_mesa_aberta.mp3','mesa_de_mau_mau_a.mp3','mesa_de_mau_mau_b.mp3','ultima_carta.mp3','conferencia_rodada.mp3','vitoria_rodada.mp3','campeao_partida.mp3'];
for(const file of tracks){
  const p=path.join(musicDir,file);ok(fs.existsSync(p),`música ausente: ${file}`);ok(fs.statSync(p).size>20000,`música vazia/pequena: ${file}`);
}
ok(html.includes('id="musicBtn"'),'botão de música na sala ausente');
ok(html.includes('id="musicBtnLanding"'),'botão de música na tela inicial ausente');
ok(html.indexOf('id="musicPanel"')<html.indexOf('id="authGate"'),'painel de música deve ser global para abrir fora da sala');
ok(html.includes('id="musicPanel"'),'painel de música ausente');
ok(html.includes('id="musicVolume"'),'controle de volume ausente');
ok(js.includes('function desiredMusicKey()'),'motor de música adaptativa ausente');
ok(js.includes("return atOne?'tension':preferredGameMusicKey()"),'tensão de última carta ausente');
ok(js.includes("next.status==='between-rounds'"),'stinger de fim de rodada ausente');
ok(js.includes("next.status==='finished'"),'stinger de campeão ausente');
ok(js.includes('beginMusicSpeechDuck()'),'ducking de voz ausente');
ok(js.includes('maumauMusicVolumeV1'),'persistência de volume ausente');
ok(js.includes("$$('.music-btn').forEach"),'abertura compartilhada do painel de música ausente');
ok(css.includes('.music-panel'),'estilos do painel de música ausentes');
ok(fs.existsSync(path.join(musicDir,'ORIGEM_E_LICENCA.txt')),'declaração de origem das trilhas ausente');
console.log('music-contract: OK');

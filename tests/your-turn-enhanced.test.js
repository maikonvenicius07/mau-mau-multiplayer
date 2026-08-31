
'use strict';
const fs=require('fs');
const path=require('path');
function ok(cond,msg){if(!cond)throw new Error(msg)}
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
ok(html.includes('id="yourTurnAlert"'),'aviso grande SUA VEZ ausente');
ok(html.includes('>SUA VEZ!</strong>'),'texto SUA VEZ ausente');
ok(html.includes('id="vibrationBtn"'),'controle de vibração ausente');
ok(js.includes("maumauTurnVibrationV1"),'preferência de vibração não persistida');
ok(js.includes('navigator.vibrate([70,45,110])'),'padrão curto de vibração ausente');
ok(js.includes('function shouldCueMyTurn(prev,next)'),'detecção robusta de nova vez ausente');
ok(js.includes('if(prev.paused&&!next.paused)return true'),'retomada após pausa não gera alerta');
ok(js.includes('/perdeu a vez|joga novamente/i'),'repetição de vez com A/Q em 2 jogadores não tratada');
ok(js.includes("playGameSound('yourTurn')"),'som SUA VEZ ausente');
ok(css.includes('.your-turn-alert.show'),'animação SUA VEZ ausente');
ok(css.includes('#game.my-turn .player-card.active'),'iluminação do jogador ativo ausente');
ok(css.includes('#game.my-turn .hand .playing-card.playable'),'iluminação das cartas válidas ausente');
ok(css.includes('@media(prefers-reduced-motion:reduce)'),'acessibilidade de movimento reduzido ausente');
console.log('✓ V39.2: SUA VEZ com animação, iluminação, som e vibração opcional');

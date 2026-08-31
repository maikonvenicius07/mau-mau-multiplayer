const fs=require('fs');
const css=fs.readFileSync('public/styles.css','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
function ok(cond,msg){if(!cond)throw new Error(msg)}
ok(html.includes('viewport-fit=cover'),'viewport-fit=cover ausente');
ok(html.includes('class="topbar"'),'barra superior do jogo ausente');
ok(css.includes('V26 — MOBILE FIRST'),'bloco mobile V26 ausente');
ok(css.includes('env(safe-area-inset-bottom'),'safe-area inferior ausente');
ok(css.includes('scroll-snap-type:x proximity'),'rolagem de mão otimizada ausente');
ok(css.includes('@media(orientation:landscape)'), 'ajuste landscape ausente');
ok(css.includes('.self-seat{display:none}'),'ocultação da própria cadeira no celular ausente');
ok(css.includes('min-height:44px'),'alvos de toque mínimos ausentes');
ok(app.includes('const mobile=window.innerWidth<=900'),'posicionamento mobile dos jogadores ausente');
ok(app.includes('data-label="Jogos"'),'ranking mobile por cartões ausente');
console.log('✓ V38: layout mobile preservado e identificação atualizada.');

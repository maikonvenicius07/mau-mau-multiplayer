const fs=require('fs');
const path=require('path');
const assert=require('assert');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');

assert(html.includes('styles.css?v=40.69.2-v49.9.2-round-review-close-fix'),'cache-busting V49.9.2 ausente');
assert(css.includes('V49.9.2 — botão fechar da conferência fica acima do conteúdo no mobile'),'anotação V49.9.2 ausente');
assert(css.includes('.round-review-modal{position:relative') || css.includes('.round-review-modal{position:relative;'),'round-review modal precisa ser posicionada');
assert(css.includes('padding-top:58px'),'round-review modal precisa reservar espaço superior para o fechar');
assert(css.includes('.round-review-close{position:absolute;top:12px;right:12px;float:none;z-index:30'),'botão fechar precisa ficar absoluto acima do conteúdo');
assert(css.includes('.round-review-close:hover,.round-review-close:focus'),'estados de foco/hover do fechar ausentes');
assert(css.includes('.round-review-modal{padding-top:60px}') || css.includes('.round-review-modal{padding-top:60px'), 'ajuste mobile do topo ausente');
assert(css.includes('.round-review-close{top:10px;right:10px;width:42px;height:42px;z-index:40}') || css.includes('.round-review-close{top:10px;right:10px;width:42px;height:42px;z-index:40'), 'ajuste mobile do botão fechar ausente');
console.log('✓ V49.9.2: fechar da conferência acima do conteúdo no mobile.');

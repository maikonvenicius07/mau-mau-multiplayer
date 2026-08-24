'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const ids=['macaco','boi','jacare','veado','cachorro'];
for(const id of ids){
  const asset=path.join(root,'public','assets','avatars',`${id}.webp`);
  assert(fs.existsSync(asset),`avatar ${id} ausente`);
  assert(fs.statSync(asset).size>5000,`avatar ${id} parece inválido`);
  assert(html.includes(`data-avatar="${id}"`),`opção ${id} ausente no seletor`);
  assert(app.includes(`${id}:`) || app.includes(`${id}:{`),`catálogo ${id} ausente no cliente`);
}
assert(html.includes('id="avatarPicker"'),'galeria visual de avatar ausente');
assert(html.includes('V21 • AVATARES HD'),'identificação V21 ausente');
assert(app.includes('function avatarHTML'),'renderização de avatar ilustrado ausente');
assert(app.includes('function setAvatarSelection'),'seleção de avatar ausente');
assert(css.includes('.avatar-option.selected'),'destaque do avatar selecionado ausente');
assert(css.includes('.avatar-photo'),'estilo dos avatares na mesa ausente');
console.log('✓ V21 avatares HD: seletor, assets e renderização conferidos.');

'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const ids=['macaco','boi','jacare','veado','cachorro','preta','costela','perna','telaazul','caldo','anao','anaocabecao','vesgo','magreloverde','homem','mulher'];
for(const id of ids){
  const asset=path.join(root,'public','assets','avatars',`${id}.webp`);
  assert(fs.existsSync(asset),`avatar ${id} ausente`);
  assert(fs.statSync(asset).size>1000,`avatar ${id} parece inválido`);
  assert(html.includes(`data-avatar="${id}"`),`opção ${id} ausente no seletor`);
  assert(app.includes(`${id}:`) || app.includes(`${id}:{`),`catálogo ${id} ausente no cliente`);
}
assert(html.includes('id="customAvatarInput"'),'input de upload da figurinha ausente');
assert(html.includes('id="customAvatarOption"'),'cartão da figurinha personalizada ausente');
assert(html.includes('Sua Figurinha'),'seção de figurinha ausente');
assert(app.includes('function prepareCustomAvatar'),'preparo da figurinha ausente');
assert(app.includes('function isCustomAvatarValue'),'detecção de figurinha ausente');
assert(app.includes('customAvatarStoragePrefix'),'persistência local da figurinha ausente');
assert(css.includes('.custom-avatar-group'),'estilo da área de figurinha ausente');
assert(css.includes('.avatar-user-upload'),'estilo de renderização da figurinha ausente');
for(const botAvatar of ['preta','costela','perna','homem','mulher','telaazul','caldo','anao','anaocabecao','vesgo','magreloverde']){
  assert(server.includes(`'${botAvatar}'`),`bot não contempla avatar ${botAvatar}`);
}
console.log('✓ galeria ampliada + figurinha própria do jogador conferidas.');

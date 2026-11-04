'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');
const {contentVersion,versionedIndex}=require('../static-asset-versioning');
const root=path.join(__dirname,'..');
const publicDir=path.join(root,'public');
const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
const css=fs.readFileSync(path.join(publicDir,'styles.css'),'utf8');
const original=fs.readFileSync(path.join(publicDir,'assets/app/icon-512.png'));
const display=fs.readFileSync(path.join(publicDir,'assets/app/logo-display-512.webp'));

assert.ok(display.length < original.length*0.3,'logo WebP precisa reduzir bastante o peso do PNG');
assert.match(html,/class="app-splash-logo" src="\/assets\/app\/logo-display-512\.webp"/,'splash deve usar WebP');
assert.match(css,/background-image:url\('\/assets\/app\/logo-display-512\.webp'\)/,'marca CSS deve usar WebP');
assert.ok(!css.includes("background-image:url('/assets/app/icon-512.png')"),'evitar download do ícone 512 PNG pela marca');
assert.match(html,/<link rel="icon" type="image\/png" sizes="64x64" href="\/assets\/app\/icon-64\.png"/,'manter favicon');
assert.match(html,/apple-touch-icon.*icon-180\.png/,'manter ícone iOS');
const avatarMatches=[...html.matchAll(/<img\b[^>]*\bsrc="assets\/avatars\/[^" ]+\.webp"[^>]*>/g)];
assert.strictEqual(avatarMatches.length,17,'todos os 17 avatares da seleção devem existir');
for(const [tag] of avatarMatches){
  assert.match(tag,/loading="lazy"/,'avatar deve ser carregado quando visível');
  assert.match(tag,/decoding="async"/,'decodificação de avatar não pode bloquear pintura');
}
assert.match(html,/id="customAvatarPreview"/, 'preservar prévia personalizada');
assert.match(html,/id="avatarPicker"/, 'preservar seletores de avatar');
const live=versionedIndex(publicDir);
assert.ok(live.includes(`/assets/app/logo-display-512.webp?v=${contentVersion(display)}`),'logo WebP deve receber hash');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mm-logo5b-'));
try{
  fs.mkdirSync(path.join(temp,'assets/app'),{recursive:true});
  fs.writeFileSync(path.join(temp,'index.html'),'<img src="/assets/app/logo-display-512.webp">');
  fs.writeFileSync(path.join(temp,'assets/app/logo-display-512.webp'),'version one');
  const first=versionedIndex(temp);
  fs.writeFileSync(path.join(temp,'assets/app/logo-display-512.webp'),'version two');
  const second=versionedIndex(temp);
  assert.notStrictEqual(first,second,'WebP alterado deve gerar URL nova');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log(`✓ Fase 5B: logo WebP ${original.length} → ${display.length} bytes; 17 avatares lazy; versão por conteúdo preservada.`);

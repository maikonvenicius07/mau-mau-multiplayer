"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const ROOT=path.join(__dirname,"..");
const PUBLIC=path.join(ROOT,"public");
const manifest=JSON.parse(fs.readFileSync(path.join(PUBLIC,"manifest.webmanifest"),"utf8"));
assert.strictEqual(manifest.name,"MAU-MAU CANDEIAS");
assert.strictEqual(manifest.short_name,"MAU-MAU");
assert.strictEqual(manifest.start_url,"/");
assert.strictEqual(manifest.scope,"/");
assert.ok(["standalone","fullscreen"].includes(manifest.display));
const icons=new Map(manifest.icons.map(x=>[`${x.sizes}:${x.purpose||"any"}`,x]));
assert.ok(icons.has("192x192:any"),"manifest deve ter ícone 192x192");
assert.ok(icons.has("512x512:any"),"manifest deve ter ícone 512x512");
assert.ok(icons.has("512x512:maskable"),"manifest deve ter ícone maskable 512x512");
function pngSize(file){
  const b=fs.readFileSync(file);
  assert.strictEqual(b.toString("hex",0,8),"89504e470d0a1a0a",`${file} não é PNG`);
  return [b.readUInt32BE(16),b.readUInt32BE(20)];
}
for(const icon of manifest.icons){
  const f=path.join(PUBLIC,icon.src.replace(/^\//,""));
  assert.ok(fs.existsSync(f),`ícone ausente: ${icon.src}`);
  const expected=icon.sizes.split("x").map(Number);
  assert.deepStrictEqual(pngSize(f),expected,`dimensão incorreta: ${icon.src}`);
}
const html=fs.readFileSync(path.join(PUBLIC,"index.html"),"utf8");
assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(html,/rel="apple-touch-icon" sizes="180x180" href="\/assets\/app\/icon-180\.png"/);
assert.match(html,/name="mobile-web-app-capable" content="yes"/);
console.log("✓ PASSO 5A: manifesto e ícones Android/TWA válidos.");

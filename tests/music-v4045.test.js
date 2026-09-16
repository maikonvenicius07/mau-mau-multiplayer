'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const musicDir=path.join(root,'public','assets','music');
assert(!fs.existsSync(musicDir),'public/assets/music ainda existe; a V40.47 deve usar música externa do próprio aparelho');
const publicDir=path.join(root,'public');
function bytes(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?bytes(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).size),0)}
const total=bytes(publicDir);
assert(total<2500000,`public ainda está pesado demais para V40.47: ${total} bytes`);
const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
assert(html.includes('app.js?v=40.47')&&html.includes('styles.css?v=40.47'),'cache-busting V40.47 ausente');
console.log(`✓ V40.47: sem assets de música interna; public=${total} bytes.`);

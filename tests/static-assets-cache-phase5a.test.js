'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { versionedIndex, contentVersion } = require('../static-asset-versioning');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-static-v5a-'));
try {
  fs.mkdirSync(path.join(dir, 'assets', 'app'), { recursive:true });
  fs.writeFileSync(path.join(dir, 'styles.css'), 'body{color:red}');
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x=1;');
  fs.writeFileSync(path.join(dir, 'camera-video.js'), 'const camera=true;');
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"name":"teste"}');
  fs.writeFileSync(path.join(dir, 'assets', 'app', 'icon-64.png'), 'fake-binary');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><link href="styles.css?v=version-antiga"><script src="app.js?v=antigo"></script><script src="camera-video.js"></script><script src="https://accounts.google.com/gsi/client"></script><script src="/socket.io/socket.io.js"></script><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/assets/app/icon-64.png"><a href="/salas?code=XYZ">Sala</a>');
  const first = versionedIndex(dir);
  const cssVersion=contentVersion('body{color:red}');
  const jsVersion=contentVersion('const x=1;');
  assert.ok(first.includes(`styles.css?v=${cssVersion}`), 'CSS deve usar hash do conteúdo');
  assert.ok(first.includes(`app.js?v=${jsVersion}`), 'JS deve usar hash do conteúdo');
  assert.match(first, /camera-video\.js\?v=[a-f0-9]{12}/);
  assert.match(first, /manifest\.webmanifest\?v=[a-f0-9]{12}/);
  assert.match(first, /icon-64\.png\?v=[a-f0-9]{12}/);
  assert.ok(first.includes('https://accounts.google.com/gsi/client'), 'CDN deve permanecer intacta');
  assert.ok(first.includes('/socket.io/socket.io.js'), 'Socket.IO dinâmico não deve receber hash');
  assert.ok(first.includes('/salas?code=XYZ'), 'links da sala não devem ser alterados');
  assert.strictEqual(versionedIndex(dir), first, 'resposta deve ser determinística');
  fs.writeFileSync(path.join(dir, 'styles.css'), 'body{color:blue}');
  const second = versionedIndex(dir);
  assert.notStrictEqual(second, first, 'mudança no CSS deve produzir nova URL');
  assert.ok(second.includes(`app.js?v=${jsVersion}`), 'JS intacto deve manter sua URL');
} finally { fs.rmSync(dir, { recursive:true, force:true }); }

const base=path.join(__dirname,'..');
const live=versionedIndex(path.join(base,'public'));
for(const name of ['styles.css','app.js','camera-video.js','camera-floating.js','tournament-dashboard.js','tournament-ui.js']){
  assert.ok(live.includes(`${name}?v=${contentVersion(fs.readFileSync(path.join(base,'public',name)))}`), `versão não aplicada: ${name}`);
}
const server=fs.readFileSync(path.join(base,'server.js'),'utf8');
assert.ok(server.includes("app.get(['/', '/index.html']"));
assert.ok(server.includes('StaticAssetVersioning.versionedIndex'));
assert.ok(server.includes("webmanifest)$/i.test(filePath)"),'manifesto deve revalidar');
assert.ok(!/serviceWorker\.register\(/.test(fs.readFileSync(path.join(base,'public','app.js'),'utf8')),'não introduzir Service Worker sem estratégia de sincronização');
console.log('✓ Fase 5A: versionamento automático por conteúdo, manifesto revalidável e links preservados.');

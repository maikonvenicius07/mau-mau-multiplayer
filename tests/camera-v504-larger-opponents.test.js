'use strict';
// V50.4 reconstruída a partir da V50.3 real enviada pelo usuário.
// Verificações sem webcam, mídia externa, armazenamento ou gravação.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
const client=fs.readFileSync(path.join(root,'public/camera-video.js'),'utf8');
assert.match(html,/id="cameraOpponentOverlay"/,'faltou visualização ampliada');
assert.match(html,/id="cameraOpponentExpandedVideo"/,'faltou vídeo ampliado');
assert.match(html,/camera-video\.js\?v=50\.3-trocar-camera-v50\.4/,'cache bust deve preservar testes V50.3');
assert.match(css,/width:96px;height:96px/,'tamanho do vídeo no computador');
assert.match(css,/width:66px;height:66px/,'tamanho do vídeo no celular');
assert.match(css,/width:60px;height:60px/,'tamanho do vídeo no celular pequeno');
assert.match(css,/\.player-card\.camera-seat/,'não ampliar avatares sem vídeo');
assert.match(css,/\.camera-opponent-overlay/,'visualização temporária deve ter estilo');
assert.match(client,/function openExpanded\(/,'abrir ampliação');
assert.match(client,/function closeExpanded\(/,'fechar ampliação');
assert.match(client,/if\(String\(id\)===expandedPlayerId\)closeExpanded\(\)/,'fechar quando câmera desconectar');
assert.match(client,/enlarged\.srcObject=video\.srcObject/,'reutilizar transmissão existente');
assert.match(client,/event\.key==='Escape'/,'fechar usando Esc');
assert.match(client,/avatar\.addEventListener\('keydown'/,'acessibilidade no teclado');
assert.match(html,/id="cameraSwitchBtn"/,'preservar troca da câmera frontal/traseira');
assert.match(html,/id="cameraSelfPreview"/,'preservar câmera flutuante');
assert.doesNotMatch(client,/MediaRecorder|canvas\.toDataURL|indexedDB|localStorage|captureStream\(|\.upload\(/,'não armazenar mídia');
assert.doesNotMatch(client,/socket\.emit\('cameraFrame'/,'não transmitir vídeo pelo Socket.IO');
console.log('✓ V50.4: câmera maior, ampliação, limpeza, compatibilidade V50.3 e ausência de gravação.');

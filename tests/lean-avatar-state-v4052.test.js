'use strict';

const fs=require('fs');
const path=require('path');
const AvatarWire=require('../avatar-wire');

const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

assert(pkg.version==='40.61.1','package.json deve identificar V40.54');

const custom=`data:image/webp;base64,${'A'.repeat(60000)}`;
assert(AvatarWire.isCustomAvatarData(custom),'amostra custom deve ser reconhecida');
const ref=AvatarWire.avatarRefFor(custom);
assert(/^custom-avatar:[a-f0-9]{32}$/.test(ref),'referência de avatar deve ser curta e baseada em hash');
assert(AvatarWire.avatarRefFor(custom)===ref,'a mesma imagem deve produzir a mesma referência');

const rawState={
  players:[
    {id:'p1',avatar:custom,name:'A'},
    {id:'p2',avatar:custom,name:'B'},
  ],
  spectators:[{id:'s1',avatar:custom,name:'C'}],
  me:{id:'p1',avatar:custom,hand:[]},
  roundReview:{winnerAvatar:custom,players:[{id:'p1',avatar:custom}]},
  log:[],
};
const rawJson=JSON.stringify(rawState);
const lean=AvatarWire.leanStateAvatars(rawState);
const leanJson=JSON.stringify(lean);
assert(!leanJson.includes('data:image/'),'evento state leve não pode repetir Base64');
assert(lean.players[0].avatar===ref&&lean.me.avatar===ref&&lean.spectators[0].avatar===ref,'estado deve usar a referência em todos os participantes');
assert(lean.roundReview.winnerAvatar===ref&&lean.roundReview.players[0].avatar===ref,'Conferência da Rodada também deve usar referência');
assert(rawState.players[0].avatar===custom,'serialização leve não pode alterar o estado interno da sala');
assert(leanJson.length<rawJson.length/20,'estado com figurinha deve ficar muito menor');

const room={
  players:[{avatar:custom},{avatar:custom}],
  spectators:[{avatar:custom}],
  roundReview:{winnerAvatar:custom,players:[{avatar:custom}]},
};
const assets=AvatarWire.collectRoomAvatarAssets(room);
assert(assets.size===1&&assets.get(ref)===custom,'imagem repetida deve ser enviada uma única vez por referência');

assert(server.includes("socket.emit('avatarAsset',{ref,dataUrl})"),'servidor deve enviar imagem separada do state');
assert(server.includes("socket.on('requestAvatarAssets'"),'recuperação sob demanda de avatar ausente não foi implementada');
assert(server.includes('AvatarWire.leanStateAvatars'),'estado emitido deve passar pela serialização leve');
assert(server.includes('const room=rooms.get(roomCode)'),'pedido de avatar deve ficar restrito à sala atual');
assert(app.includes('const avatarAssetCache=new Map()'),'cache de avatar no cliente ausente');
assert(app.includes('requestMissingAvatarRefs'),'cliente não recupera referências ausentes');
assert(app.includes("socket.on('avatarAsset'"),'cliente não recebe asset separado');
assert(app.includes('AVATAR_ASSET_CACHE_MAX=32'),'cache de sessão precisa de limite');
assert(html.includes('id="networkStatePayloadValue"')&&html.includes('id="networkAvatarCacheValue"')&&html.includes('id="networkAvatarBytesValue"'),'diagnóstico de payload/cache ausente');
assert(html.includes('app.js?v=40.61.1')&&html.includes('styles.css?v=40.61.1'),'cache-busting V40.54 ausente');

console.log(`✓ V40.54: state leve confirmado (${rawJson.length} -> ${leanJson.length} caracteres no cenário sintético).`);

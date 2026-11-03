'use strict';
const assert=require('assert');
const E=require('../game-engine');

const room=E.createRoom('OBS001',{socketId:'sock-a',token:'tok-a',name:'Ana',avatar:'mulher',playerKey:'g_a'});
const b=E.addPlayer(room,{socketId:'sock-b',token:'tok-b',name:'Bruno',avatar:'homem',playerKey:'g_b'});
const a=room.players[0];
room.status='playing';room.round=2;room.currentPlayer=0;room.direction=-1;
const publicTop={id:'public-top-card',suit:'hearts',rank:'7',copy:1};
const hiddenA={id:'PRIVATE-ANA-CARD',suit:'clubs',rank:'2',copy:1};
const hiddenB={id:'PRIVATE-BRUNO-CARD',suit:'spades',rank:'K',copy:2};
const hiddenDeck={id:'PRIVATE-DECK-CARD',suit:'diamonds',rank:'4',copy:1};
a.hand=[hiddenA];b.hand=[hiddenB];room.deck=[hiddenDeck];room.discard=[publicTop];
room.lastPass={playerId:a.id,keptCardId:'PRIVATE-KEPT-ID',nextPlayerId:b.id,afterBurn:false,at:Date.now()};
room.spectators=[{id:'s_obs',name:'Orlando',avatar:'macaco',connected:true,role:'SPECTATOR'}];

const state=E.roomSpectatorState(room,room.spectators[0]);
assert.equal(state.viewerRole,'SPECTATOR');
assert.equal(state.me.role,'SPECTATOR');
assert.deepEqual(state.me.hand,[]);
assert.deepEqual(state.me.legalCardIds,[]);
assert.deepEqual(state.me.burnableCardIds,[]);
assert.deepEqual(state.me.quickActionCardIds,[]);
assert.deepEqual(state.me.doublePairs,[]);
assert.equal(state.players.length,2);
assert.equal(state.players[0].cardCount,1);
assert.equal(state.players[1].cardCount,1);
assert.ok(!Object.prototype.hasOwnProperty.call(state.players[0],'hand'),'estado público do jogador não pode conter hand');
assert.equal(state.topCard.id,'public-top-card');
assert.equal(state.deckCount,1);
assert.equal(state.roundReview,null);
assert.ok(state.lastPass && !Object.prototype.hasOwnProperty.call(state.lastPass,'keptCardId'),'lastPass do observador não pode conter keptCardId');
const serialized=JSON.stringify(state);
for(const secret of ['PRIVATE-ANA-CARD','PRIVATE-BRUNO-CARD','PRIVATE-DECK-CARD','PRIVATE-KEPT-ID']){
  assert.ok(!serialized.includes(secret),`segredo vazou no estado do observador: ${secret}`);
}


// Informações derivadas da mão também são privadas para quem está assistindo.
room.log.push({id:'private-eligibility-1',kind:'turn',message:'Ana possui 3 opção(ões) válida(s) após a compra e pode escolher qualquer uma delas ou passar a vez.'});
room.log.push({id:'private-eligibility-2',kind:'turn',message:'Bruno não possui carta válida após a compra e deve passar a vez.'});
const sanitized=E.roomSpectatorState(room,room.spectators[0]);
assert.ok(!sanitized.log.some(x=>String(x.message).includes('opção(ões) válida(s) após a compra')),'observador recebeu quantidade de opções válidas derivada da mão');
assert.ok(!sanitized.log.some(x=>String(x.message).includes('não possui carta válida após a compra')),'observador recebeu informação privada de ausência de jogada');

// Depois da rodada, a conferência existente pode revelar as cartas restantes.
room.status='between-rounds';
room.roundReview={id:'review-2',round:2,winnerId:a.id,winnerName:a.name,winnerAvatar:a.avatar,lastWinnerCard:publicTop,doubledByJack:false,players:[{id:b.id,name:b.name,avatar:b.avatar,isBot:false,isWinner:false,cards:[hiddenB],basePoints:13,multiplier:1,roundScore:13,scoreAfter:13}],createdAt:Date.now()};
const reviewState=E.roomSpectatorState(room,room.spectators[0]);
assert.equal(reviewState.roundReview.id,'review-2');
assert.equal(reviewState.roundReview.players[0].cards[0].id,'PRIVATE-BRUNO-CARD');
console.log('✓ V40.31: estado SPECTATOR não recebe cartas privadas durante a rodada e libera conferência somente após o fim.');

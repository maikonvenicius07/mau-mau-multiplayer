'use strict';

// A dificuldade altera somente decisões estratégicas, nunca a legalidade de
// jogadas. Salas antigas e jogadores AUTO mantêm o comportamento normal.
const LEVELS=Object.freeze(['easy','normal','hard']);
function normalize(value){return LEVELS.includes(value)?value:'normal';}
function forPlayer(room,player){return player?.isBot?normalize(room?.botDifficulty):'normal';}
module.exports={LEVELS,normalize,forPlayer};

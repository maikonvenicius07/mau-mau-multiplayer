'use strict';
// V40.69.8.14 — gravação consistente dos resultados de torneios.
// O PostgreSQL confirma a fase e o resultado público da classificatória
// na mesma transação. Uma repetição idêntica é aceita; conflitos são recusados.
async function recordTournamentResult({bracket,games,id,phase,number,roomCode,record,roster}){
  const stageArgs={id,stage:phase,number,roomCode,result:record,players:roster};
  const gameArgs={id,number,roomCode,result:record,expectedPlayers:roster.length};
  const sharedPool=bracket.pool&&bracket.pool===games.pool?bracket.pool:null;
  if(sharedPool){
    const client=await sharedPool.connect();
    try{
      await client.query('BEGIN');
      await bracket.recordResult({...stageArgs,client});
      if(phase==='qualifier')await games.finish({...gameArgs,client});
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(rollbackError=>
        console.error('[tournament] rollback falhou:',rollbackError));
      throw error;
    }finally{client.release();}
  }else{
    // Local/development: os arquivos JSON não suportam transação entre si.
    // A fase é validada primeiro. Repetições idempotentes reparam a segunda
    // gravação após uma falha temporária.
    await bracket.recordResult(stageArgs);
    if(phase==='qualifier')await games.finish(gameArgs);
  }
}
module.exports={recordTournamentResult};

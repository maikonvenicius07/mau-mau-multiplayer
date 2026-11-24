'use strict';
const {isAbsenceRecord}=require('./tournament-empty-table');
// V40.69.8.14 — gravação consistente dos resultados de torneios.
// O PostgreSQL confirma a fase e o resultado público da classificatória
// na mesma transação. Uma repetição idêntica é aceita; conflitos são recusados.
async function recordTournamentResult({bracket,games,id,phase,number,roomCode,record,roster}){
  const stageArgs={id,stage:phase,number,roomCode,result:record,players:roster};
  const gameArgs={id,number,roomCode,result:record,expectedPlayers:roster.length};
  const empty=isAbsenceRecord(record);
  const finishGame=args=>empty?games.finishEmpty(args):games.finish(args);
  const sharedPool=bracket.pool&&bracket.pool===games.pool?bracket.pool:null;
  if(sharedPool){
    const client=await sharedPool.connect();
    try{
      await client.query('BEGIN');
      await bracket.recordResult({...stageArgs,client});
      if(phase==='qualifier')await finishGame({...gameArgs,client});
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
    // No JSON, registrar a mesa pública primeiro apenas no caso de ausência.
    // Assim advance() não vê o resultado privado antes da confirmação pública.
    if(empty&&phase==='qualifier'){
      const previous=(await bracket.rows(id)).find(t=>t.stage===phase&&t.number===number);
      if(previous?.result&&(!isAbsenceRecord(previous.result)||previous.result.matchId!==record.matchId))
        throw new Error('Resultado privado já registrado; encerramento por ausência bloqueado.');
      await finishGame(gameArgs);
    }
    await bracket.recordResult(stageArgs);
    if(!empty&&phase==='qualifier')await finishGame(gameArgs);
  }
}
module.exports={recordTournamentResult};

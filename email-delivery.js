'use strict';

const RESEND_ENDPOINT='https://api.resend.com/emails';

function emailRecoveryConfigured(env=process.env){
  return !!(String(env.RESEND_API_KEY||'').trim() && String(env.EMAIL_FROM||'').trim());
}

function emailError(code,message){const e=new Error(message);e.code=code;return e;}

async function sendPasswordResetCode({to,code,apiKey=process.env.RESEND_API_KEY,from=process.env.EMAIL_FROM,fetchImpl=global.fetch}={}){
  const email=String(to||'').trim().toLowerCase();
  const resetCode=String(code||'').trim();
  const key=String(apiKey||'').trim();
  const sender=String(from||'').trim();
  if(!key||!sender)throw emailError('EMAIL_NOT_CONFIGURED','Recuperação por e-mail ainda não está configurada.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{6}$/.test(resetCode))throw emailError('INVALID_EMAIL_MESSAGE','Dados inválidos para envio do código.');
  if(typeof fetchImpl!=='function')throw emailError('EMAIL_SEND_FAILED','Serviço de envio indisponível.');
  let response;
  try{
    response=await fetchImpl(RESEND_ENDPOINT,{
      method:'POST',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:sender,
        to:[email],
        subject:'Código para recuperar sua senha — MAU-MAU CANDEIAS',
        text:`Seu código de recuperação do MAU-MAU CANDEIAS é ${resetCode}. Ele vale por 10 minutos. Se você não solicitou esta alteração, ignore esta mensagem.`,
        html:`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>MAU-MAU CANDEIAS</h2><p>Use o código abaixo para criar uma nova senha:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:18px 0">${resetCode}</div><p>O código vale por <strong>10 minutos</strong>.</p><p style="color:#666">Se você não solicitou esta alteração, ignore esta mensagem.</p></div>`
      }),
      signal:typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(10000):undefined,
    });
  }catch(e){
    const err=emailError('EMAIL_SEND_FAILED','Não foi possível enviar o código de recuperação agora.');
    err.cause=e;throw err;
  }
  if(!response?.ok){
    let detail='';try{detail=String(await response.text()).slice(0,300)}catch{}
    const err=emailError('EMAIL_SEND_FAILED','Não foi possível enviar o código de recuperação agora.');
    err.status=Number(response?.status||0);err.detail=detail;throw err;
  }
  return {ok:true};
}

module.exports={RESEND_ENDPOINT,emailRecoveryConfigured,sendPasswordResetCode};

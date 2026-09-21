'use strict';

const crypto=require('crypto');
const {normalizeEmail}=require('./auth-identity-store');

function hmacToken(secret,payloadObject){
  const payload=Buffer.from(JSON.stringify(payloadObject)).toString('base64url');
  const signature=crypto.createHmac('sha256',secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifyHmacToken(secret,token){
  try{
    const [payload,signature,extra]=String(token||'').split('.');
    if(!payload||!signature||extra)return null;
    const expected=crypto.createHmac('sha256',secret).update(payload).digest('base64url');
    const a=Buffer.from(signature),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    return JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  }catch{return null;}
}
function createAppleChallenge(secret,{ttlMs=30*60*1000,now=Date.now()}={}){
  const nonce=crypto.randomBytes(24).toString('base64url');
  const state=hmacToken(secret,{kind:'apple-auth',nonce,exp:now+ttlMs});
  return {state,nonce,expiresAt:now+ttlMs};
}
function verifyAppleChallenge(secret,state,{now=Date.now()}={}){
  const parsed=verifyHmacToken(secret,state);
  if(!parsed||parsed.kind!=='apple-auth'||!parsed.nonce||Number(parsed.exp||0)<=now)return null;
  return parsed;
}
function decodeJwtPart(value){return JSON.parse(Buffer.from(String(value||''),'base64url').toString('utf8'));}
let appleKeyCache={expiresAt:0,keys:[]};
async function applePublicKeys(fetchImpl=global.fetch){
  const now=Date.now();
  if(appleKeyCache.keys.length&&appleKeyCache.expiresAt>now)return appleKeyCache.keys;
  const res=await fetchImpl('https://appleid.apple.com/auth/keys',{headers:{Accept:'application/json'}});
  if(!res.ok)throw new Error('Não foi possível consultar as chaves públicas da Apple.');
  const body=await res.json();
  const keys=Array.isArray(body?.keys)?body.keys:[];
  if(!keys.length)throw new Error('A Apple não retornou chaves públicas válidas.');
  appleKeyCache={keys,expiresAt:now+60*60*1000};
  return keys;
}
async function verifyAppleIdentityToken(idToken,{audience,nonce,fetchImpl=global.fetch,now=Date.now()}={}){
  const parts=String(idToken||'').split('.');
  if(parts.length!==3)throw new Error('Token Apple inválido.');
  const [encodedHeader,encodedPayload,encodedSignature]=parts;
  const header=decodeJwtPart(encodedHeader),payload=decodeJwtPart(encodedPayload);
  if(header?.alg!=='RS256'||!header?.kid)throw new Error('Assinatura Apple inválida.');
  const keys=await applePublicKeys(fetchImpl);
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk)throw new Error('Chave pública Apple não encontrada.');
  const publicKey=crypto.createPublicKey({key:jwk,format:'jwk'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${encodedHeader}.${encodedPayload}`),publicKey,Buffer.from(encodedSignature,'base64url'));
  if(!valid)throw new Error('Assinatura Apple inválida.');
  if(payload?.iss!=='https://appleid.apple.com')throw new Error('Emissor Apple inválido.');
  const audiences=Array.isArray(payload?.aud)?payload.aud:[payload?.aud];
  if(!audience||!audiences.includes(audience))throw new Error('Aplicativo Apple inválido.');
  if(Number(payload?.exp||0)*1000<=now-30000)throw new Error('Token Apple expirado.');
  if(Number(payload?.iat||0)*1000>now+5*60*1000)throw new Error('Horário do token Apple inválido.');
  if(!payload?.sub)throw new Error('Conta Apple sem identificador válido.');
  if(nonce&&String(payload?.nonce||'')!==String(nonce))throw new Error('Validação Apple expirada. Tente novamente.');
  return payload;
}

function applePrivateKey(value){
  return String(value||'').replace(/\\n/g,'\n').trim();
}
function createAppleClientSecret({clientId,teamId,keyId,privateKey,now=Date.now(),ttlSeconds=60*60}={}){
  if(!clientId||!teamId||!keyId||!privateKey)throw new Error('Configuração Apple incompleta.');
  const header=Buffer.from(JSON.stringify({alg:'ES256',kid:keyId})).toString('base64url');
  const iat=Math.floor(now/1000),exp=iat+Math.max(300,Math.min(15777000,Number(ttlSeconds)||3600));
  const payload=Buffer.from(JSON.stringify({iss:teamId,iat,exp,aud:'https://appleid.apple.com',sub:clientId})).toString('base64url');
  const signingInput=`${header}.${payload}`;
  const signature=crypto.sign('sha256',Buffer.from(signingInput),{key:applePrivateKey(privateKey),dsaEncoding:'ieee-p1363'}).toString('base64url');
  return `${signingInput}.${signature}`;
}
async function exchangeAppleAuthorizationCode(code,{clientId,teamId,keyId,privateKey,redirectURI,fetchImpl=global.fetch}={}){
  if(!String(code||'').trim())throw new Error('Código de autorização Apple ausente.');
  const clientSecret=createAppleClientSecret({clientId,teamId,keyId,privateKey});
  const body=new URLSearchParams({grant_type:'authorization_code',code:String(code).trim(),client_id:clientId,client_secret:clientSecret,redirect_uri:redirectURI});
  const response=await fetchImpl('https://appleid.apple.com/auth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error)throw new Error(`A Apple recusou o código de autorização (${data?.error||response.status}).`);
  if(!data?.id_token)throw new Error('A Apple não retornou token de identidade na validação do código.');
  return data;
}

function generateEmailOtp(){return String(crypto.randomInt(0,1000000)).padStart(6,'0');}
function emailOtpHash(secret,email,code){
  return crypto.createHmac('sha256',secret).update(`email-otp:${normalizeEmail(email)}:${String(code||'')}`).digest('hex');
}
function safeEmailDisplay(email){
  const normalized=normalizeEmail(email);if(!normalized)return '';
  const [local,domain]=normalized.split('@');
  const visible=local.length<=2?local.slice(0,1):local.slice(0,2);
  return `${visible}${'*'.repeat(Math.max(1,Math.min(6,local.length-visible)))}@${domain}`;
}

class SlidingWindowLimiter {
  constructor({limit=3,windowMs=15*60*1000}={}){this.limit=limit;this.windowMs=windowMs;this.entries=new Map();}
  consume(subject,now=Date.now()){
    const key=String(subject||'anonymous').slice(0,240);
    const recent=(this.entries.get(key)||[]).filter(ts=>now-ts<this.windowMs);
    if(recent.length>=this.limit){this.entries.set(key,recent);return{allowed:false,retryAfterMs:this.windowMs-(now-recent[0])};}
    recent.push(now);this.entries.set(key,recent);return{allowed:true,retryAfterMs:0};
  }
  prune(now=Date.now()){for(const [key,times] of this.entries){const recent=times.filter(ts=>now-ts<this.windowMs);if(recent.length)this.entries.set(key,recent);else this.entries.delete(key);}}
}

module.exports={
  hmacToken,verifyHmacToken,createAppleChallenge,verifyAppleChallenge,verifyAppleIdentityToken,createAppleClientSecret,exchangeAppleAuthorizationCode,
  generateEmailOtp,emailOtpHash,safeEmailDisplay,SlidingWindowLimiter,
};

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function normalizeEmail(value) {
  const email=String(value||'').trim().toLowerCase();
  if(!email || email.length>180) return '';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}
const PASSWORD_MIN_LENGTH=6;
const PASSWORD_MAX_LENGTH=60;
const PASSWORD_RESET_TTL_MS=10*60*1000;
const PASSWORD_RESET_MAX_ATTEMPTS=5;
function normalizePassword(value,{allowLegacyPin=false}={}){
  const password=String(value??'');
  if(/[\u0000-\u001F\u007F]/u.test(password))return '';
  if(password.length>=PASSWORD_MIN_LENGTH&&password.length<=PASSWORD_MAX_LENGTH)return password;
  // Compatibilidade: contas criadas antes desta versão usavam PIN numérico de 6 dígitos.
  if(allowLegacyPin&&/^\d{6}$/.test(password))return password;
  return '';
}
function normalizePasswordResetCode(value){
  const code=String(value||'').replace(/\D/g,'').slice(0,6);
  return /^\d{6}$/.test(code)?code:'';
}
function generatePasswordResetCode(){return String(crypto.randomInt(0,1000000)).padStart(6,'0');}
function normalizePin(value){
  const pin=String(value||'').replace(/\D/g,'').slice(0,6);
  return /^\d{6}$/.test(pin)?pin:'';
}
function normalizeRecoveryCode(value){
  const raw=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!raw)return '';
  return raw.startsWith('RC')?raw:`RC${raw}`;
}
function identityHash(provider,subject) {
  return crypto.createHash('sha256').update(`mau-mau-auth:${String(provider||'').toLowerCase()}:${String(subject||'')}`).digest('hex');
}
function newPlayerKey() { return `u_${crypto.randomBytes(20).toString('hex')}`; }
function cleanUserProfile({playerKey,name,email,picture,provider}={}) {
  return {
    playerKey:String(playerKey||'').slice(0,80),
    name:String(name||'Jogador').trim().slice(0,60)||'Jogador',
    email:normalizeEmail(email),
    picture:String(picture||'').trim().slice(0,500),
    provider:String(provider||'').trim().toLowerCase().slice(0,20),
  };
}
function emailPinDisplayName(email,name=''){
  const supplied=String(name||'').trim().slice(0,60);
  if(supplied)return supplied;
  const local=normalizeEmail(email).split('@')[0].replace(/[._-]+/g,' ').trim();
  return (local||'Jogador').replace(/\b\w/g,c=>c.toUpperCase()).slice(0,60)||'Jogador';
}
function authError(code,message){const e=new Error(message);e.code=code;return e;}
function randomSalt(){return crypto.randomBytes(16).toString('hex');}
function scryptHex(secret,salt){
  return new Promise((resolve,reject)=>crypto.scrypt(String(secret),String(salt),32,{N:16384,r:8,p:1,maxmem:64*1024*1024},(err,key)=>err?reject(err):resolve(key.toString('hex'))));
}
function safeHexEqual(a,b){
  try{const x=Buffer.from(String(a||''),'hex'),y=Buffer.from(String(b||''),'hex');return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y);}catch{return false}
}
function generateRecoveryCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body='';const bytes=crypto.randomBytes(16);
  for(let i=0;i<16;i++)body+=alphabet[bytes[i]%alphabet.length];
  return `RC-${body.slice(0,4)}-${body.slice(4,8)}-${body.slice(8,12)}-${body.slice(12,16)}`;
}
function publicEmailPinUser(user,email){return {...cleanUserProfile({...user,email,provider:'email_pin'}),provider:'email_pin'};}
function publicEmailPasswordUser(user,email){return {...cleanUserProfile({...user,email,provider:'email_password'}),provider:'email_password'};}

class JsonBackend {
  constructor(filePath){this.filePath=filePath;this.data={version:2,users:{},identities:{},emailPins:{}};}
  async init(){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    try{
      const parsed=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if(parsed&&parsed.users&&parsed.identities){
        this.data={version:2,users:parsed.users||{},identities:parsed.identities||{},emailPins:parsed.emailPins||{}};
      }
    }catch(e){if(e.code!=='ENOENT')console.warn('[auth-store] falha ao ler JSON:',e.message);}
  }
  persist(){const tmp=`${this.filePath}.tmp`;fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));fs.renameSync(tmp,this.filePath);}
  async healthCheck(){return true;}
  async ensureSessionUser(session){
    const user=cleanUserProfile(session);if(!user.playerKey)return null;
    // E-mail+PIN não prova posse da caixa postal; nunca promove esse e-mail para
    // e-mail verificado/canônico, evitando vinculação automática insegura com Google/Apple.
    if(user.provider==='email_pin'||user.provider==='email_password')user.email='';
    const prior=this.data.users[user.playerKey]||{};
    this.data.users[user.playerKey]={...prior,...user,provider:user.provider||prior.provider||'',updatedAt:new Date().toISOString(),createdAt:prior.createdAt||new Date().toISOString()};
    this.persist();return this.data.users[user.playerKey];
  }
  async resolveIdentity({provider,subject,legacyPlayerKey='',name,email,picture,verifiedEmail=true}={}){
    provider=String(provider||'').trim().toLowerCase();subject=String(subject||'').trim();
    if(!provider||!subject)throw new Error('Identidade de login inválida.');
    const key=`${provider}:${identityHash(provider,subject)}`;const normalizedEmail=verifiedEmail?normalizeEmail(email):'';const now=new Date().toISOString();
    const existingIdentity=this.data.identities[key];
    if(existingIdentity){
      const prior=this.data.users[existingIdentity.playerKey]||{playerKey:existingIdentity.playerKey};
      const user=cleanUserProfile({playerKey:existingIdentity.playerKey,name:name||prior.name,email:normalizedEmail||prior.email,picture:picture||prior.picture,provider});
      this.data.users[user.playerKey]={...prior,...user,createdAt:prior.createdAt||now,updatedAt:now};existingIdentity.lastLoginAt=now;if(normalizedEmail)existingIdentity.providerEmail=normalizedEmail;this.persist();return {...user,provider};
    }
    let playerKey='';
    if(normalizedEmail){const sameEmail=Object.values(this.data.users).find(u=>normalizeEmail(u?.email)===normalizedEmail);if(sameEmail?.playerKey)playerKey=sameEmail.playerKey;}
    if(!playerKey&&legacyPlayerKey)playerKey=String(legacyPlayerKey).slice(0,80);
    if(!playerKey)playerKey=newPlayerKey();
    const prior=this.data.users[playerKey]||{};const user=cleanUserProfile({playerKey,name:name||prior.name,email:normalizedEmail||prior.email,picture:picture||prior.picture,provider});
    this.data.users[playerKey]={...prior,...user,createdAt:prior.createdAt||now,updatedAt:now};
    this.data.identities[key]={provider,subjectHash:identityHash(provider,subject),playerKey,providerEmail:normalizedEmail,createdAt:now,lastLoginAt:now};this.persist();return {...user,provider};
  }
  async registerEmailPin({email,pin,name}={}){
    email=normalizeEmail(email);pin=normalizePin(pin);if(!email)throw authError('INVALID_EMAIL','Informe um e-mail válido.');if(!pin)throw authError('INVALID_PIN','O PIN deve ter exatamente 6 números.');
    if(this.data.emailPins[email])throw authError('EMAIL_EXISTS','Este e-mail já possui uma conta. Use Entrar.');
    const playerKey=newPlayerKey(),now=new Date().toISOString(),pinSalt=randomSalt(),recoverySalt=randomSalt(),recoveryCode=generateRecoveryCode();
    const [pinHash,recoveryHash]=await Promise.all([scryptHex(pin,pinSalt),scryptHex(normalizeRecoveryCode(recoveryCode),recoverySalt)]);
    const user=cleanUserProfile({playerKey,name:emailPinDisplayName(email,name),email:'',picture:'',provider:'email_pin'});
    this.data.users[playerKey]={...user,createdAt:now,updatedAt:now};
    this.data.emailPins[email]={playerKey,pinSalt,pinHash,recoverySalt,recoveryHash,failedAttempts:0,lockedUntil:0,createdAt:now,updatedAt:now,lastLoginAt:null};
    this.persist();return {user:publicEmailPinUser(user,email),recoveryCode};
  }
  async loginEmailPin({email,pin,now=Date.now()}={}){
    email=normalizeEmail(email);pin=normalizePin(pin);if(!email||!pin)throw authError('INVALID_CREDENTIALS','E-mail ou PIN inválido.');
    const cred=this.data.emailPins[email];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
    if(Number(cred.lockedUntil||0)>now)throw authError('LOCKED','Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.');
    const actual=await scryptHex(pin,cred.pinSalt);if(!safeHexEqual(actual,cred.pinHash)){
      cred.failedAttempts=Number(cred.failedAttempts||0)+1;if(cred.failedAttempts>=5){cred.lockedUntil=now+15*60*1000;cred.failedAttempts=0;}cred.updatedAt=new Date(now).toISOString();this.persist();throw authError('INVALID_CREDENTIALS','E-mail ou PIN incorreto.');
    }
    cred.failedAttempts=0;cred.lockedUntil=0;cred.lastLoginAt=new Date(now).toISOString();cred.updatedAt=cred.lastLoginAt;this.persist();
    const user=this.data.users[cred.playerKey]||{playerKey:cred.playerKey,name:emailPinDisplayName(email)};return publicEmailPinUser(user,email);
  }
  async recoverEmailPin({email,recoveryCode,newPin}={}){
    email=normalizeEmail(email);newPin=normalizePin(newPin);const recovery=normalizeRecoveryCode(recoveryCode);
    if(!email||!newPin||!recovery)throw authError('INVALID_RECOVERY','Dados de recuperação inválidos.');
    const cred=this.data.emailPins[email];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
    const actual=await scryptHex(recovery,cred.recoverySalt);if(!safeHexEqual(actual,cred.recoveryHash))throw authError('INVALID_RECOVERY','Chave de recuperação inválida.');
    cred.pinSalt=randomSalt();cred.pinHash=await scryptHex(newPin,cred.pinSalt);cred.failedAttempts=0;cred.lockedUntil=0;cred.updatedAt=new Date().toISOString();this.persist();
    const user=this.data.users[cred.playerKey]||{playerKey:cred.playerKey,name:emailPinDisplayName(email)};return publicEmailPinUser(user,email);
  }
  async registerEmailPassword({email,password,name}={}){
    email=normalizeEmail(email);password=normalizePassword(password);
    if(!email)throw authError('INVALID_EMAIL','Informe um e-mail válido.');
    if(!password)throw authError('INVALID_PASSWORD',`A senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
    if(this.data.emailPins[email])throw authError('EMAIL_EXISTS','Este e-mail já possui uma conta. Use Entrar.');
    const playerKey=newPlayerKey(),now=new Date().toISOString(),pinSalt=randomSalt(),recoverySalt=randomSalt(),recoveryCode=generateRecoveryCode();
    const [pinHash,recoveryHash]=await Promise.all([scryptHex(password,pinSalt),scryptHex(normalizeRecoveryCode(recoveryCode),recoverySalt)]);
    const user=cleanUserProfile({playerKey,name:emailPinDisplayName(email,name),email:'',picture:'',provider:'email_password'});
    this.data.users[playerKey]={...user,createdAt:now,updatedAt:now};
    // Mantemos os nomes internos antigos para preservar contas existentes sem migração destrutiva.
    this.data.emailPins[email]={playerKey,pinSalt,pinHash,recoverySalt,recoveryHash,failedAttempts:0,lockedUntil:0,createdAt:now,updatedAt:now,lastLoginAt:null};
    this.persist();return {user:publicEmailPasswordUser(user,email),recoveryCode};
  }
  async loginEmailPassword({email,password,now=Date.now()}={}){
    email=normalizeEmail(email);password=normalizePassword(password,{allowLegacyPin:true});
    if(!email||!password)throw authError('INVALID_CREDENTIALS','E-mail ou senha inválida.');
    const cred=this.data.emailPins[email];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
    if(Number(cred.lockedUntil||0)>now)throw authError('LOCKED','Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.');
    const actual=await scryptHex(password,cred.pinSalt);if(!safeHexEqual(actual,cred.pinHash)){
      cred.failedAttempts=Number(cred.failedAttempts||0)+1;if(cred.failedAttempts>=5){cred.lockedUntil=now+15*60*1000;cred.failedAttempts=0;}cred.updatedAt=new Date(now).toISOString();this.persist();throw authError('INVALID_CREDENTIALS','E-mail ou senha incorreta.');
    }
    cred.failedAttempts=0;cred.lockedUntil=0;cred.lastLoginAt=new Date(now).toISOString();cred.updatedAt=cred.lastLoginAt;this.persist();
    const user=this.data.users[cred.playerKey]||{playerKey:cred.playerKey,name:emailPinDisplayName(email)};return publicEmailPasswordUser(user,email);
  }
  async recoverEmailPassword({email,recoveryCode,newPassword}={}){
    email=normalizeEmail(email);newPassword=normalizePassword(newPassword);const recovery=normalizeRecoveryCode(recoveryCode);
    if(!email||!newPassword||!recovery)throw authError('INVALID_RECOVERY',`Preencha os dados corretamente. A nova senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
    const cred=this.data.emailPins[email];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
    const actual=await scryptHex(recovery,cred.recoverySalt);if(!safeHexEqual(actual,cred.recoveryHash))throw authError('INVALID_RECOVERY','Chave de recuperação inválida.');
    cred.pinSalt=randomSalt();cred.pinHash=await scryptHex(newPassword,cred.pinSalt);cred.failedAttempts=0;cred.lockedUntil=0;cred.updatedAt=new Date().toISOString();this.persist();
    const user=this.data.users[cred.playerKey]||{playerKey:cred.playerKey,name:emailPinDisplayName(email)};return publicEmailPasswordUser(user,email);
  }

  async issueEmailPasswordResetCode({email,now=Date.now()}={}){
    email=normalizeEmail(email);if(!email)throw authError('INVALID_EMAIL','Informe um e-mail válido.');
    const cred=this.data.emailPins[email];if(!cred)return {exists:false};
    const code=generatePasswordResetCode(),salt=randomSalt(),hash=await scryptHex(code,salt),expiresAt=now+PASSWORD_RESET_TTL_MS;
    cred.passwordResetSalt=salt;cred.passwordResetHash=hash;cred.passwordResetExpiresAt=expiresAt;cred.passwordResetAttempts=0;cred.passwordResetSentAt=now;cred.updatedAt=new Date(now).toISOString();this.persist();
    return {exists:true,code,expiresAt};
  }
  async clearEmailPasswordReset({email}={}){
    email=normalizeEmail(email);const cred=this.data.emailPins[email];if(!cred)return false;
    delete cred.passwordResetSalt;delete cred.passwordResetHash;delete cred.passwordResetExpiresAt;delete cred.passwordResetAttempts;delete cred.passwordResetSentAt;this.persist();return true;
  }
  async resetEmailPasswordWithCode({email,code,newPassword,now=Date.now()}={}){
    email=normalizeEmail(email);code=normalizePasswordResetCode(code);newPassword=normalizePassword(newPassword);
    if(!email||!code||!newPassword)throw authError('INVALID_RESET',`Preencha o código e uma nova senha de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres.`);
    const cred=this.data.emailPins[email];if(!cred)throw authError('INVALID_RESET','Código inválido ou expirado.');
    const expiresAt=Number(cred.passwordResetExpiresAt||0);if(!cred.passwordResetSalt||!cred.passwordResetHash||!expiresAt||expiresAt<now){await this.clearEmailPasswordReset({email});throw authError('RESET_EXPIRED','Código inválido ou expirado. Solicite um novo.');}
    const actual=await scryptHex(code,cred.passwordResetSalt);if(!safeHexEqual(actual,cred.passwordResetHash)){
      cred.passwordResetAttempts=Number(cred.passwordResetAttempts||0)+1;
      if(cred.passwordResetAttempts>=PASSWORD_RESET_MAX_ATTEMPTS){await this.clearEmailPasswordReset({email});throw authError('RESET_ATTEMPTS','Muitas tentativas incorretas. Solicite um novo código.');}
      cred.updatedAt=new Date(now).toISOString();this.persist();throw authError('INVALID_RESET','Código inválido ou expirado.');
    }
    cred.pinSalt=randomSalt();cred.pinHash=await scryptHex(newPassword,cred.pinSalt);cred.failedAttempts=0;cred.lockedUntil=0;cred.updatedAt=new Date(now).toISOString();delete cred.passwordResetSalt;delete cred.passwordResetHash;delete cred.passwordResetExpiresAt;delete cred.passwordResetAttempts;delete cred.passwordResetSentAt;this.persist();
    const user=this.data.users[cred.playerKey]||{playerKey:cred.playerKey,name:emailPinDisplayName(email)};return publicEmailPasswordUser(user,email);
  }
  async close(){}
}

class PostgresBackend {
  constructor(databaseUrl){const {Pool}=require('pg');this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});}
  async init(){
    const client=await this.pool.connect();
    try{
      await client.query(`
        CREATE TABLE IF NOT EXISTS mm_auth_users (
          player_key TEXT PRIMARY KEY,
          name VARCHAR(60) NOT NULL,
          email VARCHAR(180),
          email_normalized VARCHAR(180),
          picture VARCHAR(500),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS mm_auth_identities (
          provider VARCHAR(20) NOT NULL,
          subject_hash CHAR(64) NOT NULL,
          player_key TEXT NOT NULL REFERENCES mm_auth_users(player_key) ON DELETE CASCADE,
          provider_email VARCHAR(180),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY(provider, subject_hash)
        );
        CREATE TABLE IF NOT EXISTS mm_auth_email_pin (
          email_normalized VARCHAR(180) PRIMARY KEY,
          player_key TEXT UNIQUE NOT NULL REFERENCES mm_auth_users(player_key) ON DELETE CASCADE,
          pin_salt VARCHAR(64) NOT NULL,
          pin_hash VARCHAR(128) NOT NULL,
          recovery_salt VARCHAR(64) NOT NULL,
          recovery_hash VARCHAR(128) NOT NULL,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ
        );
      `);
      await client.query(`
        ALTER TABLE mm_auth_email_pin ADD COLUMN IF NOT EXISTS password_reset_salt VARCHAR(64);
        ALTER TABLE mm_auth_email_pin ADD COLUMN IF NOT EXISTS password_reset_hash VARCHAR(128);
        ALTER TABLE mm_auth_email_pin ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
        ALTER TABLE mm_auth_email_pin ADD COLUMN IF NOT EXISTS password_reset_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE mm_auth_email_pin ADD COLUMN IF NOT EXISTS password_reset_sent_at TIMESTAMPTZ;
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS mm_auth_users_email_normalized_uq ON mm_auth_users(email_normalized) WHERE email_normalized IS NOT NULL AND email_normalized <> ''`);
      await client.query(`CREATE INDEX IF NOT EXISTS mm_auth_identities_player_idx ON mm_auth_identities(player_key)`);
    }finally{client.release();}
  }
  async healthCheck(){const {rows}=await this.pool.query('SELECT 1 AS ok');return Number(rows?.[0]?.ok)===1;}
  async ensureSessionUser(session){
    const user=cleanUserProfile(session);if(!user.playerKey)return null;if(user.provider==='email_pin'||user.provider==='email_password')user.email='';
    await this.pool.query(`INSERT INTO mm_auth_users(player_key,name,email,email_normalized,picture,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT(player_key) DO UPDATE SET name=COALESCE(NULLIF(EXCLUDED.name,''),mm_auth_users.name),email=COALESCE(NULLIF(EXCLUDED.email,''),mm_auth_users.email),email_normalized=COALESCE(NULLIF(EXCLUDED.email_normalized,''),mm_auth_users.email_normalized),picture=COALESCE(NULLIF(EXCLUDED.picture,''),mm_auth_users.picture),updated_at=NOW()`,[user.playerKey,user.name,user.email||null,user.email||null,user.picture||null]);return user;
  }
  async resolveIdentity({provider,subject,legacyPlayerKey='',name,email,picture,verifiedEmail=true}={}){
    provider=String(provider||'').trim().toLowerCase();subject=String(subject||'').trim();if(!provider||!subject)throw new Error('Identidade de login inválida.');
    const subjectHash=identityHash(provider,subject),normalizedEmail=verifiedEmail?normalizeEmail(email):'',client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`auth:${provider}:${subjectHash}`]);
      const found=await client.query(`SELECT i.player_key,u.name,u.email,u.picture FROM mm_auth_identities i JOIN mm_auth_users u ON u.player_key=i.player_key WHERE i.provider=$1 AND i.subject_hash=$2`,[provider,subjectHash]);
      let playerKey=found.rows[0]?.player_key||'';
      if(!playerKey&&normalizedEmail){const same=await client.query(`SELECT player_key FROM mm_auth_users WHERE email_normalized=$1 LIMIT 1`,[normalizedEmail]);playerKey=same.rows[0]?.player_key||'';}
      if(!playerKey&&legacyPlayerKey)playerKey=String(legacyPlayerKey).slice(0,80);if(!playerKey)playerKey=newPlayerKey();
      await client.query(`INSERT INTO mm_auth_users(player_key,name,email,email_normalized,picture,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT(player_key) DO UPDATE SET name=COALESCE(NULLIF(EXCLUDED.name,''),mm_auth_users.name),email=COALESCE(NULLIF(EXCLUDED.email,''),mm_auth_users.email),email_normalized=COALESCE(NULLIF(EXCLUDED.email_normalized,''),mm_auth_users.email_normalized),picture=COALESCE(NULLIF(EXCLUDED.picture,''),mm_auth_users.picture),updated_at=NOW()`,[playerKey,String(name||'Jogador').trim().slice(0,60)||'Jogador',normalizedEmail||null,normalizedEmail||null,String(picture||'').trim().slice(0,500)||null]);
      await client.query(`INSERT INTO mm_auth_identities(provider,subject_hash,player_key,provider_email,created_at,last_login_at) VALUES($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT(provider,subject_hash) DO UPDATE SET player_key=EXCLUDED.player_key,provider_email=COALESCE(EXCLUDED.provider_email,mm_auth_identities.provider_email),last_login_at=NOW()`,[provider,subjectHash,playerKey,normalizedEmail||null]);
      const row=await client.query(`SELECT player_key,name,email,picture FROM mm_auth_users WHERE player_key=$1`,[playerKey]);await client.query('COMMIT');return cleanUserProfile({...row.rows[0],playerKey:row.rows[0]?.player_key,provider});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async registerEmailPin({email,pin,name}={}){
    email=normalizeEmail(email);pin=normalizePin(pin);if(!email)throw authError('INVALID_EMAIL','Informe um e-mail válido.');if(!pin)throw authError('INVALID_PIN','O PIN deve ter exatamente 6 números.');
    const playerKey=newPlayerKey(),pinSalt=randomSalt(),recoverySalt=randomSalt(),recoveryCode=generateRecoveryCode();const [pinHash,recoveryHash]=await Promise.all([scryptHex(pin,pinSalt),scryptHex(normalizeRecoveryCode(recoveryCode),recoverySalt)]);const displayName=emailPinDisplayName(email,name);const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-pin:${email}`]);
      const exists=await client.query(`SELECT 1 FROM mm_auth_email_pin WHERE email_normalized=$1`,[email]);if(exists.rowCount)throw authError('EMAIL_EXISTS','Este e-mail já possui uma conta. Use Entrar.');
      await client.query(`INSERT INTO mm_auth_users(player_key,name,email,email_normalized,picture,created_at,updated_at) VALUES($1,$2,NULL,NULL,NULL,NOW(),NOW())`,[playerKey,displayName]);
      await client.query(`INSERT INTO mm_auth_email_pin(email_normalized,player_key,pin_salt,pin_hash,recovery_salt,recovery_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())`,[email,playerKey,pinSalt,pinHash,recoverySalt,recoveryHash]);await client.query('COMMIT');
      return {user:publicEmailPinUser({playerKey,name:displayName,picture:''},email),recoveryCode};
    }catch(e){await client.query('ROLLBACK');if(e?.code==='23505')throw authError('EMAIL_EXISTS','Este e-mail já possui uma conta. Use Entrar.');throw e;}finally{client.release();}
  }
  async loginEmailPin({email,pin,now=Date.now()}={}){
    email=normalizeEmail(email);pin=normalizePin(pin);if(!email||!pin)throw authError('INVALID_CREDENTIALS','E-mail ou PIN inválido.');const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-pin:${email}`]);
      const found=await client.query(`SELECT c.*,u.name,u.picture FROM mm_auth_email_pin c JOIN mm_auth_users u ON u.player_key=c.player_key WHERE c.email_normalized=$1`,[email]);const cred=found.rows[0];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
      if(cred.locked_until&&new Date(cred.locked_until).getTime()>now)throw authError('LOCKED','Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.');
      const actual=await scryptHex(pin,cred.pin_salt);if(!safeHexEqual(actual,cred.pin_hash)){
        const attempts=Number(cred.failed_attempts||0)+1;if(attempts>=5)await client.query(`UPDATE mm_auth_email_pin SET failed_attempts=0,locked_until=NOW()+INTERVAL '15 minutes',updated_at=NOW() WHERE email_normalized=$1`,[email]);else await client.query(`UPDATE mm_auth_email_pin SET failed_attempts=$2,updated_at=NOW() WHERE email_normalized=$1`,[email,attempts]);await client.query('COMMIT');throw authError('INVALID_CREDENTIALS','E-mail ou PIN incorreto.');
      }
      await client.query(`UPDATE mm_auth_email_pin SET failed_attempts=0,locked_until=NULL,last_login_at=NOW(),updated_at=NOW() WHERE email_normalized=$1`,[email]);await client.query('COMMIT');return publicEmailPinUser({playerKey:cred.player_key,name:cred.name,picture:cred.picture||''},email);
    }catch(e){if(!['INVALID_CREDENTIALS'].includes(e?.code)){try{await client.query('ROLLBACK')}catch{}}throw e;}finally{client.release();}
  }
  async recoverEmailPin({email,recoveryCode,newPin}={}){
    email=normalizeEmail(email);newPin=normalizePin(newPin);const recovery=normalizeRecoveryCode(recoveryCode);if(!email||!newPin||!recovery)throw authError('INVALID_RECOVERY','Dados de recuperação inválidos.');const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-pin:${email}`]);const found=await client.query(`SELECT c.*,u.name,u.picture FROM mm_auth_email_pin c JOIN mm_auth_users u ON u.player_key=c.player_key WHERE c.email_normalized=$1`,[email]);const cred=found.rows[0];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
      const actual=await scryptHex(recovery,cred.recovery_salt);if(!safeHexEqual(actual,cred.recovery_hash))throw authError('INVALID_RECOVERY','Chave de recuperação inválida.');const pinSalt=randomSalt(),pinHash=await scryptHex(newPin,pinSalt);await client.query(`UPDATE mm_auth_email_pin SET pin_salt=$2,pin_hash=$3,failed_attempts=0,locked_until=NULL,updated_at=NOW() WHERE email_normalized=$1`,[email,pinSalt,pinHash]);await client.query('COMMIT');return publicEmailPinUser({playerKey:cred.player_key,name:cred.name,picture:cred.picture||''},email);
    }catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release();}
  }
  async registerEmailPassword({email,password,name}={}){
    email=normalizeEmail(email);password=normalizePassword(password);
    if(!email)throw authError('INVALID_EMAIL','Informe um e-mail válido.');
    if(!password)throw authError('INVALID_PASSWORD',`A senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
    const playerKey=newPlayerKey(),pinSalt=randomSalt(),recoverySalt=randomSalt(),recoveryCode=generateRecoveryCode();
    const [pinHash,recoveryHash]=await Promise.all([scryptHex(password,pinSalt),scryptHex(normalizeRecoveryCode(recoveryCode),recoverySalt)]);
    const displayName=emailPinDisplayName(email,name);const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-password:${email}`]);
      const exists=await client.query(`SELECT 1 FROM mm_auth_email_pin WHERE email_normalized=$1`,[email]);if(exists.rowCount)throw authError('EMAIL_EXISTS','Este e-mail já possui uma conta. Use Entrar.');
      await client.query(`INSERT INTO mm_auth_users(player_key,name,email,email_normalized,picture,created_at,updated_at) VALUES($1,$2,NULL,NULL,NULL,NOW(),NOW())`,[playerKey,displayName]);
      // A tabela/colunas mantêm o nome legado para preservar contas existentes sem recriar o banco.
      await client.query(`INSERT INTO mm_auth_email_pin(email_normalized,player_key,pin_salt,pin_hash,recovery_salt,recovery_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())`,[email,playerKey,pinSalt,pinHash,recoverySalt,recoveryHash]);await client.query('COMMIT');
      return {user:publicEmailPasswordUser({playerKey,name:displayName,picture:''},email),recoveryCode};
    }catch(e){await client.query('ROLLBACK');if(e?.code==='23505')throw authError('EMAIL_EXISTS','Este e-mail já possui uma conta. Use Entrar.');throw e;}finally{client.release();}
  }
  async loginEmailPassword({email,password,now=Date.now()}={}){
    email=normalizeEmail(email);password=normalizePassword(password,{allowLegacyPin:true});
    if(!email||!password)throw authError('INVALID_CREDENTIALS','E-mail ou senha inválida.');const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-password:${email}`]);
      const found=await client.query(`SELECT c.*,u.name,u.picture FROM mm_auth_email_pin c JOIN mm_auth_users u ON u.player_key=c.player_key WHERE c.email_normalized=$1`,[email]);const cred=found.rows[0];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
      if(cred.locked_until&&new Date(cred.locked_until).getTime()>now)throw authError('LOCKED','Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.');
      const actual=await scryptHex(password,cred.pin_salt);if(!safeHexEqual(actual,cred.pin_hash)){
        const attempts=Number(cred.failed_attempts||0)+1;if(attempts>=5)await client.query(`UPDATE mm_auth_email_pin SET failed_attempts=0,locked_until=NOW()+INTERVAL '15 minutes',updated_at=NOW() WHERE email_normalized=$1`,[email]);else await client.query(`UPDATE mm_auth_email_pin SET failed_attempts=$2,updated_at=NOW() WHERE email_normalized=$1`,[email,attempts]);await client.query('COMMIT');throw authError('INVALID_CREDENTIALS','E-mail ou senha incorreta.');
      }
      await client.query(`UPDATE mm_auth_email_pin SET failed_attempts=0,locked_until=NULL,last_login_at=NOW(),updated_at=NOW() WHERE email_normalized=$1`,[email]);await client.query('COMMIT');return publicEmailPasswordUser({playerKey:cred.player_key,name:cred.name,picture:cred.picture||''},email);
    }catch(e){if(!['INVALID_CREDENTIALS'].includes(e?.code)){try{await client.query('ROLLBACK')}catch{}}throw e;}finally{client.release();}
  }
  async recoverEmailPassword({email,recoveryCode,newPassword}={}){
    email=normalizeEmail(email);newPassword=normalizePassword(newPassword);const recovery=normalizeRecoveryCode(recoveryCode);
    if(!email||!newPassword||!recovery)throw authError('INVALID_RECOVERY',`Preencha os dados corretamente. A nova senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-password:${email}`]);const found=await client.query(`SELECT c.*,u.name,u.picture FROM mm_auth_email_pin c JOIN mm_auth_users u ON u.player_key=c.player_key WHERE c.email_normalized=$1`,[email]);const cred=found.rows[0];if(!cred)throw authError('NOT_FOUND','Conta não encontrada para este e-mail.');
      const actual=await scryptHex(recovery,cred.recovery_salt);if(!safeHexEqual(actual,cred.recovery_hash))throw authError('INVALID_RECOVERY','Chave de recuperação inválida.');const pinSalt=randomSalt(),pinHash=await scryptHex(newPassword,pinSalt);await client.query(`UPDATE mm_auth_email_pin SET pin_salt=$2,pin_hash=$3,failed_attempts=0,locked_until=NULL,updated_at=NOW() WHERE email_normalized=$1`,[email,pinSalt,pinHash]);await client.query('COMMIT');return publicEmailPasswordUser({playerKey:cred.player_key,name:cred.name,picture:cred.picture||''},email);
    }catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release();}
  }

  async issueEmailPasswordResetCode({email,now=Date.now()}={}){
    email=normalizeEmail(email);if(!email)throw authError('INVALID_EMAIL','Informe um e-mail válido.');const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-reset:${email}`]);
      const found=await client.query(`SELECT email_normalized FROM mm_auth_email_pin WHERE email_normalized=$1`,[email]);if(!found.rowCount){await client.query('COMMIT');return {exists:false};}
      const code=generatePasswordResetCode(),salt=randomSalt(),hash=await scryptHex(code,salt),expiresAt=new Date(now+PASSWORD_RESET_TTL_MS);
      await client.query(`UPDATE mm_auth_email_pin SET password_reset_salt=$2,password_reset_hash=$3,password_reset_expires_at=$4,password_reset_attempts=0,password_reset_sent_at=NOW(),updated_at=NOW() WHERE email_normalized=$1`,[email,salt,hash,expiresAt]);await client.query('COMMIT');return {exists:true,code,expiresAt:expiresAt.getTime()};
    }catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release();}
  }
  async clearEmailPasswordReset({email}={}){
    email=normalizeEmail(email);if(!email)return false;const result=await this.pool.query(`UPDATE mm_auth_email_pin SET password_reset_salt=NULL,password_reset_hash=NULL,password_reset_expires_at=NULL,password_reset_attempts=0,password_reset_sent_at=NULL,updated_at=NOW() WHERE email_normalized=$1`,[email]);return result.rowCount>0;
  }
  async resetEmailPasswordWithCode({email,code,newPassword,now=Date.now()}={}){
    email=normalizeEmail(email);code=normalizePasswordResetCode(code);newPassword=normalizePassword(newPassword);
    if(!email||!code||!newPassword)throw authError('INVALID_RESET',`Preencha o código e uma nova senha de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres.`);const client=await this.pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`email-reset:${email}`]);
      const found=await client.query(`SELECT c.*,u.name,u.picture FROM mm_auth_email_pin c JOIN mm_auth_users u ON u.player_key=c.player_key WHERE c.email_normalized=$1`,[email]);const cred=found.rows[0];
      if(!cred||!cred.password_reset_salt||!cred.password_reset_hash||!cred.password_reset_expires_at||new Date(cred.password_reset_expires_at).getTime()<now){
        if(cred)await client.query(`UPDATE mm_auth_email_pin SET password_reset_salt=NULL,password_reset_hash=NULL,password_reset_expires_at=NULL,password_reset_attempts=0,password_reset_sent_at=NULL,updated_at=NOW() WHERE email_normalized=$1`,[email]);
        await client.query('COMMIT');throw authError('RESET_EXPIRED','Código inválido ou expirado. Solicite um novo.');
      }
      const actual=await scryptHex(code,cred.password_reset_salt);if(!safeHexEqual(actual,cred.password_reset_hash)){
        const attempts=Number(cred.password_reset_attempts||0)+1;
        if(attempts>=PASSWORD_RESET_MAX_ATTEMPTS)await client.query(`UPDATE mm_auth_email_pin SET password_reset_salt=NULL,password_reset_hash=NULL,password_reset_expires_at=NULL,password_reset_attempts=0,password_reset_sent_at=NULL,updated_at=NOW() WHERE email_normalized=$1`,[email]);
        else await client.query(`UPDATE mm_auth_email_pin SET password_reset_attempts=$2,updated_at=NOW() WHERE email_normalized=$1`,[email,attempts]);
        await client.query('COMMIT');throw authError(attempts>=PASSWORD_RESET_MAX_ATTEMPTS?'RESET_ATTEMPTS':'INVALID_RESET',attempts>=PASSWORD_RESET_MAX_ATTEMPTS?'Muitas tentativas incorretas. Solicite um novo código.':'Código inválido ou expirado.');
      }
      const pinSalt=randomSalt(),pinHash=await scryptHex(newPassword,pinSalt);
      await client.query(`UPDATE mm_auth_email_pin SET pin_salt=$2,pin_hash=$3,failed_attempts=0,locked_until=NULL,password_reset_salt=NULL,password_reset_hash=NULL,password_reset_expires_at=NULL,password_reset_attempts=0,password_reset_sent_at=NULL,updated_at=NOW() WHERE email_normalized=$1`,[email,pinSalt,pinHash]);await client.query('COMMIT');return publicEmailPasswordUser({playerKey:cred.player_key,name:cred.name,picture:cred.picture||''},email);
    }catch(e){if(!['INVALID_RESET','RESET_EXPIRED','RESET_ATTEMPTS'].includes(e?.code)){try{await client.query('ROLLBACK')}catch{}}throw e;}finally{client.release();}
  }
  async close(){await this.pool.end();}
}

class AuthIdentityStore {
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=process.env.AUTH_IDENTITY_FILE||path.join(__dirname,'data','auth-identities.json')}={}){this.kind=databaseUrl?'postgres':'json';this.backend=databaseUrl?new PostgresBackend(databaseUrl):new JsonBackend(filePath);}
  async init(){return this.backend.init();}
  async healthCheck(){return this.backend.healthCheck();}
  async ensureSessionUser(session){return this.backend.ensureSessionUser(session);}
  async resolveIdentity(opts){return this.backend.resolveIdentity(opts);}
  async registerEmailPin(opts){return this.backend.registerEmailPin(opts);}
  async loginEmailPin(opts){return this.backend.loginEmailPin(opts);}
  async recoverEmailPin(opts){return this.backend.recoverEmailPin(opts);}
  async registerEmailPassword(opts){return this.backend.registerEmailPassword(opts);}
  async loginEmailPassword(opts){return this.backend.loginEmailPassword(opts);}
  async recoverEmailPassword(opts){return this.backend.recoverEmailPassword(opts);}
  async issueEmailPasswordResetCode(opts){return this.backend.issueEmailPasswordResetCode(opts);}
  async clearEmailPasswordReset(opts){return this.backend.clearEmailPasswordReset(opts);}
  async resetEmailPasswordWithCode(opts){return this.backend.resetEmailPasswordWithCode(opts);}
  async close(){return this.backend.close();}
}

module.exports={AuthIdentityStore,normalizeEmail,normalizePin,normalizePassword,normalizePasswordResetCode,normalizeRecoveryCode,identityHash,newPlayerKey,cleanUserProfile,generateRecoveryCode,generatePasswordResetCode,PASSWORD_MIN_LENGTH,PASSWORD_MAX_LENGTH,PASSWORD_RESET_TTL_MS,PASSWORD_RESET_MAX_ATTEMPTS};

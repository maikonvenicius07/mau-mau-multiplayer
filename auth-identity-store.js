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

function identityHash(provider,subject) {
  return crypto.createHash('sha256').update(`mau-mau-auth:${String(provider||'').toLowerCase()}:${String(subject||'')}`).digest('hex');
}

function newPlayerKey() {
  return `u_${crypto.randomBytes(20).toString('hex')}`;
}

function cleanUserProfile({playerKey,name,email,picture,provider}={}) {
  return {
    playerKey:String(playerKey||'').slice(0,80),
    name:String(name||'Jogador').trim().slice(0,60)||'Jogador',
    email:normalizeEmail(email),
    picture:String(picture||'').trim().slice(0,500),
    provider:String(provider||'').trim().toLowerCase().slice(0,20),
  };
}

class JsonBackend {
  constructor(filePath){
    this.filePath=filePath;
    this.data={version:1,users:{},identities:{}};
  }
  async init(){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    try{
      const parsed=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if(parsed&&parsed.version===1&&parsed.users&&parsed.identities)this.data=parsed;
    }catch(e){if(e.code!=='ENOENT')console.warn('[auth-store] falha ao ler JSON:',e.message);}
  }
  persist(){
    const tmp=`${this.filePath}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));
    fs.renameSync(tmp,this.filePath);
  }
  async healthCheck(){return true;}
  async ensureSessionUser(session){
    const user=cleanUserProfile(session);
    if(!user.playerKey)return null;
    const prior=this.data.users[user.playerKey]||{};
    this.data.users[user.playerKey]={...prior,...user,provider:user.provider||prior.provider||'',updatedAt:new Date().toISOString(),createdAt:prior.createdAt||new Date().toISOString()};
    this.persist();
    return this.data.users[user.playerKey];
  }
  async resolveIdentity({provider,subject,legacyPlayerKey='',name,email,picture,verifiedEmail=true}={}){
    provider=String(provider||'').trim().toLowerCase();subject=String(subject||'').trim();
    if(!provider||!subject)throw new Error('Identidade de login inválida.');
    const key=`${provider}:${identityHash(provider,subject)}`;
    const normalizedEmail=verifiedEmail?normalizeEmail(email):'';
    const now=new Date().toISOString();
    const existingIdentity=this.data.identities[key];
    if(existingIdentity){
      const prior=this.data.users[existingIdentity.playerKey]||{playerKey:existingIdentity.playerKey};
      const user=cleanUserProfile({
        playerKey:existingIdentity.playerKey,
        name:name||prior.name,
        email:normalizedEmail||prior.email,
        picture:picture||prior.picture,
        provider,
      });
      this.data.users[user.playerKey]={...prior,...user,createdAt:prior.createdAt||now,updatedAt:now};
      existingIdentity.lastLoginAt=now;
      if(normalizedEmail)existingIdentity.providerEmail=normalizedEmail;
      this.persist();
      return {...user,provider};
    }
    let playerKey='';
    if(normalizedEmail){
      const sameEmail=Object.values(this.data.users).find(u=>normalizeEmail(u?.email)===normalizedEmail);
      if(sameEmail?.playerKey)playerKey=sameEmail.playerKey;
    }
    if(!playerKey&&legacyPlayerKey)playerKey=String(legacyPlayerKey).slice(0,80);
    if(!playerKey)playerKey=newPlayerKey();
    const prior=this.data.users[playerKey]||{};
    const user=cleanUserProfile({playerKey,name:name||prior.name,email:normalizedEmail||prior.email,picture:picture||prior.picture,provider});
    this.data.users[playerKey]={...prior,...user,createdAt:prior.createdAt||now,updatedAt:now};
    this.data.identities[key]={provider,subjectHash:identityHash(provider,subject),playerKey,providerEmail:normalizedEmail,createdAt:now,lastLoginAt:now};
    this.persist();
    return {...user,provider};
  }
  async close(){}
}

class PostgresBackend {
  constructor(databaseUrl){
    const {Pool}=require('pg');
    this.pool=new Pool({connectionString:databaseUrl,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});
  }
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
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS mm_auth_users_email_normalized_uq ON mm_auth_users(email_normalized) WHERE email_normalized IS NOT NULL AND email_normalized <> ''`);
      await client.query(`CREATE INDEX IF NOT EXISTS mm_auth_identities_player_idx ON mm_auth_identities(player_key)`);
    }finally{client.release();}
  }
  async healthCheck(){const {rows}=await this.pool.query('SELECT 1 AS ok');return Number(rows?.[0]?.ok)===1;}
  async ensureSessionUser(session){
    const user=cleanUserProfile(session);if(!user.playerKey)return null;
    await this.pool.query(
      `INSERT INTO mm_auth_users(player_key,name,email,email_normalized,picture,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,NOW(),NOW())
       ON CONFLICT(player_key) DO UPDATE SET
         name=COALESCE(NULLIF(EXCLUDED.name,''),mm_auth_users.name),
         email=COALESCE(NULLIF(EXCLUDED.email,''),mm_auth_users.email),
         email_normalized=COALESCE(NULLIF(EXCLUDED.email_normalized,''),mm_auth_users.email_normalized),
         picture=COALESCE(NULLIF(EXCLUDED.picture,''),mm_auth_users.picture),updated_at=NOW()`,
      [user.playerKey,user.name,user.email||null,user.email||null,user.picture||null]
    );
    return user;
  }
  async resolveIdentity({provider,subject,legacyPlayerKey='',name,email,picture,verifiedEmail=true}={}){
    provider=String(provider||'').trim().toLowerCase();subject=String(subject||'').trim();
    if(!provider||!subject)throw new Error('Identidade de login inválida.');
    const subjectHash=identityHash(provider,subject);
    const normalizedEmail=verifiedEmail?normalizeEmail(email):'';
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`auth:${provider}:${subjectHash}`]);
      const found=await client.query(
        `SELECT i.player_key,u.name,u.email,u.picture FROM mm_auth_identities i JOIN mm_auth_users u ON u.player_key=i.player_key WHERE i.provider=$1 AND i.subject_hash=$2`,
        [provider,subjectHash]
      );
      let playerKey=found.rows[0]?.player_key||'';
      if(!playerKey&&normalizedEmail){
        const same=await client.query(`SELECT player_key FROM mm_auth_users WHERE email_normalized=$1 LIMIT 1`,[normalizedEmail]);
        playerKey=same.rows[0]?.player_key||'';
      }
      if(!playerKey&&legacyPlayerKey)playerKey=String(legacyPlayerKey).slice(0,80);
      if(!playerKey)playerKey=newPlayerKey();
      await client.query(
        `INSERT INTO mm_auth_users(player_key,name,email,email_normalized,picture,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,NOW(),NOW())
         ON CONFLICT(player_key) DO UPDATE SET
           name=COALESCE(NULLIF(EXCLUDED.name,''),mm_auth_users.name),
           email=COALESCE(NULLIF(EXCLUDED.email,''),mm_auth_users.email),
           email_normalized=COALESCE(NULLIF(EXCLUDED.email_normalized,''),mm_auth_users.email_normalized),
           picture=COALESCE(NULLIF(EXCLUDED.picture,''),mm_auth_users.picture),updated_at=NOW()`,
        [playerKey,String(name||'Jogador').trim().slice(0,60)||'Jogador',normalizedEmail||null,normalizedEmail||null,String(picture||'').trim().slice(0,500)||null]
      );
      await client.query(
        `INSERT INTO mm_auth_identities(provider,subject_hash,player_key,provider_email,created_at,last_login_at)
         VALUES($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT(provider,subject_hash) DO UPDATE SET player_key=EXCLUDED.player_key,provider_email=COALESCE(EXCLUDED.provider_email,mm_auth_identities.provider_email),last_login_at=NOW()`,
        [provider,subjectHash,playerKey,normalizedEmail||null]
      );
      const row=await client.query(`SELECT player_key,name,email,picture FROM mm_auth_users WHERE player_key=$1`,[playerKey]);
      await client.query('COMMIT');
      return cleanUserProfile({...row.rows[0],playerKey:row.rows[0]?.player_key,provider});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async close(){await this.pool.end();}
}

class AuthIdentityStore {
  constructor({databaseUrl=process.env.DATABASE_URL,filePath=process.env.AUTH_IDENTITY_FILE||path.join(__dirname,'data','auth-identities.json')}={}){
    this.kind=databaseUrl?'postgres':'json';
    this.backend=databaseUrl?new PostgresBackend(databaseUrl):new JsonBackend(filePath);
  }
  async init(){return this.backend.init();}
  async healthCheck(){return this.backend.healthCheck();}
  async ensureSessionUser(session){return this.backend.ensureSessionUser(session);}
  async resolveIdentity(opts){return this.backend.resolveIdentity(opts);}
  async close(){return this.backend.close();}
}

module.exports={AuthIdentityStore,normalizeEmail,identityHash,newPlayerKey,cleanUserProfile};

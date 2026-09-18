'use strict';

const MAX_NAME_LENGTH = 24;
const MAX_CHAT_LENGTH = 180;
const MAX_SHORT_AVATAR_LENGTH = 24;
const MAX_CUSTOM_AVATAR_LENGTH = 180000;
const MAX_OPAQUE_ID_LENGTH = 160;
const MAX_CARD_ID_LENGTH = 80;
const MAX_ROOM_CODE_LENGTH = 6;
const CUSTOM_AVATAR_DATA_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i;
const CUSTOM_AVATAR_REF_RE = /^custom-avatar:[a-f0-9]{32}$/;

function stringOnly(value, maxInputLength = 4096) {
  if (typeof value !== 'string') return '';
  return value.length > maxInputLength ? value.slice(0, maxInputLength) : value;
}

function cleanHumanText(value, {maxInputLength=1024, maxOutputLength=180}={}) {
  return stringOnly(value,maxInputLength)
    .replace(/[\u0000-\u001F\u007F]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,maxOutputLength);
}

function cleanPresenceName(value, fallback='Jogador') {
  return cleanHumanText(value,{maxInputLength:256,maxOutputLength:MAX_NAME_LENGTH}) || fallback;
}

function cleanChatText(value) {
  return cleanHumanText(value,{maxInputLength:2048,maxOutputLength:MAX_CHAT_LENGTH});
}

function cleanAvatar(value, fallback='macaco') {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw) return fallback;
  if (CUSTOM_AVATAR_REF_RE.test(raw)) return raw;
  if (raw.startsWith('data:image/')) {
    if (raw.length > MAX_CUSTOM_AVATAR_LENGTH) return fallback;
    return CUSTOM_AVATAR_DATA_RE.test(raw) ? raw : fallback;
  }
  return cleanHumanText(raw,{maxInputLength:128,maxOutputLength:MAX_SHORT_AVATAR_LENGTH}) || fallback;
}

function cleanOpaqueId(value, maxLength=MAX_OPAQUE_ID_LENGTH) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0,Math.max(1,Math.min(256,Number(maxLength)||MAX_OPAQUE_ID_LENGTH)));
}

function cleanCardId(value) {
  return cleanOpaqueId(value,MAX_CARD_ID_LENGTH);
}

function cleanRoomCode(value) {
  if (typeof value !== 'string') return '';
  const code=value.trim().toUpperCase();
  return /^[A-Z2-9]{6}$/.test(code) ? code : '';
}

function cleanEnumToken(value, maxLength=32) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0,Math.max(1,Math.min(64,Number(maxLength)||32)));
}

function firstSafeStrings(values,{maxItems=16,maxLength=160,filter=null}={}) {
  if (!Array.isArray(values)) return [];
  const out=[];
  const limit=Math.max(0,Math.min(64,Number(maxItems)||16));
  for (const value of values.slice(0,limit)) {
    const cleaned=cleanOpaqueId(value,maxLength);
    if (!cleaned) continue;
    if (filter && !filter(cleaned)) continue;
    out.push(cleaned);
  }
  return out;
}

module.exports={
  MAX_NAME_LENGTH,
  MAX_CHAT_LENGTH,
  MAX_SHORT_AVATAR_LENGTH,
  MAX_CUSTOM_AVATAR_LENGTH,
  MAX_OPAQUE_ID_LENGTH,
  MAX_CARD_ID_LENGTH,
  MAX_ROOM_CODE_LENGTH,
  CUSTOM_AVATAR_DATA_RE,
  CUSTOM_AVATAR_REF_RE,
  cleanHumanText,
  cleanPresenceName,
  cleanChatText,
  cleanAvatar,
  cleanOpaqueId,
  cleanCardId,
  cleanRoomCode,
  cleanEnumToken,
  firstSafeStrings,
};

'use strict';

const crypto = require('crypto');

const CUSTOM_AVATAR_DATA_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i;
const CUSTOM_AVATAR_REF_RE = /^custom-avatar:[a-f0-9]{32}$/;

function isCustomAvatarData(value) {
  return CUSTOM_AVATAR_DATA_RE.test(String(value || ''));
}

function isCustomAvatarRef(value) {
  return CUSTOM_AVATAR_REF_RE.test(String(value || ''));
}

function avatarRefFor(value) {
  const raw = String(value || '');
  if (!isCustomAvatarData(raw)) return null;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0,32);
  return `custom-avatar:${hash}`;
}

function leanAvatarValue(value) {
  return avatarRefFor(value) || value;
}

function leanRoundReview(review) {
  if (!review || typeof review !== 'object') return review;
  return {
    ...review,
    winnerAvatar: leanAvatarValue(review.winnerAvatar),
    players: Array.isArray(review.players)
      ? review.players.map(player => ({...player, avatar:leanAvatarValue(player.avatar)}))
      : review.players,
  };
}

function leanStateAvatars(state) {
  if (!state || typeof state !== 'object') return state;
  return {
    ...state,
    spectators: Array.isArray(state.spectators)
      ? state.spectators.map(s => ({...s, avatar:leanAvatarValue(s.avatar)}))
      : state.spectators,
    players: Array.isArray(state.players)
      ? state.players.map(p => ({...p, avatar:leanAvatarValue(p.avatar)}))
      : state.players,
    me: state.me ? {...state.me, avatar:leanAvatarValue(state.me.avatar)} : state.me,
    roundReview: leanRoundReview(state.roundReview),
  };
}

function collectRoomAvatarAssets(room) {
  const assets = new Map();
  const add = value => {
    const ref = avatarRefFor(value);
    if (ref) assets.set(ref, String(value));
  };
  if (!room || typeof room !== 'object') return assets;
  for (const player of Array.isArray(room.players) ? room.players : []) add(player?.avatar);
  for (const spectator of Array.isArray(room.spectators) ? room.spectators : []) add(spectator?.avatar);
  add(room.roundReview?.winnerAvatar);
  for (const player of Array.isArray(room.roundReview?.players) ? room.roundReview.players : []) add(player?.avatar);
  return assets;
}

module.exports = {
  CUSTOM_AVATAR_REF_RE,
  isCustomAvatarData,
  isCustomAvatarRef,
  avatarRefFor,
  leanAvatarValue,
  leanStateAvatars,
  collectRoomAvatarAssets,
};

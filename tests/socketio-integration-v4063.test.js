'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io: clientIo } = require('socket.io-client');
const pkg = require('../package.json');

assert.strictEqual(pkg.version, '40.68', 'package.json deve identificar V40.63');
assert.strictEqual(pkg.dependencies['socket.io-client'], '4.8.1', 'cliente Socket.IO real deve estar fixado na mesma linha do servidor');

const AUTH_SECRET = 'v4063-integration-secret-fixed-for-tests-only';
const AUTH_COOKIE = 'maumau_google_session';
const root = path.join(__dirname, '..');
const sockets = new Set();
let child = null;
let tempDir = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function googlePlayerKey(sub) {
  return `g_${crypto.createHash('sha256').update(`mau-mau-google:${sub}`).digest('hex').slice(0, 40)}`;
}

function authCookie(sub, name) {
  const payload = Buffer.from(JSON.stringify({
    playerKey: googlePlayerKey(sub),
    name,
    email: `${sub}@teste.invalid`,
    picture: '',
    exp: Date.now() + 60 * 60 * 1000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${AUTH_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}`;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(err => err ? reject(err) : resolve(port));
    });
  });
}

function waitEvent(socket, event, { timeout = 4000, predicate = () => true } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout aguardando ${event}`));
    }, timeout);
    const onEvent = data => {
      let ok = false;
      try { ok = predicate(data); } catch (e) { cleanup(); reject(e); return; }
      if (!ok) return;
      cleanup();
      resolve(data);
    };
    const cleanup = () => { clearTimeout(timer); socket.off(event, onEvent); };
    socket.on(event, onEvent);
  });
}

async function waitUntil(fn, { timeout = 4000, interval = 15, label = 'condição' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`timeout aguardando ${label}`);
}

async function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando ack de ${event}`)), 4000);
    const ack = data => { clearTimeout(timer); resolve(data); };
    if (payload === undefined) socket.emit(event, ack);
    else socket.emit(event, payload, ack);
  });
}

async function connectUser(baseUrl, sub, name) {
  const socket = clientIo(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000,
    extraHeaders: { Cookie: authCookie(sub, name) },
  });
  sockets.add(socket);
  socket.lastState = null;
  socket.on('state', state => { socket.lastState = state; });
  await Promise.race([
    waitEvent(socket, 'connect', { timeout: 4000 }),
    waitEvent(socket, 'connect_error', { timeout: 4000 }).then(e => { throw e; }),
  ]);
  socket.emit('presenceProfile', { name, avatar: 'macaco' });
  return socket;
}

async function createRoom(socket, name, opts = {}) {
  const joinedP = waitEvent(socket, 'joined');
  socket.emit('createRoom', { name, avatar: 'macaco', publicRoom: true, ...opts });
  return joinedP;
}

async function joinRoom(socket, code, name, extra = {}) {
  const joinedP = waitEvent(socket, 'joined');
  const errorP = waitEvent(socket, 'gameError').then(e => { throw new Error(e?.message || 'gameError'); });
  socket.emit('joinRoom', { code, name, avatar: 'macaco', ...extra });
  return Promise.race([joinedP, errorP]);
}

async function startRound(host) {
  host.emit('startRound');
  await waitUntil(() => host.lastState?.status === 'playing' && host.lastState, { label: 'rodada iniciar' });
}

function playerIn(state, id) {
  return state?.players?.find(p => p.id === id) || null;
}

async function startServer() {
  const port = await freePort();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mau-v4063-'));
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    AUTH_SESSION_SECRET: AUTH_SECRET,
    GOOGLE_CLIENT_ID: '',
    DATABASE_URL: '',
    RANKING_FILE: path.join(tempDir, 'ranking.json'),
    ROOM_SNAPSHOT_FILE: path.join(tempDir, 'rooms.json'),
    MAUMAU_TEST_DISCONNECT_DEBOUNCE_MS: '35',
    MAUMAU_TEST_RECONNECT_GRACE_MS: '500',
    MAUMAU_HTTP_LOGS: '0',
  };
  child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });
  await new Promise((resolve, reject) => {
    const end = Date.now() + 7000;
    const poll = () => {
      if (/Mau-Mau online em http:\/\/localhost:/.test(output)) return resolve();
      if (child.exitCode !== null) return reject(new Error(`servidor encerrou antes de iniciar:\n${output}`));
      if (Date.now() > end) return reject(new Error(`timeout iniciando servidor:\n${output}`));
      setTimeout(poll, 20);
    };
    poll();
  });
  return `http://127.0.0.1:${port}`;
}

async function cleanup() {
  for (const socket of sockets) {
    try { socket.removeAllListeners(); socket.disconnect(); } catch {}
  }
  sockets.clear();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      sleep(2500).then(() => { try { child.kill('SIGKILL'); } catch {} }),
    ]);
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}

async function scenarioReconnect(baseUrl) {
  const alice = await connectUser(baseUrl, 'alice-v4063', 'Alice');
  const bob = await connectUser(baseUrl, 'bob-v4063', 'Bob');
  const aJoined = await createRoom(alice, 'Alice');
  const code = aJoined.code;
  const aliceId = aJoined.playerId;
  const aliceToken = aJoined.token;
  await joinRoom(bob, code, 'Bob');
  await waitUntil(() => alice.lastState?.players?.length === 2, { label: '2 jogadores na sala' });
  await startRound(alice);
  const originalHand = alice.lastState.me.hand.map(c => c.id).sort();

  // Refresh/queda antes do prazo: reconecta pelo token salvo na MESMA cadeira e mão.
  alice.disconnect();
  await waitUntil(() => {
    const p = playerIn(bob.lastState, aliceId);
    return p && p.connected === false && p.reconnectDeadlineAt;
  }, { label: 'queda involuntária registrada' });
  const aliceRefresh = await connectUser(baseUrl, 'alice-v4063', 'Alice');
  const refreshed = await joinRoom(aliceRefresh, code, 'Alice', { token: aliceToken, resumeIntent: 'saved-session' });
  assert.strictEqual(refreshed.playerId, aliceId, 'refresh deve retomar a mesma cadeira');
  await waitUntil(() => aliceRefresh.lastState?.me?.id === aliceId, { label: 'estado após refresh' });
  assert.deepStrictEqual(aliceRefresh.lastState.me.hand.map(c => c.id).sort(), originalHand, 'refresh deve preservar a mão');

  // Queda além do prazo: AUTO assume e a Conta Google retoma depois sem código/token.
  aliceRefresh.disconnect();
  await waitUntil(() => playerIn(bob.lastState, aliceId)?.autoControlled === true, { timeout: 3000, label: 'AUTO assumir após prazo acelerado' });
  const handAtAuto = playerIn(bob.lastState, aliceId).cardCount;
  const aliceReturn = await connectUser(baseUrl, 'alice-v4063', 'Alice');
  const resultP = waitEvent(aliceReturn, 'resumeActiveSeatResult');
  aliceReturn.emit('resumeActiveSeat');
  const resumed = await resultP;
  assert.strictEqual(resumed.ok, true, 'retorno após AUTO deve ser aceito');
  assert.strictEqual(resumed.fromAuto, true, 'retorno deve informar que substituiu AUTO');
  assert.strictEqual(resumed.playerId, aliceId, 'AUTO não pode trocar a cadeira original');
  await waitUntil(() => aliceReturn.lastState?.me?.id === aliceId, { label: 'estado após AUTO' });
  assert.strictEqual(aliceReturn.lastState.me.hand.length, handAtAuto, 'jogador deve receber a mão atual da cadeira AUTO');
  assert.strictEqual(playerIn(aliceReturn.lastState, aliceId).autoControlled, false, 'AUTO deve ser removido após retorno');

  // SAIR voluntário: cancela a reserva; a cadeira vira Máquina e auto-resume não volta.
  const leftP = waitEvent(aliceReturn, 'leftRoom');
  const ack = await emitAck(aliceReturn, 'leaveRoom');
  assert.strictEqual(ack.ok, true, 'SAIR deve ser confirmado pelo servidor');
  await leftP;
  await waitUntil(() => playerIn(bob.lastState, aliceId)?.isBot === true, { label: 'cadeira abandonada virar Máquina comum' });
  const aliceAfterLeave = await connectUser(baseUrl, 'alice-v4063', 'Alice');
  const noResumeP = waitEvent(aliceAfterLeave, 'resumeActiveSeatResult');
  aliceAfterLeave.emit('resumeActiveSeat');
  const noResume = await noResumeP;
  assert.strictEqual(noResume.ok, false, 'SAIR não pode permitir reconexão automática posterior');
  assert.strictEqual(noResume.reason, 'none');

  return { code, bob };
}

async function scenarioSwitchRoom(baseUrl) {
  const carlos = await connectUser(baseUrl, 'carlos-v4063', 'Carlos');
  const dani = await connectUser(baseUrl, 'dani-v4063', 'Dani');
  const eva = await connectUser(baseUrl, 'eva-v4063', 'Eva');
  const oldJoined = await createRoom(carlos, 'Carlos');
  await joinRoom(dani, oldJoined.code, 'Dani');
  await waitUntil(() => carlos.lastState?.players?.length === 2, { label: 'sala antiga pronta' });
  await startRound(carlos);
  const oldCarlosId = oldJoined.playerId;
  carlos.disconnect();
  await waitUntil(() => playerIn(dani.lastState, oldCarlosId)?.connected === false, { label: 'reserva antiga desconectada' });

  const target = await createRoom(eva, 'Eva');
  const carlosNew = await connectUser(baseUrl, 'carlos-v4063', 'Carlos');
  const entered = await joinRoom(carlosNew, target.code, 'Carlos');
  assert.strictEqual(entered.code, target.code, 'entrada normal em nova sala deve funcionar');
  await waitUntil(() => playerIn(dani.lastState, oldCarlosId)?.isBot === true, { label: 'vaga antiga perder associação humana' });

  // Uma nova sessão da mesma conta não pode ressuscitar a reserva antiga.
  const carlosProbe = await connectUser(baseUrl, 'carlos-v4063', 'Carlos');
  const probeP = waitEvent(carlosProbe, 'resumeActiveSeatResult');
  carlosProbe.emit('resumeActiveSeat');
  const probe = await probeP;
  assert.strictEqual(probe.ok, false, 'entrar em outra sala deve cancelar a reserva automática anterior');
}

async function scenarioInvite(baseUrl) {
  const host = await connectUser(baseUrl, 'invite-host-v4063', 'HostConvite');
  const guest = await connectUser(baseUrl, 'invite-guest-v4063', 'Convidado');
  const room = await createRoom(host, 'HostConvite');
  await sleep(70); // presença do convidado já registrada no servidor
  const inviteP = waitEvent(guest, 'inviteReceived');
  host.emit('sendInvite', {
    targetPlayerKey: googlePlayerKey('invite-guest-v4063'),
    profile: { name: 'HostConvite', avatar: 'macaco' },
  });
  const invite = await inviteP;
  assert.strictEqual(invite.targetRoomCode, room.code, 'convite real deve apontar para a sala do anfitrião');
  const joinedP = waitEvent(guest, 'joined');
  guest.emit('respondInvite', { inviteId: invite.id, accept: true });
  const joined = await joinedP;
  assert.strictEqual(joined.code, room.code, 'aceitar convite deve ingressar pela conexão Socket.IO real');
}

async function scenarioTwoDrops(baseUrl) {
  const h = await connectUser(baseUrl, 'drop-h-v4063', 'Hugo');
  const i = await connectUser(baseUrl, 'drop-i-v4063', 'Iara');
  const j = await connectUser(baseUrl, 'drop-j-v4063', 'Joao');
  const hj = await createRoom(h, 'Hugo');
  const ij = await joinRoom(i, hj.code, 'Iara');
  await joinRoom(j, hj.code, 'Joao');
  await waitUntil(() => h.lastState?.players?.length === 3, { label: '3 jogadores prontos' });
  await startRound(h);
  const hId = hj.playerId, iId = ij.playerId;

  h.disconnect();
  i.disconnect();
  await waitUntil(() => {
    const hp = playerIn(j.lastState, hId), ip = playerIn(j.lastState, iId);
    return hp?.connected === false && ip?.connected === false;
  }, { label: 'duas quedas simultâneas' });

  // Um retorna antes do prazo, o outro fica em AUTO: reservas independentes.
  const h2 = await connectUser(baseUrl, 'drop-h-v4063', 'Hugo');
  const hResumeP = waitEvent(h2, 'resumeActiveSeatResult');
  h2.emit('resumeActiveSeat');
  assert.strictEqual((await hResumeP).ok, true, 'primeiro jogador deve conseguir retornar');
  await waitUntil(() => playerIn(j.lastState, hId)?.connected === true, { label: 'primeiro retorno' });
  await waitUntil(() => playerIn(j.lastState, iId)?.autoControlled === true, { timeout: 3000, label: 'segundo jogador entrar em AUTO' });
  assert.strictEqual(playerIn(j.lastState, hId).autoControlled, false, 'retorno de um jogador não pode alterar a reserva do outro');
}

(async () => {
  try {
    const baseUrl = await startServer();
    await scenarioReconnect(baseUrl);
    await scenarioSwitchRoom(baseUrl);
    await scenarioInvite(baseUrl);
    await scenarioTwoDrops(baseUrl);
    console.log('✓ V40.63: integração Socket.IO real validou refresh, queda, AUTO, retorno, SAIR, troca de sala, convite e duas quedas simultâneas.');
  } catch (e) {
    console.error(e?.stack || e);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();

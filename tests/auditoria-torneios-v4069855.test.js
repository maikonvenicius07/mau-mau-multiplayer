'use strict';
// V40.69.8.59 — contrato atual da reconciliação de torneios.
// O catálogo aceita list({status:'closed'}), enquanto a rotina faz a validação
// defensiva do status e isola exceções de um torneio sem parar os demais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('let tournamentReconcileRunning=false;');
const end = source.indexOf('const tournamentProgressTimer=', start);
assert(start >= 0 && end > start, 'Rotina de reconciliação presente no servidor');
const routine = source.slice(start, end);

const processed = [];
const notified = [];
const errors = [];
const listArguments = [];
const first = [{ number: 1, players: [{playerKey: 'a'}, {playerKey: 'b'}] }];
const context = vm.createContext({
  snapshotsRestored: true,
  ensureTournamentBracketReady: async () => true,
  ensureTournamentPodiumReady: async () => true,
  tournamentCatalog: {
    list: async (...args) => {
      listArguments.push(args);
      return [
        {id: 'aberto', status: 'open'},
        {id: 'falhou', status: 'closed'},
        {id: 'saudavel', status: 'closed'},
        {id: 'cancelado', status: 'cancelled'}
      ];
    }
  },
  tournamentDraw: { get: async id => {
    processed.push(id);
    if (id === 'falhou') throw new Error('FALHA_SIMULADA');
    return first;
  } },
  tournamentBracket: { advance: async () => ({champion: null, currentStage: 'qualifier', stages: []}) },
  tournamentGames: { get: async () => ({roomCode: null}) },
  tournamentPodiumArchive: { record: async () => {} },
  rooms: new Map(),
  maybeResolveTournamentLobbyWalkover: () => false,
  emitRoom: () => {},
  notifyTournamentSeats: async (id, stage, tables) => notified.push(`${id}:${stage}:${tables.length}`),
  console: {error: (...args) => errors.push(args.map(String).join(' '))},
  Date, Map, Set
});
vm.runInContext(routine, context);

(async () => {
  await vm.runInContext('reconcileTournamentProgress()', context);
  assert.equal(listArguments.length, 1, 'Um único acesso ao catálogo no ciclo');
  assert.equal(listArguments[0].length, 1,
    'A consulta de reconciliação deve usar o filtro seletivo de status');
  assert.equal(listArguments[0][0]?.status, 'closed',
    "O catálogo já aceita list({status:'closed'}); não consultar torneios abertos no banco");
  assert.deepEqual(processed, ['falhou', 'saudavel'],
    'Somente torneios com inscrições encerradas são processados');
  assert.deepEqual(notified, ['saudavel:qualifier:1'],
    'Um torneio saudável continua mesmo após outro apresentar falha');
  assert(errors.some(line => line.includes('falhou') && line.includes('FALHA_SIMULADA')),
    'A falha isolada é registrada com o identificador correto');
  assert.equal(vm.runInContext('tournamentReconcileRunning', context), false,
    'A trava do ciclo é liberada');
  console.log('✓ V40.69.8.59: catálogo filtrado, reconciliação isolada por torneio e proteção da trava.');
})().catch(error => {console.error(error); process.exitCode = 1;});

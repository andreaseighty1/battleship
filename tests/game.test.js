'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ARCADE_ABILITY_CHARGES,
  ARCADE_FLEET,
  BOARD_SIZE,
  FLEET,
  GAME_TTL_MS,
  LOBBY_TTL_MS,
  abandonGame,
  createBotGame,
  createGame,
  getHighScores,
  joinGame,
  performAction,
  placeFleet,
  serializeGame,
  SONAR_SIZE,
  validateFleet
} = require('../server');

function fleetFromRows(startY = 0, fleet = FLEET) {
  return fleet.map((ship, index) => ({
    id: ship.id,
    cells: Array.from({ length: ship.length }, (_, x) => ({ x, y: (startY + index) % BOARD_SIZE }))
  }));
}

function arcadeFleetFromRows(startY = 0) {
  return fleetFromRows(startY, ARCADE_FLEET);
}

test('validates a complete classic fleet', () => {
  const fleet = validateFleet(fleetFromRows(0));
  assert.equal(fleet.length, FLEET.length);
  assert.equal(fleet[0].cells.length, 5);
});

test('validates an arcade fleet with a one-cell drone', () => {
  assert.throws(() => validateFleet(fleetFromRows(0), 'arcade'), /Drönare/);

  const fleet = validateFleet(arcadeFleetFromRows(0), 'arcade');
  const drone = fleet.find((ship) => ship.id === 'drone');
  assert.equal(fleet.length, ARCADE_FLEET.length);
  assert.equal(drone.name, 'Drönare');
  assert.equal(drone.cells.length, 1);
});

test('rejects overlapping ships', () => {
  const fleet = fleetFromRows(0);
  fleet[1].cells = fleet[0].cells.slice(0, 4);
  assert.throws(() => validateFleet(fleet), /överlappa/);
});

test('rejects diagonal ships', () => {
  const fleet = fleetFromRows(0);
  fleet[0].cells = Array.from({ length: fleet[0].cells.length }, (_, index) => ({ x: index, y: index }));
  assert.throws(() => validateFleet(fleet), /rakt/);
});

test('rejects profanity in player names', () => {
  const blockedName = ['f', 'u', 'c', 'k'].join('.');
  assert.throws(() => createGame(blockedName, new Map()), /annat namn/);
});

test('rejects empty player names', () => {
  assert.throws(() => createGame('   ', new Map()), /namn/);
});

test('starts when both players have placed their fleets', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  const guest = joinGame(host.code, 'Bo', store);

  placeFleet(host.code, host.playerId, fleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, fleetFromRows(5), store);

  const hostState = serializeGame(host.game, host.playerId);
  assert.equal(hostState.status, 'playing');
  assert.equal(hostState.mode.id, 'classic');
  assert.equal(hostState.timing.maxDurationMs, GAME_TTL_MS);
  assert.ok(hostState.timing.expiresAt - hostState.timing.createdAt === GAME_TTL_MS);
  assert.equal(hostState.timing.lobbyDurationMs, LOBBY_TTL_MS);
  assert.ok(hostState.timing.turnStartedAt >= hostState.timing.startedAt);
  assert.equal(hostState.turn.isYou, true);
});

test('expires waiting lobbies after five minutes', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  host.game.lobbyExpiresAt = Date.now() - 1;

  const hostState = serializeGame(host.game, host.playerId);
  assert.equal(hostState.status, 'expired');
  assert.equal(hostState.timing.expiredReason, 'lobby');
  assert.equal(hostState.timing.lobbyDurationMs, LOBBY_TTL_MS);
  assert.equal(hostState.score, null);
  assert.throws(
    () => joinGame(host.code, 'Bo', store),
    /gått ut/
  );
});

test('hit keeps turn and miss passes it', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade');
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, arcadeFleetFromRows(5), store);

  performAction(host.code, host.playerId, { ability: 'shot', x: 0, y: 5 }, store);
  assert.equal(serializeGame(host.game, host.playerId).turn.isYou, true);

  host.game.turnStartedAt = 1000;
  performAction(host.code, host.playerId, { ability: 'shot', x: 9, y: 9 }, store);
  assert.equal(serializeGame(host.game, host.playerId).turn.isYou, false);
  assert.ok(host.game.turnStartedAt > 1000);
});

test('marks all hit cells when a ship is sunk', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade');
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  const guestFleet = arcadeFleetFromRows(5);
  placeFleet(host.code, guest.playerId, guestFleet, store);

  const destroyer = guestFleet.find((ship) => ship.id === 'destroyer');
  for (const cell of destroyer.cells) {
    performAction(host.code, host.playerId, { ability: 'shot', x: cell.x, y: cell.y }, store);
  }

  const hostState = serializeGame(host.game, host.playerId);
  const sunkHits = hostState.target.outgoingShots.filter((shot) => shot.sunkShipId === destroyer.id);
  assert.equal(sunkHits.length, destroyer.cells.length);
  assert.ok(sunkHits.every((shot) => shot.sunkShipName === 'Jagare'));
});

test('expires games after forty-eight hours without recording a score', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  joinGame(host.code, 'Bo', store);
  host.game.expiresAt = Date.now() - 1;

  const hostState = serializeGame(host.game, host.playerId);
  assert.equal(hostState.status, 'expired');
  assert.equal(hostState.score, null);
  assert.equal(hostState.timing.maxDurationMs, GAME_TTL_MS);
  assert.throws(
    () => placeFleet(host.code, host.playerId, fleetFromRows(0), store),
    /gått ut/
  );
});

test('classic mode passes turn after hits and blocks powers', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'classic');
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, fleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, fleetFromRows(5), store);

  assert.equal(serializeGame(host.game, host.playerId).mode.id, 'classic');
  assert.throws(
    () => performAction(host.code, host.playerId, { ability: 'sonar', x: 0, y: 5 }, store),
    /Arcade/
  );

  performAction(host.code, host.playerId, { ability: 'shot', x: 0, y: 5 }, store);
  const hostState = serializeGame(host.game, host.playerId);
  assert.equal(hostState.turn.isYou, false);
  assert.equal(hostState.own.energy, 0);
});

test('classic bot game auto-places and fires back', () => {
  const store = new Map();
  const host = createBotGame('Ada', store);
  const lobbyState = serializeGame(host.game, host.playerId);
  assert.equal(lobbyState.status, 'placing');
  assert.equal(lobbyState.mode.id, 'classic');
  assert.equal(lobbyState.target.opponentName, 'Datorn');
  assert.equal(lobbyState.target.opponentReady, true);

  placeFleet(host.code, host.playerId, fleetFromRows(0), store);
  assert.equal(serializeGame(host.game, host.playerId).turn.isYou, true);

  performAction(host.code, host.playerId, { ability: 'shot', x: 0, y: 0 }, store);
  const afterExchange = serializeGame(host.game, host.playerId);
  assert.equal(afterExchange.status, 'playing');
  assert.equal(afterExchange.turn.isYou, true);
  assert.equal(afterExchange.target.outgoingShots.length, 1);
  assert.equal(afterExchange.own.incomingShots.length, 1);
});

test('arcade bot game keeps arcade fleet and powers', () => {
  const store = new Map();
  const host = createBotGame('Ada', store, 'arcade');
  const lobbyState = serializeGame(host.game, host.playerId);
  const bot = host.game.players.find((player) => player.isBot);

  assert.equal(lobbyState.status, 'placing');
  assert.equal(lobbyState.mode.id, 'arcade');
  assert.equal(lobbyState.target.opponentName, 'Datorn');
  assert.equal(lobbyState.own.commander.id, 'offense');
  assert.equal(lobbyState.players.every((player) => player.commander), true);
  assert.equal(lobbyState.fleet.some((ship) => ship.id === 'drone'), true);
  assert.equal(bot.ships.some((ship) => ship.id === 'drone'), true);

  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  const state = serializeGame(host.game, host.playerId);
  assert.equal(state.turn.isYou, true);
  assert.equal(state.own.abilityCharges.sonar, ARCADE_ABILITY_CHARGES.sonar);
  assert.equal(state.own.abilityCharges.barrage, ARCADE_ABILITY_CHARGES.barrage + 1);
});

test('commander cards adjust arcade ability charges', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade', 'scout');
  const guest = joinGame(host.code, 'Bo', store, 'offense');
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, arcadeFleetFromRows(5), store);

  const hostState = serializeGame(host.game, host.playerId);
  const guestState = serializeGame(host.game, guest.playerId);

  assert.equal(hostState.own.commander.id, 'scout');
  assert.equal(hostState.own.abilityCharges.sonar, ARCADE_ABILITY_CHARGES.sonar + 1);
  assert.equal(hostState.own.abilityCharges.barrage, ARCADE_ABILITY_CHARGES.barrage);
  assert.equal(guestState.own.commander.id, 'offense');
  assert.equal(guestState.own.abilityCharges.sonar, ARCADE_ABILITY_CHARGES.sonar);
  assert.equal(guestState.own.abilityCharges.barrage, ARCADE_ABILITY_CHARGES.barrage + 1);
});

test('defensive commander blocks the first hit and can be shot again', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade', 'offense');
  const guest = joinGame(host.code, 'Bo', store, 'defensive');
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, arcadeFleetFromRows(5), store);

  const first = performAction(host.code, host.playerId, { ability: 'shot', x: 0, y: 5 }, store);
  assert.equal(first.result.blocked, true);
  assert.equal(first.result.shot.result, 'blocked');
  assert.equal(serializeGame(host.game, guest.playerId).own.commanderState.defenseBlocked, true);

  performAction(host.code, guest.playerId, { ability: 'shot', x: 9, y: 9 }, store);
  const second = performAction(host.code, host.playerId, { ability: 'shot', x: 0, y: 5 }, store);
  assert.equal(second.result.hit, true);
  assert.equal(second.result.shot.result, 'hit');
});

test('arcade bot uses barrage to follow up a known hit', () => {
  const store = new Map();
  const host = createBotGame('Ada', store, 'arcade');
  const bot = host.game.players.find((player) => player.isBot);
  bot.ships = arcadeFleetFromRows(5);
  bot.abilityCharges.barrage = 1;
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);

  host.game.shotsByPlayer[bot.id].push({
    x: 0,
    y: 0,
    source: 'shot',
    result: 'hit',
    shipId: 'carrier',
    at: Date.now()
  });

  performAction(host.code, host.playerId, { ability: 'shot', x: 9, y: 9 }, store);
  const botShots = host.game.shotsByPlayer[bot.id];

  assert.equal(bot.abilityCharges.barrage, 0);
  assert.equal(botShots.some((shot) => shot.source === 'barrage'), true);
  assert.equal(serializeGame(host.game, host.playerId).turn.isYou, true);
});

test('bot games do not record highscores', () => {
  const store = new Map();
  const host = createBotGame('Ada', store);
  const hostFleet = fleetFromRows(0);
  const bot = host.game.players.find((player) => player.isBot);
  bot.ships = fleetFromRows(5);

  placeFleet(host.code, host.playerId, hostFleet, store);
  const allBotShipCells = bot.ships.flatMap((ship) => ship.cells);

  for (const cell of allBotShipCells) {
    performAction(host.code, host.playerId, { ability: 'shot', x: cell.x, y: cell.y }, store);
  }

  const hostState = serializeGame(host.game, host.playerId);
  assert.equal(hostState.status, 'finished');
  assert.equal(hostState.winner.isYou, true);
  assert.equal(hostState.score, null);
  assert.equal(getHighScores().some((score) => score.code === host.code), false);
});

test('leaving a game abandons it for the opponent without recording a score', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  const guest = joinGame(host.code, 'Bo', store);

  abandonGame(host.code, host.playerId, store);

  const guestState = serializeGame(host.game, guest.playerId);
  assert.equal(guestState.status, 'abandoned');
  assert.equal(guestState.abandonedBy.playerName, 'Ada');
  assert.equal(guestState.abandonedBy.isYou, false);
  assert.equal(guestState.winner, null);
  assert.equal(guestState.score, null);
});

test('sonar spends a charge and passes turn', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade');
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, arcadeFleetFromRows(5), store);

  const result = performAction(host.code, host.playerId, { ability: 'sonar', x: 0, y: 5 }, store);
  assert.equal(result.result.count, 11);
  const state = serializeGame(host.game, host.playerId);
  assert.equal(state.turn.isYou, false);
  assert.equal(state.own.abilityCharges.sonar, ARCADE_ABILITY_CHARGES.sonar - 1);
  assert.equal(state.own.abilityCharges.barrage, ARCADE_ABILITY_CHARGES.barrage + 1);
  assert.equal(state.target.sonarScans[0].size, SONAR_SIZE);
  assert.equal(state.target.sonarScans[0].originX, 0);
  assert.equal(state.target.sonarScans[0].originY, 4);
});

test('sonar cannot spend a charge on the same scanned area twice', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade');
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, arcadeFleetFromRows(5), store);

  performAction(host.code, host.playerId, { ability: 'sonar', x: 0, y: 5 }, store);
  performAction(host.code, guest.playerId, { ability: 'shot', x: 9, y: 9 }, store);

  assert.throws(
    () => performAction(host.code, host.playerId, { ability: 'sonar', x: 1, y: 5 }, store),
    /sonar/
  );
  const state = serializeGame(host.game, host.playerId);
  assert.equal(state.own.abilityCharges.sonar, ARCADE_ABILITY_CHARGES.sonar - 1);
  assert.equal(state.target.sonarScans.length, 1);
});

test('barrage spends a charge and fires a cross pattern', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade');
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, arcadeFleetFromRows(5), store);

  const result = performAction(host.code, host.playerId, { ability: 'barrage', x: 2, y: 5 }, store);
  assert.equal(result.result.shots.length, 5);
  const state = serializeGame(host.game, host.playerId);
  assert.equal(state.turn.isYou, false);
  assert.equal(state.own.abilityCharges.barrage, ARCADE_ABILITY_CHARGES.barrage);
});

test('arcade powers cannot be used after charges run out', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade');
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, arcadeFleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, arcadeFleetFromRows(5), store);
  host.game.players[0].abilityCharges.sonar = 0;

  assert.throws(
    () => performAction(host.code, host.playerId, { ability: 'sonar', x: 0, y: 5 }, store),
    /Sonar är slut/
  );
});

test('complete game can be won and records a fast-win score', () => {
  const store = new Map();
  const host = createGame('Ada', store, 'arcade');
  const guest = joinGame(host.code, 'Bo', store);
  const hostFleet = arcadeFleetFromRows(0);
  const guestFleet = arcadeFleetFromRows(5);
  placeFleet(host.code, host.playerId, hostFleet, store);
  placeFleet(host.code, guest.playerId, guestFleet, store);

  const allGuestShipCells = guestFleet.flatMap((ship) => ship.cells);
  performAction(host.code, host.playerId, { ability: 'shot', x: 9, y: 9 }, store);
  performAction(host.code, guest.playerId, { ability: 'shot', x: 9, y: 9 }, store);

  for (const cell of allGuestShipCells) {
    performAction(host.code, host.playerId, { ability: 'shot', x: cell.x, y: cell.y }, store);
  }

  const hostState = serializeGame(host.game, host.playerId);
  assert.equal(hostState.status, 'finished');
  assert.equal(hostState.winner.isYou, true);
  assert.equal(hostState.score.winnerName, 'Ada');
  assert.equal(hostState.score.mode, 'arcade');
  assert.equal(hostState.score.shots, allGuestShipCells.length + 1);
  assert.equal(hostState.score.hits, allGuestShipCells.length);
  assert.equal(hostState.score.misses, 1);
  assert.equal(hostState.stats.outgoing.hits, allGuestShipCells.length);
  assert.equal(hostState.stats.outgoing.misses, 1);
  assert.equal(getHighScores().some((score) => score.code === host.code && score.winnerName === 'Ada' && score.misses === 1), true);
});

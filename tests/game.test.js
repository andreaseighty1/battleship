'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BARRAGE_COST,
  FLEET,
  createGame,
  getHighScores,
  joinGame,
  performAction,
  placeFleet,
  serializeGame,
  validateFleet
} = require('../server');

function fleetFromRows(startY = 0) {
  return FLEET.map((ship, index) => ({
    id: ship.id,
    cells: Array.from({ length: ship.length }, (_, x) => ({ x, y: startY + index }))
  }));
}

test('validates a complete classic fleet', () => {
  const fleet = validateFleet(fleetFromRows(0));
  assert.equal(fleet.length, FLEET.length);
  assert.equal(fleet[0].cells.length, 5);
});

test('rejects overlapping ships', () => {
  const fleet = fleetFromRows(0);
  fleet[1].cells = fleet[0].cells.slice(0, 4);
  assert.throws(() => validateFleet(fleet), /överlappa/);
});

test('rejects profanity in player names', () => {
  const blockedName = ['f', 'u', 'c', 'k'].join('.');
  assert.throws(() => createGame(blockedName, new Map()), /annat namn/);
});

test('starts when both players have placed their fleets', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  const guest = joinGame(host.code, 'Bo', store);

  placeFleet(host.code, host.playerId, fleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, fleetFromRows(5), store);

  const hostState = serializeGame(host.game, host.playerId);
  assert.equal(hostState.status, 'playing');
  assert.equal(hostState.mode.id, 'arcade');
  assert.equal(hostState.turn.isYou, true);
});

test('hit keeps turn and miss passes it', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, fleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, fleetFromRows(5), store);

  performAction(host.code, host.playerId, { ability: 'shot', x: 0, y: 5 }, store);
  assert.equal(serializeGame(host.game, host.playerId).turn.isYou, true);

  performAction(host.code, host.playerId, { ability: 'shot', x: 9, y: 9 }, store);
  assert.equal(serializeGame(host.game, host.playerId).turn.isYou, false);
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

test('sonar spends energy without changing turn', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, fleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, fleetFromRows(5), store);

  const result = performAction(host.code, host.playerId, { ability: 'sonar', x: 0, y: 5 }, store);
  assert.equal(result.result.count, 4);
  const state = serializeGame(host.game, host.playerId);
  assert.equal(state.turn.isYou, true);
  assert.equal(state.own.energy, 0);
});

test('barrage spends energy and fires a cross pattern', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  const guest = joinGame(host.code, 'Bo', store);
  placeFleet(host.code, host.playerId, fleetFromRows(0), store);
  placeFleet(host.code, guest.playerId, fleetFromRows(5), store);
  host.game.players[0].energy = BARRAGE_COST;

  const result = performAction(host.code, host.playerId, { ability: 'barrage', x: 2, y: 5 }, store);
  assert.equal(result.result.shots.length, 5);
  assert.equal(serializeGame(host.game, host.playerId).turn.isYou, false);
});

test('complete game can be won and records a fast-win score', () => {
  const store = new Map();
  const host = createGame('Ada', store);
  const guest = joinGame(host.code, 'Bo', store);
  const hostFleet = fleetFromRows(0);
  const guestFleet = fleetFromRows(5);
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
  assert.ok(getHighScores().some((score) => score.code === host.code && score.winnerName === 'Ada' && score.misses === 1));
});

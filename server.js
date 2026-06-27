'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const BOARD_SIZE = 10;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SONAR_COST = 2;
const BARRAGE_COST = 5;
const MAX_ENERGY = 9;
const SONAR_SIZE = 4;
const SONAR_CHARGES = 3;
const BARRAGE_CHARGES = 1;
const ARCADE_ABILITY_CHARGES = Object.freeze({
  sonar: SONAR_CHARGES,
  barrage: BARRAGE_CHARGES
});
const LOBBY_TTL_MS = 5 * 60 * 1000;
const GAME_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MODE = 'classic';
const GAME_MODES = Object.freeze({
  classic: Object.freeze({
    id: 'classic',
    label: 'Classic',
    abilities: false,
    hitKeepsTurn: false,
    startingEnergy: 0
  }),
  arcade: Object.freeze({
    id: 'arcade',
    label: 'Arcade',
    abilities: true,
    hitKeepsTurn: false,
    startingEnergy: 2
  })
});
const DEFAULT_COMMANDER = 'offense';
const COMMANDER_CARDS = Object.freeze({
  offense: Object.freeze({
    id: 'offense',
    label: 'Offensiv Kommendör',
    shortLabel: 'Offensiv',
    effect: '+1 Barrage'
  }),
  scout: Object.freeze({
    id: 'scout',
    label: 'Scout',
    shortLabel: 'Scout',
    effect: '+1 Sonar ping'
  }),
  defensive: Object.freeze({
    id: 'defensive',
    label: 'Defensiv Kommendör',
    shortLabel: 'Defensiv',
    effect: 'Blockerar första träffen'
  })
});

const CLASSIC_FLEET = Object.freeze([
  Object.freeze({ id: 'carrier', name: 'Hangarfartyg', length: 5 }),
  Object.freeze({ id: 'battleship', name: 'Slagskepp', length: 4 }),
  Object.freeze({ id: 'cruiser', name: 'Kryssare', length: 3 }),
  Object.freeze({ id: 'submarine', name: 'Ubåt', length: 3 }),
  Object.freeze({ id: 'destroyer', name: 'Jagare', length: 2 })
]);
const ARCADE_FLEET = Object.freeze([
  ...CLASSIC_FLEET,
  Object.freeze({ id: 'drone', name: 'Drönare', length: 1 })
]);
const FLEET = CLASSIC_FLEET;

const games = new Map();
const subscribers = new Map();
const highScores = [];
const SCORE_FETCH_LIMIT = 250;
const PROFANITY_TERMS = Object.freeze([
  'fuck',
  'fucker',
  'shit',
  'bitch',
  'cunt',
  'dick',
  'pussy',
  'asshole',
  'bastard',
  'whore',
  'slut',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'hora',
  'fitta',
  'kuk',
  'knull',
  'slyna',
  'luder',
  'javla',
  'nazist'
]);
const PROFANITY_WORD_TERMS = Object.freeze(['bog']);

class GameError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'GameError';
    this.statusCode = statusCode;
  }
}

function fail(statusCode, message) {
  throw new GameError(statusCode, message);
}

function randomId() {
  return crypto.randomBytes(9).toString('base64url');
}

function normalizeForProfanity(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@4]/g, 'a')
    .replace(/[!1|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't');
}

function containsProfanity(value) {
  const normalized = normalizeForProfanity(value);
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return PROFANITY_TERMS.some((term) => compact.includes(term) || words.includes(term))
    || PROFANITY_WORD_TERMS.some((term) => words.includes(term) || compact === term);
}

function cleanName(value, fallback = 'Kapten') {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) {
    fail(400, 'Skriv ett namn.');
  }
  const chosenName = (name || fallback).slice(0, 24);
  if (containsProfanity(chosenName)) {
    fail(400, 'Välj ett annat namn.');
  }
  return chosenName;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return GAME_MODES[mode] ? mode : DEFAULT_MODE;
}

function modeSettings(gameOrMode) {
  const mode = typeof gameOrMode === 'string' ? gameOrMode : gameOrMode && gameOrMode.mode;
  return GAME_MODES[normalizeMode(mode)];
}

function fleetForMode(gameOrMode = DEFAULT_MODE) {
  return modeSettings(gameOrMode).abilities ? ARCADE_FLEET : CLASSIC_FLEET;
}

function publicMode(gameOrMode) {
  const settings = modeSettings(gameOrMode);
  return {
    id: settings.id,
    label: settings.label,
    abilities: settings.abilities,
    hitKeepsTurn: settings.hitKeepsTurn
  };
}

function normalizeCommander(value) {
  const commander = String(value || '').trim().toLowerCase();
  return COMMANDER_CARDS[commander] ? commander : DEFAULT_COMMANDER;
}

function commanderForMode(value, gameOrMode = DEFAULT_MODE) {
  if (!modeSettings(gameOrMode).abilities) {
    return null;
  }
  return COMMANDER_CARDS[normalizeCommander(value)];
}

function publicCommander(player, gameOrMode = DEFAULT_MODE) {
  const commander = commanderForMode(player && player.commanderId, gameOrMode);
  return commander ? { ...commander } : null;
}

function initialCommanderState(player, gameOrMode = DEFAULT_MODE) {
  const commander = commanderForMode(player && player.commanderId, gameOrMode);
  return {
    defenseBlocked: commander && commander.id === 'defensive' ? false : null
  };
}

function commanderStateFor(player, gameOrMode = DEFAULT_MODE) {
  if (!player) {
    return initialCommanderState(player, gameOrMode);
  }
  if (!player.commanderState || typeof player.commanderState !== 'object') {
    player.commanderState = initialCommanderState(player, gameOrMode);
  }
  if (commanderForMode(player.commanderId, gameOrMode)?.id === 'defensive' && typeof player.commanderState.defenseBlocked !== 'boolean') {
    player.commanderState.defenseBlocked = false;
  }
  return player.commanderState;
}

function initialAbilityCharges(gameOrMode = DEFAULT_MODE, player = null) {
  if (!modeSettings(gameOrMode).abilities) {
    return { sonar: 0, barrage: 0 };
  }
  const charges = { ...ARCADE_ABILITY_CHARGES };
  const commander = commanderForMode(player && player.commanderId, gameOrMode);
  if (commander && commander.id === 'offense') {
    charges.barrage += 1;
  }
  if (commander && commander.id === 'scout') {
    charges.sonar += 1;
  }
  return charges;
}

function ensureAbilityCharges(player, gameOrMode = DEFAULT_MODE) {
  const defaults = initialAbilityCharges(gameOrMode, player);
  if (!modeSettings(gameOrMode).abilities) {
    return defaults;
  }
  if (!player.abilityCharges || typeof player.abilityCharges !== 'object') {
    player.abilityCharges = { ...defaults };
  }
  for (const [ability, defaultCount] of Object.entries(defaults)) {
    const value = Number(player.abilityCharges[ability]);
    player.abilityCharges[ability] = Number.isInteger(value) && value >= 0 ? value : defaultCount;
  }
  return player.abilityCharges;
}

function publicAbilityCharges(player, gameOrMode = DEFAULT_MODE) {
  return { ...ensureAbilityCharges(player, gameOrMode) };
}

function sonarScansFor(player) {
  if (!player) {
    return [];
  }
  if (!Array.isArray(player.sonarScans)) {
    player.sonarScans = [];
  }
  return player.sonarScans;
}

function useAbilityCharge(player, gameOrMode, ability, label) {
  const charges = ensureAbilityCharges(player, gameOrMode);
  if (!Number.isInteger(charges[ability]) || charges[ability] <= 0) {
    fail(409, `${label} är slut.`);
  }
  charges[ability] -= 1;
  return charges[ability];
}

function generateCode(store = games) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
    if (!store.has(code)) {
      return code;
    }
  }
  fail(503, 'Kunde inte skapa en unik rumskod just nu.');
}

function createPlayer(name, index, commander = null, gameOrMode = DEFAULT_MODE) {
  const commanderCard = commanderForMode(commander, gameOrMode);
  return {
    id: randomId(),
    index,
    name: cleanName(name, index === 0 ? 'Värd' : 'Utmanare'),
    ships: null,
    ready: false,
    energy: 0,
    abilityCharges: null,
    sonarScans: [],
    commanderId: commanderCard ? commanderCard.id : null,
    commanderState: commanderCard ? initialCommanderState({ commanderId: commanderCard.id }, gameOrMode) : null
  };
}

function logEvent(game, type, text) {
  game.log.push({ type, text, at: Date.now() });
  if (game.log.length > 80) {
    game.log.splice(0, game.log.length - 80);
  }
}

function touch(game) {
  game.updatedAt = Date.now();
}

function isTerminalStatus(status) {
  return status === 'finished' || status === 'abandoned' || status === 'expired';
}

function ensureTiming(game) {
  const now = Date.now();
  if (!Number.isFinite(Number(game.createdAt))) {
    game.createdAt = now;
  }
  if (!Number.isFinite(Number(game.updatedAt))) {
    game.updatedAt = game.createdAt;
  }
  if (!Number.isFinite(Number(game.expiresAt))) {
    game.expiresAt = game.createdAt + GAME_TTL_MS;
  }
  if (!Number.isFinite(Number(game.lobbyExpiresAt))) {
    game.lobbyExpiresAt = game.createdAt + LOBBY_TTL_MS;
  }
  if (game.status === 'playing' && !Number.isFinite(Number(game.turnStartedAt))) {
    game.turnStartedAt = game.startedAt || game.updatedAt || game.createdAt;
  }
}

function clearTurn(game) {
  game.turnPlayerId = null;
  game.turnStartedAt = null;
}

function setTurn(game, playerId) {
  if (game.turnPlayerId !== playerId || !Number.isFinite(Number(game.turnStartedAt))) {
    game.turnStartedAt = Date.now();
  }
  game.turnPlayerId = playerId;
}

function expireGameIfNeeded(game) {
  ensureTiming(game);
  if (isTerminalStatus(game.status)) {
    return false;
  }

  const now = Date.now();
  const lobbyExpired = game.status === 'waiting' && now > game.lobbyExpiresAt;
  const matchExpired = now > game.expiresAt;
  if (!lobbyExpired && !matchExpired) {
    return false;
  }

  const reason = lobbyExpired ? 'lobby' : 'match';
  game.status = 'expired';
  game.expiredReason = reason;
  game.expiredAt = reason === 'lobby' ? game.lobbyExpiresAt : game.expiresAt;
  game.finishedAt = game.expiredAt;
  clearTurn(game);
  logEvent(
    game,
    'system',
    reason === 'lobby'
      ? 'Rumskoden gick ut efter 5 minuter.'
      : 'Matchen gick ut efter 48 timmar. Ingen highscore sparades.'
  );
  return true;
}

function compareScores(a, b) {
  return a.durationMs - b.durationMs || a.shots - b.shots || a.finishedAt - b.finishedAt;
}

function publicScore(score) {
  const shots = Number(score.shots || 0);
  const hits = Number(score.hits ?? shots);
  const misses = Number(score.misses ?? Math.max(0, shots - hits));
  const opponentType = isBotScore(score) ? 'computer' : 'player';
  return {
    code: score.code,
    winnerName: score.winnerName,
    opponentName: score.opponentName,
    opponentType,
    mode: normalizeMode(score.mode),
    durationMs: score.durationMs,
    shots,
    hits,
    misses,
    accuracy: shots ? Math.round((hits / shots) * 100) : 0,
    finishedAt: score.finishedAt
  };
}

function randomCommander() {
  const commanders = Object.keys(COMMANDER_CARDS);
  return commanders[crypto.randomInt(commanders.length)];
}

function createBotPlayer(name = 'Datorn', gameOrMode = DEFAULT_MODE) {
  const bot = createPlayer(name, 1, randomCommander(), gameOrMode);
  bot.isBot = true;
  return bot;
}

function isHiddenScore(score) {
  return score
    && String(score.winnerName || '').trim().toLowerCase() === 'ada'
    && normalizeMode(score.mode) === 'arcade'
    && Number(score.durationMs || 0) <= 10000
    && Number(score.shots || 0) === 18
    && Number(score.hits || 0) === 17
    && Number(score.misses || 0) === 1;
}

function isBotScore(score) {
  const opponent = String(score && score.opponentName || '').trim().toLowerCase();
  const winner = String(score && score.winnerName || '').trim().toLowerCase();
  return ['datorn', 'ai', 'computer'].includes(opponent) || ['datorn', 'ai', 'computer'].includes(winner);
}

function isBotWinnerScore(score) {
  const winner = String(score && score.winnerName || '').trim().toLowerCase();
  return ['datorn', 'ai', 'computer'].includes(winner);
}

function getHighScores(limit = SCORE_FETCH_LIMIT) {
  return highScores.filter((score) => !isHiddenScore(score) && !isBotWinnerScore(score)).slice(0, limit).map(publicScore);
}

function shotStatsFor(game, playerId) {
  const shots = game.shotsByPlayer[playerId] || [];
  const hits = shots.filter((shot) => shot.result === 'hit').length;
  const misses = shots.filter((shot) => shot.result === 'miss').length;
  return {
    shots: shots.length,
    hits,
    misses,
    accuracy: shots.length ? Math.round((hits / shots.length) * 100) : 0
  };
}

function recordHighScore(game, winner) {
  if (game.score) {
    return game.score;
  }
  if (isBotPlayer(winner)) {
    game.finishedAt = game.finishedAt || Date.now();
    return null;
  }

  const opponent = getOpponent(game, winner.id);
  const finishedAt = Date.now();
  const startedAt = game.startedAt || game.createdAt || finishedAt;
  const stats = shotStatsFor(game, winner.id);
  const score = {
    code: game.code,
    mode: normalizeMode(game.mode),
    winnerName: winner.name,
    opponentName: opponent ? opponent.name : null,
    durationMs: Math.max(0, finishedAt - startedAt),
    shots: stats.shots,
    hits: stats.hits,
    misses: stats.misses,
    finishedAt
  };

  game.finishedAt = finishedAt;
  game.score = score;
  highScores.push(score);
  highScores.sort(compareScores);
  highScores.splice(SCORE_FETCH_LIMIT);
  return score;
}

function createGame(hostName, store = games, mode = DEFAULT_MODE, commander = DEFAULT_COMMANDER) {
  const code = generateCode(store);
  const gameMode = normalizeMode(mode);
  const host = createPlayer(hostName, 0, commander, gameMode);
  const now = Date.now();
  const game = {
    code,
    mode: gameMode,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + GAME_TTL_MS,
    lobbyExpiresAt: now + LOBBY_TTL_MS,
    status: 'waiting',
    startedAt: null,
    finishedAt: null,
    expiredAt: null,
    expiredReason: null,
    players: [host],
    shotsByPlayer: {
      [host.id]: []
    },
    turnPlayerId: null,
    turnStartedAt: null,
    winnerId: null,
    abandonedByPlayerId: null,
    abandonedAt: null,
    score: null,
    log: []
  };

  logEvent(game, 'system', `${host.name} skapade ett ${modeSettings(gameMode).label}-rum.`);
  store.set(code, game);
  return { game, code, playerId: host.id };
}

function randomFleet(gameOrMode = DEFAULT_MODE) {
  const fleet = fleetForMode(gameOrMode);
  const ships = [];
  for (const ship of fleet) {
    let placed = false;
    for (let attempt = 0; attempt < 800 && !placed; attempt += 1) {
      const direction = crypto.randomInt(2) === 0 ? 'horizontal' : 'vertical';
      const maxX = direction === 'horizontal' ? BOARD_SIZE - ship.length : BOARD_SIZE - 1;
      const maxY = direction === 'vertical' ? BOARD_SIZE - ship.length : BOARD_SIZE - 1;
      const x = crypto.randomInt(maxX + 1);
      const y = crypto.randomInt(maxY + 1);
      const cells = Array.from({ length: ship.length }, (_, index) => ({
        x: direction === 'horizontal' ? x + index : x,
        y: direction === 'vertical' ? y + index : y
      }));
      if (cells.every((cell) => !shipAtFleet(ships, cell.x, cell.y))) {
        ships.push({ id: ship.id, cells });
        placed = true;
      }
    }
    if (!placed) {
      fail(503, 'Datorn kunde inte placera sin flotta just nu.');
    }
  }
  return validateFleet(ships, gameOrMode);
}

function shipAtFleet(ships, x, y) {
  return ships.find((ship) => ship.cells.some((cell) => cell.x === x && cell.y === y)) || null;
}

function createBotGame(hostName, store = games, mode = DEFAULT_MODE, commander = DEFAULT_COMMANDER) {
  const { game, code, playerId } = createGame(hostName, store, mode, commander);
  const bot = createBotPlayer('Datorn', game);
  bot.ships = randomFleet(game);
  bot.ready = true;
  bot.energy = modeSettings(game).startingEnergy;
  bot.abilityCharges = initialAbilityCharges(game, bot);
  bot.sonarScans = [];
  game.players.push(bot);
  game.shotsByPlayer[bot.id] = [];
  game.status = 'placing';
  touch(game);
  logEvent(game, 'system', `${bot.name} är redo. Placera din flotta!`);
  return { game, code, playerId };
}

function getGame(codeInput, store = games) {
  const code = normalizeCode(codeInput);
  const game = store.get(code);
  if (!game) {
    fail(404, 'Rummet hittades inte.');
  }
  expireGameIfNeeded(game);
  return game;
}

function getPlayer(game, playerId) {
  const player = game.players.find((entry) => entry.id === playerId);
  if (!player) {
    fail(403, 'Spelaren hör inte till det här rummet.');
  }
  return player;
}

function getOpponent(game, playerId) {
  return game.players.find((entry) => entry.id !== playerId) || null;
}

function assertJoinable(game) {
  if (game.players.length >= 2) {
    fail(409, 'Rummet är fullt.');
  }
  if (game.status === 'expired') {
    fail(410, 'Rummet har gått ut.');
  }
  if (game.status !== 'waiting') {
    fail(409, 'Rummet har redan startat.');
  }
}

function getJoinInfo(codeInput, store = games) {
  const game = getGame(codeInput, store);
  assertJoinable(game);
  return {
    code: game.code,
    mode: publicMode(game),
    requiresCommander: modeSettings(game).abilities,
    players: game.players.length,
    maxPlayers: 2
  };
}

function joinGame(codeInput, playerName, store = games, commander = DEFAULT_COMMANDER) {
  const game = getGame(codeInput, store);
  assertJoinable(game);

  const player = createPlayer(playerName, 1, commander, game);
  game.players.push(player);
  game.shotsByPlayer[player.id] = [];
  game.status = 'placing';
  touch(game);
  logEvent(game, 'system', `${player.name} gick med. Placera skeppen!`);

  return { game, code: game.code, playerId: player.id };
}

function abandonGame(codeInput, playerId, store = games) {
  const game = getGame(codeInput, store);
  const player = getPlayer(game, playerId);
  if (isTerminalStatus(game.status)) {
    return { game };
  }

  game.status = 'abandoned';
  clearTurn(game);
  game.abandonedByPlayerId = player.id;
  game.abandonedAt = Date.now();
  game.finishedAt = game.abandonedAt;
  touch(game);
  logEvent(game, 'system', `${player.name} lämnade matchen.`);
  return { game };
}

function assertBoardCell(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
    fail(400, 'Rutan ligger utanför spelplanen.');
  }
}

function normalizeCell(cell) {
  const x = Number(cell && cell.x);
  const y = Number(cell && cell.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    fail(400, 'Rutor måste ha heltalskoordinater.');
  }
  assertBoardCell(x, y);
  return { x, y };
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function validateFleet(rawShips, gameOrMode = DEFAULT_MODE) {
  if (!Array.isArray(rawShips)) {
    fail(400, 'Skeppen saknas.');
  }

  const fleet = fleetForMode(gameOrMode);
  const allowedShipIds = new Set(fleet.map((ship) => ship.id));
  const unexpectedShip = rawShips.find((ship) => ship && ship.id && !allowedShipIds.has(ship.id));
  if (unexpectedShip) {
    fail(400, `Flottan innehåller ett okänt skepp: ${unexpectedShip.id}.`);
  }

  const occupied = new Set();
  const normalized = [];

  for (const fleetShip of fleet) {
    const candidates = rawShips.filter((ship) => ship && ship.id === fleetShip.id);
    if (candidates.length !== 1) {
      fail(400, `Flottan måste innehålla exakt ett ${fleetShip.name}.`);
    }

    const ship = candidates[0];
    if (!Array.isArray(ship.cells) || ship.cells.length !== fleetShip.length) {
      fail(400, `${fleetShip.name} måste vara ${fleetShip.length} rutor långt.`);
    }

    const cells = ship.cells.map(normalizeCell);
    const uniqueCells = new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
    if (uniqueCells.size !== cells.length) {
      fail(400, `${fleetShip.name} innehåller samma ruta flera gånger.`);
    }

    const sameRow = cells.every((cell) => cell.y === cells[0].y);
    const sameColumn = cells.every((cell) => cell.x === cells[0].x);
    if (!sameRow && !sameColumn) {
      fail(400, `${fleetShip.name} måste ligga rakt.`);
    }

    const sorted = [...cells].sort((a, b) => (sameRow ? a.x - b.x : a.y - b.y));
    for (let i = 0; i < sorted.length; i += 1) {
      const expectedX = sameRow ? sorted[0].x + i : sorted[0].x;
      const expectedY = sameColumn ? sorted[0].y + i : sorted[0].y;
      if (sorted[i].x !== expectedX || sorted[i].y !== expectedY) {
        fail(400, `${fleetShip.name} måste ligga sammanhängande.`);
      }
    }

    for (const cell of sorted) {
      const key = cellKey(cell.x, cell.y);
      if (occupied.has(key)) {
        fail(400, 'Skeppen får inte överlappa.');
      }
      occupied.add(key);
    }

    normalized.push({
      id: fleetShip.id,
      name: fleetShip.name,
      length: fleetShip.length,
      cells: sorted
    });
  }

  return normalized;
}

function placeFleet(codeInput, playerId, rawShips, store = games) {
  const game = getGame(codeInput, store);
  const player = getPlayer(game, playerId);
  if (game.status === 'expired') {
    fail(410, 'Matchen har gått ut.');
  }
  if (game.status !== 'placing') {
    fail(409, 'Det går inte att placera skepp just nu.');
  }
  if (player.ready) {
    fail(409, 'Du är redan redo.');
  }

  player.ships = validateFleet(rawShips, game);
  player.ready = true;
  player.energy = modeSettings(game).startingEnergy;
  player.abilityCharges = initialAbilityCharges(game, player);
  player.sonarScans = [];
  player.commanderState = initialCommanderState(player, game);
  touch(game);
  logEvent(game, 'system', `${player.name} är redo.`);

  if (game.players.length === 2 && game.players.every((entry) => entry.ready)) {
    game.status = 'playing';
    game.startedAt = Date.now();
    setTurn(game, game.players[0].id);
    logEvent(game, 'system', `Matchen startade. ${game.players[0].name} börjar.`);
  }

  return { game };
}

function findShipAt(player, x, y) {
  if (!player || !player.ships) {
    return null;
  }
  return player.ships.find((ship) => ship.cells.some((cell) => cell.x === x && cell.y === y)) || null;
}

function hasShotAt(game, attackerId, x, y) {
  return (game.shotsByPlayer[attackerId] || []).some((shot) => shot.x === x && shot.y === y && shot.result !== 'blocked');
}

function isShipSunkByShots(shots, ship) {
  return ship.cells.every((cell) => shots.some((shot) => shot.x === cell.x && shot.y === cell.y && shot.result === 'hit'));
}

function markSunkShipShots(shots, ship) {
  if (!Array.isArray(shots) || !ship || !Array.isArray(ship.cells)) {
    return;
  }
  const shipCells = new Set(ship.cells.map((cell) => `${cell.x},${cell.y}`));
  shots.forEach((shot) => {
    if (shot.result === 'hit' && shipCells.has(`${shot.x},${shot.y}`)) {
      shot.sunkShipId = ship.id;
      shot.sunkShipName = ship.name;
    }
  });
}

function isFleetSunkBy(game, attackerId, defender) {
  const shots = game.shotsByPlayer[attackerId] || [];
  return Boolean(defender.ships && defender.ships.every((ship) => isShipSunkByShots(shots, ship)));
}

function shouldBlockHit(defender, gameOrMode) {
  if (commanderForMode(defender && defender.commanderId, gameOrMode)?.id !== 'defensive') {
    return false;
  }
  const state = commanderStateFor(defender, gameOrMode);
  if (state.defenseBlocked) {
    return false;
  }
  state.defenseBlocked = true;
  return true;
}

function resolveSingleShot(game, attacker, defender, x, y, source) {
  const ship = findShipAt(defender, x, y);
  const blocked = ship && shouldBlockHit(defender, game);
  const shot = {
    x,
    y,
    source,
    result: blocked ? 'blocked' : (ship ? 'hit' : 'miss'),
    at: Date.now()
  };

  if (blocked) {
    shot.shipId = ship.id;
    shot.blocked = true;
    game.shotsByPlayer[attacker.id].push(shot);
    return { shot, hit: false, blocked: true, sunkShip: null };
  }

  if (ship) {
    shot.shipId = ship.id;
    game.shotsByPlayer[attacker.id].push(shot);
    const sunk = isShipSunkByShots(game.shotsByPlayer[attacker.id], ship);
    if (sunk) {
      markSunkShipShots(game.shotsByPlayer[attacker.id], ship);
      return { shot, hit: true, sunkShip: ship };
    }
    return { shot, hit: true, sunkShip: null };
  }

  game.shotsByPlayer[attacker.id].push(shot);
  return { shot, hit: false, sunkShip: null };
}

function formatCell(x, y) {
  return `${String.fromCharCode(65 + y)}${x + 1}`;
}

function finishGame(game, winner) {
  game.status = 'finished';
  clearTurn(game);
  game.winnerId = winner.id;
  recordHighScore(game, winner);
  logEvent(game, 'win', `${winner.name} vann matchen.`);
}

function performShot(game, attacker, defender, x, y) {
  const settings = modeSettings(game);
  if (hasShotAt(game, attacker.id, x, y)) {
    fail(409, 'Du har redan skjutit på den rutan.');
  }

  const outcome = resolveSingleShot(game, attacker, defender, x, y, 'shot');
  if (outcome.blocked) {
    logEvent(game, 'power', `${defender.name} blockerade träffen vid ${formatCell(x, y)} med sin commander.`);
  } else if (outcome.sunkShip) {
    logEvent(game, 'hit', `${attacker.name} sänkte ${outcome.sunkShip.name} vid ${formatCell(x, y)}.`);
  } else if (outcome.hit) {
    if (settings.hitKeepsTurn) {
      logEvent(game, 'hit', `${attacker.name} träffade vid ${formatCell(x, y)} och behåller turen.`);
    } else {
      logEvent(game, 'hit', `${attacker.name} träffade vid ${formatCell(x, y)}.`);
    }
  } else {
    logEvent(game, 'miss', `${attacker.name} missade vid ${formatCell(x, y)}.`);
  }

  if (isFleetSunkBy(game, attacker.id, defender)) {
    finishGame(game, attacker);
  } else if (!outcome.hit || !settings.hitKeepsTurn) {
    setTurn(game, defender.id);
  }

  return { ability: 'shot', ...outcome };
}

function isBotPlayer(player) {
  return Boolean(player && player.isBot);
}

function unshotCells(game, attackerId) {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!hasShotAt(game, attackerId, x, y)) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function botTargetCandidates(game, botId) {
  const shots = game.shotsByPlayer[botId] || [];
  const candidates = [];
  shots
    .filter((shot) => shot.result === 'hit' && !shot.sunkShipId)
    .forEach((shot) => {
      [
        { x: shot.x + 1, y: shot.y },
        { x: shot.x - 1, y: shot.y },
        { x: shot.x, y: shot.y + 1 },
        { x: shot.x, y: shot.y - 1 }
      ].forEach((cell) => {
        if (cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE && !hasShotAt(game, botId, cell.x, cell.y)) {
          candidates.push(cell);
        }
      });
    });
  return candidates;
}

function botKnownHits(game, botId) {
  return (game.shotsByPlayer[botId] || [])
    .filter((shot) => shot.result === 'hit' && !shot.sunkShipId);
}

function sonarRegionKey(region) {
  return `${region.originX},${region.originY},${region.size}`;
}

function storedSonarRegion(scan) {
  const originX = Number(scan && scan.originX);
  const originY = Number(scan && scan.originY);
  const size = Number(scan && scan.size);
  if (Number.isInteger(originX) && Number.isInteger(originY) && Number.isInteger(size) && size > 0) {
    return { originX, originY, size };
  }
  return sonarRegion(Number(scan && scan.x), Number(scan && scan.y));
}

function sonarScanCells(region) {
  const cells = [];
  for (let scanY = region.originY; scanY < region.originY + region.size; scanY += 1) {
    for (let scanX = region.originX; scanX < region.originX + region.size; scanX += 1) {
      if (scanX >= 0 && scanY >= 0 && scanX < BOARD_SIZE && scanY < BOARD_SIZE) {
        cells.push({ x: scanX, y: scanY });
      }
    }
  }
  return cells;
}

function hasScannedSonarRegion(player, region) {
  const key = sonarRegionKey(region);
  return sonarScansFor(player).some((scan) => sonarRegionKey(storedSonarRegion(scan)) === key);
}

function botSonarTargetCandidates(game, bot) {
  const candidates = [];
  sonarScansFor(bot)
    .filter((scan) => Number(scan.count || 0) > 0)
    .forEach((scan) => {
      sonarScanCells(storedSonarRegion(scan)).forEach((cell) => {
        if (!hasShotAt(game, bot.id, cell.x, cell.y)) {
          candidates.push(cell);
        }
      });
    });
  return candidates;
}

function chooseBotShot(game, bot) {
  const targets = botTargetCandidates(game, bot.id);
  if (targets.length) {
    return targets[crypto.randomInt(targets.length)];
  }
  const scannedTargets = botSonarTargetCandidates(game, bot);
  if (scannedTargets.length) {
    return scannedTargets[crypto.randomInt(scannedTargets.length)];
  }
  const available = unshotCells(game, bot.id);
  return available.length ? available[crypto.randomInt(available.length)] : null;
}

function chooseBotBarrage(game, bot) {
  if (!modeSettings(game).abilities || ensureAbilityCharges(bot, game).barrage <= 0) {
    return null;
  }
  const candidates = botKnownHits(game, bot.id)
    .filter((hit) => barrageCells(hit.x, hit.y).some((cell) => !hasShotAt(game, bot.id, cell.x, cell.y)));
  return candidates.length ? candidates[crypto.randomInt(candidates.length)] : null;
}

function chooseBotSonar(game, bot) {
  if (!modeSettings(game).abilities || ensureAbilityCharges(bot, game).sonar <= 0 || botTargetCandidates(game, bot.id).length) {
    return null;
  }
  if (botSonarTargetCandidates(game, bot).length || crypto.randomInt(100) >= 34) {
    return null;
  }

  const regions = [];
  const seen = new Set();
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const region = sonarRegion(x, y);
      const key = sonarRegionKey(region);
      if (!seen.has(key) && !hasScannedSonarRegion(bot, region)) {
        seen.add(key);
        regions.push({ x, y });
      }
    }
  }
  return regions.length ? regions[crypto.randomInt(regions.length)] : null;
}

function chooseBotAction(game, bot) {
  const barrage = chooseBotBarrage(game, bot);
  if (barrage) {
    return { ability: 'barrage', x: barrage.x, y: barrage.y };
  }

  const sonar = chooseBotSonar(game, bot);
  if (sonar) {
    return { ability: 'sonar', x: sonar.x, y: sonar.y };
  }

  const shot = chooseBotShot(game, bot);
  return shot ? { ability: 'shot', x: shot.x, y: shot.y } : null;
}

function runBotTurns(game) {
  let guard = 0;
  while (game.status === 'playing' && guard < BOARD_SIZE * BOARD_SIZE) {
    const bot = game.players.find((entry) => entry.id === game.turnPlayerId);
    if (!isBotPlayer(bot)) {
      return;
    }
    const defender = getOpponent(game, bot.id);
    if (!defender || !defender.ready) {
      return;
    }
    const action = chooseBotAction(game, bot);
    if (!action) {
      setTurn(game, defender.id);
      return;
    }
    if (action.ability === 'sonar') {
      performSonar(game, bot, defender, action.x, action.y);
    } else if (action.ability === 'barrage') {
      performBarrage(game, bot, defender, action.x, action.y);
    } else {
      performShot(game, bot, defender, action.x, action.y);
    }
    guard += 1;
  }
}

function sonarRegion(x, y) {
  const originX = Math.min(Math.max(0, x - 1), BOARD_SIZE - SONAR_SIZE);
  const originY = Math.min(Math.max(0, y - 1), BOARD_SIZE - SONAR_SIZE);
  const cells = [];
  for (let scanY = originY; scanY < originY + SONAR_SIZE; scanY += 1) {
    for (let scanX = originX; scanX < originX + SONAR_SIZE; scanX += 1) {
      cells.push({ x: scanX, y: scanY });
    }
  }
  return { originX, originY, size: SONAR_SIZE, cells };
}

function performSonar(game, attacker, defender, x, y) {
  if (!modeSettings(game).abilities) {
    fail(409, 'Sonar finns bara i Arcade-laget.');
  }
  const scan = sonarRegion(x, y);
  if (hasScannedSonarRegion(attacker, scan)) {
    fail(409, 'Du har redan pingat det sonarområdet.');
  }

  const count = sonarScanCells(scan).filter((cell) => findShipAt(defender, cell.x, cell.y)).length;
  useAbilityCharge(attacker, game, 'sonar', 'Sonar');
  sonarScansFor(attacker).push({ x, y, originX: scan.originX, originY: scan.originY, size: scan.size, count, at: Date.now() });
  logEvent(game, 'power', `${attacker.name} använde sonar vid ${formatCell(x, y)}.`);
  setTurn(game, defender.id);
  return { ability: 'sonar', count, charges: publicAbilityCharges(attacker, game) };
}

function barrageCells(centerX, centerY) {
  return [
    { x: centerX, y: centerY },
    { x: centerX, y: centerY - 1 },
    { x: centerX + 1, y: centerY },
    { x: centerX, y: centerY + 1 },
    { x: centerX - 1, y: centerY }
  ].filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE);
}

function performBarrage(game, attacker, defender, x, y) {
  if (!modeSettings(game).abilities) {
    fail(409, 'Barrage finns bara i Arcade-laget.');
  }

  const targets = barrageCells(x, y).filter((cell) => !hasShotAt(game, attacker.id, cell.x, cell.y));
  if (targets.length === 0) {
    fail(409, 'Barrage-området är redan beskjutet.');
  }

  useAbilityCharge(attacker, game, 'barrage', 'Barrage');
  const outcomes = targets.map((cell) => resolveSingleShot(game, attacker, defender, cell.x, cell.y, 'barrage'));
  const hits = outcomes.filter((outcome) => outcome.hit);
  const blocked = outcomes.filter((outcome) => outcome.blocked);
  const sunkNames = [...new Set(outcomes.filter((outcome) => outcome.sunkShip).map((outcome) => outcome.sunkShip.name))];
  const sunkText = sunkNames.length ? ` Sänkte ${sunkNames.join(', ')}.` : '';
  const blockedText = blocked.length ? ` ${blocked.length} blockerad.` : '';
  logEvent(game, hits.length ? 'hit' : (blocked.length ? 'power' : 'miss'), `${attacker.name} körde barrage vid ${formatCell(x, y)}: ${hits.length}/${targets.length} träff.${blockedText}${sunkText}`);

  if (isFleetSunkBy(game, attacker.id, defender)) {
    finishGame(game, attacker);
  } else {
    setTurn(game, defender.id);
  }

  return { ability: 'barrage', shots: outcomes.map((outcome) => outcome.shot), charges: publicAbilityCharges(attacker, game) };
}

function performAction(codeInput, playerId, body, store = games) {
  const game = getGame(codeInput, store);
  const attacker = getPlayer(game, playerId);
  const defender = getOpponent(game, playerId);
  if (game.status === 'expired') {
    fail(410, 'Matchen har gått ut.');
  }
  if (game.status !== 'playing') {
    fail(409, 'Matchen är inte igång.');
  }
  if (!defender || !defender.ready) {
    fail(409, 'Väntar på motståndaren.');
  }
  if (game.turnPlayerId !== attacker.id) {
    fail(409, 'Det är inte din tur.');
  }

  const { x, y } = normalizeCell(body || {});
  const ability = String((body && body.ability) || 'shot');
  let result;

  if (ability === 'shot') {
    result = performShot(game, attacker, defender, x, y);
  } else if (ability === 'sonar') {
    result = performSonar(game, attacker, defender, x, y);
  } else if (ability === 'barrage') {
    result = performBarrage(game, attacker, defender, x, y);
  } else {
    fail(400, 'Okänd förmåga.');
  }

  runBotTurns(game);
  touch(game);
  return { game, result };
}

function cloneShot(shot) {
  const clone = {
    x: shot.x,
    y: shot.y,
    result: shot.result,
    source: shot.source,
    at: shot.at
  };
  if (shot.shipId) clone.shipId = shot.shipId;
  if (shot.blocked) clone.blocked = true;
  if (shot.sunkShipId) clone.sunkShipId = shot.sunkShipId;
  if (shot.sunkShipName) clone.sunkShipName = shot.sunkShipName;
  return clone;
}

function serializeGame(game, playerId) {
  expireGameIfNeeded(game);
  const player = getPlayer(game, playerId);
  const opponent = getOpponent(game, playerId);
  const turnPlayer = game.players.find((entry) => entry.id === game.turnPlayerId) || null;
  const winner = game.players.find((entry) => entry.id === game.winnerId) || null;
  const abandonedBy = game.players.find((entry) => entry.id === game.abandonedByPlayerId) || null;
  const ownStats = shotStatsFor(game, player.id);
  const incomingStats = opponent ? shotStatsFor(game, opponent.id) : { shots: 0, hits: 0, misses: 0, accuracy: 0 };

  return {
    code: game.code,
    mode: publicMode(game),
    status: game.status,
    boardSize: BOARD_SIZE,
    timing: {
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      startedAt: game.startedAt,
      finishedAt: game.finishedAt,
      expiredAt: game.expiredAt || null,
      expiredReason: game.expiredReason || null,
      lobbyExpiresAt: game.lobbyExpiresAt,
      expiresAt: game.expiresAt,
      turnStartedAt: game.turnStartedAt || null,
      lobbyDurationMs: LOBBY_TTL_MS,
      maxDurationMs: GAME_TTL_MS
    },
    fleet: fleetForMode(game),
    playerId: player.id,
    playerName: player.name,
    players: game.players.map((entry) => ({
      name: entry.name,
      isYou: entry.id === player.id,
      ready: entry.ready,
      commander: publicCommander(entry, game),
      energy: entry.id === player.id && modeSettings(game).abilities ? entry.energy : undefined,
      abilityCharges: entry.id === player.id && modeSettings(game).abilities ? publicAbilityCharges(entry, game) : undefined
    })),
    turn: turnPlayer
      ? {
          playerName: turnPlayer.name,
          isYou: turnPlayer.id === player.id
        }
      : null,
    winner: winner
      ? {
          playerName: winner.name,
          isYou: winner.id === player.id
        }
      : null,
    abandonedBy: abandonedBy
      ? {
          playerName: abandonedBy.name,
          isYou: abandonedBy.id === player.id
        }
      : null,
    score: game.score ? publicScore(game.score) : null,
    stats: {
      outgoing: ownStats,
      incoming: incomingStats
    },
    own: {
      ready: player.ready,
      commander: publicCommander(player, game),
      commanderState: commanderStateFor(player, game),
      energy: modeSettings(game).abilities ? player.energy : 0,
      abilityCharges: modeSettings(game).abilities ? publicAbilityCharges(player, game) : initialAbilityCharges(game),
      ships: player.ships || [],
      incomingShots: opponent ? (game.shotsByPlayer[opponent.id] || []).map(cloneShot) : []
    },
    target: {
      opponentName: opponent ? opponent.name : null,
      opponentReady: opponent ? opponent.ready : false,
      ships: game.status === 'finished' && opponent ? opponent.ships || [] : [],
      outgoingShots: (game.shotsByPlayer[player.id] || []).map(cloneShot),
      sonarScans: sonarScansFor(player).map((scan) => ({ ...scan }))
    },
    log: game.log.slice(-18)
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, error) {
  const statusCode = error instanceof GameError ? error.statusCode : 500;
  sendJson(res, statusCode, { error: error.message || 'Något gick fel.' });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new GameError(413, 'För stor förfrågan.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new GameError(400, 'Ogiltig JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function broadcast(game) {
  const roomSubscribers = subscribers.get(game.code);
  if (!roomSubscribers) {
    return;
  }

  for (const subscriber of [...roomSubscribers]) {
    try {
      sendEvent(subscriber.res, 'state', serializeGame(game, subscriber.playerId));
    } catch {
      roomSubscribers.delete(subscriber);
    }
  }
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function handleEvents(req, res, parts) {
  const code = normalizeCode(parts[2]);
  const playerId = parts[3];
  const game = games.get(code);
  if (!game || !game.players.some((player) => player.id === playerId)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Rummet eller spelaren hittades inte.');
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write(': connected\n\n');

  const subscriber = { playerId, res };
  if (!subscribers.has(code)) {
    subscribers.set(code, new Set());
  }
  subscribers.get(code).add(subscriber);
  sendEvent(res, 'state', serializeGame(game, playerId));

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);
  keepAlive.unref?.();

  req.on('close', () => {
    clearInterval(keepAlive);
    const roomSubscribers = subscribers.get(code);
    if (roomSubscribers) {
      roomSubscribers.delete(subscriber);
      if (roomSubscribers.size === 0) {
        subscribers.delete(code);
      }
    }
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'events') {
      handleEvents(req, res, parts);
      return;
    }

    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'state') {
      const game = getGame(parts[2]);
      sendJson(res, 200, { state: serializeGame(game, parts[3]) });
      return;
    }

    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'scores') {
      sendJson(res, 200, { scores: getHighScores() });
      return;
    }

    if (req.method !== 'POST') {
      fail(405, 'Metoden stöds inte.');
    }

    const body = await parseBody(req);

    if (parts[1] === 'create') {
      const { game, code, playerId } = createGame(body.name, games, body.mode, body.commander);
      sendJson(res, 201, { code, playerId, state: serializeGame(game, playerId) });
      return;
    }

    if (parts[1] === 'create-bot') {
      const { game, code, playerId } = createBotGame(body.name, games, body.mode, body.commander);
      sendJson(res, 201, { code, playerId, state: serializeGame(game, playerId) });
      return;
    }

    if (parts[1] === 'join-info') {
      sendJson(res, 200, getJoinInfo(body.code, games));
      return;
    }

    if (parts[1] === 'join') {
      const { game, code, playerId } = joinGame(body.code, body.name, games, body.commander);
      broadcast(game);
      sendJson(res, 200, { code, playerId, state: serializeGame(game, playerId) });
      return;
    }

    if (parts[1] === 'place') {
      const { game } = placeFleet(body.code, body.playerId, body.ships);
      broadcast(game);
      sendJson(res, 200, { state: serializeGame(game, body.playerId) });
      return;
    }

    if (parts[1] === 'action') {
      const { game, result } = performAction(body.code, body.playerId, body);
      broadcast(game);
      sendJson(res, 200, { result, state: serializeGame(game, body.playerId) });
      return;
    }

    if (parts[1] === 'leave') {
      const { game } = abandonGame(body.code, body.playerId);
      broadcast(game);
      sendJson(res, 200, { state: serializeGame(game, body.playerId) });
      return;
    }

    fail(404, 'API-rutten hittades inte.');
  } catch (error) {
    sendError(res, error);
  }
}

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.png', 'image/png'],
  ['.mp3', 'audio/mpeg'],
  ['.ico', 'image/x-icon']
]);

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Hittades inte.');
      return;
    }

    res.writeHead(200, {
      'content-type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
}

function cleanupOldGames() {
  const now = Date.now();
  const cleanupGraceMs = 60 * 60 * 1000;
  for (const [code, game] of games) {
    expireGameIfNeeded(game);
    const finishedAt = Number(game.finishedAt || game.expiredAt || 0);
    const expiresAt = Number(game.expiresAt || 0);
    const shouldDelete = (isTerminalStatus(game.status) && finishedAt && finishedAt < now - cleanupGraceMs)
      || (expiresAt && expiresAt < now - cleanupGraceMs);
    if (shouldDelete) {
      games.delete(code);
      const roomSubscribers = subscribers.get(code);
      if (roomSubscribers) {
        for (const subscriber of roomSubscribers) {
          subscriber.res.end();
        }
        subscribers.delete(code);
      }
    }
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`BattleShip Arcade körs på http://${HOST}:${PORT}`);
  });

  const cleanupTimer = setInterval(cleanupOldGames, 30 * 60 * 1000);
  cleanupTimer.unref?.();
}

module.exports = {
  ARCADE_FLEET,
  ARCADE_ABILITY_CHARGES,
  BARRAGE_COST,
  BARRAGE_CHARGES,
  BOARD_SIZE,
  CLASSIC_FLEET,
  GAME_MODES,
  GAME_TTL_MS,
  LOBBY_TTL_MS,
  FLEET,
  GameError,
  MAX_ENERGY,
  SONAR_COST,
  SONAR_CHARGES,
  SONAR_SIZE,
  abandonGame,
  createBotGame,
  createGame,
  fleetForMode,
  getJoinInfo,
  joinGame,
  getHighScores,
  performAction,
  placeFleet,
  serializeGame,
  validateFleet
};

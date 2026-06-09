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
const DEFAULT_MODE = 'arcade';
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
    hitKeepsTurn: true,
    startingEnergy: 2
  })
});

const FLEET = Object.freeze([
  Object.freeze({ id: 'carrier', name: 'Hangarfartyg', length: 5 }),
  Object.freeze({ id: 'battleship', name: 'Slagskepp', length: 4 }),
  Object.freeze({ id: 'cruiser', name: 'Kryssare', length: 3 }),
  Object.freeze({ id: 'submarine', name: 'Ubåt', length: 3 }),
  Object.freeze({ id: 'destroyer', name: 'Jagare', length: 2 })
]);

const games = new Map();
const subscribers = new Map();
const highScores = [];
const SCORE_LIMIT = 10;
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

function publicMode(gameOrMode) {
  const settings = modeSettings(gameOrMode);
  return {
    id: settings.id,
    label: settings.label,
    abilities: settings.abilities,
    hitKeepsTurn: settings.hitKeepsTurn
  };
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

function createPlayer(name, index) {
  return {
    id: randomId(),
    index,
    name: cleanName(name, index === 0 ? 'Värd' : 'Utmanare'),
    ships: null,
    ready: false,
    energy: 0,
    sonarScans: []
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

function compareScores(a, b) {
  return a.durationMs - b.durationMs || a.shots - b.shots || a.finishedAt - b.finishedAt;
}

function publicScore(score) {
  const shots = Number(score.shots || 0);
  const hits = Number(score.hits ?? shots);
  const misses = Number(score.misses ?? Math.max(0, shots - hits));
  return {
    code: score.code,
    winnerName: score.winnerName,
    opponentName: score.opponentName,
    mode: normalizeMode(score.mode),
    durationMs: score.durationMs,
    shots,
    hits,
    misses,
    accuracy: shots ? Math.round((hits / shots) * 100) : 0,
    finishedAt: score.finishedAt
  };
}

function getHighScores(limit = SCORE_LIMIT) {
  return highScores.slice(0, limit).map(publicScore);
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
  highScores.splice(SCORE_LIMIT);
  return score;
}

function createGame(hostName, store = games, mode = DEFAULT_MODE) {
  const code = generateCode(store);
  const host = createPlayer(hostName, 0);
  const gameMode = normalizeMode(mode);
  const game = {
    code,
    mode: gameMode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'waiting',
    startedAt: null,
    finishedAt: null,
    players: [host],
    shotsByPlayer: {
      [host.id]: []
    },
    turnPlayerId: null,
    winnerId: null,
    score: null,
    log: []
  };

  logEvent(game, 'system', `${host.name} skapade ett ${modeSettings(gameMode).label}-rum.`);
  store.set(code, game);
  return { game, code, playerId: host.id };
}

function getGame(codeInput, store = games) {
  const code = normalizeCode(codeInput);
  const game = store.get(code);
  if (!game) {
    fail(404, 'Rummet hittades inte.');
  }
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

function joinGame(codeInput, playerName, store = games) {
  const game = getGame(codeInput, store);
  if (game.players.length >= 2) {
    fail(409, 'Rummet är fullt.');
  }
  if (game.status !== 'waiting') {
    fail(409, 'Rummet har redan startat.');
  }

  const player = createPlayer(playerName, 1);
  game.players.push(player);
  game.shotsByPlayer[player.id] = [];
  game.status = 'placing';
  touch(game);
  logEvent(game, 'system', `${player.name} gick med. Placera skeppen!`);

  return { game, code: game.code, playerId: player.id };
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

function validateFleet(rawShips) {
  if (!Array.isArray(rawShips)) {
    fail(400, 'Skeppen saknas.');
  }

  const occupied = new Set();
  const normalized = [];

  for (const fleetShip of FLEET) {
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
  if (game.status !== 'placing') {
    fail(409, 'Det går inte att placera skepp just nu.');
  }
  if (player.ready) {
    fail(409, 'Du är redan redo.');
  }

  player.ships = validateFleet(rawShips);
  player.ready = true;
  player.energy = modeSettings(game).startingEnergy;
  player.sonarScans = [];
  touch(game);
  logEvent(game, 'system', `${player.name} är redo.`);

  if (game.players.length === 2 && game.players.every((entry) => entry.ready)) {
    game.status = 'playing';
    game.startedAt = Date.now();
    game.turnPlayerId = game.players[0].id;
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
  return (game.shotsByPlayer[attackerId] || []).some((shot) => shot.x === x && shot.y === y);
}

function isShipSunkByShots(shots, ship) {
  return ship.cells.every((cell) => shots.some((shot) => shot.x === cell.x && shot.y === cell.y && shot.result === 'hit'));
}

function isFleetSunkBy(game, attackerId, defender) {
  const shots = game.shotsByPlayer[attackerId] || [];
  return Boolean(defender.ships && defender.ships.every((ship) => isShipSunkByShots(shots, ship)));
}

function addEnergy(player, amount) {
  player.energy = Math.max(0, Math.min(MAX_ENERGY, player.energy + amount));
}

function resolveSingleShot(game, attacker, defender, x, y, source) {
  const settings = modeSettings(game);
  const ship = findShipAt(defender, x, y);
  const shot = {
    x,
    y,
    source,
    result: ship ? 'hit' : 'miss',
    at: Date.now()
  };

  if (ship) {
    shot.shipId = ship.id;
    game.shotsByPlayer[attacker.id].push(shot);
    const sunk = isShipSunkByShots(game.shotsByPlayer[attacker.id], ship);
    if (sunk) {
      shot.sunkShipId = ship.id;
      shot.sunkShipName = ship.name;
      if (settings.abilities) {
        addEnergy(attacker, 3);
      }
      return { shot, hit: true, sunkShip: ship };
    }
    if (settings.abilities) {
      addEnergy(attacker, 1);
    }
    return { shot, hit: true, sunkShip: null };
  }

  game.shotsByPlayer[attacker.id].push(shot);
  return { shot, hit: false, sunkShip: null };
}

function formatCell(x, y) {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

function finishGame(game, winner) {
  game.status = 'finished';
  game.turnPlayerId = null;
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
  if (outcome.sunkShip) {
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
    game.turnPlayerId = defender.id;
  }

  return { ability: 'shot', ...outcome };
}

function regionCells(centerX, centerY, radius) {
  const cells = [];
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function performSonar(game, attacker, defender, x, y) {
  if (!modeSettings(game).abilities) {
    fail(409, 'Sonar finns bara i Arcade-laget.');
  }
  if (attacker.energy < SONAR_COST) {
    fail(409, 'Du har inte tillräckligt med energi för sonar.');
  }
  if (attacker.sonarScans.some((scan) => scan.x === x && scan.y === y)) {
    fail(409, 'Du har redan pingat den rutan med sonar.');
  }

  const count = regionCells(x, y, 1).filter((cell) => findShipAt(defender, cell.x, cell.y)).length;
  addEnergy(attacker, -SONAR_COST);
  attacker.sonarScans.push({ x, y, count, at: Date.now() });
  logEvent(game, 'power', `${attacker.name} använde sonar vid ${formatCell(x, y)}.`);
  return { ability: 'sonar', count };
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
  if (attacker.energy < BARRAGE_COST) {
    fail(409, 'Du har inte tillräckligt med energi för barrage.');
  }

  const targets = barrageCells(x, y).filter((cell) => !hasShotAt(game, attacker.id, cell.x, cell.y));
  if (targets.length === 0) {
    fail(409, 'Barrage-området är redan beskjutet.');
  }

  addEnergy(attacker, -BARRAGE_COST);
  const outcomes = targets.map((cell) => resolveSingleShot(game, attacker, defender, cell.x, cell.y, 'barrage'));
  const hits = outcomes.filter((outcome) => outcome.hit);
  const sunkNames = [...new Set(outcomes.filter((outcome) => outcome.sunkShip).map((outcome) => outcome.sunkShip.name))];
  const sunkText = sunkNames.length ? ` Sänkte ${sunkNames.join(', ')}.` : '';
  logEvent(game, hits.length ? 'hit' : 'miss', `${attacker.name} körde barrage vid ${formatCell(x, y)}: ${hits.length}/${targets.length} träff.${sunkText}`);

  if (isFleetSunkBy(game, attacker.id, defender)) {
    finishGame(game, attacker);
  } else {
    game.turnPlayerId = defender.id;
  }

  return { ability: 'barrage', shots: outcomes.map((outcome) => outcome.shot) };
}

function performAction(codeInput, playerId, body, store = games) {
  const game = getGame(codeInput, store);
  const attacker = getPlayer(game, playerId);
  const defender = getOpponent(game, playerId);
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
  if (shot.sunkShipId) clone.sunkShipId = shot.sunkShipId;
  if (shot.sunkShipName) clone.sunkShipName = shot.sunkShipName;
  return clone;
}

function serializeGame(game, playerId) {
  const player = getPlayer(game, playerId);
  const opponent = getOpponent(game, playerId);
  const turnPlayer = game.players.find((entry) => entry.id === game.turnPlayerId) || null;
  const winner = game.players.find((entry) => entry.id === game.winnerId) || null;
  const ownStats = shotStatsFor(game, player.id);
  const incomingStats = opponent ? shotStatsFor(game, opponent.id) : { shots: 0, hits: 0, misses: 0, accuracy: 0 };

  return {
    code: game.code,
    mode: publicMode(game),
    status: game.status,
    boardSize: BOARD_SIZE,
    fleet: FLEET,
    playerId: player.id,
    playerName: player.name,
    players: game.players.map((entry) => ({
      name: entry.name,
      isYou: entry.id === player.id,
      ready: entry.ready,
      energy: entry.id === player.id && modeSettings(game).abilities ? entry.energy : undefined
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
    score: game.score ? publicScore(game.score) : null,
    stats: {
      outgoing: ownStats,
      incoming: incomingStats
    },
    own: {
      ready: player.ready,
      energy: modeSettings(game).abilities ? player.energy : 0,
      ships: player.ships || [],
      incomingShots: opponent ? (game.shotsByPlayer[opponent.id] || []).map(cloneShot) : []
    },
    target: {
      opponentName: opponent ? opponent.name : null,
      opponentReady: opponent ? opponent.ready : false,
      outgoingShots: (game.shotsByPlayer[player.id] || []).map(cloneShot),
      sonarScans: player.sonarScans.map((scan) => ({ ...scan }))
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
      const { game, code, playerId } = createGame(body.name, games, body.mode);
      sendJson(res, 201, { code, playerId, state: serializeGame(game, playerId) });
      return;
    }

    if (parts[1] === 'join') {
      const { game, code, playerId } = joinGame(body.code, body.name);
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
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [code, game] of games) {
    if (game.updatedAt < cutoff) {
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
  BARRAGE_COST,
  BOARD_SIZE,
  GAME_MODES,
  FLEET,
  GameError,
  MAX_ENERGY,
  SONAR_COST,
  createGame,
  joinGame,
  getHighScores,
  performAction,
  placeFleet,
  serializeGame,
  validateFleet
};

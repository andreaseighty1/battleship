import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BOARD_SIZE = 10;
const SONAR_COST = 2;
const BARRAGE_COST = 5;
const MAX_ENERGY = 9;
const LOBBY_TTL_MS = 5 * 60 * 1000;
const GAME_TTL_MS = 48 * 60 * 60 * 1000;
const SCORE_LIMIT = 50;
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

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS'
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || readDefaultSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
const publicApiKeys = new Set([
  Deno.env.get('SUPABASE_ANON_KEY') || '',
  ...readDefaultPublicKeys(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))
].filter(Boolean));
const admin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function readDefaultSecretKey(value: string | undefined): string {
  if (!value) return '';
  try {
    const keys = JSON.parse(value);
    if (typeof keys.default === 'string') return keys.default;
    const firstValue = Object.values(keys).find((entry) => typeof entry === 'string');
    return typeof firstValue === 'string' ? firstValue : '';
  } catch {
    return value;
  }
}

function readDefaultPublicKeys(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const keys = JSON.parse(value);
    return Object.values(keys).filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [value];
  }
}

function hasAllowedApiKey(req: Request): boolean {
  if (publicApiKeys.size === 0) return true;
  const key = req.headers.get('apikey') || '';
  return publicApiKeys.has(key);
}

class GameError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function fail(statusCode: number, message: string): never {
  throw new GameError(statusCode, message);
}

function json(statusCode: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.body) return {};
  try {
    return await req.json();
  } catch {
    fail(400, 'Invalid JSON.');
  }
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 18);
}

function randomIndex(max: number): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

function normalizeForProfanity(value: unknown): string {
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

function containsProfanity(value: unknown): boolean {
  const normalized = normalizeForProfanity(value);
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return PROFANITY_TERMS.some((term) => compact.includes(term) || words.includes(term))
    || PROFANITY_WORD_TERMS.some((term) => words.includes(term) || compact === term);
}

function cleanName(value: unknown, fallback = 'Captain'): string {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) fail(400, 'Skriv ett namn.');
  const chosenName = (name || fallback).slice(0, 24);
  if (containsProfanity(chosenName)) fail(400, 'Välj ett annat namn.');
  return chosenName;
}

function normalizeCode(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeMode(value: unknown): string {
  const mode = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(GAME_MODES, mode) ? mode : DEFAULT_MODE;
}

function modeSettings(gameOrMode: any): any {
  const mode = typeof gameOrMode === 'string' ? gameOrMode : gameOrMode?.mode;
  return (GAME_MODES as any)[normalizeMode(mode)];
}

function publicMode(gameOrMode: any): any {
  const settings = modeSettings(gameOrMode);
  return {
    id: settings.id,
    label: settings.label,
    abilities: settings.abilities,
    hitKeepsTurn: settings.hitKeepsTurn
  };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function formatCell(x: number, y: number): string {
  return `${String.fromCharCode(65 + y)}${x + 1}`;
}

function addEnergy(player: any, amount: number): void {
  player.energy = Math.max(0, Math.min(MAX_ENERGY, player.energy + amount));
}

function createPlayer(name: unknown, index: number): any {
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

function createBotPlayer(name = 'Datorn'): any {
  const bot = createPlayer(name, 1);
  bot.isBot = true;
  return bot;
}

function logEvent(game: any, type: string, text: string): void {
  game.log.push({ type, text, at: Date.now() });
  if (game.log.length > 80) {
    game.log.splice(0, game.log.length - 80);
  }
}

function touch(game: any): void {
  game.updatedAt = Date.now();
}

function isTerminalStatus(status: unknown): boolean {
  return status === 'finished' || status === 'abandoned' || status === 'expired';
}

function ensureTiming(game: any): void {
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

function clearTurn(game: any): void {
  game.turnPlayerId = null;
  game.turnStartedAt = null;
}

function setTurn(game: any, playerId: string): void {
  if (game.turnPlayerId !== playerId || !Number.isFinite(Number(game.turnStartedAt))) {
    game.turnStartedAt = Date.now();
  }
  game.turnPlayerId = playerId;
}

function expireGameIfNeeded(game: any): boolean {
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

function activeExpiresAt(game: any): number {
  ensureTiming(game);
  return game.status === 'waiting' ? game.lobbyExpiresAt : game.expiresAt;
}

function publicScore(score: any): any {
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

function isHiddenScore(score: any): boolean {
  return score
    && String(score.winnerName || '').trim().toLowerCase() === 'ada'
    && normalizeMode(score.mode) === 'arcade'
    && Number(score.durationMs || 0) <= 10000
    && Number(score.shots || 0) === 18
    && Number(score.hits || 0) === 17
    && Number(score.misses || 0) === 1;
}

async function getHighScores(): Promise<any[]> {
  let { data, error } = await admin!
    .from('battleship_scores')
    .select('code,winner_name,opponent_name,duration_ms,shots,hits,misses,finished_at,mode')
    .order('duration_ms', { ascending: true })
    .order('shots', { ascending: true })
    .order('finished_at', { ascending: true })
    .limit(SCORE_LIMIT + 10);
  if (error && error.message.includes('mode')) {
    const fallback = await admin!
      .from('battleship_scores')
      .select('code,winner_name,opponent_name,duration_ms,shots,hits,misses,finished_at')
      .order('duration_ms', { ascending: true })
      .order('shots', { ascending: true })
      .order('finished_at', { ascending: true })
      .limit(SCORE_LIMIT + 10);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) fail(500, error.message);
  return (data || [])
    .map((score: any) => ({
      code: score.code,
      winnerName: score.winner_name,
      opponentName: score.opponent_name,
      mode: normalizeMode(score.mode),
      durationMs: score.duration_ms,
      shots: score.shots,
      hits: score.hits,
      misses: score.misses,
      finishedAt: new Date(score.finished_at).getTime()
    }))
    .filter((score: any) => !isHiddenScore(score))
    .slice(0, SCORE_LIMIT)
    .map(publicScore);
}

function shotStatsFor(game: any, playerId: string): any {
  const shots = game.shotsByPlayer[playerId] || [];
  const hits = shots.filter((shot: any) => shot.result === 'hit').length;
  const misses = shots.filter((shot: any) => shot.result === 'miss').length;
  return {
    shots: shots.length,
    hits,
    misses,
    accuracy: shots.length ? Math.round((hits / shots.length) * 100) : 0
  };
}

async function recordHighScore(game: any, winner: any): Promise<any> {
  if (game.score) return game.score;

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

  const payload: any = {
    code: score.code,
    mode: score.mode,
    winner_name: score.winnerName,
    opponent_name: score.opponentName,
    duration_ms: score.durationMs,
    shots: score.shots,
    hits: score.hits,
    misses: score.misses,
    finished_at: new Date(score.finishedAt).toISOString()
  };
  let { error } = await admin!
    .from('battleship_scores')
    .insert(payload);
  if (error && error.message.includes('mode')) {
    delete payload.mode;
    error = (await admin!.from('battleship_scores').insert(payload)).error;
  }
  if (error) fail(500, error.message);
  return score;
}

async function generateCode(): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) {
      code += alphabet[randomIndex(alphabet.length)];
    }
    const { data, error } = await admin!
      .from('battleship_games')
      .select('code')
      .eq('code', code)
      .maybeSingle();
    if (error) fail(500, error.message);
    if (!data) return code;
  }
  fail(503, 'Could not create a unique room code.');
}

async function loadGame(codeInput: unknown): Promise<any> {
  const code = normalizeCode(codeInput);
  const { data, error } = await admin!
    .from('battleship_games')
    .select('data')
    .eq('code', code)
    .maybeSingle();
  if (error) fail(500, error.message);
  if (!data) fail(404, 'Room not found.');
  const game = data.data;
  if (expireGameIfNeeded(game)) {
    await saveGame(game);
  }
  return game;
}

async function saveGame(game: any): Promise<void> {
  ensureTiming(game);
  const { error } = await admin!
    .from('battleship_games')
    .update({
      data: game,
      updated_at: new Date().toISOString(),
      expires_at: new Date(activeExpiresAt(game)).toISOString()
    })
    .eq('code', game.code);
  if (error) fail(500, error.message);
  const tick = await admin!.rpc('battleship_tick_game', { game_code: game.code });
  if (tick.error) fail(500, tick.error.message);
}

async function createGame(hostName: unknown, mode: unknown = DEFAULT_MODE): Promise<{ game: any; code: string; playerId: string }> {
  const code = await generateCode();
  const host = createPlayer(hostName, 0);
  const gameMode = normalizeMode(mode);
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
    shotsByPlayer: { [host.id]: [] },
    turnPlayerId: null,
    turnStartedAt: null,
    winnerId: null,
    abandonedByPlayerId: null,
    abandonedAt: null,
    score: null,
    log: []
  };
  logEvent(game, 'system', `${host.name} skapade ett ${modeSettings(gameMode).label}-rum.`);

  const { error } = await admin!
    .from('battleship_games')
    .insert({ code, data: game, expires_at: new Date(activeExpiresAt(game)).toISOString() });
  if (error) fail(500, error.message);
  const tick = await admin!.rpc('battleship_tick_game', { game_code: code });
  if (tick.error) fail(500, tick.error.message);
  return { game, code, playerId: host.id };
}

function shipAtFleet(ships: any[], x: number, y: number): any | null {
  return ships.find((ship) => ship.cells.some((cell: any) => cell.x === x && cell.y === y)) || null;
}

function randomFleet(): any[] {
  const ships = [];
  for (const ship of FLEET) {
    let placed = false;
    for (let attempt = 0; attempt < 800 && !placed; attempt += 1) {
      const direction = randomIndex(2) === 0 ? 'horizontal' : 'vertical';
      const maxX = direction === 'horizontal' ? BOARD_SIZE - ship.length : BOARD_SIZE - 1;
      const maxY = direction === 'vertical' ? BOARD_SIZE - ship.length : BOARD_SIZE - 1;
      const x = randomIndex(maxX + 1);
      const y = randomIndex(maxY + 1);
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
  return validateFleet(ships);
}

async function createBotGame(hostName: unknown): Promise<{ game: any; code: string; playerId: string }> {
  const { game, code, playerId } = await createGame(hostName, 'classic');
  const bot = createBotPlayer();
  bot.ships = randomFleet();
  bot.ready = true;
  bot.energy = modeSettings(game).startingEnergy;
  bot.sonarScans = [];
  game.players.push(bot);
  game.shotsByPlayer[bot.id] = [];
  game.status = 'placing';
  touch(game);
  logEvent(game, 'system', `${bot.name} Ã¤r redo. Placera din flotta!`);
  await saveGame(game);
  return { game, code, playerId };
}

function getPlayer(game: any, playerId: unknown): any {
  const player = game.players.find((entry: any) => entry.id === playerId);
  if (!player) fail(403, 'Player is not in this room.');
  return player;
}

function getOpponent(game: any, playerId: unknown): any | null {
  return game.players.find((entry: any) => entry.id !== playerId) || null;
}

async function joinGame(codeInput: unknown, playerName: unknown): Promise<{ game: any; code: string; playerId: string }> {
  const game = await loadGame(codeInput);
  if (game.players.length >= 2) fail(409, 'Room is full.');
  if (game.status === 'expired') fail(410, 'Rummet har gått ut.');
  if (game.status !== 'waiting') fail(409, 'Room has already started.');

  const player = createPlayer(playerName, 1);
  game.players.push(player);
  game.shotsByPlayer[player.id] = [];
  game.status = 'placing';
  touch(game);
  logEvent(game, 'system', `${player.name} gick med. Placera skeppen!`);
  await saveGame(game);
  return { game, code: game.code, playerId: player.id };
}

async function abandonGame(codeInput: unknown, playerId: unknown): Promise<any> {
  const game = await loadGame(codeInput);
  const player = getPlayer(game, playerId);
  if (isTerminalStatus(game.status)) return game;

  game.status = 'abandoned';
  clearTurn(game);
  game.abandonedByPlayerId = player.id;
  game.abandonedAt = Date.now();
  game.finishedAt = game.abandonedAt;
  touch(game);
  logEvent(game, 'system', `${player.name} lämnade matchen.`);
  await saveGame(game);
  return game;
}

function assertBoardCell(x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
    fail(400, 'Cell is outside the board.');
  }
}

function normalizeCell(cell: any): { x: number; y: number } {
  const x = Number(cell?.x);
  const y = Number(cell?.y);
  assertBoardCell(x, y);
  return { x, y };
}

function validateFleet(rawShips: any): any[] {
  if (!Array.isArray(rawShips)) fail(400, 'Fleet is missing.');
  const occupied = new Set<string>();
  const normalized = [];

  for (const fleetShip of FLEET) {
    const candidates = rawShips.filter((ship: any) => ship?.id === fleetShip.id);
    if (candidates.length !== 1) fail(400, `Fleet must contain one ${fleetShip.name}.`);
    const ship = candidates[0];
    if (!Array.isArray(ship.cells) || ship.cells.length !== fleetShip.length) {
      fail(400, `${fleetShip.name} has the wrong length.`);
    }

    const cells = ship.cells.map(normalizeCell);
    const uniqueCells = new Set(cells.map((cell: any) => cellKey(cell.x, cell.y)));
    if (uniqueCells.size !== cells.length) fail(400, `${fleetShip.name} contains duplicate cells.`);

    const sameRow = cells.every((cell: any) => cell.y === cells[0].y);
    const sameColumn = cells.every((cell: any) => cell.x === cells[0].x);
    if (!sameRow && !sameColumn) fail(400, `${fleetShip.name} must be straight.`);

    const sorted = [...cells].sort((a, b) => sameRow ? a.x - b.x : a.y - b.y);
    for (let i = 0; i < sorted.length; i += 1) {
      const expectedX = sameRow ? sorted[0].x + i : sorted[0].x;
      const expectedY = sameColumn ? sorted[0].y + i : sorted[0].y;
      if (sorted[i].x !== expectedX || sorted[i].y !== expectedY) {
        fail(400, `${fleetShip.name} must be contiguous.`);
      }
    }

    for (const cell of sorted) {
      const key = cellKey(cell.x, cell.y);
      if (occupied.has(key)) fail(400, 'Ships may not overlap.');
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

async function placeFleet(codeInput: unknown, playerId: unknown, rawShips: any): Promise<any> {
  const game = await loadGame(codeInput);
  const player = getPlayer(game, playerId);
  if (game.status === 'expired') fail(410, 'Matchen har gått ut.');
  if (game.status !== 'placing') fail(409, 'You cannot place ships right now.');
  if (player.ready) fail(409, 'You are already ready.');

  player.ships = validateFleet(rawShips);
  player.ready = true;
  player.energy = modeSettings(game).startingEnergy;
  player.sonarScans = [];
  touch(game);
  logEvent(game, 'system', `${player.name} är redo.`);

  if (game.players.length === 2 && game.players.every((entry: any) => entry.ready)) {
    game.status = 'playing';
    game.startedAt = Date.now();
    setTurn(game, game.players[0].id);
    logEvent(game, 'system', `Matchen startade. ${game.players[0].name} börjar.`);
  }

  await saveGame(game);
  return game;
}

function findShipAt(player: any, x: number, y: number): any | null {
  if (!player?.ships) return null;
  return player.ships.find((ship: any) => ship.cells.some((cell: any) => cell.x === x && cell.y === y)) || null;
}

function hasShotAt(game: any, attackerId: string, x: number, y: number): boolean {
  return (game.shotsByPlayer[attackerId] || []).some((shot: any) => shot.x === x && shot.y === y);
}

function isShipSunkByShots(shots: any[], ship: any): boolean {
  return ship.cells.every((cell: any) => shots.some((shot: any) => shot.x === cell.x && shot.y === cell.y && shot.result === 'hit'));
}

function markSunkShipShots(shots: any[], ship: any): void {
  if (!Array.isArray(shots) || !ship || !Array.isArray(ship.cells)) return;
  const shipCells = new Set(ship.cells.map((cell: any) => `${cell.x},${cell.y}`));
  shots.forEach((shot: any) => {
    if (shot.result === 'hit' && shipCells.has(`${shot.x},${shot.y}`)) {
      shot.sunkShipId = ship.id;
      shot.sunkShipName = ship.name;
    }
  });
}

function isFleetSunkBy(game: any, attackerId: string, defender: any): boolean {
  const shots = game.shotsByPlayer[attackerId] || [];
  return Boolean(defender.ships && defender.ships.every((ship: any) => isShipSunkByShots(shots, ship)));
}

function resolveSingleShot(game: any, attacker: any, defender: any, x: number, y: number, source: string): any {
  const settings = modeSettings(game);
  const ship = findShipAt(defender, x, y);
  const shot: any = { x, y, source, result: ship ? 'hit' : 'miss', at: Date.now() };
  if (!ship) {
    game.shotsByPlayer[attacker.id].push(shot);
    return { shot, hit: false, sunkShip: null };
  }

  shot.shipId = ship.id;
  game.shotsByPlayer[attacker.id].push(shot);
  const sunk = isShipSunkByShots(game.shotsByPlayer[attacker.id], ship);
  if (sunk) {
    markSunkShipShots(game.shotsByPlayer[attacker.id], ship);
    if (settings.abilities) addEnergy(attacker, 3);
    return { shot, hit: true, sunkShip: ship };
  }
  if (settings.abilities) addEnergy(attacker, 1);
  return { shot, hit: true, sunkShip: null };
}

function finishGame(game: any, winner: any): void {
  game.status = 'finished';
  clearTurn(game);
  game.winnerId = winner.id;
  logEvent(game, 'win', `${winner.name} vann matchen.`);
}

function performShot(game: any, attacker: any, defender: any, x: number, y: number): any {
  const settings = modeSettings(game);
  if (hasShotAt(game, attacker.id, x, y)) fail(409, 'You already fired at that cell.');
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
    setTurn(game, defender.id);
  }
  return { ability: 'shot', ...outcome };
}

function isBotPlayer(player: any): boolean {
  return Boolean(player?.isBot);
}

function unshotCells(game: any, attackerId: string): Array<{ x: number; y: number }> {
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

function botTargetCandidates(game: any, botId: string): Array<{ x: number; y: number }> {
  const shots = game.shotsByPlayer[botId] || [];
  const candidates: Array<{ x: number; y: number }> = [];
  shots
    .filter((shot: any) => shot.result === 'hit' && !shot.sunkShipId)
    .forEach((shot: any) => {
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

function chooseBotShot(game: any, bot: any): { x: number; y: number } | null {
  const targets = botTargetCandidates(game, bot.id);
  if (targets.length) {
    return targets[randomIndex(targets.length)];
  }
  const available = unshotCells(game, bot.id);
  return available.length ? available[randomIndex(available.length)] : null;
}

function runBotTurns(game: any): void {
  let guard = 0;
  while (game.status === 'playing' && guard < BOARD_SIZE * BOARD_SIZE) {
    const bot = game.players.find((entry: any) => entry.id === game.turnPlayerId);
    if (!isBotPlayer(bot)) {
      return;
    }
    const defender = getOpponent(game, bot.id);
    if (!defender?.ready) {
      return;
    }
    const shot = chooseBotShot(game, bot);
    if (!shot) {
      setTurn(game, defender.id);
      return;
    }
    performShot(game, bot, defender, shot.x, shot.y);
    guard += 1;
  }
}

function regionCells(centerX: number, centerY: number, radius: number): Array<{ x: number; y: number }> {
  const cells = [];
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE) cells.push({ x, y });
    }
  }
  return cells;
}

function performSonar(game: any, attacker: any, defender: any, x: number, y: number): any {
  if (!modeSettings(game).abilities) fail(409, 'Sonar finns bara i Arcade-laget.');
  if (attacker.energy < SONAR_COST) fail(409, 'Not enough energy for sonar.');
  if (attacker.sonarScans.some((scan: any) => scan.x === x && scan.y === y)) {
    fail(409, 'You already scanned that cell.');
  }
  const count = regionCells(x, y, 1).filter((cell) => findShipAt(defender, cell.x, cell.y)).length;
  addEnergy(attacker, -SONAR_COST);
  attacker.sonarScans.push({ x, y, count, at: Date.now() });
  logEvent(game, 'power', `${attacker.name} använde sonar vid ${formatCell(x, y)}.`);
  return { ability: 'sonar', count };
}

function barrageCells(centerX: number, centerY: number): Array<{ x: number; y: number }> {
  return [
    { x: centerX, y: centerY },
    { x: centerX, y: centerY - 1 },
    { x: centerX + 1, y: centerY },
    { x: centerX, y: centerY + 1 },
    { x: centerX - 1, y: centerY }
  ].filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE);
}

function performBarrage(game: any, attacker: any, defender: any, x: number, y: number): any {
  if (!modeSettings(game).abilities) fail(409, 'Barrage finns bara i Arcade-laget.');
  if (attacker.energy < BARRAGE_COST) fail(409, 'Not enough energy for barrage.');
  const targets = barrageCells(x, y).filter((cell) => !hasShotAt(game, attacker.id, cell.x, cell.y));
  if (targets.length === 0) fail(409, 'Barrage area is already fired at.');

  addEnergy(attacker, -BARRAGE_COST);
  const outcomes = targets.map((cell) => resolveSingleShot(game, attacker, defender, cell.x, cell.y, 'barrage'));
  const hits = outcomes.filter((outcome) => outcome.hit);
  const sunkNames = [...new Set(outcomes.filter((outcome) => outcome.sunkShip).map((outcome) => outcome.sunkShip.name))];
  const sunkText = sunkNames.length ? ` Sänkte ${sunkNames.join(', ')}.` : '';
  logEvent(game, hits.length ? 'hit' : 'miss', `${attacker.name} körde barrage vid ${formatCell(x, y)}: ${hits.length}/${targets.length} träff.${sunkText}`);

  if (isFleetSunkBy(game, attacker.id, defender)) {
    finishGame(game, attacker);
  } else {
    setTurn(game, defender.id);
  }
  return { ability: 'barrage', shots: outcomes.map((outcome) => outcome.shot) };
}

async function performAction(body: any): Promise<{ game: any; result: any }> {
  const game = await loadGame(body.code);
  const attacker = getPlayer(game, body.playerId);
  const defender = getOpponent(game, body.playerId);
  if (game.status === 'expired') fail(410, 'Matchen har gått ut.');
  if (game.status !== 'playing') fail(409, 'Game is not running.');
  if (!defender?.ready) fail(409, 'Waiting for opponent.');
  if (game.turnPlayerId !== attacker.id) fail(409, 'It is not your turn.');

  const { x, y } = normalizeCell(body);
  const ability = String(body.ability || 'shot');
  let result;
  if (ability === 'shot') result = performShot(game, attacker, defender, x, y);
  else if (ability === 'sonar') result = performSonar(game, attacker, defender, x, y);
  else if (ability === 'barrage') result = performBarrage(game, attacker, defender, x, y);
  else fail(400, 'Unknown ability.');

  runBotTurns(game);
  if (game.status === 'finished') {
    const winner = game.players.find((entry: any) => entry.id === game.winnerId) || attacker;
    await recordHighScore(game, winner);
  }
  touch(game);
  await saveGame(game);
  return { game, result };
}

function cloneShot(shot: any): any {
  const clone: any = {
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

function serializeGame(game: any, playerId: unknown): any {
  expireGameIfNeeded(game);
  const player = getPlayer(game, playerId);
  const opponent = getOpponent(game, playerId);
  const turnPlayer = game.players.find((entry: any) => entry.id === game.turnPlayerId) || null;
  const winner = game.players.find((entry: any) => entry.id === game.winnerId) || null;
  const abandonedBy = game.players.find((entry: any) => entry.id === game.abandonedByPlayerId) || null;
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
    fleet: FLEET,
    playerId: player.id,
    playerName: player.name,
    players: game.players.map((entry: any) => ({
      name: entry.name,
      isYou: entry.id === player.id,
      ready: entry.ready,
      energy: entry.id === player.id && modeSettings(game).abilities ? entry.energy : undefined
    })),
    turn: turnPlayer ? { playerName: turnPlayer.name, isYou: turnPlayer.id === player.id } : null,
    winner: winner ? { playerName: winner.name, isYou: winner.id === player.id } : null,
    abandonedBy: abandonedBy ? { playerName: abandonedBy.name, isYou: abandonedBy.id === player.id } : null,
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
      ships: game.status === 'finished' && opponent ? opponent.ships || [] : [],
      outgoingShots: (game.shotsByPlayer[player.id] || []).map(cloneShot),
      sonarScans: player.sonarScans.map((scan: any) => ({ ...scan }))
    },
    log: game.log.slice(-18)
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!admin) return json(500, { error: 'Supabase service role environment is missing.' });
  if (!hasAllowedApiKey(req)) return json(401, { error: 'Invalid API key.' });

  try {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'battleship') parts.shift();

    if (req.method === 'GET' && parts[0] === 'state') {
      const game = await loadGame(parts[1]);
      return json(200, { state: serializeGame(game, parts[2]) });
    }

    if (req.method === 'GET' && parts[0] === 'scores') {
      return json(200, { scores: await getHighScores() });
    }

    if (req.method !== 'POST') fail(405, 'Method not allowed.');
    const body = await readBody(req);

    if (parts[0] === 'create') {
      const { game, code, playerId } = await createGame(body.name, body.mode);
      return json(201, { code, playerId, state: serializeGame(game, playerId) });
    }

    if (parts[0] === 'create-bot') {
      const { game, code, playerId } = await createBotGame(body.name);
      return json(201, { code, playerId, state: serializeGame(game, playerId) });
    }

    if (parts[0] === 'join') {
      const { game, code, playerId } = await joinGame(body.code, body.name);
      return json(200, { code, playerId, state: serializeGame(game, playerId) });
    }

    if (parts[0] === 'place') {
      const game = await placeFleet(body.code, body.playerId, body.ships);
      return json(200, { state: serializeGame(game, body.playerId) });
    }

    if (parts[0] === 'action') {
      const { game, result } = await performAction(body);
      return json(200, { result, state: serializeGame(game, body.playerId) });
    }

    if (parts[0] === 'leave') {
      const game = await abandonGame(body.code, body.playerId);
      return json(200, { state: serializeGame(game, body.playerId) });
    }

    fail(404, 'Route not found.');
  } catch (error) {
    if (error instanceof GameError) return json(error.statusCode, { error: error.message });
    return json(500, { error: error instanceof Error ? error.message : 'Unknown error.' });
  }
});

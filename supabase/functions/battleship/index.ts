import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BOARD_SIZE = 10;
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
const SCORE_FETCH_LIMIT = 250;
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

function fleetForMode(gameOrMode: any = DEFAULT_MODE): readonly any[] {
  return modeSettings(gameOrMode).abilities ? ARCADE_FLEET : CLASSIC_FLEET;
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

function normalizeCommander(value: unknown): string {
  const commander = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMMANDER_CARDS, commander) ? commander : DEFAULT_COMMANDER;
}

function commanderForMode(value: unknown, gameOrMode: any = DEFAULT_MODE): any | null {
  if (!modeSettings(gameOrMode).abilities) {
    return null;
  }
  return (COMMANDER_CARDS as any)[normalizeCommander(value)];
}

function publicCommander(player: any, gameOrMode: any = DEFAULT_MODE): any | null {
  const commander = commanderForMode(player?.commanderId, gameOrMode);
  return commander ? { ...commander } : null;
}

function initialCommanderState(player: any, gameOrMode: any = DEFAULT_MODE): any {
  const commander = commanderForMode(player?.commanderId, gameOrMode);
  return {
    defenseBlocked: commander?.id === 'defensive' ? false : null
  };
}

function commanderStateFor(player: any, gameOrMode: any = DEFAULT_MODE): any {
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

function initialAbilityCharges(gameOrMode: any = DEFAULT_MODE, player: any = null): any {
  if (!modeSettings(gameOrMode).abilities) {
    return { sonar: 0, barrage: 0 };
  }
  const charges = { ...ARCADE_ABILITY_CHARGES };
  const commander = commanderForMode(player?.commanderId, gameOrMode);
  if (commander?.id === 'offense') {
    charges.barrage += 1;
  }
  if (commander?.id === 'scout') {
    charges.sonar += 1;
  }
  return charges;
}

function ensureAbilityCharges(player: any, gameOrMode: any = DEFAULT_MODE): any {
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

function publicAbilityCharges(player: any, gameOrMode: any = DEFAULT_MODE): any {
  return { ...ensureAbilityCharges(player, gameOrMode) };
}

function sonarScansFor(player: any): any[] {
  if (!player) {
    return [];
  }
  if (!Array.isArray(player.sonarScans)) {
    player.sonarScans = [];
  }
  return player.sonarScans;
}

function useAbilityCharge(player: any, gameOrMode: any, ability: string, label: string): number {
  const charges = ensureAbilityCharges(player, gameOrMode);
  if (!Number.isInteger(charges[ability]) || charges[ability] <= 0) {
    fail(409, `${label} är slut.`);
  }
  charges[ability] -= 1;
  return charges[ability];
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function formatCell(x: number, y: number): string {
  return `${String.fromCharCode(65 + y)}${x + 1}`;
}

function createPlayer(name: unknown, index: number, commander: unknown = null, gameOrMode: any = DEFAULT_MODE): any {
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

function randomCommander(): string {
  const commanders = Object.keys(COMMANDER_CARDS);
  return commanders[randomIndex(commanders.length)];
}

function createBotPlayer(name = 'Datorn', gameOrMode: any = DEFAULT_MODE): any {
  const bot = createPlayer(name, 1, randomCommander(), gameOrMode);
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

function isBotScore(score: any): boolean {
  const opponent = String(score?.opponentName || '').trim().toLowerCase();
  const winner = String(score?.winnerName || '').trim().toLowerCase();
  return ['datorn', 'ai', 'computer'].includes(opponent) || ['datorn', 'ai', 'computer'].includes(winner);
}

async function getHighScores(): Promise<any[]> {
  let { data, error } = await admin!
    .from('battleship_scores')
    .select('code,winner_name,opponent_name,duration_ms,shots,hits,misses,finished_at,mode')
    .order('duration_ms', { ascending: true })
    .order('shots', { ascending: true })
    .order('finished_at', { ascending: true })
    .limit(SCORE_FETCH_LIMIT);
  if (error && error.message.includes('mode')) {
    const fallback = await admin!
      .from('battleship_scores')
      .select('code,winner_name,opponent_name,duration_ms,shots,hits,misses,finished_at')
      .order('duration_ms', { ascending: true })
      .order('shots', { ascending: true })
      .order('finished_at', { ascending: true })
      .limit(SCORE_FETCH_LIMIT);
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
    .filter((score: any) => !isHiddenScore(score) && !isBotScore(score))
    .slice(0, SCORE_FETCH_LIMIT)
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
  if (game.players.some(isBotPlayer)) {
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

async function createGame(hostName: unknown, mode: unknown = DEFAULT_MODE, commander: unknown = DEFAULT_COMMANDER): Promise<{ game: any; code: string; playerId: string }> {
  const code = await generateCode();
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

function randomFleet(gameOrMode: any = DEFAULT_MODE): any[] {
  const fleet = fleetForMode(gameOrMode);
  const ships = [];
  for (const ship of fleet) {
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
  return validateFleet(ships, gameOrMode);
}

async function createBotGame(hostName: unknown, mode: unknown = DEFAULT_MODE, commander: unknown = DEFAULT_COMMANDER): Promise<{ game: any; code: string; playerId: string }> {
  const { game, code, playerId } = await createGame(hostName, mode, commander);
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

function assertJoinable(game: any): void {
  if (game.players.length >= 2) fail(409, 'Room is full.');
  if (game.status === 'expired') fail(410, 'Rummet har gått ut.');
  if (game.status !== 'waiting') fail(409, 'Room has already started.');
}

async function getJoinInfo(codeInput: unknown): Promise<any> {
  const game = await loadGame(codeInput);
  assertJoinable(game);
  return {
    code: game.code,
    mode: publicMode(game),
    requiresCommander: modeSettings(game).abilities,
    players: game.players.length,
    maxPlayers: 2
  };
}

async function joinGame(codeInput: unknown, playerName: unknown, commander: unknown = DEFAULT_COMMANDER): Promise<{ game: any; code: string; playerId: string }> {
  const game = await loadGame(codeInput);
  assertJoinable(game);

  const player = createPlayer(playerName, 1, commander, game);
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

function validateFleet(rawShips: any, gameOrMode: any = DEFAULT_MODE): any[] {
  if (!Array.isArray(rawShips)) fail(400, 'Fleet is missing.');
  const fleet = fleetForMode(gameOrMode);
  const allowedShipIds = new Set(fleet.map((ship: any) => ship.id));
  const unexpectedShip = rawShips.find((ship: any) => ship?.id && !allowedShipIds.has(ship.id));
  if (unexpectedShip) fail(400, `Fleet contains unknown ship: ${unexpectedShip.id}.`);
  const occupied = new Set<string>();
  const normalized = [];

  for (const fleetShip of fleet) {
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

  player.ships = validateFleet(rawShips, game);
  player.ready = true;
  player.energy = modeSettings(game).startingEnergy;
  player.abilityCharges = initialAbilityCharges(game, player);
  player.sonarScans = [];
  player.commanderState = initialCommanderState(player, game);
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
  return (game.shotsByPlayer[attackerId] || []).some((shot: any) => shot.x === x && shot.y === y && shot.result !== 'blocked');
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

function shouldBlockHit(defender: any, gameOrMode: any): boolean {
  if (commanderForMode(defender?.commanderId, gameOrMode)?.id !== 'defensive') {
    return false;
  }
  const state = commanderStateFor(defender, gameOrMode);
  if (state.defenseBlocked) {
    return false;
  }
  state.defenseBlocked = true;
  return true;
}

function resolveSingleShot(game: any, attacker: any, defender: any, x: number, y: number, source: string): any {
  const ship = findShipAt(defender, x, y);
  const blocked = ship && shouldBlockHit(defender, game);
  const shot: any = { x, y, source, result: blocked ? 'blocked' : (ship ? 'hit' : 'miss'), at: Date.now() };
  if (blocked) {
    shot.shipId = ship.id;
    shot.blocked = true;
    game.shotsByPlayer[attacker.id].push(shot);
    return { shot, hit: false, blocked: true, sunkShip: null };
  }
  if (!ship) {
    game.shotsByPlayer[attacker.id].push(shot);
    return { shot, hit: false, sunkShip: null };
  }

  shot.shipId = ship.id;
  game.shotsByPlayer[attacker.id].push(shot);
  const sunk = isShipSunkByShots(game.shotsByPlayer[attacker.id], ship);
  if (sunk) {
    markSunkShipShots(game.shotsByPlayer[attacker.id], ship);
    return { shot, hit: true, sunkShip: ship };
  }
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

function botKnownHits(game: any, botId: string): any[] {
  return (game.shotsByPlayer[botId] || [])
    .filter((shot: any) => shot.result === 'hit' && !shot.sunkShipId);
}

function sonarRegionKey(region: { originX: number; originY: number; size: number }): string {
  return `${region.originX},${region.originY},${region.size}`;
}

function storedSonarRegion(scan: any): { originX: number; originY: number; size: number } {
  const originX = Number(scan?.originX);
  const originY = Number(scan?.originY);
  const size = Number(scan?.size);
  if (Number.isInteger(originX) && Number.isInteger(originY) && Number.isInteger(size) && size > 0) {
    return { originX, originY, size };
  }
  return sonarRegion(Number(scan?.x), Number(scan?.y));
}

function sonarScanCells(region: { originX: number; originY: number; size: number }): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let scanY = region.originY; scanY < region.originY + region.size; scanY += 1) {
    for (let scanX = region.originX; scanX < region.originX + region.size; scanX += 1) {
      if (scanX >= 0 && scanY >= 0 && scanX < BOARD_SIZE && scanY < BOARD_SIZE) {
        cells.push({ x: scanX, y: scanY });
      }
    }
  }
  return cells;
}

function hasScannedSonarRegion(player: any, region: { originX: number; originY: number; size: number }): boolean {
  const key = sonarRegionKey(region);
  return sonarScansFor(player).some((scan: any) => sonarRegionKey(storedSonarRegion(scan)) === key);
}

function botSonarTargetCandidates(game: any, bot: any): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  sonarScansFor(bot)
    .filter((scan: any) => Number(scan.count || 0) > 0)
    .forEach((scan: any) => {
      sonarScanCells(storedSonarRegion(scan)).forEach((cell) => {
        if (!hasShotAt(game, bot.id, cell.x, cell.y)) {
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
  const scannedTargets = botSonarTargetCandidates(game, bot);
  if (scannedTargets.length) {
    return scannedTargets[randomIndex(scannedTargets.length)];
  }
  const available = unshotCells(game, bot.id);
  return available.length ? available[randomIndex(available.length)] : null;
}

function chooseBotBarrage(game: any, bot: any): { x: number; y: number } | null {
  if (!modeSettings(game).abilities || ensureAbilityCharges(bot, game).barrage <= 0) {
    return null;
  }
  const candidates = botKnownHits(game, bot.id)
    .filter((hit: any) => barrageCells(hit.x, hit.y).some((cell) => !hasShotAt(game, bot.id, cell.x, cell.y)));
  return candidates.length ? candidates[randomIndex(candidates.length)] : null;
}

function chooseBotSonar(game: any, bot: any): { x: number; y: number } | null {
  if (!modeSettings(game).abilities || ensureAbilityCharges(bot, game).sonar <= 0 || botTargetCandidates(game, bot.id).length) {
    return null;
  }
  if (botSonarTargetCandidates(game, bot).length || randomIndex(100) >= 34) {
    return null;
  }

  const regions: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
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
  return regions.length ? regions[randomIndex(regions.length)] : null;
}

function chooseBotAction(game: any, bot: any): { ability: string; x: number; y: number } | null {
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

function sonarRegion(x: number, y: number): { originX: number; originY: number; size: number; cells: Array<{ x: number; y: number }> } {
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

function performSonar(game: any, attacker: any, defender: any, x: number, y: number): any {
  if (!modeSettings(game).abilities) fail(409, 'Sonar finns bara i Arcade-laget.');
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
  const targets = barrageCells(x, y).filter((cell) => !hasShotAt(game, attacker.id, cell.x, cell.y));
  if (targets.length === 0) fail(409, 'Barrage area is already fired at.');

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
  if (shot.blocked) clone.blocked = true;
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
    fleet: fleetForMode(game),
    playerId: player.id,
    playerName: player.name,
    players: game.players.map((entry: any) => ({
      name: entry.name,
      isYou: entry.id === player.id,
      ready: entry.ready,
      commander: publicCommander(entry, game),
      energy: entry.id === player.id && modeSettings(game).abilities ? entry.energy : undefined,
      abilityCharges: entry.id === player.id && modeSettings(game).abilities ? publicAbilityCharges(entry, game) : undefined
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
      sonarScans: sonarScansFor(player).map((scan: any) => ({ ...scan }))
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
      const { game, code, playerId } = await createGame(body.name, body.mode, body.commander);
      return json(201, { code, playerId, state: serializeGame(game, playerId) });
    }

    if (parts[0] === 'create-bot') {
      const { game, code, playerId } = await createBotGame(body.name, body.mode, body.commander);
      return json(201, { code, playerId, state: serializeGame(game, playerId) });
    }

    if (parts[0] === 'join-info') {
      return json(200, await getJoinInfo(body.code));
    }

    if (parts[0] === 'join') {
      const { game, code, playerId } = await joinGame(body.code, body.name, body.commander);
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

(function () {
  'use strict';

  function assetUrl(path) {
    const script = document.currentScript || document.querySelector('script[src$="app.js"], script[src*="/app.js"]');
    const baseUrl = script && script.src ? script.src : window.location.href;
    return new URL(`assets/${String(path).replace(/^\/+/, '')}`, baseUrl).toString();
  }

  const BOARD_SIZE = 10;
  const SONAR_SIZE = 4;
  const DEFAULT_ABILITY_CHARGES = { sonar: 3, barrage: 1 };
  const CLASSIC_FLEET = [
    { id: 'carrier', name: 'Hangarfartyg', length: 5 },
    { id: 'battleship', name: 'Slagskepp', length: 4 },
    { id: 'cruiser', name: 'Kryssare', length: 3 },
    { id: 'submarine', name: 'Ubåt', length: 3 },
    { id: 'destroyer', name: 'Jagare', length: 2 }
  ];
  const ARCADE_FLEET = [
    ...CLASSIC_FLEET,
    { id: 'drone', name: 'Drönare', length: 1 }
  ];
  const FLEET = CLASSIC_FLEET;
  const GAME_MODES = [
    { id: 'classic', label: 'Classic', tag: 'Standard' },
    { id: 'arcade', label: 'Arcade', tag: 'Beta' }
  ];
  const COMMANDER_CARDS = [
    {
      id: 'offense',
      label: 'Offensiv Kommendör',
      shortLabel: 'Offensiv',
      effect: '+1 Barrage',
      quote: 'Anfall är bästa försvar.',
      image: assetUrl('gfx/ccard_offense.png')
    },
    {
      id: 'scout',
      label: 'Scout',
      shortLabel: 'Scout',
      effect: '+1 Sonar ping',
      quote: 'Kunskap är makt.',
      image: assetUrl('gfx/ccard_scout.png')
    },
    {
      id: 'defensive',
      label: 'Defensiv Kommendör',
      shortLabel: 'Defensiv',
      effect: 'Blockerar första träffen',
      quote: 'Skydda flottan till varje pris.',
      image: assetUrl('gfx/ccard_defensive.png')
    }
  ];
  const SHIP_ASSETS = {
    carrier: assetUrl('gfx/ship_5_squares.png'),
    battleship: assetUrl('gfx/ship_4_squares.png'),
    cruiser: assetUrl('gfx/ship_3_squares_v1.png'),
    submarine: assetUrl('gfx/ship_3_squares_v2.png'),
    destroyer: assetUrl('gfx/ship_2_squares_v1.png'),
    drone: assetUrl('gfx/drone_placeholder.svg')
  };
  const BANNER_IMAGE = assetUrl('gfx/battleship_banner.png');
  const OWL_LOGO = assetUrl('gfx/42IO-logo-A-light.svg');
  const OWL_SEAL_LOGO = assetUrl('gfx/42IO-logo-A-light.svg');
  const MUSIC_ASSETS = {
    title: assetUrl('sounds/battleship_title.mp3'),
    battle: assetUrl('sounds/battleship_battle.mp3')
  };
  const SOUND_ASSETS = {
    fire: [
      assetUrl('sounds/fire_1.mp3'),
      assetUrl('sounds/fire_2.mp3'),
      assetUrl('sounds/fire_3.mp3')
    ],
    hit: assetUrl('sounds/hit.mp3'),
    miss: assetUrl('sounds/miss.mp3'),
    sink: assetUrl('sounds/hit.mp3'),
    sonar: assetUrl('sounds/sonar.mp3'),
    barrage: [
      assetUrl('sounds/fire_1.mp3'),
      assetUrl('sounds/fire_3.mp3')
    ],
    victory: assetUrl('sounds/winner_fanfare.mp3'),
    defeat: assetUrl('sounds/loser_fanfare.mp3')
  };
  const UI_SOUND_PROFILES = {
    click: [{ frequency: 520, endFrequency: 680, duration: 0.035, volume: 0.018, type: 'triangle' }],
    select: [
      { frequency: 520, endFrequency: 690, duration: 0.04, volume: 0.018, type: 'triangle' },
      { delay: 0.045, frequency: 760, endFrequency: 920, duration: 0.035, volume: 0.014, type: 'sine' }
    ],
    rotate: [
      { frequency: 340, endFrequency: 620, duration: 0.045, volume: 0.019, type: 'square' },
      { delay: 0.04, frequency: 620, endFrequency: 420, duration: 0.045, volume: 0.014, type: 'triangle' }
    ],
    place: [
      { frequency: 300, endFrequency: 190, duration: 0.06, volume: 0.02, type: 'triangle' },
      { delay: 0.055, frequency: 740, endFrequency: 940, duration: 0.04, volume: 0.015, type: 'sine' }
    ],
    ready: [
      { frequency: 520, endFrequency: 720, duration: 0.055, volume: 0.02, type: 'triangle' },
      { delay: 0.06, frequency: 860, endFrequency: 1120, duration: 0.07, volume: 0.018, type: 'sine' }
    ],
    error: [{ frequency: 170, endFrequency: 105, duration: 0.09, volume: 0.024, type: 'sawtooth' }]
  };
  const AUDIO_SETTING_KEY = 'battleship-audio';
  const PLAYER_NAME_KEY = 'battleship-player-name';
  const SCORE_PREVIEW_LIMIT = 5;
  const SCORE_PAGE_LIMIT = 50;
  const SCORE_CATEGORIES = [
    { id: 'fastest', label: 'Snabbast' },
    { id: 'accuracy', label: 'Träffsäkerhet' },
    { id: 'misses', label: 'Minst missar' }
  ];
  const SCORE_SCOPES = [
    { id: 'players', label: 'Mot spelare' },
    { id: 'computer', label: 'Mot datorn' }
  ];
  const COPYRIGHT_NOTICE = '© 2026 Andreas Jonsson & 42 Improbable Owls';

  const app = document.querySelector('#app');
  const toast = document.querySelector('#toast');
  const runtimeConfig = window.BATTLESHIP_CONFIG || {};
  const backendMode = runtimeConfig.backend === 'supabase' ? 'supabase' : 'local';
  const supabaseFunctionName = runtimeConfig.supabaseFunctionName || 'battleship';
  const supabaseSdkUrl = runtimeConfig.supabaseSdkUrl || 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  let state = null;
  let eventSource = null;
  let realtimeChannel = null;
  let pollTimer = null;
  let supabaseClient = null;
  let supabaseSdkPromise = null;
  let selectedShipId = FLEET[0].id;
  let orientation = 'horizontal';
  let placedShips = [];
  let hoverCell = null;
  let targetPreviewCell = null;
  let selectedAbility = 'shot';
  let selectedMode = 'classic';
  let selectedCommanderId = 'offense';
  let commanderPrompt = null;
  let activePage = 'home';
  let mobileInfoOpen = false;
  let mobileLogOpen = false;
  let abilityPanelOpen = false;
  let selectedScoreMode = 'classic';
  let selectedScoreCategory = 'fastest';
  let selectedScoreScope = 'players';
  let playerNameDraft = readPlayerName();
  let toastTimer = null;
  let scores = [];
  let matchesToday = null;
  let audioEnabled = readAudioPreference();
  let audioUnlocked = false;
  let audioUnlockListenerAttached = false;
  let activeMusicKey = null;
  let lastOutcomeSoundCode = null;
  let lastPlacementPointerAt = 0;
  let nowMs = Date.now();
  let clockTimer = null;
  let uiAudioContext = null;
  let animatedImpactKeys = new Set();
  const musicPlayers = {};
  const unavailableAudio = new Set();

  const storage = {
    get() {
      try {
        return JSON.parse(localStorage.getItem('battleship-session') || 'null');
      } catch {
        return null;
      }
    },
    set(session) {
      localStorage.setItem('battleship-session', JSON.stringify(session));
    },
    clear() {
      localStorage.removeItem('battleship-session');
    }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 3200);
  }

  function readAudioPreference() {
    try {
      return localStorage.getItem(AUDIO_SETTING_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  function writeAudioPreference(value) {
    try {
      localStorage.setItem(AUDIO_SETTING_KEY, value ? 'on' : 'off');
    } catch {
      // Ignore localStorage failures; audio can still work for the current page.
    }
  }

  function readPlayerName() {
    try {
      return localStorage.getItem(PLAYER_NAME_KEY) || '';
    } catch {
      return '';
    }
  }

  function writePlayerName(value) {
    try {
      localStorage.setItem(PLAYER_NAME_KEY, value);
    } catch {
      // Names are still submitted even if the browser blocks storage.
    }
  }

  function ensureAudioUnlockListener() {
    if (audioUnlockListenerAttached) {
      return;
    }
    audioUnlockListenerAttached = true;
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
  }

  function unlockAudio() {
    if (!audioEnabled) {
      return;
    }
    audioUnlocked = true;
    if (uiAudioContext && uiAudioContext.state === 'suspended') {
      uiAudioContext.resume().catch(() => undefined);
    }
    syncMusic();
  }

  function desiredMusicKey() {
    return state && state.status === 'playing' ? 'battle' : 'title';
  }

  function getMusicPlayer(key) {
    if (musicPlayers[key]) {
      return musicPlayers[key];
    }
    const src = MUSIC_ASSETS[key];
    if (!src || unavailableAudio.has(`music:${key}`)) {
      return null;
    }
    const player = new Audio(src);
    player.loop = true;
    player.preload = 'auto';
    player.volume = key === 'battle' ? 0.34 : 0.28;
    player.addEventListener('error', () => {
      unavailableAudio.add(`music:${key}`);
      if (activeMusicKey === key) {
        activeMusicKey = null;
      }
    }, { once: true });
    musicPlayers[key] = player;
    return player;
  }

  function pauseMusic(exceptKey = null) {
    Object.entries(musicPlayers).forEach(([key, player]) => {
      if (key === exceptKey) {
        return;
      }
      player.pause();
      try {
        player.currentTime = 0;
      } catch {
        // Some browsers do not allow seeking unloaded audio. Pausing is enough.
      }
    });
    if (!exceptKey) {
      activeMusicKey = null;
    }
  }

  function syncMusic() {
    if (!audioEnabled || !audioUnlocked) {
      pauseMusic();
      return;
    }
    const key = desiredMusicKey();
    if (unavailableAudio.has(`music:${key}`)) {
      pauseMusic();
      return;
    }
    pauseMusic(key);
    const player = getMusicPlayer(key);
    if (!player) {
      return;
    }
    activeMusicKey = key;
    if (!player.paused) {
      return;
    }
    player.play().catch(() => undefined);
  }

  function playSound(name, volume = 0.55) {
    if (!audioEnabled || !audioUnlocked) {
      return false;
    }
    const src = chooseSoundSource(SOUND_ASSETS[name]);
    const key = `sound:${name}`;
    if (!src || unavailableAudio.has(key)) {
      return false;
    }
    const player = new Audio(src);
    player.preload = 'auto';
    player.volume = volume;
    player.addEventListener('error', () => unavailableAudio.add(key), { once: true });
    player.play().catch(() => undefined);
    return true;
  }

  function getUiAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    if (!uiAudioContext) {
      uiAudioContext = new AudioContextCtor();
    }
    if (uiAudioContext.state === 'suspended') {
      uiAudioContext.resume().catch(() => undefined);
    }
    return uiAudioContext;
  }

  function playUiSound(name = 'click') {
    if (!audioEnabled || !audioUnlocked) {
      return false;
    }
    const context = getUiAudioContext();
    const tones = UI_SOUND_PROFILES[name] || UI_SOUND_PROFILES.click;
    if (!context || !tones) {
      return false;
    }
    const baseTime = context.currentTime + 0.004;
    tones.forEach((tone) => playUiTone(context, baseTime, tone));
    return true;
  }

  function playUiTone(context, baseTime, tone) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startTime = baseTime + Number(tone.delay || 0);
    const duration = Math.max(0.025, Number(tone.duration || 0.04));
    const startFrequency = Math.max(1, Number(tone.frequency || 440));
    const endFrequency = Math.max(1, Number(tone.endFrequency || startFrequency));
    const volume = Math.max(0.001, Number(tone.volume || 0.018));

    oscillator.type = tone.type || 'sine';
    oscillator.frequency.setValueAtTime(startFrequency, startTime);
    if (endFrequency !== startFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startTime + duration);
    }
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + Math.min(0.008, duration / 2));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }

  function chooseSoundSource(source) {
    if (!Array.isArray(source)) {
      return source;
    }
    return source[Math.floor(Math.random() * source.length)] || null;
  }

  function playShotResultSound(shots, fallbackHit) {
    const shotList = Array.isArray(shots) ? shots : [];
    const sunk = shotList.some((shot) => shot.sunkShipId) || fallbackHit === 'sunk';
    const hit = shotList.some((shot) => shot.result === 'hit') || fallbackHit === 'hit' || sunk;
    const blocked = shotList.some((shot) => shot.result === 'blocked');
    if (blocked) {
      playSound('sonar', 0.46);
      return;
    }
    if (sunk) {
      playSound('sink', 0.62);
      return;
    }
    playSound(hit ? 'hit' : 'miss', hit ? 0.58 : 0.48);
  }

  function playActionSound(result, nextState) {
    if (!result) {
      return;
    }
    if (result.ability === 'sonar') {
      playSound('sonar', 0.5);
    } else if (result.ability === 'barrage') {
      playSound('barrage', 0.54);
      window.setTimeout(() => playShotResultSound(result.shots, null), 140);
    } else {
      playSound('fire', 0.42);
      const fallback = result.sunkShip ? 'sunk' : (result.hit ? 'hit' : 'miss');
      window.setTimeout(() => playShotResultSound(result.shot ? [result.shot] : [], fallback), 120);
    }

    if (nextState && nextState.status === 'finished' && nextState.winner) {
      lastOutcomeSoundCode = nextState.code;
      window.setTimeout(() => {
        playSound(nextState.winner.isYou ? 'victory' : 'defeat', 0.66);
      }, 420);
    }
  }

  function playOutcomeSoundOnce() {
    if (!state || state.status !== 'finished' || !state.winner || lastOutcomeSoundCode === state.code) {
      return;
    }
    if (playSound(state.winner.isYou ? 'victory' : 'defeat', 0.66)) {
      lastOutcomeSoundCode = state.code;
    }
  }

  function toggleAudio() {
    audioEnabled = !audioEnabled;
    writeAudioPreference(audioEnabled);
    if (audioEnabled) {
      audioUnlocked = true;
      playUiSound('select');
      syncMusic();
    } else {
      pauseMusic();
    }
    render();
  }

  async function api(path, payload) {
    if (backendMode === 'supabase') {
      return supabaseFunctionFetch(path, { method: 'POST', payload });
    }

    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Något gick fel.');
    }
    return data;
  }

  function getSupabaseSettings() {
    const supabaseUrl = String(runtimeConfig.supabaseUrl || '').replace(/\/+$/, '');
    const supabaseKey = String(runtimeConfig.supabaseKey || runtimeConfig.supabaseAnonKey || runtimeConfig.supabasePublishableKey || '');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase saknar URL eller public key i public/config.js.');
    }
    return { supabaseUrl, supabaseKey };
  }

  function supabasePath(path) {
    return String(path).replace(/^\/api/, '') || '/';
  }

  async function supabaseFunctionFetch(path, options = {}) {
    const { supabaseUrl, supabaseKey } = getSupabaseSettings();
    const method = options.method || 'GET';
    const headers = {
      apikey: supabaseKey
    };
    if (supabaseKey.startsWith('eyJ')) {
      headers.authorization = `Bearer ${supabaseKey}`;
    }
    const request = { method, headers };

    if (options.payload !== undefined) {
      headers['content-type'] = 'application/json';
      request.body = JSON.stringify(options.payload);
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/${supabaseFunctionName}${supabasePath(path)}`, request);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Något gick fel.');
    }
    return data;
  }

  async function loadSupabaseSdk() {
    if (window.supabase && window.supabase.createClient) {
      return window.supabase;
    }
    if (!supabaseSdkPromise) {
      supabaseSdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = supabaseSdkUrl;
        script.async = true;
        script.onload = () => resolve(window.supabase);
        script.onerror = () => reject(new Error('Kunde inte ladda Supabase SDK.'));
        document.head.appendChild(script);
      });
    }
    const sdk = await supabaseSdkPromise;
    if (!sdk || !sdk.createClient) {
      throw new Error('Supabase SDK saknas.');
    }
    return sdk;
  }

  async function getSupabaseClient() {
    if (!supabaseClient) {
      const { supabaseUrl, supabaseKey } = getSupabaseSettings();
      const sdk = await loadSupabaseSdk();
      supabaseClient = sdk.createClient(supabaseUrl, supabaseKey);
    }
    return supabaseClient;
  }

  async function fetchState(code, playerId) {
    if (backendMode === 'supabase') {
      return supabaseFunctionFetch(`/state/${encodeURIComponent(code)}/${encodeURIComponent(playerId)}`);
    }

    const response = await fetch(`/api/state/${encodeURIComponent(code)}/${encodeURIComponent(playerId)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Sessionen finns inte kvar.');
    }
    return data;
  }

  async function fetchScores() {
    const range = localDayRange();
    const query = `?todayStart=${encodeURIComponent(range.start)}&todayEnd=${encodeURIComponent(range.end)}`;
    if (backendMode === 'supabase') {
      return supabaseFunctionFetch(`/scores${query}`);
    }

    const response = await fetch(`/api/scores${query}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Kunde inte hämta topplistan.');
    }
    return data;
  }

  async function loadScores() {
    try {
      const data = await fetchScores();
      scores = Array.isArray(data.scores) ? data.scores.filter((score) => !isHiddenScore(score) && !isBotWinnerScore(score)) : [];
      const count = Number(data.matchesToday);
      matchesToday = Number.isFinite(count) ? count : null;
    } catch {
      scores = [];
      matchesToday = null;
    }
  }

  function localDayRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }

  function isBotName(name) {
    return ['datorn', 'ai', 'computer'].includes(String(name || '').trim().toLowerCase());
  }

  function isBotScore(score) {
    return score && (score.opponentType === 'computer' || isBotName(score.opponentName) || isBotName(score.winnerName));
  }

  function isBotWinnerScore(score) {
    return score && isBotName(score.winnerName);
  }

  function isHiddenScore(score) {
    return score
      && String(score.winnerName || '').trim().toLowerCase() === 'ada'
      && normalizeModeId(score.mode) === 'arcade'
      && Number(score.durationMs || 0) <= 10000
      && Number(score.shots || 0) === 18
      && Number(score.hits || 0) === 17
      && Number(score.misses || 0) === 1;
  }

  function scoreCategoryLabel(category = selectedScoreCategory) {
    const found = SCORE_CATEGORIES.find((entry) => entry.id === category);
    return found ? found.label : SCORE_CATEGORIES[0].label;
  }

  function scoreScopeLabel(scope = selectedScoreScope) {
    const found = SCORE_SCOPES.find((entry) => entry.id === scope);
    return found ? found.label : SCORE_SCOPES[0].label;
  }

  function compareScoreRows(category) {
    return (a, b) => {
      if (category === 'accuracy') {
        return Number(b.accuracy || 0) - Number(a.accuracy || 0)
          || Number(a.misses || 0) - Number(b.misses || 0)
          || Number(a.durationMs || 0) - Number(b.durationMs || 0)
          || Number(a.finishedAt || 0) - Number(b.finishedAt || 0);
      }
      if (category === 'misses') {
        return Number(a.misses || 0) - Number(b.misses || 0)
          || Number(a.durationMs || 0) - Number(b.durationMs || 0)
          || Number(a.shots || 0) - Number(b.shots || 0)
          || Number(a.finishedAt || 0) - Number(b.finishedAt || 0);
      }
      return Number(a.durationMs || 0) - Number(b.durationMs || 0)
        || Number(a.shots || 0) - Number(b.shots || 0)
        || Number(a.finishedAt || 0) - Number(b.finishedAt || 0);
    };
  }

  function scoresFor(mode = selectedScoreMode, category = selectedScoreCategory, scope = selectedScoreScope) {
    return scores
      .filter((score) => normalizeModeId(score.mode) === normalizeModeId(mode))
      .filter((score) => scope === 'computer' ? isBotScore(score) : !isBotScore(score))
      .slice()
      .sort(compareScoreRows(category));
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) {
      return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    }
    if (minutes) {
      return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
  }

  function readTime(value) {
    const time = Number(value);
    return Number.isFinite(time) && time > 0 ? time : null;
  }

  function timing() {
    return state && state.timing ? state.timing : {};
  }

  function isLobbyWaiting() {
    return state && state.status === 'waiting';
  }

  function usesLobbyTimer() {
    return state && (state.status === 'waiting' || timing().expiredReason === 'lobby');
  }

  function elapsedSince(value) {
    const time = readTime(value);
    return time ? Math.max(0, nowMs - time) : 0;
  }

  function remainingUntil(value) {
    const time = readTime(value);
    return time ? Math.max(0, time - nowMs) : 0;
  }

  function activeExpiresAt() {
    const info = timing();
    return usesLobbyTimer() ? info.lobbyExpiresAt : info.expiresAt;
  }

  function activeMaxDurationMs() {
    const info = timing();
    return usesLobbyTimer()
      ? (info.lobbyDurationMs || 5 * 60 * 1000)
      : (info.maxDurationMs || 48 * 60 * 60 * 1000);
  }

  function matchElapsedMs() {
    const info = timing();
    return elapsedSince(info.startedAt || info.createdAt);
  }

  function turnElapsedMs() {
    const info = timing();
    return elapsedSince(info.turnStartedAt || info.startedAt || info.createdAt);
  }

  function shouldTickClock() {
    if (!state) {
      return false;
    }
    return state.status === 'waiting'
      || state.status === 'playing'
      || (state.status === 'placing' && state.own && state.own.ready);
  }

  function startClock() {
    if (clockTimer) {
      return;
    }
    clockTimer = window.setInterval(() => {
      nowMs = Date.now();
      if (shouldTickClock()) {
        render();
      }
    }, 1000);
  }

  function renderTimeChips() {
    if (!state || !state.timing) {
      return '';
    }
    const remaining = remainingUntil(activeExpiresAt());
    const elapsed = state.status === 'playing' ? turnElapsedMs() : matchElapsedMs();
    const lobbyTimer = usesLobbyTimer();
    const elapsedLabel = state.status === 'playing' ? 'Tur' : (lobbyTimer ? 'Kod' : 'Tid');
    const remainingLabel = lobbyTimer ? 'Koden kvar' : 'Kvar';
    const warningAt = lobbyTimer ? 60 * 1000 : 60 * 60 * 1000;
    return `
      <span class="chip time-chip elapsed-chip">${escapeHtml(elapsedLabel)} ${escapeHtml(formatDuration(elapsed))}</span>
      <span class="chip time-chip remaining-chip ${remaining <= warningAt ? 'is-warning' : ''}">${escapeHtml(remainingLabel)} ${escapeHtml(formatDuration(remaining))}</span>
    `;
  }

  function renderTimePanel() {
    if (!state || !state.timing) {
      return '';
    }
    const remaining = remainingUntil(activeExpiresAt());
    const maxDuration = activeMaxDurationMs();
    const lobbyTimer = usesLobbyTimer();
    const firstLabel = lobbyTimer ? 'Kodtid' : 'Matchtid';
    const remainingLabel = lobbyTimer ? 'Koden kvar' : 'Kvar';
    return `
      <div class="time-panel">
        <div>
          <span>${escapeHtml(firstLabel)}</span>
          <strong>${escapeHtml(formatDuration(matchElapsedMs()))}</strong>
        </div>
        <div>
          <span>Max</span>
          <strong>${escapeHtml(formatDuration(maxDuration))}</strong>
        </div>
        <div>
          <span>${escapeHtml(remainingLabel)}</span>
          <strong>${escapeHtml(formatDuration(remaining))}</strong>
        </div>
      </div>
    `;
  }

  function renderWaitingTurnCard() {
    if (!state || state.status !== 'playing' || !state.turn || state.turn.isYou) {
      return '';
    }
    return `
      <div class="wait-card" role="status" aria-live="polite">
        <span>Väntar på ${escapeHtml(state.turn.playerName)}</span>
        <strong>${escapeHtml(formatDuration(turnElapsedMs()))}</strong>
        <small>Sedan motståndarens tur började</small>
      </div>
    `;
  }

  function normalizeModeId(value) {
    const mode = String(value || '').toLowerCase();
    return GAME_MODES.some((entry) => entry.id === mode) ? mode : 'classic';
  }

  function modeLabel(value) {
    const id = typeof value === 'object' && value ? value.id : value;
    const mode = GAME_MODES.find((entry) => entry.id === normalizeModeId(id));
    return mode ? mode.label : 'Arcade';
  }

  function normalizeCommanderId(value) {
    const id = String(value || '').toLowerCase();
    return COMMANDER_CARDS.some((entry) => entry.id === id) ? id : COMMANDER_CARDS[0].id;
  }

  function commanderDefinition(value) {
    const id = typeof value === 'object' && value ? value.id : value;
    return COMMANDER_CARDS.find((entry) => entry.id === normalizeCommanderId(id)) || COMMANDER_CARDS[0];
  }

  function commanderLabel(value) {
    if (!value) return '';
    const local = commanderDefinition(value);
    return (typeof value === 'object' && value && value.shortLabel) || local.shortLabel || local.label;
  }

  function commanderEffect(value) {
    if (!value) return '';
    const local = commanderDefinition(value);
    return (typeof value === 'object' && value && value.effect) || local.effect || '';
  }

  function commanderStatus(value) {
    const commander = commanderDefinition(value);
    if (commander.id === 'defensive') {
      const blocked = Boolean(state && state.own && state.own.commanderState && state.own.commanderState.defenseBlocked);
      return blocked ? 'Block använd' : 'Block redo';
    }
    return commanderEffect(value);
  }

  function renderCommanderLoadout(variant = 'panel') {
    if (!state || !hasArcadePowers() || !state.own || !state.own.commander) {
      return '';
    }
    const commander = commanderDefinition(state.own.commander);
    const label = commanderLabel(state.own.commander);
    const effect = commanderEffect(state.own.commander);
    const status = commanderStatus(state.own.commander);
    return `
      <div class="commander-loadout is-${escapeHtml(variant)}">
        <img src="${escapeHtml(commander.image)}" alt="">
        <span class="commander-loadout-copy">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(effect)}</span>
        </span>
        <em>${escapeHtml(status)}</em>
      </div>
    `;
  }

  function currentMode() {
    return state && state.mode ? state.mode : { id: 'arcade', label: 'Arcade', abilities: true, hitKeepsTurn: false };
  }

  function hasArcadePowers() {
    return Boolean(currentMode().abilities);
  }

  function ownAbilityCharges() {
    const charges = state && state.own && state.own.abilityCharges ? state.own.abilityCharges : {};
    return {
      sonar: Number.isInteger(Number(charges.sonar)) ? Number(charges.sonar) : DEFAULT_ABILITY_CHARGES.sonar,
      barrage: Number.isInteger(Number(charges.barrage)) ? Number(charges.barrage) : DEFAULT_ABILITY_CHARGES.barrage
    };
  }

  function abilityCharge(id) {
    if (id === 'shot') {
      return Infinity;
    }
    return ownAbilityCharges()[id] || 0;
  }

  function abilityDisabled(id) {
    if (!state || state.status !== 'playing' || !(state.turn && state.turn.isYou)) {
      return true;
    }
    return id !== 'shot' && abilityCharge(id) <= 0;
  }

  function abilitySummary() {
    const charges = ownAbilityCharges();
    return `S ${charges.sonar} / B ${charges.barrage}`;
  }

  function localFleetForMode(modeOrId) {
    return normalizeModeId(modeOrId && modeOrId.id ? modeOrId.id : modeOrId) === 'arcade' ? ARCADE_FLEET : CLASSIC_FLEET;
  }

  function currentFleet() {
    const modeFleet = localFleetForMode(state && state.mode ? state.mode : selectedMode);
    if (state && Array.isArray(state.fleet) && state.fleet.length) {
      if (normalizeModeId(state.mode && state.mode.id) !== 'arcade') {
        return state.fleet;
      }
      const byId = new Map(state.fleet.map((ship) => [ship.id, ship]));
      return [
        ...state.fleet,
        ...modeFleet.filter((ship) => !byId.has(ship.id))
      ];
    }
    return modeFleet;
  }

  function shipDefinition(type) {
    const id = String(type || '').trim();
    return currentFleet().find((entry) => entry.id === id)
      || ARCADE_FLEET.find((entry) => entry.id === id)
      || CLASSIC_FLEET.find((entry) => entry.id === id)
      || null;
  }

  async function loadSession() {
    const session = storage.get();
    if (!session || !session.code || !session.playerId) {
      render();
      return;
    }
    if (session.backend && session.backend !== backendMode) {
      storage.clear();
      render();
      return;
    }

    try {
      const data = await fetchState(session.code, session.playerId);
      state = data.state;
      syncPlacedShips();
      connectEvents(session.code, session.playerId);
    } catch {
      storage.clear();
      state = null;
      render();
    }
  }

  function connectEvents(code, playerId) {
    disconnectLiveUpdates();
    if (backendMode === 'supabase') {
      startPolling(code, playerId, 4000);
      connectSupabaseRealtime(code, playerId).catch(() => {
        showToast('Liveuppdatering föll tillbaka till pollning.');
      });
      return;
    }

    eventSource = new EventSource(`/api/events/${encodeURIComponent(code)}/${encodeURIComponent(playerId)}`);
    eventSource.addEventListener('state', (event) => {
      state = JSON.parse(event.data);
      syncPlacedShips();
      if (state.status === 'finished') {
        loadScores().then(render).catch(() => render());
        return;
      }
      render();
    });
    eventSource.onerror = () => {
      showToast('Anslutningen försöker återhämta sig.');
    };
  }

  function disconnectLiveUpdates() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (realtimeChannel && supabaseClient) {
      supabaseClient.removeChannel(realtimeChannel);
    }
    realtimeChannel = null;
  }

  async function refreshState(code, playerId) {
    const data = await fetchState(code, playerId);
    state = data.state;
    syncPlacedShips();
    if (state.status === 'finished') {
      await loadScores();
    }
    render();
  }

  function startPolling(code, playerId, intervalMs) {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    pollTimer = setInterval(() => {
      refreshState(code, playerId).catch(() => undefined);
    }, intervalMs);
  }

  async function connectSupabaseRealtime(code, playerId) {
    const client = await getSupabaseClient();
    realtimeChannel = client
      .channel(`battleship-${code}-${playerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'battleship_game_ticks',
          filter: `code=eq.${code}`
        },
        () => {
          refreshState(code, playerId).catch(() => undefined);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          startPolling(code, playerId, 12000);
          refreshState(code, playerId).catch(() => undefined);
        }
      });
  }

  function syncPlacedShips() {
    if (!state || state.status !== 'placing' || placedShips.length) {
      return;
    }
    placedShips = (state.own.ships || []).map(normalizePlacementShip).filter(Boolean);
  }

  function resetLocalPlacement() {
    const fleet = currentFleet();
    placedShips = [];
    hoverCell = null;
    targetPreviewCell = null;
    selectedShipId = (fleet[0] || FLEET[0]).id;
    orientation = 'horizontal';
    animatedImpactKeys = new Set();
  }

  function statusLabel() {
    if (!state) {
      if (activePage === 'scores') return 'Topplista';
      if (activePage === 'rules') return 'Regler';
      return 'Meny';
    }
    if (state.status === 'waiting') return 'Väntar';
    if (state.status === 'placing') return 'Placering';
    if (state.status === 'playing') return state.turn && state.turn.isYou ? 'Din tur' : 'Motståndarens tur';
    if (state.status === 'finished') return 'Avgjord';
    if (state.status === 'abandoned') return 'Avslutad';
    if (state.status === 'expired') return timing().expiredReason === 'lobby' ? 'Koden ute' : 'Tiden ute';
    return state.status;
  }

  function render() {
    if (state && !hasArcadePowers()) {
      selectedAbility = 'shot';
      abilityPanelOpen = false;
    }
    if (state && hasArcadePowers() && selectedAbility !== 'shot' && abilityCharge(selectedAbility) <= 0) {
      selectedAbility = 'shot';
    }
    if (!state || state.status !== 'playing' || !state.turn || !state.turn.isYou || selectedAbility === 'shot') {
      targetPreviewCell = null;
    }
    if (!state || state.status !== 'playing') {
      mobileInfoOpen = false;
      mobileLogOpen = false;
      abilityPanelOpen = false;
    }
    const sidePanelScrollTop = document.querySelector('.side-panel.is-open')?.scrollTop || 0;
    const topbar = renderTopbar();
    app.className = `app-shell ${viewClass()}`;
    app.innerHTML = `
      ${topbar}
      <main class="screen">
        ${renderScreen()}
      </main>
      <footer class="app-footer">
        <a class="studio-credit" href="https://42improbableowls.com" target="_blank" rel="noopener">
          <img src="${OWL_LOGO}" alt="42 Improbable Owls logo">
          <span>${escapeHtml(COPYRIGHT_NOTICE)}</span>
        </a>
      </footer>
    `;
    bindEvents();
    if (mobileInfoOpen && sidePanelScrollTop) {
      const sidePanel = document.querySelector('.side-panel.is-open');
      if (sidePanel) {
        sidePanel.scrollTop = sidePanelScrollTop;
        requestAnimationFrame(() => {
          sidePanel.scrollTop = sidePanelScrollTop;
        });
      }
    }
    playOutcomeSoundOnce();
    syncMusic();
  }

  function viewClass() {
    if (!state) {
      return `view-${activePage}`;
    }
    return `view-${state.status}`;
  }

  function renderTopbar() {
    if ((!state && (activePage === 'home' || activePage === 'scores' || activePage === 'rules')) || (state && state.status === 'placing')) {
      return '';
    }
    const homeTopbarClass = !state && activePage === 'home' ? 'is-home-topbar' : '';
    const gameTopbarClass = state && state.status === 'playing' ? 'is-game-topbar' : '';
    const mobileTopbarClass = state && (state.status === 'placing' || state.status === 'playing') ? 'is-mobile-topbar' : '';
    const statusTopbarClass = state ? `is-status-${state.status}` : '';
    return `
      <header class="topbar ${homeTopbarClass} ${gameTopbarClass} ${mobileTopbarClass} ${statusTopbarClass}">
        <div class="brand">
          <img class="brand-logo" src="${OWL_SEAL_LOGO}" alt="42 Improbable Owls">
          <div>
            <h1>Sänka Skepp</h1>
            <p>${state ? escapeHtml(state.playerName) : 'Online sänka skepp'}</p>
          </div>
        </div>
        <div class="room-strip">
          ${state ? `<span class="chip code-chip">Kod <strong>${escapeHtml(state.code)}</strong></span>` : ''}
          ${state ? `<span class="chip mode-chip">${escapeHtml(modeLabel(state.mode))}</span>` : ''}
          <span class="chip status-chip ${state && state.status === 'playing' ? 'is-live' : ''}">${escapeHtml(statusLabel())}</span>
          ${renderTimeChips()}
          ${state && state.turn ? `<span class="chip turn-chip ${state.turn.isYou ? 'is-turn' : ''}">${escapeHtml(state.turn.playerName)}</span>` : ''}
          ${!state && activePage !== 'scores' ? '<button class="btn ghost" data-action="show-scores" type="button">Topplista</button>' : ''}
          ${!state && activePage === 'scores' ? '<button class="btn ghost" data-action="show-home" type="button">Meny</button>' : ''}
          <button class="btn ghost audio-toggle" data-action="toggle-audio" type="button" aria-pressed="${audioEnabled ? 'true' : 'false'}">${audioEnabled ? 'Ljud på' : 'Ljud av'}</button>
          ${state ? '<button class="btn ghost leave-button" data-action="leave">Lämna</button>' : ''}
        </div>
      </header>
    `;
  }

  function renderScreen() {
    if (!state) {
      if (activePage === 'scores') return renderScoresPage();
      if (activePage === 'rules') return renderRulesPage();
      return renderHome();
    }
    if (state.status === 'waiting') {
      return renderWaiting();
    }
    if (state.status === 'expired' && timing().expiredReason === 'lobby') {
      return renderExpiredLobby();
    }
    if (state.status === 'placing') {
      return renderPlacement();
    }
    return renderGame();
  }

  function renderHome() {
    return `
      <section class="title-screen">
        ${renderTitleBanner()}
        <div class="home-console">
          ${renderHomeStatusCard()}
          <div class="home-launch-controls">
            <input class="home-name-input" name="name" maxlength="24" placeholder="Ditt namn" autocomplete="nickname" value="${escapeHtml(playerNameDraft)}">
            ${renderModeSelector()}
            ${renderModeNotice()}
          </div>
          <div class="home-menu-grid">
            <form class="home-menu-form" data-form="create">
              <button class="menu-card primary-card" type="submit">
                <span class="menu-icon icon-play" aria-hidden="true"></span>
                <strong>Spela som värd</strong>
                <span>Skapa lobby</span>
              </button>
            </form>
            <form class="menu-card join-menu-card" data-form="join">
              <span class="menu-icon icon-target" aria-hidden="true"></span>
              <strong>Gå med</strong>
              <input class="home-code-input" name="code" maxlength="7" placeholder="Kod" autocomplete="off" aria-label="Rumskod">
              <button class="join-submit" type="submit">Anslut</button>
            </form>
            <button class="menu-card" data-action="create-bot" type="button">
              <span class="menu-icon icon-bot" aria-hidden="true"></span>
              <strong>Mot datorn</strong>
              <span>${escapeHtml(modeLabel(selectedMode))}</span>
            </button>
            <button class="menu-card" data-action="show-scores" type="button">
              <span class="menu-icon icon-trophy" aria-hidden="true"></span>
              <strong>Topplista</strong>
              <span>${scores.length ? `${scores.length} matcher` : 'Visa rekord'}</span>
            </button>
            <button class="menu-card" data-action="show-rules" type="button">
              <span class="menu-icon icon-rules" aria-hidden="true"></span>
              <strong>Regler</strong>
              <span>Classic & Arcade</span>
            </button>
            <button class="menu-card" data-action="toggle-audio" type="button" aria-pressed="${audioEnabled ? 'true' : 'false'}">
              ${renderSoundIcon(audioEnabled)}
              <strong>${audioEnabled ? 'Ljud på' : 'Ljud av'}</strong>
              <span>Musik & effekter</span>
            </button>
          </div>
        </div>
        ${renderCommanderPrompt()}
      </section>
    `;
  }

  function renderTitleBanner(extraClass = '', hud = '') {
    const className = ['title-banner-card', hud ? 'has-hud' : '', extraClass].filter(Boolean).join(' ');
    return `
      <div class="${className}">
        <img class="title-banner" src="${BANNER_IMAGE}" alt="Sänka Skepp">
        ${hud}
      </div>
    `;
  }

  function renderBannerHud(kind) {
    if (kind === 'scores') {
      return `
        <div class="title-banner-hud">
          <div class="banner-hud-label">
            <strong>Topplista</strong>
            <span>Snabbaste vinsterna</span>
          </div>
          <div class="banner-actions">
            <span class="chip status-chip">Topplista</span>
            <button class="btn ghost" data-action="refresh-scores" type="button">Uppdatera</button>
            <button class="btn primary" data-action="show-home" type="button">Meny</button>
            <button class="btn ghost audio-toggle" data-action="toggle-audio" type="button" aria-pressed="${audioEnabled ? 'true' : 'false'}">${audioEnabled ? 'Ljud på' : 'Ljud av'}</button>
          </div>
        </div>
      `;
    }
    if (kind === 'rules') {
      return `
        <div class="title-banner-hud">
          <div class="banner-hud-label">
            <strong>Regler</strong>
            <span>Classic & Arcade</span>
          </div>
          <div class="banner-actions">
            <span class="chip status-chip">Regler</span>
            <button class="btn primary" data-action="show-home" type="button">Meny</button>
            <button class="btn ghost audio-toggle" data-action="toggle-audio" type="button" aria-pressed="${audioEnabled ? 'true' : 'false'}">${audioEnabled ? 'Ljud på' : 'Ljud av'}</button>
          </div>
        </div>
      `;
    }
    if (kind === 'placement' && state) {
      return `
        <div class="title-banner-hud">
          <div class="banner-hud-label">
            <strong>${escapeHtml(state.playerName)}</strong>
            <span>Placera flottan</span>
          </div>
          <div class="banner-actions">
            <span class="chip code-chip">Kod <strong>${escapeHtml(state.code)}</strong></span>
            <span class="chip mode-chip">${escapeHtml(modeLabel(state.mode))}</span>
            <span class="chip status-chip">Placering</span>
            ${renderTimeChips()}
            <button class="btn ghost audio-toggle" data-action="toggle-audio" type="button" aria-pressed="${audioEnabled ? 'true' : 'false'}">${audioEnabled ? 'Ljud på' : 'Ljud av'}</button>
            <button class="btn ghost leave-button" data-action="leave" type="button">Lämna</button>
          </div>
        </div>
      `;
    }
    return '';
  }

  function renderSoundIcon(enabled) {
    return `
      <span class="menu-icon sound-svg-icon" aria-hidden="true">
        ${enabled ? `
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M3 9v6h4l5 4V5L7 9H3z"></path>
            <path d="M16 8.5a5 5 0 0 1 0 7"></path>
            <path d="M18.5 6a8 8 0 0 1 0 12"></path>
          </svg>
        ` : `
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M3 9v6h4l5 4V5L7 9H3z"></path>
            <path d="M16 9l5 5"></path>
            <path d="M21 9l-5 5"></path>
          </svg>
        `}
      </span>
    `;
  }

  function renderHomeStatusCard() {
    const todayCount = matchesToday === null ? countScoresToday(scores) : matchesToday;
    return `
      <div class="home-status-card" aria-live="polite">
        <div>
          <span class="online-state"><span aria-hidden="true"></span>Online</span>
          <strong>${todayCount} matcher spelade idag</strong>
        </div>
        <span class="radar-mark" aria-hidden="true"></span>
      </div>
    `;
  }

  function countScoresToday(scoreRows) {
    const today = new Date().toDateString();
    return (scoreRows || []).filter((score) => {
      const finishedAt = Number(score.finishedAt || 0);
      return finishedAt && new Date(finishedAt).toDateString() === today;
    }).length;
  }

  function renderScoresPage() {
    const visibleScores = scoresFor();
    return `
      <section class="scores-page themed-screen">
        ${renderTitleBanner('compact-banner-card', renderBannerHud('scores'))}
        <div class="home-console page-console scores-panel">
          <div class="scores-header">
            <div>
              <h2>Topplista</h2>
              <span>${visibleScores.length ? `${Math.min(visibleScores.length, SCORE_PAGE_LIMIT)} ${scoreCategoryLabel().toLowerCase()} - ${modeLabel(selectedScoreMode)} - ${scoreScopeLabel()}` : `Inga ${modeLabel(selectedScoreMode)}-matcher ${scoreScopeLabel().toLowerCase()} ännu`}</span>
            </div>
          </div>
          ${renderScoreFilters()}
          ${renderScoreList(visibleScores, SCORE_PAGE_LIMIT, 'full')}
        </div>
      </section>
    `;
  }

  function renderScoreFilters() {
    return `
      <div class="score-filters" aria-label="Topplistefilter">
        <div class="score-filter-group" role="group" aria-label="Spelläge">
          ${GAME_MODES.map((mode) => `
            <button class="btn ghost score-filter ${selectedScoreMode === mode.id ? 'is-active' : ''}" data-action="score-mode" data-score-mode="${escapeHtml(mode.id)}" type="button">${escapeHtml(mode.label)}</button>
          `).join('')}
        </div>
        <div class="score-filter-group" role="group" aria-label="Kategori">
          ${SCORE_CATEGORIES.map((category) => `
            <button class="btn ghost score-filter ${selectedScoreCategory === category.id ? 'is-active' : ''}" data-action="score-category" data-score-category="${escapeHtml(category.id)}" type="button">${escapeHtml(category.label)}</button>
          `).join('')}
        </div>
        <div class="score-filter-group" role="group" aria-label="Motståndare">
          ${SCORE_SCOPES.map((scope) => `
            <button class="btn ghost score-filter ${selectedScoreScope === scope.id ? 'is-active' : ''}" data-action="score-scope" data-score-scope="${escapeHtml(scope.id)}" type="button">${escapeHtml(scope.label)}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderRulesPage() {
    return `
      <section class="rules-page themed-screen">
        ${renderTitleBanner('compact-banner-card', renderBannerHud('rules'))}
        <div class="home-console page-console rules-panel">
          <div class="scores-header">
            <div>
              <h2>Regler</h2>
              <span>Snabb överblick för Classic och Arcade.</span>
            </div>
          </div>
          <div class="rules-grid">
            <article class="rules-card">
              <h3>Classic</h3>
              <ul>
                <li>Placera hela flottan: 5 skepp, raka linjer, inga överlapp.</li>
                <li>Spelarna turas om att skjuta en ruta på motståndarens plan.</li>
                <li>Träff eller miss spelar ingen roll för turen: efter skottet går turen över.</li>
                <li>Först att sänka alla motståndarens skepp vinner matchen.</li>
              </ul>
            </article>
            <article class="rules-card">
              <h3>Arcade</h3>
              <ul>
                <li>Samma grundregler som Classic, men flottan har även en Drönare på 1 ruta.</li>
                <li>Varje spelare väljer ett Commander Card innan placering.</li>
                <li>Förmågor har begränsade laddningar och använder din tur.</li>
                <li>Vanliga skott byter tur efter både träff och miss, precis som Classic.</li>
              </ul>
            </article>
            <article class="rules-card is-wide">
              <h3>Förmågor & Commander Cards</h3>
              <div class="rules-mini-grid">
                <div>
                  <strong>Sonar</strong>
                  <span>Scannar en 4x4-zon och visar hur många skeppsrutor som finns där.</span>
                </div>
                <div>
                  <strong>Barrage</strong>
                  <span>Skjuter ett korsmönster runt vald ruta.</span>
                </div>
                <div>
                  <strong>Offensiv</strong>
                  <span>Startar med +1 Barrage.</span>
                </div>
                <div>
                  <strong>Scout</strong>
                  <span>Startar med +1 Sonar ping.</span>
                </div>
                <div>
                  <strong>Defensiv</strong>
                  <span>Blockerar första träffen på din flotta.</span>
                </div>
              </div>
            </article>
            <article class="rules-card is-wide">
              <h3>Topplista</h3>
              <ul>
                <li>Matcher mot spelare och matcher mot Datorn har separata listor.</li>
                <li>Du kan sortera på snabbast, träffsäkerhet eller minst missar.</li>
                <li>AI-vinster sparas inte som highscore, bara dina vinster mot Datorn.</li>
              </ul>
            </article>
          </div>
        </div>
      </section>
    `;
  }

  function renderModeSelector() {
    return `
      <div class="mode-select" role="radiogroup" aria-label="Spelläge">
        ${GAME_MODES.map((mode) => `
          <label class="mode-option ${selectedMode === mode.id ? 'is-active' : ''}" data-mode-option data-mode="${escapeHtml(mode.id)}">
            <input type="radio" name="mode" value="${escapeHtml(mode.id)}" ${selectedMode === mode.id ? 'checked' : ''}>
            <strong>${escapeHtml(mode.label)}</strong>
            <span>${escapeHtml(mode.tag)}</span>
          </label>
        `).join('')}
      </div>
    `;
  }

  function renderCommanderSelector() {
    if (selectedMode !== 'arcade' && !commanderPrompt) {
      return '';
    }
    return `
      <div class="commander-select" aria-label="Commander Cards">
        ${COMMANDER_CARDS.map((card) => `
          <button class="commander-card ${selectedCommanderId === card.id ? 'is-active' : ''}" data-action="commander-card" data-commander="${escapeHtml(card.id)}" type="button" aria-pressed="${selectedCommanderId === card.id ? 'true' : 'false'}">
            <img src="${escapeHtml(card.image)}" alt="">
            <span class="commander-card-copy">
              <strong>${escapeHtml(card.label)}</strong>
              <span>${escapeHtml(card.effect)}</span>
              <small>${escapeHtml(card.quote)}</small>
            </span>
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderCommanderPrompt() {
    if (!commanderPrompt) {
      return '';
    }
    const selected = commanderDefinition(selectedCommanderId);
    const actionLabel = commanderPrompt.action === 'create-bot'
      ? 'Starta mot datorn'
      : commanderPrompt.action === 'create'
        ? 'Skapa lobby'
        : commanderPrompt.action === 'join'
          ? 'Gå med'
          : 'Använd kort';
    return `
      <div class="commander-prompt-scrim" data-action="close-commander-prompt" aria-hidden="true"></div>
      <aside class="commander-prompt" role="dialog" aria-modal="true" aria-labelledby="commander-prompt-title">
        <div class="commander-prompt-header">
          <div>
            <h2 id="commander-prompt-title">Välj Commander Card</h2>
            <span>Arcade använder specialförmågor. Välj taktik innan flottan placeras.</span>
          </div>
          <button class="btn ghost side-close" data-action="close-commander-prompt" type="button">Stäng</button>
        </div>
        ${renderCommanderSelector()}
        <div class="commander-prompt-actions">
          <span>${escapeHtml(selected.label)} · ${escapeHtml(selected.effect)}</span>
          <button class="btn primary" data-action="confirm-commander" type="button">${escapeHtml(actionLabel)}</button>
        </div>
      </aside>
    `;
  }

  function renderModeNotice() {
    return `
      <div class="mode-notice" role="note">
        <strong>${selectedMode === 'arcade' ? 'Arcade Beta.' : 'Classic är standard.'}</strong>
        <span>${selectedMode === 'arcade' ? 'Välj Commander Card när matchen startas.' : 'Arcade bygger vidare med Commander Cards och specialförmågor.'}</span>
      </div>
    `;
  }

  function renderWaiting() {
    return `
      <section class="status-grid">
        <div class="panel">
          <h2>Rumskod</h2>
          <div class="code-value">${escapeHtml(state.code)}</div>
          ${renderTimePanel()}
        </div>
        <div class="panel">
          <h2>Spelare</h2>
          ${renderPlayers()}
        </div>
      </section>
    `;
  }

  function renderExpiredLobby() {
    return `
      <section class="status-grid">
        <div class="panel">
          <h2>Koden gick ut</h2>
          <div class="score-summary">Ingen motståndare anslöt inom 5 minuter.</div>
          ${renderTimePanel()}
          <div class="outcome-actions">
            <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
            <button class="btn ghost leave-button" data-action="leave" type="button">Lämna</button>
          </div>
        </div>
        <div class="panel">
          <h2>Spelare</h2>
          ${renderPlayers()}
        </div>
      </section>
    `;
  }

  function renderPlacement() {
    const fleet = currentFleet();
    const canReady = placedShips.length === fleet.length;
    const locked = state.own.ready;
    const selectedShip = fleet.find((ship) => ship.id === selectedShipId) || fleet.find((ship) => !placementForType(ship.id)) || fleet[0];
    if (selectedShip && selectedShipId !== selectedShip.id) {
      selectedShipId = selectedShip.id;
    }
    const selectedPlacement = selectedShip ? placementForType(selectedShip.id) : null;
    const selectedText = selectedShip
      ? `${selectedShip.name}, ${selectedShip.length} rutor${selectedPlacement ? ' - vald för flytt' : ''}`
      : 'Välj ett skepp';
    return `
      <section class="placement-screen themed-screen">
        ${renderTitleBanner('compact-banner-card', renderBannerHud('placement'))}
        <div class="home-console page-console placement-console">
          <div class="status-grid placement-grid">
            <div class="panel placement-controls-panel">
          <div class="placement-header">
            <div>
              <h2>Flotta</h2>
              <span>${locked ? 'Inväntar motståndaren' : escapeHtml(selectedText)}</span>
            </div>
            <span class="chip">${locked ? 'Låst' : `${placedShips.length}/${fleet.length}`}</span>
          </div>
          ${renderCommanderLoadout('placement')}
          ${locked ? renderTimePanel() : ''}
          <div class="fleet-list fleet-dock">${fleet.map(renderShipButton).join('')}</div>
          <div class="toolbar placement-toolbar">
            <button class="btn" data-action="auto-place" type="button" ${locked ? 'disabled' : ''}>Auto</button>
            <button class="btn" data-action="clear-place" type="button" ${locked ? 'disabled' : ''}>Rensa</button>
            <button class="btn danger" data-action="remove-ship" type="button" ${selectedPlacement && !locked ? '' : 'disabled'}>Ta bort</button>
            <button class="btn primary" data-action="ready" type="button" ${canReady && !locked ? '' : 'disabled'}>Redo</button>
          </div>
            </div>
            <div class="panel board-wrap placement-board-panel">
          <div class="board-title placement-board-title">
            <h2>Din spelplan</h2>
            <span class="chip">${locked ? 'Låst' : `${placedShips.length}/${fleet.length}`}</span>
          </div>
          <div class="placement-board-body">
            <div class="placement-rotate-rail">
              ${renderPlacementFloatControls(locked)}
            </div>
            ${renderBoard('placement')}
          </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderPlacementFloatControls(locked) {
    return `
      <div class="placement-float-controls is-docked" aria-label="Placeringskontroller">
        <button class="float-control rotate-control" data-action="rotate" type="button" title="Rotera skepp" aria-label="Rotera skepp" ${locked ? 'disabled' : ''}>
          <span aria-hidden="true">↻</span>
          <strong>Rotera</strong>
        </button>
        <span class="float-orientation" aria-hidden="true">${orientation === 'horizontal' ? 'Vågrätt' : 'Lodrätt'}</span>
      </div>
    `;
  }

  function renderGame() {
    const finished = state.status === 'finished';
    const terminal = ['finished', 'expired', 'abandoned'].includes(state.status);
    return `
      <section class="game-grid">
        <div class="panel board-wrap own-board-panel">
          <div class="board-title own-board-title">
            <h2>Din flotta</h2>
            <div class="board-title-actions own-board-actions">
              ${hasArcadePowers() ? `<span class="chip board-ability-chip">${escapeHtml(abilitySummary())}</span>` : `<span class="chip board-mode-chip">${escapeHtml(modeLabel(state.mode))}</span>`}
              <div class="mobile-top-actions">
                ${hasArcadePowers() && state.status === 'playing' ? `<button class="btn ghost mobile-ability-button ${abilityPanelOpen ? 'is-active' : ''}" data-action="toggle-ability-panel" type="button" aria-label="Förmågor" aria-expanded="${abilityPanelOpen ? 'true' : 'false'}">Förmågor</button>` : ''}
                <button class="btn ghost mobile-options-button" data-action="toggle-mobile-info" type="button" aria-label="Alternativ" aria-expanded="${mobileInfoOpen ? 'true' : 'false'}"><span aria-hidden="true"></span></button>
              </div>
            </div>
          </div>
          ${renderBoard('own')}
          ${renderFleetRadar()}
        </div>
        <div class="panel board-wrap target-board-panel">
          <div class="board-title">
            <h2>${escapeHtml(state.target.opponentName || 'Motståndare')}</h2>
            <div class="board-title-actions">
              <span class="chip turn-status-chip ${state.turn && state.turn.isYou ? 'is-turn' : ''}">${finished ? escapeHtml(state.winner.playerName) : escapeHtml(statusLabel())}</span>
              ${hasArcadePowers() && state.status === 'playing' ? `<button class="btn ghost ability-toggle ${abilityPanelOpen ? 'is-active' : ''}" data-action="toggle-ability-panel" type="button" aria-label="Förmågor" aria-expanded="${abilityPanelOpen ? 'true' : 'false'}">Förmågor</button>` : ''}
              <button class="btn ghost mobile-info-toggle" data-action="toggle-mobile-info" type="button" aria-label="Alternativ" aria-expanded="${mobileInfoOpen ? 'true' : 'false'}">Alternativ</button>
            </div>
          </div>
          ${renderBoard('target')}
          ${renderTurnLockOverlay()}
        </div>
        ${terminal ? renderMobileEndActions() : ''}
        ${renderAbilityPopover()}
        <div class="mobile-info-scrim ${mobileInfoOpen ? 'is-open' : ''}" data-action="close-mobile-info" aria-hidden="true"></div>
        <aside class="panel side-panel ${mobileInfoOpen ? 'is-open' : ''}">
          <div class="side-panel-header">
            <h2>Matchinfo</h2>
            <button class="btn ghost side-close" data-action="close-mobile-info" type="button">Stäng</button>
          </div>
          ${renderWaitingTurnCard()}
          ${renderTimePanel()}
          ${renderOutcome()}
          ${renderPowerPanel()}
          ${renderStatsPanel()}
          <h3>Spelare</h3>
          ${renderPlayers()}
          <button class="btn ghost log-toggle" data-action="toggle-log" type="button" aria-expanded="${mobileLogOpen ? 'true' : 'false'}">
            ${mobileLogOpen ? 'Dölj logg' : 'Visa logg'}
          </button>
          ${mobileLogOpen ? `<div class="log-drawer"><h3>Logg</h3>${renderLog()}</div>` : ''}
          <div class="mobile-side-actions">
            <button class="btn ghost audio-toggle" data-action="toggle-audio" type="button" aria-pressed="${audioEnabled ? 'true' : 'false'}">${audioEnabled ? 'Ljud på' : 'Ljud av'}</button>
            <button class="btn ghost leave-button" data-action="leave" type="button">Lämna</button>
          </div>
        </aside>
      </section>
    `;
  }

  function renderMobileEndActions() {
    return `
      <div class="mobile-end-actions">
        <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
        <button class="btn ghost leave-button" data-action="leave" type="button">Lämna</button>
      </div>
    `;
  }

  function renderAbilityPopover() {
    if (!state || state.status !== 'playing' || !hasArcadePowers()) {
      return '';
    }
    return `
      <div class="ability-scrim ${abilityPanelOpen ? 'is-open' : ''}" data-action="close-ability-panel" aria-hidden="true"></div>
      <aside class="ability-popover ${abilityPanelOpen ? 'is-open' : ''}" aria-label="Arcadeförmågor">
        <div class="ability-popover-header">
          <strong>Taktisk snabbpanel</strong>
          <button class="btn ghost side-close" data-action="close-ability-panel" type="button">Stäng</button>
        </div>
        ${renderPowerPanel('popover')}
      </aside>
    `;
  }

  function renderTurnLockOverlay() {
    if (!state || state.status !== 'playing' || !state.turn || state.turn.isYou) {
      return '';
    }
    return `
      <div class="turn-lock-overlay" role="status" aria-live="polite">
        <strong>Motståndarens tur</strong>
        <span>${escapeHtml(formatDuration(turnElapsedMs()))}</span>
      </div>
    `;
  }

  function renderOutcome() {
    if (state.status === 'expired') {
      const lobbyExpired = timing().expiredReason === 'lobby';
      return `
        <div class="energy">
          <h2>${lobbyExpired ? 'Koden gick ut' : 'Tiden gick ut'}</h2>
          <div class="score-summary">${lobbyExpired ? 'Ingen motståndare anslöt inom 5 minuter.' : 'Matchen passerade 48 timmar. Ingen highscore sparades.'}</div>
          <div class="outcome-actions">
            <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
            <button class="btn ghost leave-button" data-action="leave" type="button">Lämna</button>
          </div>
        </div>
      `;
    }

    if (state.status === 'abandoned') {
      const leftText = state.abandonedBy
        ? `${state.abandonedBy.playerName} lämnade matchen.`
        : 'Matchen avbröts.';
      return `
        <div class="energy">
          <h2>Matchen avslutades</h2>
          <div class="score-summary">${escapeHtml(leftText)} Ingen highscore sparades.</div>
          <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
        </div>
      `;
    }

    if (state.status !== 'finished') {
      return '';
    }
    return `
      <div class="energy">
        <h2>${state.winner.isYou ? 'Seger' : 'Förlust'}</h2>
        ${state.score ? `<div class="score-summary">${escapeHtml(state.score.winnerName)} vann på ${formatDuration(state.score.durationMs)} med ${state.score.shots} skott, ${state.score.hits} träff och ${state.score.misses} miss.</div>` : ''}
        <div class="outcome-actions">
          <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
          <button class="btn ghost leave-button" data-action="leave" type="button">Lämna</button>
        </div>
      </div>
    `;
  }

  function renderPowerPanel(variant = 'side') {
    if (state.status !== 'playing' || !hasArcadePowers()) {
      return '';
    }
    const charges = ownAbilityCharges();
    return `
      <div class="ability-panel ${variant === 'popover' ? 'is-popover' : 'is-side'}">
        <div class="ability-panel-title">
          <h3>Förmågor</h3>
          <span class="chip">${escapeHtml(abilitySummary())}</span>
        </div>
        ${renderCommanderLoadout('power')}
        <div class="toolbox ability-toolbox">
          ${renderAbility('shot', 'Skott', '∞', abilityDisabled('shot'))}
          ${renderAbility('sonar', 'Sonar ping', `${charges.sonar} kvar`, abilityDisabled('sonar'))}
          ${renderAbility('barrage', 'Barrage', `${charges.barrage} kvar`, abilityDisabled('barrage'))}
        </div>
      </div>
    `;
  }

  function renderAbility(id, name, cost, disabled) {
    return `
      <button class="ability-button ${selectedAbility === id ? 'is-active' : ''}" data-action="ability" data-ability="${id}" type="button" ${disabled ? 'disabled' : ''}>
        <strong>${escapeHtml(name)}</strong>
        <span>${cost}</span>
      </button>
    `;
  }

  function renderStatsPanel() {
    if (!state || !state.stats) {
      return '';
    }
    const outgoing = state.stats.outgoing || { shots: 0, hits: 0, misses: 0, accuracy: 0 };
    const incoming = state.stats.incoming || { shots: 0, hits: 0, misses: 0, accuracy: 0 };
    return `
      <h3>Statistik</h3>
      <div class="stat-grid">
        <div class="stat-tile">
          <strong>${outgoing.hits}/${outgoing.shots}</strong>
          <span>Dina träff</span>
        </div>
        <div class="stat-tile">
          <strong>${outgoing.misses}</strong>
          <span>Dina miss</span>
        </div>
        <div class="stat-tile">
          <strong>${outgoing.accuracy}%</strong>
          <span>Precision</span>
        </div>
        <div class="stat-tile muted">
          <strong>${incoming.hits}/${incoming.shots}</strong>
          <span>Mot dig</span>
        </div>
      </div>
    `;
  }

  function renderPlayers() {
    return `
      <div class="players-list">
        ${state.players.map((player) => `
          <div class="player-row">
            <strong>${escapeHtml(player.name)}${player.isYou ? ' · du' : ''}</strong>
            ${player.commander ? `<span class="player-commander">${escapeHtml(commanderLabel(player.commander))} · ${escapeHtml(commanderEffect(player.commander))}</span>` : ''}
            <span class="player-state">${player.ready ? 'Redo' : 'Väntar'}</span>
          </div>
        `).join('')}
        ${state.players.length < 2 ? '<div class="empty-state">Väntar på spelare</div>' : ''}
      </div>
    `;
  }

  function renderLog() {
    const entries = [...(state.log || [])].reverse();
    if (!entries.length) {
      return '<div class="empty-state">Ingen logg än</div>';
    }
    return `<div class="log-list">${entries.map((entry) => `<div class="log-item" data-type="${escapeHtml(entry.type)}">${escapeHtml(entry.text)}</div>`).join('')}</div>`;
  }

  function renderScoreList(scoreRows = scoresFor(), limit = SCORE_PREVIEW_LIMIT, variant = 'compact') {
    if (!scoreRows.length) {
      return '<div class="empty-state compact">Ingen topplista än</div>';
    }
    const full = variant === 'full';
    return `
      <div class="score-list ${full ? 'is-full' : ''}">
        ${scoreRows.slice(0, limit).map((score, index) => `
          <div class="score-row ${full ? 'is-full' : ''}">
            <strong>${index + 1}. ${escapeHtml(score.winnerName)}</strong>
            <span>${escapeHtml(modeLabel(score.mode))} · ${formatDuration(score.durationMs)} · ${score.hits}/${score.shots} träff · ${score.misses} miss · ${score.accuracy || 0}%</span>
            ${renderScoreMeta(score, full)}
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderScoreMeta(score, full) {
    if (!full) {
      return '';
    }
    return `
      <div class="score-meta">
        <span>${escapeHtml(scoreCategoryLabel())}</span>
        <span>${escapeHtml(scoreScopeLabel(isBotScore(score) ? 'computer' : 'players'))}</span>
        <span>${escapeHtml(modeLabel(score.mode))}</span>
        <span>${escapeHtml(formatDuration(score.durationMs))}</span>
        <span>${escapeHtml(score.hits)}/${escapeHtml(score.shots)} träff</span>
        <span>${escapeHtml(score.misses)} miss</span>
        <span>${escapeHtml(score.accuracy || 0)}%</span>
        ${score.opponentName ? `<span>mot ${escapeHtml(score.opponentName)}</span>` : ''}
      </div>
    `;
  }

  function renderShipButton(ship) {
    const placed = Boolean(placementForType(ship.id));
    const active = selectedShipId === ship.id;
    return `
      <button class="ship-button ${active ? 'is-active' : ''} ${placed ? 'is-placed' : ''}" data-action="select-ship" data-ship="${ship.id}" type="button" ${state && state.own.ready ? 'disabled' : ''}>
        <strong>${escapeHtml(ship.name)}</strong>
        <span class="ship-pips">${'<span></span>'.repeat(ship.length)}</span>
        <span class="ship-state">${placed ? (active ? 'Flytta' : 'Placerad') : 'Välj'}</span>
      </button>
    `;
  }

  function renderBoard(type) {
    const cells = [];
    const columns = [];
    const rows = [];
    const overlays = renderShipOverlays(type);
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      rows.push(`<span class="axis-label">${String.fromCharCode(65 + y)}</span>`);
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (y === 0) {
          columns.push(`<span class="axis-label">${x + 1}</span>`);
        }
        cells.push(renderCell(type, x, y));
      }
    }
    return `
      <div class="board-shell" data-board-shell="${type}">
        <div class="axis-corner" aria-hidden="true"></div>
        <div class="axis-labels axis-cols" aria-hidden="true">${columns.join('')}</div>
        <div class="axis-labels axis-rows" aria-hidden="true">${rows.join('')}</div>
        <div class="board ${overlays ? 'has-ship-overlays' : ''}" data-board="${type}">${cells.join('')}${overlays}</div>
      </div>
    `;
  }

  function renderFleetRadar() {
    const cells = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const ship = shipAt(state.own.ships, x, y);
        const incoming = shotAt(state.own.incomingShots, x, y);
        const classes = ['fleet-radar-cell'];
        const labels = [coordinateLabel(x, y)];
        if (ship) {
          const shipDef = shipDefinition(ship.type);
          classes.push('is-ship');
          labels.push(shipDef ? shipDef.name : 'Skepp');
        }
        if (incoming) {
          classes.push(incoming.result === 'hit' ? 'is-hit' : (incoming.result === 'blocked' ? 'is-blocked' : 'is-miss'));
          labels.push(incoming.result === 'hit' ? 'Träff' : (incoming.result === 'blocked' ? 'Blockerad' : 'Miss'));
          if (incoming.sunkShipId) {
            classes.push('is-sunk');
            labels.push('Sankt');
          }
        }
        cells.push(`<span class="${classes.join(' ')}" aria-label="${escapeHtml(labels.join(', '))}" title="${escapeHtml(labels.join(', '))}"></span>`);
      }
    }
    return `
      <div class="fleet-radar" role="img" aria-label="Radar over din flotta">
        <div class="fleet-radar-grid">${cells.join('')}</div>
      </div>
    `;
  }

  function renderShipOverlays(type) {
    if (type === 'target' && state.status === 'finished' && state.target && Array.isArray(state.target.ships)) {
      const reveal = state.winner && state.winner.isYou ? 'defeated' : 'winner';
      return state.target.ships.map((ship) => renderShipOverlay(ship, reveal)).join('');
    }
    if (type === 'target') {
      return '';
    }
    const ships = type === 'placement' ? placedShips : state.own.ships;
    return (ships || []).map((ship) => renderShipOverlay(ship, '', type)).join('');
  }

  function renderShipOverlay(ship, revealState = '', boardType = '') {
    const placement = normalizePlacementShip(ship);
    const cells = placement ? getShipCells(placement) : [];
    if (!cells.length) {
      return '';
    }

    const fleetShip = shipDefinition(placement.type) || {};
    const length = Number(placement.size || fleetShip.length || cells.length);
    const line = straightShipLine(cells, length);
    if (!line) {
      return '';
    }
    const { direction, cells: sorted } = line;
    const start = sorted[0];
    const columnSpan = direction === 'horizontal' ? length : 1;
    const rowSpan = direction === 'vertical' ? length : 1;
    const asset = SHIP_ASSETS[placement.type] || SHIP_ASSETS.destroyer;
    const style = [
      `grid-column: ${start.x + 1} / span ${columnSpan}`,
      `grid-row: ${start.y + 1} / span ${rowSpan}`,
      `--ship-length: ${length}`
    ].join('; ');

    const revealClass = revealState ? ` is-revealed-enemy is-${revealState}-fleet` : '';
    const selectedClass = boardType === 'placement' && selectedShipId === placement.type ? ' is-selected-placement' : '';
    const singleClass = length === 1 ? ' ship-single-cell' : '';
    return `
      <span class="ship-overlay ship-dir-${direction} ship-type-${escapeHtml(placement.type)}${singleClass}${revealClass}${selectedClass}" style="${style}" aria-hidden="true">
        <img class="ship-sprite" src="${escapeHtml(asset)}" alt="">
      </span>
    `;
  }

  function renderCell(type, x, y) {
    const classes = ['cell', `is-${type}-cell`];
    let content = '';
    let disabled = true;
    const coord = coordinateLabel(x, y);
    const attrs = `data-x="${x}" data-y="${y}" data-coord="${coord}" aria-label="${coord}"`;
    const gridStyle = `style="grid-column: ${x + 1}; grid-row: ${y + 1};"`;

    if (type === 'placement') {
      const ship = shipAt(placedShips, x, y);
      const preview = previewCells();
      const inPreview = preview.cells.some((cell) => cell.x === x && cell.y === y);
      if (ship) classes.push('is-ship');
      if (ship && ship.type === selectedShipId) classes.push('is-selected-ship');
      if (inPreview) classes.push(preview.valid ? 'is-preview' : 'is-bad-preview');
      disabled = Boolean(state && state.own.ready);
    }

    if (type === 'own') {
      const ship = shipAt(state.own.ships, x, y);
      const incoming = shotAt(state.own.incomingShots, x, y);
      if (ship) classes.push('is-ship');
      if (incoming) {
        classes.push(incoming.result === 'hit' ? 'is-hit' : (incoming.result === 'blocked' ? 'is-blocked' : 'is-miss'));
        if (incoming.sunkShipId) classes.push('is-sunk');
        content += renderImpactPop(incoming.result, type, x, y, classes);
        if (incoming.result === 'blocked') content += renderBlockedBadge();
        if (incoming.sunkShipId) content += renderSunkBadge(incoming.sunkShipName);
      }
    }

    if (type === 'target') {
      const outgoing = shotAt(state.target.outgoingShots, x, y);
      const scan = sonarAt(x, y);
      const abilityPreview = targetAbilityPreviewFor(targetPreviewCell);
      const inAbilityPreview = abilityPreview.cells.some((cell) => cell.x === x && cell.y === y);
      if (scan.inRegion) classes.push('is-sonar', scan.contact ? 'is-sonar-contact' : 'is-sonar-empty');
      if (inAbilityPreview) {
        classes.push(
          abilityPreview.valid ? 'is-ability-preview' : 'is-bad-ability-preview',
          `is-${abilityPreview.ability}-preview`
        );
        if (sameCell(abilityPreview.origin, { x, y })) {
          classes.push('is-ability-preview-origin');
        }
      }
      if (outgoing) {
        classes.push(outgoing.result === 'hit' ? 'is-hit' : (outgoing.result === 'blocked' ? 'is-blocked' : 'is-miss'));
        if (outgoing.sunkShipId) classes.push('is-sunk');
        content += renderImpactPop(outgoing.result, type, x, y, classes);
        if (outgoing.result === 'blocked') content += renderBlockedBadge();
        if (outgoing.sunkShipId) content += renderSunkBadge(outgoing.sunkShipName);
      }
      if (scan.center && !outgoing) {
        const scanCount = Number(scan.center.count || 0);
        content = `<span class="scan-count ${scanCount > 0 ? 'is-contact' : 'is-empty'}">${scanCount}</span>`;
      }
      disabled = !(state.status === 'playing' && state.turn && state.turn.isYou);
    }

    return `<button class="${classes.join(' ')}" ${attrs} ${gridStyle} data-cell="${type}" type="button" ${disabled ? 'disabled' : ''}>${content}<span class="coord-pop" aria-hidden="true">${coord}</span></button>`;
  }

  function coordinateLabel(x, y) {
    return `${String.fromCharCode(65 + y)}${x + 1}`;
  }

  function renderImpactPop(result, type, x, y, classes) {
    const key = `${state && state.code ? state.code : 'local'}:${type}:${x}:${y}:${result}`;
    if (animatedImpactKeys.has(key)) {
      return '';
    }
    animatedImpactKeys.add(key);
    if (Array.isArray(classes)) {
      classes.push('is-impacting');
    }
    if (result === 'hit') {
      return '<span class="impact-pop hit-pop" aria-hidden="true"></span>';
    }
    if (result === 'miss') {
      return '<span class="impact-pop miss-pop" aria-hidden="true"></span>';
    }
    if (result === 'blocked') {
      return '<span class="impact-pop blocked-pop" aria-hidden="true"></span>';
    }
    return '';
  }

  function renderBlockedBadge() {
    return '<span class="blocked-badge" aria-hidden="true" title="Commander blockerade träffen">BLOCK</span>';
  }

  function renderSunkBadge(shipName) {
    const label = shipName ? `Sänkt: ${shipName}` : 'Sänkt skepp';
    return `<span class="sunk-badge" aria-hidden="true" title="${escapeHtml(label)}">SÄNKT</span>`;
  }

  function shotAt(shots, x, y) {
    return [...(shots || [])].reverse().find((shot) => shot.x === x && shot.y === y) || null;
  }

  function resolvedShotAt(shots, x, y) {
    const shot = shotAt(shots, x, y);
    return shot && shot.result !== 'blocked' ? shot : null;
  }

  function shipAt(ships, x, y) {
    return (ships || [])
      .map(normalizePlacementShip)
      .filter(Boolean)
      .find((ship) => getShipCells(ship).some((cell) => cell.x === x && cell.y === y)) || null;
  }

  function sonarRegion(x, y) {
    const originX = Math.min(Math.max(0, Number(x) - 1), BOARD_SIZE - SONAR_SIZE);
    const originY = Math.min(Math.max(0, Number(y) - 1), BOARD_SIZE - SONAR_SIZE);
    return { originX, originY, size: SONAR_SIZE };
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

  function hasScannedSonarRegion(region) {
    const scans = state && state.target ? state.target.sonarScans : [];
    const key = sonarRegionKey(region);
    return scans.some((scan) => sonarRegionKey(storedSonarRegion(scan)) === key);
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

  function sameCell(a, b) {
    return Boolean(a && b && Number(a.x) === Number(b.x) && Number(a.y) === Number(b.y));
  }

  function targetAbilityPreviewFor(cell, ability = selectedAbility) {
    if (!cell || !hasArcadePowers() || ability === 'shot') {
      return { ability: 'shot', cells: [], valid: false, reason: '' };
    }
    if (ability === 'sonar') {
      const region = sonarRegion(cell.x, cell.y);
      const cells = sonarScanCells(region);
      const valid = abilityCharge('sonar') > 0 && !hasScannedSonarRegion(region);
      return {
        ability,
        cells,
        origin: { x: Number(cell.x), y: Number(cell.y) },
        valid,
        reason: valid ? '' : 'Det sonarområdet är redan pingat.'
      };
    }
    if (ability === 'barrage') {
      const cells = barrageCells(Number(cell.x), Number(cell.y));
      const valid = abilityCharge('barrage') > 0 && cells.some((entry) => !resolvedShotAt(state.target.outgoingShots, entry.x, entry.y));
      return {
        ability,
        cells,
        origin: { x: Number(cell.x), y: Number(cell.y) },
        valid,
        reason: valid ? '' : 'Barrage-området är redan beskjutet.'
      };
    }
    return { ability, cells: [], valid: false, reason: 'Okänd förmåga.' };
  }

  function sonarAt(x, y) {
    const scans = state && state.target ? state.target.sonarScans : [];
    const center = scans.find((scan) => scan.x === x && scan.y === y) || null;
    const coveringScans = scans.filter((scan) => sonarScanCells(scan).some((cell) => cell.x === x && cell.y === y));
    const contact = coveringScans.some((scan) => Number(scan.count || 0) > 0);
    return { center, inRegion: coveringScans.length > 0, contact };
  }

  function sonarScanCells(scan) {
    const originX = Number(scan && scan.originX);
    const originY = Number(scan && scan.originY);
    const size = Number(scan && scan.size);
    if (!Number.isInteger(originX) || !Number.isInteger(originY) || !Number.isInteger(size) || size <= 0) {
      return Array.from({ length: 9 }, (_, index) => ({
        x: Number(scan.x) + (index % 3) - 1,
        y: Number(scan.y) + Math.floor(index / 3) - 1
      })).filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE);
    }
    const region = { originX, originY, size };
    const cells = [];
    for (let y = region.originY; y < region.originY + region.size; y += 1) {
      for (let x = region.originX; x < region.originX + region.size; x += 1) {
        if (x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE) {
          cells.push({ x, y });
        }
      }
    }
    return cells;
  }

  function previewCells() {
    if (!hoverCell) {
      return { cells: [], valid: false, ship: null };
    }
    const ship = currentFleet().find((entry) => entry.id === selectedShipId);
    if (!ship) {
      return { cells: [], valid: false, ship: null };
    }
    const candidate = {
      type: ship.id,
      size: ship.length,
      x: hoverCell.x,
      y: hoverCell.y,
      orientation
    };
    return {
      cells: getShipCells(candidate),
      valid: canPlaceShip(candidate),
      ship: candidate
    };
  }

  function cellInCells(cell, cells) {
    return (cells || []).some((entry) => sameCell(entry, cell));
  }

  function canConfirmPlacementPreview(cell) {
    const preview = previewCells();
    return Boolean(preview.valid && preview.ship && cellInCells(cell, preview.cells));
  }

  function confirmPlacementPreview() {
    const preview = previewCells();
    if (!preview.valid || !preview.ship) {
      return false;
    }
    const placed = placeShip(preview.ship.type, preview.ship.x, preview.ship.y, preview.ship.orientation);
    if (placed) {
      playUiSound('place');
      render();
    }
    return placed;
  }

  function getShipCells(ship) {
    const normalized = normalizePlacementShip(ship);
    if (!normalized) {
      return [];
    }
    return Array.from({ length: normalized.size }, (_, index) => ({
      x: normalized.x + (normalized.orientation === 'horizontal' ? index : 0),
      y: normalized.y + (normalized.orientation === 'vertical' ? index : 0)
    }));
  }

  function normalizePlacementShip(ship) {
    if (!ship) {
      return null;
    }
    const type = String(ship.type || ship.id || '').trim();
    const fleetShip = shipDefinition(type);
    if (!fleetShip) {
      return null;
    }

    if (Number.isInteger(Number(ship.x)) && Number.isInteger(Number(ship.y))) {
      return {
        type,
        size: Number(ship.size || ship.length || fleetShip.length),
        x: Number(ship.x),
        y: Number(ship.y),
        orientation: ship.orientation === 'vertical' ? 'vertical' : 'horizontal'
      };
    }

    const cells = Array.isArray(ship.cells)
      ? ship.cells.map((cell) => ({ x: Number(cell.x), y: Number(cell.y) }))
      : [];
    const line = straightShipLine(cells, Number(ship.size || ship.length || fleetShip.length));
    if (!line) {
      return null;
    }
    return {
      type,
      size: fleetShip.length,
      x: line.cells[0].x,
      y: line.cells[0].y,
      orientation: line.direction
    };
  }

  function serializePlacementShip(ship) {
    const normalized = normalizePlacementShip(ship);
    if (!normalized) {
      return null;
    }
    return {
      id: normalized.type,
      cells: getShipCells(normalized)
    };
  }

  function straightShipLine(cells, expectedLength = cells.length) {
    if (!Array.isArray(cells) || cells.length !== expectedLength || !cells.length) {
      return null;
    }
    const normalized = cells.map((cell) => ({ x: Number(cell.x), y: Number(cell.y) }));
    if (normalized.some((cell) => !Number.isInteger(cell.x) || !Number.isInteger(cell.y))) {
      return null;
    }
    if (expectedLength === 1) {
      return { direction: 'horizontal', cells: normalized };
    }
    const sameRow = normalized.every((cell) => cell.y === normalized[0].y);
    const sameColumn = normalized.every((cell) => cell.x === normalized[0].x);
    if (!sameRow && !sameColumn) {
      return null;
    }

    const direction = sameColumn ? 'vertical' : 'horizontal';
    const sorted = [...normalized].sort((a, b) => (direction === 'horizontal' ? a.x - b.x : a.y - b.y));
    const start = sorted[0];
    const contiguous = sorted.every((cell, index) => (
      cell.x === start.x + (direction === 'horizontal' ? index : 0)
      && cell.y === start.y + (direction === 'vertical' ? index : 0)
    ));
    return contiguous ? { direction, cells: sorted } : null;
  }

  function canPlaceShip(ship, fleet = placedShips) {
    const normalized = normalizePlacementShip(ship);
    if (!normalized) {
      return false;
    }
    const cells = getShipCells(normalized);
    const line = straightShipLine(cells, normalized.size);
    if (!line || line.cells.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= BOARD_SIZE || cell.y >= BOARD_SIZE)) {
      return false;
    }
    const otherShips = (fleet || [])
      .map(normalizePlacementShip)
      .filter((entry) => entry && entry.type !== normalized.type);
    return line.cells.every((cell) => {
      const existing = shipAt(otherShips, cell.x, cell.y);
      return !existing;
    });
  }

  function bindEvents() {
    ensureAudioUnlockListener();
    document.querySelectorAll('[data-form="create"]').forEach((form) => {
      form.addEventListener('submit', handleCreate);
    });
    document.querySelectorAll('[data-form="join"]').forEach((form) => {
      form.addEventListener('submit', handleJoin);
    });
    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        selectedMode = normalizeModeId(input.value);
        commanderPrompt = null;
        playUiSound('select');
        render();
      });
    });
    document.querySelectorAll('[data-mode-option]').forEach((option) => {
      option.addEventListener('click', () => {
        const nextMode = normalizeModeId(option.dataset.mode);
        if (nextMode !== selectedMode) {
          selectedMode = nextMode;
          commanderPrompt = null;
          playUiSound('select');
          render();
        }
      });
    });
    document.querySelectorAll('input[name="name"]').forEach((input) => {
      input.addEventListener('input', () => {
        playerNameDraft = input.value;
      });
    });
    document.querySelectorAll('[data-action]').forEach((element) => {
      element.addEventListener('click', handleAction);
    });
    document.querySelectorAll('.scores-panel').forEach((panel) => {
      panel.addEventListener('wheel', handleScoresWheel, { passive: false });
    });
    document.querySelectorAll('[data-cell="placement"]').forEach((cell) => {
      cell.addEventListener('pointerenter', (event) => {
        if (event.pointerType && event.pointerType !== 'mouse') {
          return;
        }
        updatePlacementHover(cell);
      });
      cell.addEventListener('focus', () => updatePlacementHover(cell));
      cell.addEventListener('pointerup', handlePlacementPointer);
      cell.addEventListener('click', handlePlacementClick);
    });
    document.querySelectorAll('[data-cell="target"]').forEach((cell) => {
      cell.addEventListener('pointerenter', (event) => {
        if (event.pointerType && event.pointerType !== 'mouse') {
          return;
        }
        updateTargetPreview(cell);
      });
      cell.addEventListener('focus', () => updateTargetPreview(cell));
      cell.addEventListener('click', handleAction);
    });
    const placementBoard = document.querySelector('[data-board="placement"]');
    if (placementBoard) {
      placementBoard.addEventListener('pointerleave', () => {
        hoverCell = null;
        render();
      });
    }
    const targetBoard = document.querySelector('[data-board="target"]');
    if (targetBoard) {
      targetBoard.addEventListener('pointerleave', (event) => {
        if (event.pointerType && event.pointerType !== 'mouse') {
          return;
        }
        clearTargetPreview();
      });
    }
  }

  function updateTargetPreview(cellElement) {
    if (!state || state.status !== 'playing' || !state.turn || !state.turn.isYou || selectedAbility === 'shot') {
      return;
    }
    const nextCell = readCell(cellElement);
    if (sameCell(targetPreviewCell, nextCell)) {
      return;
    }
    targetPreviewCell = nextCell;
    render();
  }

  function clearTargetPreview() {
    if (!targetPreviewCell) {
      return;
    }
    targetPreviewCell = null;
    render();
  }

  function handleScoresWheel(event) {
    const panel = event.currentTarget;
    if (!panel || panel.scrollHeight <= panel.clientHeight) {
      return;
    }
    const factor = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? panel.clientHeight : 1);
    const delta = event.deltaY * factor;
    const atTop = panel.scrollTop <= 0;
    const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1;
    if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
      return;
    }
    event.preventDefault();
    panel.scrollTop += delta;
  }

  async function handleCreate(event) {
    event.preventDefault();
    unlockAudio();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || playerNameDraft || '').trim();
    if (!name) {
      playUiSound('error');
      showToast('Skriv ett namn först.');
      return;
    }
    playerNameDraft = name;
    writePlayerName(name);
    selectedMode = normalizeModeId(form.get('mode') || selectedMode);
    if (selectedMode === 'arcade') {
      openCommanderPrompt('create', { name, mode: selectedMode });
      return;
    }
    await executeCreateGame({ name, mode: selectedMode });
  }

  async function executeCreateGame(payload) {
    try {
      const data = await api('/api/create', { name: payload.name, mode: payload.mode, commander: selectedCommanderId });
      storage.set({ backend: backendMode, code: data.code, playerId: data.playerId });
      state = data.state;
      activePage = 'home';
      resetLocalPlacement();
      playUiSound('ready');
      connectEvents(data.code, data.playerId);
    } catch (error) {
      playUiSound('error');
      showToast(error.message);
    }
  }

  async function handleJoin(event) {
    event.preventDefault();
    unlockAudio();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || playerNameDraft || '').trim();
    const code = String(form.get('code') || '').trim();
    if (!name) {
      playUiSound('error');
      showToast('Skriv ett namn först.');
      return;
    }
    playerNameDraft = name;
    writePlayerName(name);
    try {
      const info = await api('/api/join-info', { code });
      selectedMode = normalizeModeId(info.mode && info.mode.id ? info.mode.id : selectedMode);
      if (info.requiresCommander) {
        openCommanderPrompt('join', { name, code: info.code || code });
        return;
      }
      await executeJoinGame({ name, code: info.code || code });
    } catch (error) {
      playUiSound('error');
      showToast(error.message);
    }
  }

  async function executeJoinGame(payload) {
    try {
      const data = await api('/api/join', { name: payload.name, code: payload.code, commander: selectedCommanderId });
      storage.set({ backend: backendMode, code: data.code, playerId: data.playerId });
      state = data.state;
      activePage = 'home';
      resetLocalPlacement();
      playUiSound('ready');
      connectEvents(data.code, data.playerId);
    } catch (error) {
      playUiSound('error');
      showToast(error.message);
    }
  }

  function handleAction(event) {
    unlockAudio();
    const action = event.currentTarget.dataset.action;
    if (action === 'toggle-audio') return toggleAudio();
    if (action === 'leave') {
      playUiSound('click');
      return leaveGame();
    }
    if (action === 'new-game') {
      playUiSound('click');
      return leaveGame();
    }
    if (action === 'show-scores') return showScoresPage();
    if (action === 'show-rules') return showRulesPage();
    if (action === 'show-home') return showHomePage();
    if (action === 'refresh-scores') return refreshScoresPage();
    if (action === 'score-mode') return selectScoreMode(event.currentTarget.dataset.scoreMode);
    if (action === 'score-category') return selectScoreCategory(event.currentTarget.dataset.scoreCategory);
    if (action === 'score-scope') return selectScoreScope(event.currentTarget.dataset.scoreScope);
    if (action === 'commander-card') return selectCommander(event.currentTarget.dataset.commander);
    if (action === 'confirm-commander') return confirmCommanderPrompt();
    if (action === 'close-commander-prompt') return closeCommanderPrompt();
    if (action === 'create-bot') return createBotGame();
    if (action === 'toggle-mobile-info') return toggleMobileInfo();
    if (action === 'close-mobile-info') return closeMobileInfo();
    if (action === 'toggle-ability-panel') return toggleAbilityPanel();
    if (action === 'close-ability-panel') return closeAbilityPanel();
    if (action === 'toggle-log') return toggleLog();
    if (action === 'select-ship') return selectShip(event.currentTarget.dataset.ship);
    if (action === 'orientation') return setOrientation(event.currentTarget.dataset.orientation);
    if (action === 'rotate') return rotateOrientation();
    if (action === 'auto-place') return autoPlace();
    if (action === 'clear-place') return clearPlacement();
    if (action === 'remove-ship') return removeShip();
    if (action === 'ready') return submitPlacement();
    if (action === 'ability') return selectAbility(event.currentTarget.dataset.ability);
    if (event.currentTarget.dataset.cell === 'placement') return placeSelectedShip(event.currentTarget);
    if (event.currentTarget.dataset.cell === 'target') return targetCell(event.currentTarget);
    return undefined;
  }

  async function showScoresPage() {
    playUiSound('click');
    activePage = 'scores';
    await loadScores();
    render();
  }

  function showRulesPage() {
    playUiSound('click');
    activePage = 'rules';
    render();
  }

  function selectScoreMode(mode) {
    selectedScoreMode = normalizeModeId(mode);
    playUiSound('select');
    render();
  }

  function selectScoreCategory(category) {
    selectedScoreCategory = SCORE_CATEGORIES.some((entry) => entry.id === category) ? category : SCORE_CATEGORIES[0].id;
    playUiSound('select');
    render();
  }

  function selectScoreScope(scope) {
    selectedScoreScope = SCORE_SCOPES.some((entry) => entry.id === scope) ? scope : SCORE_SCOPES[0].id;
    playUiSound('select');
    render();
  }

  function selectCommander(commander) {
    selectedCommanderId = normalizeCommanderId(commander);
    playUiSound('select');
    render();
  }

  function openCommanderPrompt(action, payload) {
    commanderPrompt = { action, payload };
    playUiSound('select');
    render();
  }

  function closeCommanderPrompt() {
    if (!commanderPrompt) {
      return;
    }
    commanderPrompt = null;
    playUiSound('click');
    render();
  }

  async function confirmCommanderPrompt() {
    if (!commanderPrompt) {
      return;
    }
    const prompt = commanderPrompt;
    commanderPrompt = null;
    playUiSound('ready');
    if (prompt.action === 'create-bot') {
      await executeCreateBotGame(prompt.payload);
      return;
    }
    if (prompt.action === 'join') {
      await executeJoinGame(prompt.payload);
      return;
    }
    await executeCreateGame(prompt.payload);
  }

  function showHomePage() {
    playUiSound('click');
    activePage = 'home';
    commanderPrompt = null;
    render();
  }

  async function refreshScoresPage() {
    playUiSound('click');
    await loadScores();
    render();
  }

  async function createBotGame() {
    unlockAudio();
    const name = playerNameDraft.trim();
    if (!name) {
      playUiSound('error');
      showToast('Skriv ett namn först.');
      return;
    }
    playerNameDraft = name;
    writePlayerName(name);
    if (selectedMode === 'arcade') {
      openCommanderPrompt('create-bot', { name, mode: selectedMode });
      return;
    }
    await executeCreateBotGame({ name, mode: selectedMode });
  }

  async function executeCreateBotGame(payload) {
    try {
      const data = await api('/api/create-bot', { name: payload.name, mode: payload.mode, commander: selectedCommanderId });
      selectedMode = normalizeModeId(data.state && data.state.mode ? data.state.mode.id : payload.mode);
      storage.set({ backend: backendMode, code: data.code, playerId: data.playerId });
      state = data.state;
      activePage = 'home';
      resetLocalPlacement();
      playUiSound('ready');
      connectEvents(data.code, data.playerId);
    } catch (error) {
      playUiSound('error');
      showToast(error.message);
    }
  }

  function toggleMobileInfo() {
    mobileInfoOpen = !mobileInfoOpen;
    if (mobileInfoOpen) {
      abilityPanelOpen = false;
    }
    playUiSound('click');
    render();
  }

  function closeMobileInfo() {
    if (mobileInfoOpen) {
      mobileInfoOpen = false;
      mobileLogOpen = false;
      playUiSound('click');
      render();
    }
  }

  function toggleAbilityPanel() {
    if (!hasArcadePowers()) {
      return;
    }
    abilityPanelOpen = !abilityPanelOpen;
    if (abilityPanelOpen) {
      mobileInfoOpen = false;
      mobileLogOpen = false;
    }
    playUiSound('click');
    render();
  }

  function closeAbilityPanel() {
    if (abilityPanelOpen) {
      abilityPanelOpen = false;
      playUiSound('click');
      render();
    }
  }

  function toggleLog() {
    mobileLogOpen = !mobileLogOpen;
    playUiSound('click');
    render();
  }

  function updatePlacementHover(cell) {
    if (state && state.own.ready) {
      return;
    }
    hoverCell = readCell(cell);
    render();
  }

  function handlePlacementPointer(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    lastPlacementPointerAt = Date.now();
    event.preventDefault();
    event.stopPropagation();
    unlockAudio();
    if (event.pointerType && event.pointerType !== 'mouse') {
      previewOrPlaceSelectedShip(event.currentTarget);
      return;
    }
    placeSelectedShip(event.currentTarget);
  }

  function handlePlacementClick(event) {
    if (Date.now() - lastPlacementPointerAt < 350) {
      return;
    }
    unlockAudio();
    placeSelectedShip(event.currentTarget);
  }

  function previewOrPlaceSelectedShip(cellElement) {
    if (state && state.own.ready) {
      return;
    }
    const cell = readCell(cellElement);
    if (canConfirmPlacementPreview(cell)) {
      confirmPlacementPreview();
      return;
    }
    const clickedShip = shipAt(placedShips, cell.x, cell.y);
    if (clickedShip) {
      selectPlacedShip(clickedShip, cell);
      return;
    }
    const wasPreviewed = hoverCell && hoverCell.x === cell.x && hoverCell.y === cell.y;
    hoverCell = cell;
    if (!wasPreviewed) {
      playUiSound('select');
      render();
      return;
    }
    placeSelectedShip(cellElement);
  }

  async function leaveGame() {
    const currentState = state;
    if (currentState && currentState.code && currentState.playerId && currentState.status !== 'finished' && currentState.status !== 'abandoned') {
      try {
        await api('/api/leave', {
          code: currentState.code,
          playerId: currentState.playerId
        });
      } catch {
        // Leaving should always take the local player home, even if the network call fails.
      }
    }
    disconnectLiveUpdates();
    storage.clear();
    state = null;
    activePage = 'home';
    mobileInfoOpen = false;
    mobileLogOpen = false;
    selectedAbility = 'shot';
    resetLocalPlacement();
    render();
  }

  function selectShip(shipId) {
    if (state && state.own.ready) {
      return;
    }
    const placedShip = placementForType(shipId);
    selectedShipId = shipId;
    if (placedShip) {
      orientation = placedShip.orientation;
      hoverCell = { x: placedShip.x, y: placedShip.y };
    } else {
      hoverCell = null;
    }
    playUiSound('select');
    render();
  }

  function rotateOrientation() {
    return rotateSelectedShip();
  }

  function setOrientation(nextOrientation) {
    return rotateSelectedShip(nextOrientation);
  }

  function clearPlacement() {
    if (state && state.own.ready) {
      return;
    }
    resetLocalPlacement();
    playUiSound('click');
    render();
  }

  function placementForType(type) {
    return placedShips.map(normalizePlacementShip).find((ship) => ship && ship.type === type) || null;
  }

  function selectPlacedShip(ship, focusCell = null) {
    const normalized = normalizePlacementShip(ship);
    if (!normalized) {
      return;
    }
    selectedShipId = normalized.type;
    orientation = normalized.orientation;
    hoverCell = focusCell || { x: normalized.x, y: normalized.y };
    playUiSound('select');
    render();
  }

  function placeShip(type, x, y, nextOrientation = orientation) {
    const fleet = currentFleet();
    const fleetShip = fleet.find((entry) => entry.id === type);
    if (!fleetShip) {
      return false;
    }
    const candidate = {
      type: fleetShip.id,
      size: fleetShip.length,
      x: Number(x),
      y: Number(y),
      orientation: nextOrientation === 'vertical' ? 'vertical' : 'horizontal'
    };
    if (!canPlaceShip(candidate)) {
      return false;
    }
    placedShips = [
      ...placedShips.map(normalizePlacementShip).filter((entry) => entry && entry.type !== candidate.type),
      candidate
    ];
    orientation = candidate.orientation;
    const next = fleet.find((entry) => !placementForType(entry.id));
    selectedShipId = next ? next.id : candidate.type;
    const selectedPlacement = placementForType(selectedShipId);
    hoverCell = selectedPlacement ? { x: selectedPlacement.x, y: selectedPlacement.y } : null;
    return true;
  }

  function removeShip(type = selectedShipId) {
    if (state && state.own.ready) {
      return;
    }
    const existing = placementForType(type);
    if (!existing) {
      playUiSound('error');
      showToast('Välj ett placerat skepp först.');
      return;
    }
    placedShips = placedShips.map(normalizePlacementShip).filter((entry) => entry && entry.type !== existing.type);
    selectedShipId = existing.type;
    orientation = existing.orientation;
    hoverCell = null;
    playUiSound('click');
    render();
  }

  function rotateSelectedShip(nextOrientation = null) {
    if (state && state.own.ready) {
      return;
    }
    const normalized = nextOrientation
      ? (nextOrientation === 'vertical' ? 'vertical' : 'horizontal')
      : (orientation === 'horizontal' ? 'vertical' : 'horizontal');
    if (orientation !== normalized) {
      playUiSound('rotate');
    }
    orientation = normalized;
    const selectedPlacement = placementForType(selectedShipId);
    if (selectedPlacement) {
      hoverCell = { x: selectedPlacement.x, y: selectedPlacement.y };
    }
    render();
  }

  function placeSelectedShip(cellElement) {
    if (state && state.own.ready) {
      return;
    }
    const cell = readCell(cellElement);
    const clickedShip = shipAt(placedShips, cell.x, cell.y);
    if (clickedShip) {
      selectPlacedShip(clickedShip, cell);
      return;
    }

    const ship = currentFleet().find((entry) => entry.id === selectedShipId);
    if (!ship) {
      return;
    }
    hoverCell = cell;
    const candidate = { type: ship.id, size: ship.length, x: cell.x, y: cell.y, orientation };
    if (!canPlaceShip(candidate)) {
      playUiSound('error');
      showToast('Skeppet får inte ligga där.');
      render();
      return;
    }
    placeShip(ship.id, cell.x, cell.y, orientation);
    playUiSound('place');
    render();
  }

  function autoPlace() {
    if (state && state.own.ready) {
      return;
    }
    const ships = autoPlaceFleet();
    if (!ships.length) {
      playUiSound('error');
      showToast('Auto-placering misslyckades.');
      return;
    }
    placedShips = ships;
    selectedShipId = (currentFleet()[0] || FLEET[0]).id;
    orientation = ships[0].orientation;
    hoverCell = { x: ships[0].x, y: ships[0].y };
    playUiSound('place');
    render();
  }

  function autoPlaceFleet() {
    const fleet = currentFleet();
    const ships = [];
    for (const ship of fleet) {
      let placed = false;
      for (let attempt = 0; attempt < 500 && !placed; attempt += 1) {
        const nextOrientation = Math.random() > 0.5 ? 'horizontal' : 'vertical';
        const maxX = nextOrientation === 'horizontal' ? BOARD_SIZE - ship.length : BOARD_SIZE - 1;
        const maxY = nextOrientation === 'vertical' ? BOARD_SIZE - ship.length : BOARD_SIZE - 1;
        const candidate = {
          type: ship.id,
          size: ship.length,
          x: Math.floor(Math.random() * (maxX + 1)),
          y: Math.floor(Math.random() * (maxY + 1)),
          orientation: nextOrientation
        };
        if (canPlaceShip(candidate, ships)) {
          ships.push(candidate);
          placed = true;
        }
      }
    }
    return ships.length === fleet.length ? ships : [];
  }

  async function submitPlacement() {
    if (!state || placedShips.length !== currentFleet().length) {
      return;
    }
    try {
      const data = await api('/api/place', {
        code: state.code,
        playerId: state.playerId,
        ships: placedShips.map(serializePlacementShip).filter(Boolean)
      });
      state = data.state;
      playUiSound('ready');
      render();
    } catch (error) {
      playUiSound('error');
      showToast(error.message);
    }
  }

  function selectAbility(ability) {
    if (!hasArcadePowers() && ability !== 'shot') {
      selectedAbility = 'shot';
      playUiSound('error');
      render();
      return;
    }
    if (ability !== 'shot' && abilityCharge(ability) <= 0) {
      playUiSound('error');
      showToast(`${ability === 'sonar' ? 'Sonar' : 'Barrage'} är slut.`);
      return;
    }
    selectedAbility = ability;
    targetPreviewCell = null;
    abilityPanelOpen = false;
    playUiSound('select');
    render();
  }

  function abilityLabel(ability) {
    if (ability === 'sonar') return 'Sonar ping';
    if (ability === 'barrage') return 'Barrage';
    return 'Skott';
  }

  function sonarResultMessage(result) {
    const count = Number(result && result.count);
    if (!Number.isInteger(count)) {
      return 'Sonar ping skickad.';
    }
    return count === 0
      ? 'Sonar ping: inga kontakter.'
      : `Sonar ping: ${count} ${count === 1 ? 'kontakt' : 'kontakter'}.`;
  }

  async function targetCell(cellElement) {
    if (!state || state.status !== 'playing' || !state.turn || !state.turn.isYou) {
      return;
    }
    const cell = readCell(cellElement);
    const ability = hasArcadePowers() ? selectedAbility : 'shot';
    if (ability !== 'shot' && abilityCharge(ability) > 0) {
      const confirmed = sameCell(targetPreviewCell, cell);
      const preview = targetAbilityPreviewFor(cell, ability);
      targetPreviewCell = cell;
      if (!preview.valid) {
        playUiSound('error');
        render();
        showToast(preview.reason || `${abilityLabel(ability)} kan inte användas här.`);
        return;
      }
      if (!confirmed) {
        playUiSound('select');
        render();
        showToast(`Tryck igen för att använda ${abilityLabel(ability)}.`);
        return;
      }
    }
    if (ability !== 'shot' && abilityCharge(ability) <= 0) {
      playUiSound('error');
      showToast(`${ability === 'sonar' ? 'Sonar' : 'Barrage'} är slut.`);
      selectedAbility = 'shot';
      render();
      return;
    }
    if (ability === 'shot' && resolvedShotAt(state.target.outgoingShots, cell.x, cell.y)) {
      playUiSound('error');
      showToast('Den rutan är redan beskjuten.');
      return;
    }
    try {
      const data = await api('/api/action', {
        code: state.code,
        playerId: state.playerId,
        ability,
        x: cell.x,
        y: cell.y
      });
      state = data.state;
      playActionSound(data.result, state);
      if (data.result && data.result.ability === 'sonar') {
        showToast(sonarResultMessage(data.result));
      }
      if (state.status === 'finished') {
        await loadScores();
      }
      if (ability !== 'shot') {
        selectedAbility = 'shot';
      }
      targetPreviewCell = null;
      abilityPanelOpen = false;
      render();
    } catch (error) {
      playUiSound('error');
      showToast(error.message);
    }
  }

  function readCell(element) {
    return {
      x: Number(element.dataset.x),
      y: Number(element.dataset.y)
    };
  }

  async function boot() {
    startClock();
    await loadScores();
    await loadSession();
  }

  boot();
})();

(function () {
  'use strict';

  function assetUrl(path) {
    const script = document.currentScript || document.querySelector('script[src$="app.js"], script[src*="/app.js"]');
    const baseUrl = script && script.src ? script.src : window.location.href;
    return new URL(`assets/${String(path).replace(/^\/+/, '')}`, baseUrl).toString();
  }

  const BOARD_SIZE = 10;
  const MAX_ENERGY = 9;
  const FLEET = [
    { id: 'carrier', name: 'Hangarfartyg', length: 5 },
    { id: 'battleship', name: 'Slagskepp', length: 4 },
    { id: 'cruiser', name: 'Kryssare', length: 3 },
    { id: 'submarine', name: 'Ubåt', length: 3 },
    { id: 'destroyer', name: 'Jagare', length: 2 }
  ];
  const GAME_MODES = [
    { id: 'arcade', label: 'Arcade', tag: 'Energi' },
    { id: 'classic', label: 'Classic', tag: 'Rent spel' }
  ];
  const SHIP_ASSETS = {
    carrier: assetUrl('gfx/ship_5_squares.png'),
    battleship: assetUrl('gfx/ship_4_squares.png'),
    cruiser: assetUrl('gfx/ship_3_squares_v1.png'),
    submarine: assetUrl('gfx/ship_3_squares_v2.png'),
    destroyer: assetUrl('gfx/ship_2_squares_v1.png')
  };
  const TITLE_IMAGE = assetUrl('gfx/battleship_logo_swe.png');
  const OWL_LOGO = assetUrl('gfx/42-improbable-owls-logo.svg');
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
  let selectedAbility = 'shot';
  let selectedMode = 'arcade';
  let playerNameDraft = readPlayerName();
  let toastTimer = null;
  let scores = [];
  let audioEnabled = readAudioPreference();
  let audioUnlocked = false;
  let audioUnlockListenerAttached = false;
  let activeMusicKey = null;
  let lastOutcomeSoundCode = null;
  let lastPlacementPointerAt = 0;
  let nowMs = Date.now();
  let clockTimer = null;
  let uiAudioContext = null;
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
    if (backendMode === 'supabase') {
      return supabaseFunctionFetch('/scores');
    }

    const response = await fetch('/api/scores');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Kunde inte hämta topplistan.');
    }
    return data;
  }

  async function loadScores() {
    try {
      const data = await fetchScores();
      scores = Array.isArray(data.scores) ? data.scores : [];
    } catch {
      scores = [];
    }
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
    const elapsed = matchElapsedMs();
    const lobbyTimer = usesLobbyTimer();
    const elapsedLabel = lobbyTimer ? 'Kod' : 'Tid';
    const remainingLabel = lobbyTimer ? 'Koden kvar' : 'Kvar';
    const warningAt = lobbyTimer ? 60 * 1000 : 60 * 60 * 1000;
    return `
      <span class="chip time-chip">${escapeHtml(elapsedLabel)} ${escapeHtml(formatDuration(elapsed))}</span>
      <span class="chip time-chip ${remaining <= warningAt ? 'is-warning' : ''}">${escapeHtml(remainingLabel)} ${escapeHtml(formatDuration(remaining))}</span>
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
    return GAME_MODES.some((entry) => entry.id === mode) ? mode : 'arcade';
  }

  function modeLabel(value) {
    const id = typeof value === 'object' && value ? value.id : value;
    const mode = GAME_MODES.find((entry) => entry.id === normalizeModeId(id));
    return mode ? mode.label : 'Arcade';
  }

  function currentMode() {
    return state && state.mode ? state.mode : { id: 'arcade', label: 'Arcade', abilities: true, hitKeepsTurn: true };
  }

  function hasArcadePowers() {
    return Boolean(currentMode().abilities);
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
    placedShips = (state.own.ships || []).map((ship) => ({
      id: ship.id,
      cells: ship.cells.map((cell) => ({ x: cell.x, y: cell.y }))
    }));
  }

  function resetLocalPlacement() {
    placedShips = [];
    hoverCell = null;
    selectedShipId = FLEET[0].id;
    orientation = 'horizontal';
  }

  function statusLabel() {
    if (!state) return 'Start';
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
    }
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div>
            <h1>BattleShip Arcade</h1>
            <p>${state ? escapeHtml(state.playerName) : 'Online sänka skepp'}</p>
          </div>
        </div>
        <div class="room-strip">
          ${state ? `<span class="chip">Kod <strong>${escapeHtml(state.code)}</strong></span>` : ''}
          ${state ? `<span class="chip">${escapeHtml(modeLabel(state.mode))}</span>` : ''}
          <span class="chip ${state && state.status === 'playing' ? 'is-live' : ''}">${escapeHtml(statusLabel())}</span>
          ${renderTimeChips()}
          ${state && state.turn ? `<span class="chip ${state.turn.isYou ? 'is-turn' : ''}">${escapeHtml(state.turn.playerName)}</span>` : ''}
          <button class="btn ghost audio-toggle" data-action="toggle-audio" type="button" aria-pressed="${audioEnabled ? 'true' : 'false'}">${audioEnabled ? 'Ljud på' : 'Ljud av'}</button>
          ${state ? '<button class="btn ghost" data-action="leave">Lämna</button>' : ''}
        </div>
      </header>
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
    playOutcomeSoundOnce();
    syncMusic();
  }

  function renderScreen() {
    if (!state) {
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
      <section class="home-grid">
        <div class="panel home-actions">
          <form class="form-grid" data-form="create">
            <h2>Skapa rum</h2>
            <input name="name" maxlength="24" placeholder="Ditt namn" autocomplete="nickname" required value="${escapeHtml(playerNameDraft)}">
            ${renderModeSelector()}
            <button class="btn primary" type="submit">Skapa kod</button>
          </form>
          <form class="form-grid" data-form="join">
            <h2>Gå med</h2>
            <div class="join-grid">
              <input name="name" maxlength="24" placeholder="Ditt namn" autocomplete="nickname" required value="${escapeHtml(playerNameDraft)}">
              <input name="code" maxlength="7" placeholder="Kod" autocomplete="off">
            </div>
            <button class="btn accent" type="submit">Anslut</button>
          </form>
          <div>
            <h2>Topplista</h2>
            ${renderScoreList()}
          </div>
        </div>
        <div class="hero-board title-board" aria-hidden="true">
          <img class="title-logo" src="${TITLE_IMAGE}" alt="">
          <div class="title-waterline"></div>
          <div class="hero-hit"></div>
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
          <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
        </div>
        <div class="panel">
          <h2>Spelare</h2>
          ${renderPlayers()}
        </div>
      </section>
    `;
  }

  function renderPlacement() {
    const canReady = placedShips.length === FLEET.length;
    const locked = state.own.ready;
    const selectedShip = FLEET.find((ship) => ship.id === selectedShipId);
    const selectedText = selectedShip && !placedShips.some((entry) => entry.id === selectedShip.id)
      ? `${selectedShip.name}, ${selectedShip.length} rutor`
      : 'Välj ett skepp';
    return `
      <section class="status-grid placement-grid">
        <div class="panel placement-controls-panel">
          <div class="placement-header">
            <div>
              <h2>Flotta</h2>
              <span>${locked ? 'Inväntar motståndaren' : escapeHtml(selectedText)}</span>
            </div>
            <span class="chip">${locked ? 'Låst' : `${placedShips.length}/${FLEET.length}`}</span>
          </div>
          ${locked ? renderTimePanel() : ''}
          <div class="fleet-list fleet-dock">${FLEET.map(renderShipButton).join('')}</div>
          <div class="toolbar placement-toolbar">
            <button class="btn" data-action="rotate" type="button" ${locked ? 'disabled' : ''}>Rotera ${orientation === 'horizontal' ? '->' : '^'}</button>
            <button class="btn" data-action="auto-place" type="button" ${locked ? 'disabled' : ''}>Auto</button>
            <button class="btn" data-action="clear-place" type="button" ${locked ? 'disabled' : ''}>Rensa</button>
            <button class="btn primary" data-action="ready" type="button" ${canReady && !locked ? '' : 'disabled'}>Redo</button>
          </div>
        </div>
        <div class="panel board-wrap placement-board-panel">
          <div class="board-title">
            <h2>Din spelplan</h2>
            <span class="chip">${locked ? 'Låst' : `${placedShips.length}/${FLEET.length}`}</span>
          </div>
          ${renderBoard('placement')}
        </div>
      </section>
    `;
  }

  function renderGame() {
    const finished = state.status === 'finished';
    return `
      <section class="game-grid">
        <div class="panel board-wrap">
          <div class="board-title">
            <h2>Din flotta</h2>
            ${hasArcadePowers() ? `<span class="chip">${escapeHtml(state.own.energy)} energi</span>` : `<span class="chip">${escapeHtml(modeLabel(state.mode))}</span>`}
          </div>
          ${renderBoard('own')}
        </div>
        <div class="panel board-wrap">
          <div class="board-title">
            <h2>${escapeHtml(state.target.opponentName || 'Motståndare')}</h2>
            <span class="chip ${state.turn && state.turn.isYou ? 'is-turn' : ''}">${finished ? escapeHtml(state.winner.playerName) : escapeHtml(statusLabel())}</span>
          </div>
          ${renderBoard('target')}
        </div>
        <aside class="panel side-panel">
          ${renderWaitingTurnCard()}
          ${renderTimePanel()}
          ${renderOutcome()}
          ${renderPowerPanel()}
          ${renderStatsPanel()}
          <h3>Topplista</h3>
          ${renderScoreList()}
          <h3>Spelare</h3>
          ${renderPlayers()}
          <h3 style="margin-top: 16px;">Logg</h3>
          ${renderLog()}
        </aside>
      </section>
    `;
  }

  function renderOutcome() {
    if (state.status === 'expired') {
      const lobbyExpired = timing().expiredReason === 'lobby';
      return `
        <div class="energy">
          <h2>${lobbyExpired ? 'Koden gick ut' : 'Tiden gick ut'}</h2>
          <div class="score-summary">${lobbyExpired ? 'Ingen motståndare anslöt inom 5 minuter.' : 'Matchen passerade 48 timmar. Ingen highscore sparades.'}</div>
          <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
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
        <button class="btn primary" data-action="new-game" type="button">Nytt spel</button>
      </div>
    `;
  }

  function renderPowerPanel() {
    if (state.status !== 'playing' || !hasArcadePowers()) {
      return '';
    }
    const energyWidth = Math.round((state.own.energy / MAX_ENERGY) * 100);
    const disabled = !(state.turn && state.turn.isYou);
    return `
      <div class="energy">
        <h3>Energi</h3>
        <div class="energy-bar" style="--energy-width: ${energyWidth}%"><span></span></div>
      </div>
      <div class="toolbox">
        ${renderAbility('shot', 'Skott', '0', disabled)}
        ${renderAbility('sonar', 'Sonar', '2', disabled || state.own.energy < 2)}
        ${renderAbility('barrage', 'Barrage', '5', disabled || state.own.energy < 5)}
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

  function renderScoreList() {
    if (!scores.length) {
      return '<div class="empty-state compact">Ingen topplista än</div>';
    }
    return `
      <div class="score-list">
        ${scores.slice(0, 5).map((score, index) => `
          <div class="score-row">
            <strong>${index + 1}. ${escapeHtml(score.winnerName)}</strong>
            <span>${escapeHtml(modeLabel(score.mode))} · ${formatDuration(score.durationMs)} · ${score.hits}/${score.shots} träff · ${score.misses} miss</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderShipButton(ship) {
    const placed = placedShips.some((entry) => entry.id === ship.id);
    return `
      <button class="ship-button ${selectedShipId === ship.id ? 'is-active' : ''} ${placed ? 'is-placed' : ''}" data-action="select-ship" data-ship="${ship.id}" type="button" ${state && state.own.ready ? 'disabled' : ''}>
        <strong>${escapeHtml(ship.name)}</strong>
        <span class="ship-pips">${'<span></span>'.repeat(ship.length)}</span>
      </button>
    `;
  }

  function renderBoard(type) {
    const cells = [];
    const columns = [];
    const rows = [];
    const overlays = renderShipOverlays(type);
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      rows.push(`<span class="axis-label">${y + 1}</span>`);
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (y === 0) {
          columns.push(`<span class="axis-label">${String.fromCharCode(65 + x)}</span>`);
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

  function renderShipOverlays(type) {
    if (type === 'target') {
      return '';
    }
    const ships = type === 'placement' ? placedShips : state.own.ships;
    return (ships || []).map(renderShipOverlay).join('');
  }

  function renderShipOverlay(ship) {
    const cells = Array.isArray(ship.cells)
      ? ship.cells.map((cell) => ({ x: Number(cell.x), y: Number(cell.y) }))
      : [];
    if (!cells.length) {
      return '';
    }

    const fleetShip = FLEET.find((entry) => entry.id === ship.id) || {};
    const length = Number(ship.length || fleetShip.length || cells.length);
    const line = straightShipLine(cells, length);
    if (!line) {
      return '';
    }
    const { direction, cells: sorted } = line;
    const start = sorted[0];
    const columnSpan = direction === 'horizontal' ? length : 1;
    const rowSpan = direction === 'vertical' ? length : 1;
    const asset = SHIP_ASSETS[ship.id] || SHIP_ASSETS.destroyer;
    const style = [
      `grid-column: ${start.x + 1} / span ${columnSpan}`,
      `grid-row: ${start.y + 1} / span ${rowSpan}`,
      `--ship-length: ${length}`
    ].join('; ');

    return `
      <span class="ship-overlay ship-dir-${direction}" style="${style}" aria-hidden="true">
        <img class="ship-sprite" src="${escapeHtml(asset)}" alt="">
      </span>
    `;
  }

  function renderCell(type, x, y) {
    const classes = ['cell', `is-${type}-cell`];
    let content = '';
    let disabled = true;
    const attrs = `data-x="${x}" data-y="${y}"`;
    const gridStyle = `style="grid-column: ${x + 1}; grid-row: ${y + 1};"`;

    if (type === 'placement') {
      const ship = shipAt(placedShips, x, y);
      const preview = previewCells();
      const inPreview = preview.cells.some((cell) => cell.x === x && cell.y === y);
      if (ship) classes.push('is-ship');
      if (inPreview) classes.push(preview.valid ? 'is-preview' : 'is-bad-preview');
      disabled = Boolean(state && state.own.ready);
    }

    if (type === 'own') {
      const ship = shipAt(state.own.ships, x, y);
      const incoming = shotAt(state.own.incomingShots, x, y);
      if (ship) classes.push('is-ship');
      if (incoming) {
        classes.push(incoming.result === 'hit' ? 'is-hit' : 'is-miss');
        if (incoming.sunkShipId) classes.push('is-sunk');
      }
    }

    if (type === 'target') {
      const outgoing = shotAt(state.target.outgoingShots, x, y);
      const scan = sonarAt(x, y);
      if (scan.inRegion) classes.push('is-sonar');
      if (outgoing) {
        classes.push(outgoing.result === 'hit' ? 'is-hit' : 'is-miss');
        if (outgoing.sunkShipId) classes.push('is-sunk');
      }
      if (scan.center && !outgoing) {
        content = `<span class="scan-count">${scan.center.count}</span>`;
      }
      disabled = !(state.status === 'playing' && state.turn && state.turn.isYou);
    }

    return `<button class="${classes.join(' ')}" ${attrs} ${gridStyle} data-cell="${type}" type="button" ${disabled ? 'disabled' : ''}>${content}</button>`;
  }

  function shotAt(shots, x, y) {
    return (shots || []).find((shot) => shot.x === x && shot.y === y) || null;
  }

  function shipAt(ships, x, y) {
    return (ships || []).find((ship) => ship.cells.some((cell) => cell.x === x && cell.y === y)) || null;
  }

  function sonarAt(x, y) {
    const scans = state && state.target ? state.target.sonarScans : [];
    const center = scans.find((scan) => scan.x === x && scan.y === y) || null;
    const inRegion = scans.some((scan) => Math.abs(scan.x - x) <= 1 && Math.abs(scan.y - y) <= 1);
    return { center, inRegion };
  }

  function previewCells() {
    if (!hoverCell) {
      return { cells: [], valid: false };
    }
    const ship = FLEET.find((entry) => entry.id === selectedShipId);
    if (!ship) {
      return { cells: [], valid: false };
    }
    const candidate = placementCandidate(hoverCell, ship);
    if (candidate) {
      return { cells: candidate.cells, valid: true };
    }
    const cells = cellsForShip(hoverCell.x, hoverCell.y, ship.length, orientation);
    return { cells, valid: false };
  }

  function cellsForShip(x, y, length, direction) {
    return Array.from({ length }, (_, index) => ({
      x: x + (direction === 'horizontal' ? index : 0),
      y: y + (direction === 'vertical' ? index : 0)
    }));
  }

  function straightShipLine(cells, expectedLength = cells.length) {
    if (!Array.isArray(cells) || cells.length !== expectedLength || !cells.length) {
      return null;
    }
    const normalized = cells.map((cell) => ({ x: Number(cell.x), y: Number(cell.y) }));
    if (normalized.some((cell) => !Number.isInteger(cell.x) || !Number.isInteger(cell.y))) {
      return null;
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

  function placementCandidate(cell, ship) {
    const primary = placementCandidateForDirection(cell, ship, orientation);
    if (primary) {
      return primary;
    }
    const fallbackDirection = orientation === 'horizontal' ? 'vertical' : 'horizontal';
    return placementCandidateForDirection(cell, ship, fallbackDirection);
  }

  function placementCandidateForDirection(cell, ship, direction) {
    const start = adjustedShipStart(cell.x, cell.y, ship.length, direction);
    const cells = cellsForShip(start.x, start.y, ship.length, direction);
    if (isPlacementValid(cells, ship.id, ship.length)) {
      return { cells, direction };
    }
    return null;
  }

  function adjustedShipStart(x, y, length, direction) {
    if (direction === 'vertical') {
      return {
        x: clamp(x, 0, BOARD_SIZE - 1),
        y: clamp(y, 0, BOARD_SIZE - length)
      };
    }
    return {
      x: clamp(x, 0, BOARD_SIZE - length),
      y: clamp(y, 0, BOARD_SIZE - 1)
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isPlacementValid(cells, shipId, expectedLength = cells.length) {
    const line = straightShipLine(cells, expectedLength);
    if (!line || line.cells.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= BOARD_SIZE || cell.y >= BOARD_SIZE)) {
      return false;
    }
    return line.cells.every((cell) => {
      const existing = shipAt(placedShips.filter((ship) => ship.id !== shipId), cell.x, cell.y);
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
        playUiSound('select');
        render();
      });
    });
    document.querySelectorAll('[data-mode-option]').forEach((option) => {
      option.addEventListener('click', () => {
        const nextMode = normalizeModeId(option.dataset.mode);
        if (nextMode !== selectedMode) {
          selectedMode = nextMode;
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
    document.querySelectorAll('[data-cell="placement"]').forEach((cell) => {
      cell.addEventListener('pointerenter', () => updatePlacementHover(cell));
      cell.addEventListener('focus', () => updatePlacementHover(cell));
      cell.addEventListener('pointerup', handlePlacementPointer);
      cell.addEventListener('click', handlePlacementClick);
    });
    document.querySelectorAll('[data-cell="target"]').forEach((cell) => {
      cell.addEventListener('click', handleAction);
    });
    const placementBoard = document.querySelector('[data-board="placement"]');
    if (placementBoard) {
      placementBoard.addEventListener('pointerleave', () => {
        hoverCell = null;
        render();
      });
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    unlockAudio();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    if (!name) {
      playUiSound('error');
      showToast('Skriv ett namn först.');
      return;
    }
    playerNameDraft = name;
    writePlayerName(name);
    selectedMode = normalizeModeId(form.get('mode') || selectedMode);
    try {
      const data = await api('/api/create', { name, mode: selectedMode });
      storage.set({ backend: backendMode, code: data.code, playerId: data.playerId });
      state = data.state;
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
    const name = String(form.get('name') || '').trim();
    if (!name) {
      playUiSound('error');
      showToast('Skriv ett namn först.');
      return;
    }
    playerNameDraft = name;
    writePlayerName(name);
    try {
      const data = await api('/api/join', { name, code: form.get('code') });
      storage.set({ backend: backendMode, code: data.code, playerId: data.playerId });
      state = data.state;
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
    if (action === 'select-ship') return selectShip(event.currentTarget.dataset.ship);
    if (action === 'orientation') return setOrientation(event.currentTarget.dataset.orientation);
    if (action === 'rotate') return rotateOrientation();
    if (action === 'auto-place') return autoPlace();
    if (action === 'clear-place') return clearPlacement();
    if (action === 'ready') return submitPlacement();
    if (action === 'ability') return selectAbility(event.currentTarget.dataset.ability);
    if (event.currentTarget.dataset.cell === 'placement') return placeSelectedShip(event.currentTarget);
    if (event.currentTarget.dataset.cell === 'target') return targetCell(event.currentTarget);
    return undefined;
  }

  function updatePlacementHover(cell) {
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
    placeSelectedShip(event.currentTarget);
  }

  function handlePlacementClick(event) {
    if (Date.now() - lastPlacementPointerAt < 350) {
      return;
    }
    unlockAudio();
    placeSelectedShip(event.currentTarget);
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
    selectedAbility = 'shot';
    resetLocalPlacement();
    render();
  }

  function selectShip(shipId) {
    if (state && state.own.ready) {
      return;
    }
    const placedShip = placedShips.find((entry) => entry.id === shipId);
    if (placedShip) {
      placedShips = placedShips.filter((entry) => entry.id !== shipId);
      selectedShipId = shipId;
      hoverCell = null;
      playUiSound('select');
      render();
      return;
    }
    if (selectedShipId === shipId) {
      rotateOrientation();
      return;
    }
    selectedShipId = shipId;
    playUiSound('select');
    render();
  }

  function rotateOrientation() {
    if (state && state.own.ready) {
      return;
    }
    orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
    playUiSound('rotate');
    render();
  }

  function setOrientation(nextOrientation) {
    if (state && state.own.ready) {
      return;
    }
    const normalized = nextOrientation === 'vertical' ? 'vertical' : 'horizontal';
    if (orientation !== normalized) {
      playUiSound('rotate');
    }
    orientation = normalized;
    render();
  }

  function clearPlacement() {
    if (state && state.own.ready) {
      return;
    }
    resetLocalPlacement();
    playUiSound('click');
    render();
  }

  function placeSelectedShip(cellElement) {
    if (state && state.own.ready) {
      return;
    }
    const cell = readCell(cellElement);
    const clickedShip = shipAt(placedShips, cell.x, cell.y);
    if (clickedShip) {
      const line = straightShipLine(clickedShip.cells, clickedShip.cells.length);
      placedShips = placedShips.filter((entry) => entry.id !== clickedShip.id);
      selectedShipId = clickedShip.id;
      orientation = line ? line.direction : orientation;
      hoverCell = cell;
      playUiSound('select');
      render();
      return;
    }

    const ship = FLEET.find((entry) => entry.id === selectedShipId);
    if (!ship) {
      return;
    }
    const candidate = placementCandidate(cell, ship);
    if (!candidate) {
      playUiSound('error');
      showToast('Skeppet får inte ligga där.');
      return;
    }
    orientation = candidate.direction;
    placedShips = placedShips.filter((entry) => entry.id !== ship.id);
    placedShips.push({ id: ship.id, cells: candidate.cells });
    const next = FLEET.find((entry) => !placedShips.some((shipEntry) => shipEntry.id === entry.id));
    selectedShipId = next ? next.id : selectedShipId;
    hoverCell = null;
    playUiSound('place');
    render();
  }

  function autoPlace() {
    if (state && state.own.ready) {
      return;
    }
    const ships = [];
    for (const ship of FLEET) {
      let placed = false;
      for (let attempt = 0; attempt < 400 && !placed; attempt += 1) {
        const direction = Math.random() > 0.5 ? 'horizontal' : 'vertical';
        const x = Math.floor(Math.random() * BOARD_SIZE);
        const y = Math.floor(Math.random() * BOARD_SIZE);
        const cells = cellsForShip(x, y, ship.length, direction);
        if (cells.every((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE)
          && cells.every((cell) => !shipAt(ships, cell.x, cell.y))) {
          ships.push({ id: ship.id, cells });
          placed = true;
        }
      }
    }
    if (ships.length !== FLEET.length) {
      playUiSound('error');
      showToast('Auto-placering misslyckades.');
      return;
    }
    placedShips = ships;
    hoverCell = null;
    playUiSound('place');
    render();
  }

  async function submitPlacement() {
    if (!state || placedShips.length !== FLEET.length) {
      return;
    }
    try {
      const data = await api('/api/place', {
        code: state.code,
        playerId: state.playerId,
        ships: placedShips
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
    selectedAbility = ability;
    playUiSound('select');
    render();
  }

  async function targetCell(cellElement) {
    if (!state || state.status !== 'playing' || !state.turn || !state.turn.isYou) {
      return;
    }
    const cell = readCell(cellElement);
    const ability = hasArcadePowers() ? selectedAbility : 'shot';
    if (ability === 'shot' && shotAt(state.target.outgoingShots, cell.x, cell.y)) {
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
      if (state.status === 'finished') {
        await loadScores();
      }
      if (ability !== 'shot') {
        selectedAbility = 'shot';
      }
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

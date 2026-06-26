const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const creditsEl = document.getElementById('credits');
const messageEl = document.getElementById('message');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const pauseBtn = document.getElementById('pause-btn');
const shopItemsEl = document.getElementById('shop-items');
const upgradeShopEl = document.getElementById('upgrade-shop');
const premiumShopEl = document.getElementById('premium-shop');
const gameOverOverlay = document.getElementById('game-over-overlay');
const continueBtn = document.getElementById('continue-btn');
const restartBtn = document.getElementById('restart-btn');
const fsLivesEl = document.getElementById('fs-lives');
const fsScoreEl = document.getElementById('fs-score');
const fsCreditsEl = document.getElementById('fs-credits');
const stageEl = document.getElementById('stage');
const comboEl = document.getElementById('combo');
const bombCountEl = document.getElementById('bomb-count');
const bombBtn = document.getElementById('bomb-btn');
const fsMessageEl = document.getElementById('fs-message');
const finalScoreEl = document.getElementById('final-score');
const earnedCreditsEl = document.getElementById('earned-credits');
const mainMenuEl = document.getElementById('main-menu');
const pauseMenuEl = document.getElementById('pause-menu');
const storeScreenEl = document.getElementById('store-screen');
const startBtn = document.getElementById('start-btn');
const menuStoreBtn = document.getElementById('menu-store-btn');
const pauseStoreBtn = document.getElementById('pause-store-btn');
const resumeBtn = document.getElementById('resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const storeBackBtn = document.getElementById('store-back-btn');
const bgMusic = document.getElementById('background-music');
let musicStarted = false;

const DEV_HOSTS = new Set(['', 'localhost', '127.0.0.1']);
const IS_DEV_BUILD = location.protocol === 'file:' || DEV_HOSTS.has(location.hostname);
const debugFlags = Object.freeze({
  showPowerUpSpawnRates: IS_DEV_BUILD && localStorage.getItem('debug.showPowerUpSpawnRates') === 'true',
  disableMonetizationSpawns: IS_DEV_BUILD && localStorage.getItem('debug.disableMonetizationSpawns') === 'true',
  showUIAnchors: IS_DEV_BUILD && localStorage.getItem('debug.showUIAnchors') === 'true'
});

if (debugFlags.showUIAnchors) {
  document.body.classList.add('debug-ui-anchors');
}

const SCENES = Object.freeze({
  MAIN_MENU: 'main-menu',
  GAMEPLAY: 'gameplay',
  PAUSED: 'paused',
  STORE: 'store',
  GAME_OVER: 'game-over'
});

const MONETIZATION_ALLOWED_SCENES = new Set([
  SCENES.MAIN_MENU,
  SCENES.PAUSED,
  SCENES.STORE
]);

const STORE_VISIBLE_SCENES = new Set([SCENES.STORE]);
const MAX_LIVES = 5;
const MAX_REGEN_STACKS = 2;
const REGEN_INTERVAL_SECONDS = 75;
const REGEN_STACK_INTERVAL_REDUCTION = 15;
const PADDLE_Y_RATIO = 0.85;
const PADDLE_SAFE_MARGIN = 24;
const POWERUP_DROP_CHANCE = 0.22;
const SCORE_BOOST_DURATION_SECONDS = 10;
const SHOOTER_TRACKS = ['California Love', 'Money 2x', 'Headlines', 'Goat'];

let currentScene = SCENES.MAIN_MENU;
let storeReturnScene = SCENES.MAIN_MENU;
let paypalButtonsRendered = false;
let paypalSdkPromise = null;

// Setup audio
const savedTrack = localStorage.getItem('currentSong');
const savedTrackIndex = Number.parseInt(localStorage.getItem('songIndex'), 10);
const selectedTrack = SHOOTER_TRACKS.includes(savedTrack)
  ? savedTrack
  : SHOOTER_TRACKS[savedTrackIndex] || 'Goat';
bgMusic.src = `../music/${selectedTrack}.mp3`;
bgMusic.volume = 0.3;

function getViewportCanvasSize() {
  const fullscreen = !!document.fullscreenElement;
  const width = fullscreen ? window.innerWidth : Math.min(Math.max(window.innerWidth - 32, 360), 1680);
  const height = fullscreen ? window.innerHeight : Math.min(Math.max(window.innerHeight - 170, 430), 980);
  return { width, height };
}

function getPaddleY(height, paddleHeight) {
  const preferredY = height * PADDLE_Y_RATIO;
  const maxY = height - paddleHeight - PADDLE_SAFE_MARGIN;
  return Math.max(PADDLE_SAFE_MARGIN, Math.min(preferredY, maxY));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function isGameplayActive() {
  return currentScene === SCENES.GAMEPLAY && running;
}

function canUseMonetization(scene = currentScene) {
  return MONETIZATION_ALLOWED_SCENES.has(scene) && !debugFlags.disableMonetizationSpawns;
}

function canRenderStore(scene = currentScene) {
  return STORE_VISIBLE_SCENES.has(scene);
}

function guardMonetization(actionName) {
  if (canUseMonetization()) return true;
  if (IS_DEV_BUILD) {
    console.warn(`Blocked monetization action "${actionName}" in scene "${currentScene}".`);
  }
  return false;
}

function enforceMonetizationRestrictions() {
  const storeVisible = canRenderStore();
  const premiumVisible = storeVisible && canUseMonetization();

  if (storeScreenEl) storeScreenEl.classList.toggle('hidden', !storeVisible);
  if (upgradeShopEl) upgradeShopEl.hidden = !storeVisible;
  if (premiumShopEl) premiumShopEl.hidden = !premiumVisible;

  document.body.classList.toggle('monetization-allowed', canUseMonetization());
}

function setScene(scene) {
  currentScene = scene;
  Object.values(SCENES).forEach(value => {
    document.body.classList.toggle(`scene-${value}`, value === scene);
  });
  document.body.dataset.scene = scene;

  if (mainMenuEl) mainMenuEl.classList.toggle('hidden', scene !== SCENES.MAIN_MENU);
  if (pauseMenuEl) pauseMenuEl.classList.toggle('hidden', scene !== SCENES.PAUSED);
  if (gameOverOverlay) gameOverOverlay.classList.toggle('hidden', scene !== SCENES.GAME_OVER);

  enforceMonetizationRestrictions();
  updateShop();
  updateStatusLabels();
}

let W = getViewportCanvasSize().width;
let H = getViewportCanvasSize().height;
canvas.width = W;
canvas.height = H;

const player = {
  x: W / 2 - 28,
  y: getPaddleY(H, 18),
  w: 56,
  h: 18,
  speed: 9,
  lives: 3,
  invincible: false,
  invincibilityTimer: 0,
  doubleShot: false,
  megaShot: false,
  shieldActive: false,
  rapidFire: false,
  creditBoost: false,
  homingShot: false,
  laserBeam: false,
  regen: false,
  regenStacks: 0,
  armor: 0,
  creditRain: false,
  regenTimer: 0,
  fireCooldown: 0,
  scoreMultiplier: 1,
  scoreBoostTimer: 0
};

let left = false;
let right = false;

const bullets = [];
const enemyBullets = [];
const enemies = [];
const particles = [];
const powerups = [];
const shockwaves = [];
const floatingTexts = [];
const comets = [];
const portals = [];
const stars = [];
let spawnTimer = 0;
let score = 0;
let credits = 0;
let bombs = 1;
let stage = 1;
let stageKills = 0;
let combo = 1;
let comboTimer = 0;
let running = false;
let ticks = 0;
let visualTicks = 0;
let audioCtx = null;
let musicSource = null;
let musicAnalyser = null;
let musicFrequencyData = null;
let musicWaveData = null;
let beatCooldown = 0;
let lastBeatAt = 0;
let screenShake = 0;

const musicSync = {
  trackName: selectedTrack,
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  pulse: 0,
  beat: false,
  beatAge: 999,
  beatCount: 0
};

function setShooterTrack(track, options = {}) {
  const nextTrack = SHOOTER_TRACKS.includes(track) ? track : selectedTrack;
  if (musicSync.trackName === nextTrack) return;

  const shouldResume = options.restart || (musicStarted && !bgMusic.paused);
  musicSync.trackName = nextTrack;
  bgMusic.src = `../music/${nextTrack}.mp3`;
  localStorage.setItem('currentSong', nextTrack);

  if (shouldResume) {
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => {});
    musicStarted = true;
  }

  if (messageEl) {
    messageEl.textContent = `Phonograph linked: ${nextTrack}`;
  }
}

function setShooterEra(era) {
  const nextEra = ['past', 'present', 'future'].includes(era) ? era : 'past';
  document.body.dataset.era = nextEra;
}

window.addEventListener('message', event => {
  if (window.parent !== window && event.source !== window.parent) return;
  const payload = event.data;
  if (!payload || typeof payload !== 'object') return;
  if (payload.type === 'music-track-change') {
    setShooterTrack(payload.track, { restart: musicStarted });
  }
  if (payload.type === 'era-change') {
    setShooterEra(payload.era);
  }
});

setShooterEra('past');

const powerupCooldownUntil = {
  regen: 0,
  score2x: 0,
  creditcache: 0,
  bomb: 0
};

const powerupSpawnStats = {
  rolls: 0,
  drops: 0,
  skippedByChance: 0,
  skippedByCooldown: 0,
  skippedAtMaxHealth: 0,
  byType: {}
};

const powerupDefinitions = [
  {
    type: 'creditcache',
    weight: 6,
    color: '#f1c40f',
    cooldownSeconds: [12, 24],
    canSpawn: () => true
  },
  {
    type: 'bomb',
    weight: 3,
    color: '#7c3aed',
    cooldownSeconds: [20, 36],
    canSpawn: () => true
  },
  {
    type: 'score2x',
    weight: 1,
    color: '#e74c3c',
    cooldownSeconds: [30, 60],
    canSpawn: () => true
  },
  {
    type: 'regen',
    weight: 1,
    color: '#2ecc71',
    cooldownSeconds: [45, 90],
    canSpawn: () => player.lives < MAX_LIVES
  }
];

function resizeGame() {
  const previousCenterRatio = W ? (player.x + player.w / 2) / W : 0.5;
  const nextSize = getViewportCanvasSize();
  W = nextSize.width;
  H = nextSize.height;
  canvas.width = W;
  canvas.height = H;

  player.x = clamp(W * previousCenterRatio - player.w / 2, 0, W - player.w);
  player.y = getPaddleY(H, player.h);

  stars.forEach(star => {
    if (star.x > W) star.x = Math.random() * W;
    if (star.y > H) star.y = Math.random() * H;
  });
}

// Difficulty settings
let difficulty = localStorage.getItem('gameDifficulty') || 'normal';
const difficultySettings = {
  easy: { spawnSpeedMult: 0.6, enemyHealthMult: 0.7, creditMult: 0.9 },
  normal: { spawnSpeedMult: 1.0, enemyHealthMult: 1.0, creditMult: 0.75 },
  hard: { spawnSpeedMult: 1.5, enemyHealthMult: 1.3, creditMult: 0.8 }
};

// Leaderboard
let leaderboard = JSON.parse(localStorage.getItem('shooterLeaderboard')) || [];

function applyRegenUpgrade() {
  player.regenStacks = Math.min(player.regenStacks + 1, MAX_REGEN_STACKS);
  player.regen = player.regenStacks > 0;
  player.regenTimer = 0;
}

const shopItems = [
  { id: 'speed', name: 'Turbo Thrusters', cost: 1200, description: '+2 speed', maxPurchases: 3, apply: () => player.speed += 2 },
  { id: 'double', name: 'Double Shot', cost: 1800, description: 'Fire 2 bullets', maxPurchases: 1, apply: () => player.doubleShot = true },
  { id: 'rapid', name: 'Rapid Fire', cost: 2600, description: 'Faster firing rate', maxPurchases: 1, apply: () => player.rapidFire = true },
  { id: 'shield', name: 'Shield Boost', cost: 3200, description: 'Invincible 5s', apply: () => activateShield() },
  { id: 'life', name: 'Extra Life', cost: 3600, description: '+1 life up to 5', apply: () => player.lives = Math.min(player.lives + 1, MAX_LIVES) },
  { id: 'credit', name: 'Credit Magnet', cost: 4200, description: '+15% credits', maxPurchases: 1, apply: () => player.creditBoost = true },
  { id: 'homing', name: 'Homing Missile', cost: 5200, description: 'Bullets track enemies', maxPurchases: 1, apply: () => player.homingShot = true },
  { id: 'laser', name: 'Laser Beam', cost: 7200, description: 'Piercing beam bullets', maxPurchases: 1, apply: () => player.laserBeam = true },
  { id: 'regen', name: 'Regenerator', cost: 6400, description: 'Slow life recovery', maxPurchases: MAX_REGEN_STACKS, apply: applyRegenUpgrade },
  { id: 'armor', name: 'Armor Plating', cost: 6800, description: 'Absorb 1 hit', maxPurchases: 3, apply: () => player.armor += 1 },
  { id: 'creditstorm', name: 'Credit Storm', cost: 7600, description: '+2 credits per kill', maxPurchases: 1, apply: () => player.creditRain = true },
  { id: 'bomb', name: 'Extra Bomb', cost: 2800, description: 'Clears the screen', apply: () => bombs += 1 },
  { id: 'mega', name: 'Mega Shot', cost: 6000, description: 'Powerful boosted shot', maxPurchases: 1, apply: () => player.megaShot = true }
].map(item => ({ ...item, baseCost: item.cost, purchases: 0 }));

for (let i = 0; i < 140; i++) {
  stars.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 1.2, speed: 0.2 + Math.random() * 0.8 });
}

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  setupMusicSync();
}

function startMusic() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  setupMusicSync();
  if (!musicStarted) {
    bgMusic.play().catch(() => {});
    musicStarted = true;
  }
}

function setupMusicSync() {
  if (!audioCtx || musicAnalyser) return;
  try {
    musicSource = audioCtx.createMediaElementSource(bgMusic);
    musicAnalyser = audioCtx.createAnalyser();
    musicAnalyser.fftSize = 256;
    musicAnalyser.smoothingTimeConstant = 0.72;
    musicFrequencyData = new Uint8Array(musicAnalyser.frequencyBinCount);
    musicWaveData = new Uint8Array(musicAnalyser.fftSize);
    musicSource.connect(musicAnalyser);
    musicAnalyser.connect(audioCtx.destination);
  } catch (error) {
    console.warn('Phonograph sync unavailable', error);
    musicAnalyser = null;
  }
}

function averageFrequency(start, end) {
  if (!musicFrequencyData) return 0;
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(musicFrequencyData.length, end);
  let total = 0;
  for (let i = safeStart; i < safeEnd; i++) total += musicFrequencyData[i];
  return safeEnd > safeStart ? total / ((safeEnd - safeStart) * 255) : 0;
}

function updateMusicSync() {
  musicSync.beat = false;
  musicSync.beatAge += 1;
  musicSync.pulse *= 0.86;
  if (beatCooldown > 0) beatCooldown -= 1;

  if (!musicAnalyser) {
    const idlePulse = 0.35 + Math.sin(visualTicks * 0.035) * 0.18;
    musicSync.bass += (idlePulse - musicSync.bass) * 0.06;
    musicSync.mid += (0.28 - musicSync.mid) * 0.04;
    musicSync.treble += (0.22 - musicSync.treble) * 0.04;
    musicSync.energy = (musicSync.bass + musicSync.mid + musicSync.treble) / 3;
    return;
  }

  musicAnalyser.getByteFrequencyData(musicFrequencyData);
  musicAnalyser.getByteTimeDomainData(musicWaveData);

  const bass = averageFrequency(1, 8);
  const mid = averageFrequency(8, 28);
  const treble = averageFrequency(28, 84);
  musicSync.bass += (bass - musicSync.bass) * 0.28;
  musicSync.mid += (mid - musicSync.mid) * 0.18;
  musicSync.treble += (treble - musicSync.treble) * 0.18;
  musicSync.energy = musicSync.bass * 0.5 + musicSync.mid * 0.3 + musicSync.treble * 0.2;

  const now = performance.now();
  const bassHit = bass > 0.42 && bass > musicSync.bass * 1.28;
  if (bassHit && beatCooldown <= 0 && now - lastBeatAt > 180) {
    musicSync.beat = true;
    musicSync.beatAge = 0;
    musicSync.beatCount += 1;
    musicSync.pulse = 1;
    beatCooldown = 9;
    lastBeatAt = now;
    if (isGameplayActive()) {
      spawnShockwave(player.x + player.w / 2, player.y + player.h / 2, '#64ddf7', 46 + musicSync.bass * 74);
      if (musicSync.beatCount % 4 === 0) {
        spawnFloatingText(player.x + player.w / 2, player.y - 16, 'ON BEAT', '#64ddf7');
      }
    }
  }
}

function playTone(freq, duration, type = 'sine', volume = 0.2) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playEffect(type) {
  if (!audioCtx) return;
  if (type === 'shoot') playTone(900, 0.06, 'square', 0.08);
  if (type === 'hit') playTone(300, 0.12, 'sawtooth', 0.15);
  if (type === 'explode') playTone(180, 0.18, 'triangle', 0.18);
  if (type === 'buy') playTone(1200, 0.08, 'triangle', 0.1);
  if (type === 'damage') playTone(150, 0.2, 'square', 0.18);
}

function activateShield() {
  player.invincible = true;
  player.invincibilityTimer = 300;
  player.shieldActive = true;
  playEffect('buy');
}

function spawnPortal(x, y, size, color) {
  portals.push({
    x,
    y,
    size,
    color,
    rot: Math.random() * Math.PI * 2,
    life: 42,
    maxLife: 42
  });
}

function spawnEnemy() {
  if (!isGameplayActive()) return;
  const roll = Math.random();
  const small = roll < 0.55;
  const medium = roll >= 0.55 && roll < 0.88;
  const large = roll >= 0.88;
  const size = small ? 30 : medium ? 48 : 68;
  const speed = small ? 2.6 : medium ? 1.8 : 1.05;
  const color = small ? '#ff4c6d' : medium ? '#ffb93c' : '#8b5cf6';
  const baseHealth = small ? 1 : medium ? 2 : 3;
  const settings = difficultySettings[difficulty];
  const health = Math.ceil(baseHealth * settings.enemyHealthMult);
  const type = large ? 2 : medium ? 1 : 0;
  const x = Math.random() * (W - size);
  spawnPortal(x + size / 2, 4, size * 1.15, color);
  enemies.push({
    x,
    y: -size,
    w: size,
    h: size,
    speed,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.02,
    color,
    health,
    type,
    shootCooldown: 95 + Math.random() * 80 - stage * 2,
    shootInterval: type === 2 ? 115 : type === 1 ? 140 : 170,
    chargeTimer: 0,
    maxChargeTimer: 0
  });
}
function randomRange([min, max]) {
  return min + Math.random() * (max - min);
}

function chooseWeightedPowerup(candidates) {
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

function spawnPowerup(x, y) {
  if (!isGameplayActive()) return;

  powerupSpawnStats.rolls += 1;
  if (Math.random() > POWERUP_DROP_CHANCE) {
    powerupSpawnStats.skippedByChance += 1;
    return;
  }

  const now = performance.now();
  const candidates = powerupDefinitions.filter(definition => {
    if (!definition.canSpawn()) {
      if (definition.type === 'regen') powerupSpawnStats.skippedAtMaxHealth += 1;
      return false;
    }
    return (powerupCooldownUntil[definition.type] || 0) <= now;
  });

  if (!candidates.length) {
    powerupSpawnStats.skippedByCooldown += 1;
    return;
  }

  const definition = chooseWeightedPowerup(candidates);
  powerupCooldownUntil[definition.type] = now + randomRange(definition.cooldownSeconds) * 1000;
  powerupSpawnStats.drops += 1;
  powerupSpawnStats.byType[definition.type] = (powerupSpawnStats.byType[definition.type] || 0) + 1;

  powerups.push({
    x, y,
    w: 20,
    h: 20,
    type: definition.type,
    color: definition.color,
    vy: 2,
    life: 300,
    rotation: 0
  });
}

function maybeLogPowerupStats() {
  if (!debugFlags.showPowerUpSpawnRates || ticks === 0 || ticks % 600 !== 0) return;
  const dropRate = powerupSpawnStats.rolls
    ? `${((powerupSpawnStats.drops / powerupSpawnStats.rolls) * 100).toFixed(1)}%`
    : '0%';
  console.table({
    rolls: powerupSpawnStats.rolls,
    drops: powerupSpawnStats.drops,
    dropRate,
    skippedByChance: powerupSpawnStats.skippedByChance,
    skippedByCooldown: powerupSpawnStats.skippedByCooldown,
    skippedAtMaxHealth: powerupSpawnStats.skippedAtMaxHealth,
    ...powerupSpawnStats.byType
  });
}

function spawnExplosion(x, y, color) {
  for (let i = 0; i < 28; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 5;
    const life = 50 + Math.random() * 40;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: 2 + Math.random() * 3.5,
      color,
      glow: true
    });
  }
}

function spawnShockwave(x, y, color = '#64ddf7', radius = 120) {
  shockwaves.push({
    x,
    y,
    r: 4,
    maxR: radius,
    life: 34,
    maxLife: 34,
    color
  });
}

function spawnFloatingText(x, y, text, color = '#dff8ff') {
  floatingTexts.push({
    x,
    y,
    text,
    color,
    vy: -0.55,
    life: 68,
    maxLife: 68
  });
}

function spawnMuzzleBurst(x, y, direction = -Math.PI / 2, primaryColor = '#fff7c2') {
  for (let i = 0; i < 10; i++) {
    const angle = direction + (Math.random() - 0.5) * 0.7;
    const speed = 1.4 + Math.random() * 3.2;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 18 + Math.random() * 12,
      maxLife: 30,
      size: 1.4 + Math.random() * 2,
      color: Math.random() > 0.45 ? primaryColor : '#64ddf7',
      glow: true
    });
  }
}

function spawnEnemyShot(enemy, angleOffset = 0, speedBoost = 0) {
  if (enemyBullets.length > 54) return;
  const startX = enemy.x + enemy.w / 2;
  const startY = enemy.y + enemy.h + 3;
  const targetX = player.x + player.w / 2;
  const targetY = player.y + player.h / 2;
  const angle = Math.atan2(targetY - startY, targetX - startX) + angleOffset;
  const speed = 2.5 + Math.min(1.4, stage * 0.05) + enemy.type * 0.28 + speedBoost;
  enemyBullets.push({
    x: startX,
    y: startY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: enemy.type === 2 ? 5.5 : 4.5,
    color: enemy.type === 2 ? '#ff4c6d' : enemy.type === 1 ? '#ffb93c' : '#64ddf7',
    life: 240,
    trail: [],
    phase: Math.random() * Math.PI * 2,
    wobble: enemy.type === 2 ? 0.05 : 0.02
  });
}

function fireEnemyWeapon(enemy) {
  if (!isGameplayActive()) return;
  if (enemy.type === 2) {
    spawnEnemyShot(enemy, -0.24, 0.15);
    spawnEnemyShot(enemy, 0, 0.25);
    spawnEnemyShot(enemy, 0.24, 0.15);
  } else if (enemy.type === 1) {
    spawnEnemyShot(enemy, -0.11);
    spawnEnemyShot(enemy, 0.11);
  } else {
    spawnEnemyShot(enemy);
  }
  spawnMuzzleBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h + 4, Math.PI / 2, enemy.color);
  spawnFloatingText(enemy.x + enemy.w / 2, enemy.y + enemy.h + 16, 'FIRE', enemy.color);
}
function damagePlayer(hitColor = '#ff4c6d') {
  if (player.invincible) return false;
  if (player.armor > 0) {
    player.armor -= 1;
    messageEl.textContent = 'Armor absorbed the hit.';
    showFullscreenMessage('Armor blocked it', 'health');
    spawnShockwave(player.x + player.w / 2, player.y + player.h / 2, '#64ddf7', 80);
  } else {
    player.lives -= 1;
    player.invincible = true;
    player.invincibilityTimer = 140;
  }
  playEffect('damage');
  spawnExplosion(player.x + player.w / 2, player.y + player.h / 2, hitColor);
  screenShake = 9;
  if (player.lives <= 0) {
    bgMusic.pause();
    messageEl.textContent = 'Game over. Use earned credits to continue.';
    showGameOver();
  }
  return true;
}

function addShopItems() {
  shopItemsEl.innerHTML = shopItems.map(item =>
    `<div class="shop-item" id="shop-${item.id}">
      <div>
        <strong>${item.name}</strong>
        <small>${item.description}</small>
      </div>
      <span>
        <button data-id="${item.id}">${item.cost}</button>
      </span>
    </div>`
  ).join('');
}

function isShopItemMaxed(item) {
  if (item.maxPurchases && item.purchases >= item.maxPurchases) return true;
  if (item.id === 'life' && player.lives >= MAX_LIVES) return true;
  if (item.id === 'regen' && player.regenStacks >= MAX_REGEN_STACKS) return true;
  return false;
}

function updateShop() {
  shopItems.forEach(item => {
    const btn = document.querySelector(`#shop-${item.id} button`);
    if (!btn) return;
    const maxed = isShopItemMaxed(item);
    btn.disabled = currentScene !== SCENES.STORE || credits < item.cost || maxed;
    btn.textContent = maxed ? 'MAX' : item.cost;
  });
}

function showFullscreenMessage(text, type) {
  fsMessageEl.textContent = text;
  fsMessageEl.className = 'fs-message active ' + type;
  setTimeout(() => {
    fsMessageEl.classList.remove('active');
  }, 1400);
}

function updateStatusLabels() {
  stageEl.textContent = `Stage ${stage}`;
  comboEl.textContent = `Combo x${combo}`;
  bombCountEl.textContent = `Bombs: ${bombs}`;
  if (bombBtn) {
    bombBtn.textContent = `BOMB x${bombs}`;
    bombBtn.disabled = bombs <= 0 || !isGameplayActive();
  }
  if (pauseBtn) {
    pauseBtn.disabled = currentScene !== SCENES.GAMEPLAY;
  }
}

function advanceStage() {
  stage += 1;
  stageKills = 0;
  messageEl.textContent = `Stage ${stage} begins!`;
  showFullscreenMessage(`Stage ${stage}`, 'score');
  spawnShockwave(W / 2, H * 0.35, '#e74c3c', Math.min(W, H) * 0.48);
  spawnFloatingText(W / 2, H * 0.26, `STAGE ${stage}`, '#ffecb3');
  playEffect('buy');
}

function purchaseCredits(amount) {
  if (!guardMonetization('purchaseCredits')) return false;
  credits += amount;
  messageEl.textContent = `Store pack added ${amount} credits.`;
  showFullscreenMessage(`+${amount} Credits`, 'credit');
  playEffect('buy');
  updateShop();
  return true;
}

function useBomb() {
  if (bombs <= 0 || !isGameplayActive()) return;
  bombs -= 1;
  enemies.forEach(e => spawnExplosion(e.x + e.w / 2, e.y + e.h / 2, '#f1c40f'));
  enemies.length = 0;
  enemyBullets.length = 0;
  screenShake = 18;
  spawnShockwave(W / 2, H / 2, '#f1c40f', Math.max(W, H) * 0.72);
  messageEl.textContent = 'Bomb unleashed!';
  showFullscreenMessage('Bomb blast', 'health');
  playEffect('explode');
}

function showGameOver() {
  finalScoreEl.textContent = score;
  earnedCreditsEl.textContent = credits;
  const continueCost = 750;
  continueBtn.disabled = credits < continueCost;
  continueBtn.textContent = `Continue for ${continueCost} Credits${credits < continueCost ? ' (Not enough)' : ''}`;
  running = false;
  setScene(SCENES.GAME_OVER);
  playEffect('damage');
}

function continueGame() {
  const continueCost = 750;
  if (credits < continueCost) return;
  credits -= continueCost;
  player.lives = 2;
  player.invincible = true;
  player.invincibilityTimer = 240;
  enemies.length = 0;
  bullets.length = 0;
  enemyBullets.length = 0;
  powerups.length = 0;
  portals.length = 0;
  running = true;
  setScene(SCENES.GAMEPLAY);
  messageEl.textContent = 'Respawned. Keep fighting!';
  startMusic();
  playEffect('buy');
}

function restartGame() {
  location.reload();
}

function buyItem(id) {
  if (currentScene !== SCENES.STORE) return;
  const item = shopItems.find(i => i.id === id);
  if (!item || credits < item.cost || isShopItemMaxed(item)) return;
  credits -= item.cost;
  item.apply();
  item.purchases += 1;
  if (!isShopItemMaxed(item)) {
    item.cost = Math.min(Math.ceil(item.cost * 1.35 + 250), 20000);
  }
  messageEl.textContent = `${item.name} purchased.`;
  playEffect('buy');
  if (item.id === 'shield') messageEl.textContent = 'Shield activated for 5 seconds.';
  updateShop();
}

function awardKillCredits(enemyType) {
  const settings = difficultySettings[difficulty];
  const baseReward = enemyType === 2 ? 12 : enemyType === 1 ? 7 : 4;
  const creditMultiplier = player.creditBoost ? 1.15 : 1;
  const reward = Math.max(1, Math.floor(baseReward * settings.creditMult * creditMultiplier));
  credits += reward;
  if (player.creditRain) credits += 2;
}

function updateRegen() {
  if (!player.regen || player.regenStacks <= 0) return;

  if (player.lives >= MAX_LIVES) {
    player.regenTimer = 0;
    return;
  }

  player.regenTimer += 1 / 60;
  const interval = REGEN_INTERVAL_SECONDS - (player.regenStacks - 1) * REGEN_STACK_INTERVAL_REDUCTION;
  if (player.regenTimer >= interval) {
    player.lives = Math.min(player.lives + 1, MAX_LIVES);
    player.regenTimer = 0;
    showFullscreenMessage('Life regenerated', 'health');
  }
}

function updateScoreBoost() {
  if (player.scoreBoostTimer <= 0) {
    player.scoreMultiplier = 1;
    return;
  }

  player.scoreBoostTimer -= 1 / 60;
  if (player.scoreBoostTimer <= 0) {
    player.scoreMultiplier = 1;
    messageEl.textContent = 'Score boost ended.';
  }
}

function updateAtmosphere() {
  const drift = (isGameplayActive() ? 1 : 0.35) + musicSync.energy * 0.55;
  stars.forEach(s => {
    s.y += s.speed * drift;
    s.x += Math.sin((visualTicks + s.y) * 0.006) * 0.08 * drift;
    if (s.y > H + 8) {
      s.y = -8;
      s.x = Math.random() * W;
    }
    if (s.x < -8) s.x = W + 8;
    if (s.x > W + 8) s.x = -8;
  });

  if (Math.random() < (isGameplayActive() ? 0.014 + musicSync.treble * 0.024 : 0.006 + musicSync.treble * 0.008)) {
    comets.push({
      x: Math.random() * W,
      y: -40,
      vx: -2.2 - Math.random() * 2.4 - musicSync.energy * 1.2,
      vy: 4.4 + Math.random() * 3 + musicSync.bass * 2,
      life: 70 + musicSync.energy * 18,
      maxLife: 88,
      color: Math.random() > 0.45 ? '#64ddf7' : '#ffecb3'
    });
  }

  for (let i = comets.length - 1; i >= 0; i--) {
    const comet = comets[i];
    comet.x += comet.vx;
    comet.y += comet.vy;
    comet.life -= 1;
    if (comet.life <= 0 || comet.y > H + 80 || comet.x < -120) comets.splice(i, 1);
  }
}

function update() {
  if (!isGameplayActive()) return;
  ticks += 1;
  if (comboTimer > 0) {
    comboTimer -= 1;
  } else {
    combo = 1;
  }
  if (left) player.x -= player.speed;
  if (right) player.x += player.speed;
  player.x = clamp(player.x, 0, W - player.w);
  player.y = getPaddleY(H, player.h);
  if (ticks % 2 === 0) {
    particles.push({
      x: player.x + player.w / 2 + (Math.random() - 0.5) * player.w * 0.7,
      y: player.y + player.h + 2,
      vx: (Math.random() - 0.5) * 0.7,
      vy: 1.8 + Math.random() * 1.8,
      life: 20,
      maxLife: 20,
      size: 1.5 + Math.random() * 2.5,
      color: Math.random() > 0.35 ? '#64ddf7' : '#17c3b2',
      glow: true
    });
  }
  if (player.invincible) {
    player.invincibilityTimer -= 1;
    if (player.invincibilityTimer <= 0) {
      player.invincible = false;
      player.shieldActive = false;
    }
  }
  if (player.fireCooldown > 0) player.fireCooldown -= 1;
  updateRegen();
  updateScoreBoost();

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.homing && enemies.length) {
      let closest = null;
      let bestDist = Infinity;
      enemies.forEach(e => {
        const dx = e.x + e.w / 2 - b.x;
        const dy = e.y + e.h / 2 - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          closest = { dx, dy };
        }
      });
      if (closest) {
        b.x += Math.sign(closest.dx) * Math.min(2, Math.abs(closest.dx) * 0.08);
      }
    }
    b.y -= b.speed;
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 8) b.trail.shift();
    if (b.y < -10) bullets.splice(i, 1);
  }

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    b.phase += b.wobble;
    b.x += b.vx + Math.sin(b.phase) * b.wobble * 10;
    b.y += b.vy;
    b.life -= 1;
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 10) b.trail.shift();
    const hitPlayer =
      b.x + b.r > player.x &&
      b.x - b.r < player.x + player.w &&
      b.y + b.r > player.y &&
      b.y - b.r < player.y + player.h;
    if (hitPlayer) {
      enemyBullets.splice(i, 1);
      damagePlayer(b.color);
    } else if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
      enemyBullets.splice(i, 1);
    }
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.y += e.speed;
    e.rot += e.rotSpeed;
    if (e.chargeTimer > 0) {
      e.chargeTimer -= 1;
      if (e.chargeTimer <= 0) fireEnemyWeapon(e);
    } else if (e.y > 24 && e.y < player.y - 88 && enemyBullets.length < 48) {
      e.shootCooldown -= 1 + musicSync.energy * 0.18;
      if (e.shootCooldown <= 0) {
        e.maxChargeTimer = 34;
        e.chargeTimer = e.maxChargeTimer;
        e.shootCooldown = Math.max(72, e.shootInterval - Math.min(42, stage * 3)) + Math.random() * 65;
        spawnShockwave(e.x + e.w / 2, e.y + e.h / 2, e.color, e.w * 0.82);
      }
    }
    if (e.y > H) { enemies.splice(i, 1); continue; }
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
        e.health -= b.damage;
        if (!b.laser) bullets.splice(j, 1);
        playEffect('hit');
        if (e.health <= 0) {
          spawnExplosion(e.x + e.w / 2, e.y + e.h / 2, e.color);
          const bonus = combo * (e.type === 2 ? 40 : e.type === 1 ? 25 : 15);
          score += Math.floor(bonus * player.scoreMultiplier);
          awardKillCredits(e.type);
          spawnFloatingText(e.x + e.w / 2, e.y, `+${Math.floor(bonus * player.scoreMultiplier)}`, player.scoreMultiplier > 1 ? '#ffecb3' : '#dff8ff');
          stageKills += 1;
          combo += 1;
          comboTimer = 120;
          if (combo > 4 && combo % 5 === 0) {
            spawnFloatingText(e.x + e.w / 2, e.y + e.h / 2, `COMBO x${combo}`, '#64ddf7');
          }
          if (stageKills >= 8 + stage * 3) {
            advanceStage();
          }
          enemies.splice(i, 1);
          playEffect('explode');
          spawnPowerup(e.x + e.w / 2, e.y + e.h / 2);
        }
        if (!b.laser) break;
      }
    }
    if (!player.invincible && e.y + e.h > player.y && e.x < player.x + player.w && e.x + e.w > player.x) {
      damagePlayer(e.color);
      enemies.splice(i, 1);
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.y += p.vy;
    p.rotation += 0.08;
    p.life -= 1;
    if (p.y > H) powerups.splice(i, 1);
    else if (p.x > player.x && p.x < player.x + player.w && p.y > player.y && p.y < player.y + player.h) {
      if (p.type === 'regen') {
        if (player.lives < MAX_LIVES) {
          player.lives = Math.min(player.lives + 1, MAX_LIVES);
          messageEl.textContent = 'Life restored.';
          showFullscreenMessage('Life restored', 'health');
          spawnFloatingText(p.x, p.y, '+LIFE', '#2ecc71');
          playEffect('buy');
        }
      } else if (p.type === 'creditcache') {
        credits += 75;
        messageEl.textContent = 'Credit cache collected.';
        showFullscreenMessage('+75 Credits', 'credit');
        spawnFloatingText(p.x, p.y, '+75', '#f1c40f');
        playEffect('buy');
      } else if (p.type === 'score2x') {
        player.scoreMultiplier = 2;
        player.scoreBoostTimer = SCORE_BOOST_DURATION_SECONDS;
        messageEl.textContent = 'Score boost active.';
        showFullscreenMessage('2x score boost', 'score');
        spawnFloatingText(p.x, p.y, '2x SCORE', '#e74c3c');
        playEffect('buy');
      } else if (p.type === 'bomb') {
        bombs += 1;
        messageEl.textContent = 'Bomb collected.';
        showFullscreenMessage('Bomb +1', 'health');
        spawnFloatingText(p.x, p.y, 'BOMB +1', '#bfa7ff');
        playEffect('buy');
      }
      spawnExplosion(p.x, p.y, p.color);
      powerups.splice(i, 1);
    } else if (p.life <= 0) {
      powerups.splice(i, 1);
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05;
    p.vx *= 0.99;
    p.life -= 1;
    if (p.life <= 0) particles.splice(i, 1);
  }

  for (let i = portals.length - 1; i >= 0; i--) {
    const portal = portals[i];
    portal.rot += 0.08 + musicSync.energy * 0.04;
    portal.life -= 1;
    if (portal.life <= 0) portals.splice(i, 1);
  }

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const wave = shockwaves[i];
    wave.r += (wave.maxR - wave.r) * 0.12;
    wave.life -= 1;
    if (wave.life <= 0) shockwaves.splice(i, 1);
  }

  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const text = floatingTexts[i];
    text.y += text.vy;
    text.life -= 1;
    if (text.life <= 0) floatingTexts.splice(i, 1);
  }

  const stageBonus = Math.min(0.15, stage * 0.015);
  if (spawnTimer > 0.45 - Math.min(0.2, score / 3000) - stageBonus) {
    spawnEnemy();
    spawnTimer = 0;
  }
  spawnTimer += 1 / 60;

  scoreEl.textContent = 'Score: ' + score;
  livesEl.textContent = `Lives: ${player.lives}`;
  creditsEl.textContent = `Credits: ${credits}`;
  fsLivesEl.textContent = `Lives: ${player.lives}`;
  fsScoreEl.textContent = `Score: ${score}`;
  fsCreditsEl.textContent = `Credits: ${credits}`;
  updateStatusLabels();
  updateShop();
  maybeLogPowerupStats();
}

function drawAnchors() {
  if (!debugFlags.showUIAnchors) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(23,195,178,0.9)';
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(0, getPaddleY(H, player.h));
  ctx.lineTo(W, getPaddleY(H, player.h));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,183,3,0.75)';
  ctx.strokeRect(PADDLE_SAFE_MARGIN, PADDLE_SAFE_MARGIN, W - PADDLE_SAFE_MARGIN * 2, H - PADDLE_SAFE_MARGIN * 2);
  ctx.restore();
}

function drawShip() {
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (player.invincible) {
    ctx.shadowColor = '#7bf1ff';
    ctx.shadowBlur = 20;
  }
  const shipGrad = ctx.createLinearGradient(0, -player.h * 1.2, 0, player.h * 1.4);
  shipGrad.addColorStop(0, '#e9fbff');
  shipGrad.addColorStop(0.45, '#64ddf7');
  shipGrad.addColorStop(1, '#0288d1');
  ctx.fillStyle = shipGrad;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(28, 12);
  ctx.lineTo(11, 9);
  ctx.lineTo(0, 17);
  ctx.lineTo(-11, 9);
  ctx.lineTo(-28, 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#081525';
  ctx.beginPath();
  ctx.ellipse(0, -3, 7, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(0, -5, 3, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const flame = 10 + Math.sin(visualTicks * 0.32) * 4 + musicSync.bass * 18 + musicSync.pulse * 10;
  ctx.shadowColor = '#17c3b2';
  ctx.shadowBlur = 18 + musicSync.pulse * 18;
  ctx.fillStyle = `rgba(23,195,178,${0.65 + musicSync.energy * 0.3})`;
  ctx.beginPath();
  ctx.moveTo(-8, 13);
  ctx.lineTo(0, 13 + flame);
  ctx.lineTo(8, 13);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (player.shieldActive) {
    ctx.save();
    ctx.strokeStyle = 'rgba(123,241,255,0.82)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#64ddf7';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, player.w * 0.82 + Math.sin(visualTicks * 0.1) * 3 + musicSync.pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPortal(portal) {
  const alpha = Math.max(0, portal.life / portal.maxLife);
  ctx.save();
  ctx.translate(portal.x, portal.y);
  ctx.rotate(portal.rot);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = portal.color;
  ctx.lineWidth = 3;
  ctx.shadowColor = portal.color;
  ctx.shadowBlur = 22;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, portal.size * (0.32 + i * 0.13), portal.size * (0.1 + i * 0.04), i * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEnemy(e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const beatScale = 1 + musicSync.pulse * 0.04 + musicSync.mid * 0.03;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(beatScale, beatScale);
  ctx.rotate(e.rot);
  ctx.shadowColor = e.color;
  ctx.shadowBlur = 16 + musicSync.pulse * 10;
  const grad = ctx.createRadialGradient(-e.w * 0.18, -e.h * 0.22, 2, 0, 0, e.w * 0.68);
  grad.addColorStop(0, '#fff7');
  grad.addColorStop(0.22, e.color);
  grad.addColorStop(1, '#13091f');
  ctx.fillStyle = grad;
  ctx.beginPath();
  const points = e.type === 2 ? 7 : e.type === 1 ? 6 : 5;
  for (let i = 0; i < points; i++) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / points;
    const radius = (i % 2 === 0 ? 0.58 : 0.42) * e.w;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(-e.w * 0.14, -e.h * 0.08, Math.max(2, e.w * 0.07), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (e.chargeTimer > 0) {
    const chargeProgress = 1 - e.chargeTimer / Math.max(1, e.maxChargeTimer);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = e.color;
    ctx.globalAlpha = 0.35 + chargeProgress * 0.55;
    ctx.lineWidth = 2 + chargeProgress * 3;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 20 + chargeProgress * 18;
    ctx.beginPath();
    ctx.arc(0, 0, e.w * (0.54 + chargeProgress * 0.28), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${0.18 + chargeProgress * 0.24})`;
    ctx.beginPath();
    ctx.arc(0, e.h * 0.42, 3 + chargeProgress * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemyBullet(b) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < b.trail.length; i++) {
    const t = b.trail[i];
    const alpha = (i + 1) / b.trail.length;
    ctx.fillStyle = `rgba(255,76,109,${alpha * 0.18})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, b.r * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  const pulse = 1 + Math.sin(visualTicks * 0.22 + b.phase) * 0.12 + musicSync.pulse * 0.08;
  ctx.shadowColor = b.color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawPowerup(p) {
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  ctx.rotate(p.rotation);
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const radius = i % 2 === 0 ? 13 : 7;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.rotate(-p.rotation);
  ctx.fillStyle = '#081525';
  ctx.font = '800 10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = p.type === 'regen' ? '+' : p.type === 'creditcache' ? '$' : p.type === 'score2x' ? 'x2' : 'B';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawEnergyGrid() {
  const horizon = H * 0.58;
  ctx.save();
  ctx.globalAlpha = 0.18 + musicSync.energy * 0.18;
  ctx.strokeStyle = '#64ddf7';
  ctx.lineWidth = 1;
  ctx.shadowColor = '#64ddf7';
  ctx.shadowBlur = 8 + musicSync.pulse * 12;
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const y = horizon + Math.pow(t, 1.8) * (H - horizon);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let i = -6; i <= 6; i++) {
    const x = W / 2 + i * W * 0.12;
    ctx.beginPath();
    ctx.moveTo(W / 2, horizon);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMusicVisualizer() {
  const bars = 32;
  const baseY = H - 8;
  const maxBarHeight = Math.min(86, H * 0.16);
  const barWidth = W / bars;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < bars; i++) {
    const bin = musicFrequencyData
      ? musicFrequencyData[Math.min(musicFrequencyData.length - 1, Math.floor(i * musicFrequencyData.length / bars))] / 255
      : 0.18 + Math.sin(visualTicks * 0.04 + i * 0.55) * 0.12;
    const height = 6 + bin * maxBarHeight * (0.55 + musicSync.energy * 0.7);
    const x = i * barWidth;
    const hueShift = i / bars;
    const color = hueShift < 0.33 ? '100,221,247' : hueShift < 0.66 ? '255,236,179' : '255,76,109';
    ctx.fillStyle = `rgba(${color},${0.1 + bin * 0.45})`;
    ctx.fillRect(x + 1, baseY - height, Math.max(2, barWidth - 2), height);
  }

  const beatRadius = 42 + musicSync.pulse * 44 + musicSync.bass * 22;
  ctx.strokeStyle = `rgba(100,221,247,${0.16 + musicSync.pulse * 0.45})`;
  ctx.lineWidth = 2 + musicSync.pulse * 3;
  ctx.shadowColor = '#64ddf7';
  ctx.shadowBlur = 18 + musicSync.pulse * 24;
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.18, beatRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = `rgba(233,251,255,${0.36 + musicSync.energy * 0.34})`;
  ctx.shadowBlur = 8;
  ctx.font = '800 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Phonograph linked: ${musicSync.trackName}`, W / 2, 24);
  ctx.restore();
}

function draw() {
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#020712');
  grd.addColorStop(0.48, '#071124');
  grd.addColorStop(1, '#0b1020');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  const nebula = ctx.createRadialGradient(W * 0.22, H * 0.15, 20, W * 0.22, H * 0.15, Math.max(W, H) * 0.72);
  nebula.addColorStop(0, `rgba(100,221,247,${0.08 + Math.sin(visualTicks * 0.01) * 0.02 + musicSync.energy * 0.08})`);
  nebula.addColorStop(0.42, `rgba(139,92,246,${0.06 + musicSync.bass * 0.08})`);
  nebula.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, W, H);
  
  const shaking = screenShake > 0;
  if (shaking) {
    ctx.save();
    ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    screenShake = Math.max(0, screenShake - 0.5);
  }
  stars.forEach(s => {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + musicSync.treble * 0.35 + 0.38 * Math.sin((visualTicks + s.x) * 0.01)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r + musicSync.pulse * 0.55, 0, Math.PI * 2);
    ctx.fill();
  });
  drawEnergyGrid();
  drawMusicVisualizer();
  comets.forEach(comet => {
    const alpha = Math.max(0, comet.life / comet.maxLife);
    ctx.save();
    ctx.strokeStyle = comet.color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = comet.color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(comet.x, comet.y);
    ctx.lineTo(comet.x - comet.vx * 8, comet.y - comet.vy * 8);
    ctx.stroke();
    ctx.restore();
  });

  shockwaves.forEach(wave => {
    const alpha = Math.max(0, wave.life / wave.maxLife);
    ctx.save();
    ctx.strokeStyle = wave.color;
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 3;
    ctx.shadowColor = wave.color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(wave.x, wave.y, wave.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  portals.forEach(drawPortal);
  drawShip();
  
  if (player.fireCooldown > 0 && player.fireCooldown < 3) {
    const flash = 3 - player.fireCooldown;
    ctx.fillStyle = `rgba(255, 255, 100, ${flash * 0.3})`;
    ctx.fillRect(player.x + player.w / 2 - 4, player.y - 6, 8, 6);
  }
  bullets.forEach(b => {
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      ctx.fillStyle = `rgba(255,216,107,${0.35 * (1 - i / b.trail.length)})`;
      ctx.fillRect(t.x - 2, t.y - 6, 4, 6);
    }
    if (b.mega) {
      ctx.shadowColor = 'rgba(255, 196, 83, 0.8)';
      ctx.shadowBlur = 20;
    } else if (b.synced) {
      ctx.shadowColor = 'rgba(255, 236, 179, 0.95)';
      ctx.shadowBlur = 18;
    } else {
      ctx.shadowColor = 'rgba(255, 216, 107, 0.6)';
      ctx.shadowBlur = 8;
    }
    ctx.fillStyle = b.synced ? '#ffffff' : b.mega ? '#ffecb3' : '#fff7c2';
    ctx.fillRect(b.x - (b.synced ? 3 : 2), b.y - 8, b.synced ? 6 : 4, 8);
    if (b.synced) {
      ctx.strokeStyle = 'rgba(100,221,247,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y - 5, 8 + musicSync.pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (b.mega) {
      ctx.fillStyle = 'rgba(255, 196, 83, 0.4)';
      ctx.fillRect(b.x - 8, b.y - 14, 16, 20);
      ctx.strokeStyle = 'rgba(255, 196, 83, 0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x - 8, b.y - 14, 16, 20);
    }
    ctx.shadowBlur = 0;
  });
  enemyBullets.forEach(drawEnemyBullet);
  enemies.forEach(drawEnemy);
  powerups.forEach(drawPowerup);
  particles.forEach(p => {
    const alpha = Math.max(0, p.life / (p.maxLife || 50));
    ctx.globalAlpha = alpha;
    if (p.glow) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  });
  floatingTexts.forEach(text => {
    const alpha = Math.max(0, text.life / text.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = text.color;
    ctx.shadowColor = text.color;
    ctx.shadowBlur = 10;
    ctx.font = '800 15px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text.text, text.x, text.y);
    ctx.restore();
  });

  drawAnchors();
  
  if (shaking) {
    ctx.restore();
  }
}

function loop() {
  visualTicks += 1;
  updateMusicSync();
  updateAtmosphere();
  update();
  draw();
  requestAnimationFrame(loop);
}

// Difficulty management
function changeDifficulty(newDifficulty) {
  difficulty = newDifficulty;
  localStorage.setItem('gameDifficulty', difficulty);
  messageEl.textContent = `Difficulty set to ${difficulty.toUpperCase()}`;
  showFullscreenMessage(`${difficulty.toUpperCase()} mode`, 'score');
}

// Leaderboard management
function updateLeaderboard(finalScore, finalCredits) {
  const username = localStorage.getItem('username') || 'Anonymous';
  const entry = { name: username, score: finalScore, credits: finalCredits, date: new Date().toLocaleDateString() };
  
  leaderboard.push(entry);
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard = leaderboard.slice(0, 10); // Keep top 10
  
  localStorage.setItem('shooterLeaderboard', JSON.stringify(leaderboard));
  displayLeaderboard();
}

function displayLeaderboard() {
  const listEl = document.getElementById('leaderboard-list');
  listEl.innerHTML = leaderboard.map((entry, i) => `
    <div class="leaderboard-entry">
      <span class="leaderboard-rank">#${i + 1}</span> ${entry.name}: ${entry.score}
    </div>
  `).join('');
}

function beginGame() {
  initAudio();
  startMusic();
  running = true;
  setScene(SCENES.GAMEPLAY);
  messageEl.textContent = `Phonograph drive online: ${musicSync.trackName}`;
}

function pauseGame() {
  if (!isGameplayActive()) return;
  running = false;
  left = false;
  right = false;
  setScene(SCENES.PAUSED);
  messageEl.textContent = 'Paused.';
}

function resumeGame() {
  if (currentScene !== SCENES.PAUSED) return;
  running = true;
  setScene(SCENES.GAMEPLAY);
  messageEl.textContent = 'Back in action.';
}

function openStore() {
  if (!MONETIZATION_ALLOWED_SCENES.has(currentScene)) return;
  storeReturnScene = currentScene;
  running = false;
  setScene(SCENES.STORE);
  initPayPalButtons();
}

function closeStore() {
  const returnScene = storeReturnScene === SCENES.PAUSED ? SCENES.PAUSED : SCENES.MAIN_MENU;
  running = false;
  setScene(returnScene);
}

function togglePause() {
  if (currentScene === SCENES.GAMEPLAY) {
    pauseGame();
  } else if (currentScene === SCENES.PAUSED) {
    resumeGame();
  }
}

function firePlayerShot() {
  if (!isGameplayActive() || player.fireCooldown > 0) return;
  const shots = player.doubleShot ? 2 : 1;
  const syncedShot = musicSync.beatAge < 11;
  for (let i = 0; i < shots; i++) {
    const offset = (i - (shots - 1) / 2) * 12;
    bullets.push({
      x: player.x + player.w / 2 + offset,
      y: player.y,
      speed: 12,
      trail: [],
      damage: player.megaShot ? 2 : 1,
      mega: !!player.megaShot,
      homing: player.homingShot,
      laser: player.laserBeam,
      synced: syncedShot
    });
  }
  player.fireCooldown = player.megaShot ? (player.rapidFire ? 8 : 10) : (player.rapidFire ? 10 : 14);
  spawnMuzzleBurst(player.x + player.w / 2, player.y - 10);
  if (syncedShot) {
    spawnFloatingText(player.x + player.w / 2, player.y - 24, 'SYNC SHOT', '#ffecb3');
    spawnShockwave(player.x + player.w / 2, player.y, '#ffecb3', 62);
  }
  playEffect('shoot');
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (currentScene === SCENES.STORE) closeStore();
    else togglePause();
    return;
  }

  if (e.key === 'p' || e.key === 'P') {
    togglePause();
    return;
  }

  if (!isGameplayActive()) return;

  if (!audioCtx) initAudio();
  startMusic();
  if (e.key === 'ArrowLeft' || e.key === 'a') left = true;
  if (e.key === 'ArrowRight' || e.key === 'd') right = true;
  if (e.key === 'b' || e.key === 'B') useBomb();
  if (e.key === ' ') {
    e.preventDefault();
    firePlayerShot();
  }
});

window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') left = false;
  if (e.key === 'ArrowRight' || e.key === 'd') right = false;
});

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  }
});

window.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fullscreen-active', !!document.fullscreenElement);
  resizeGame();
});

if (pauseBtn) pauseBtn.addEventListener('click', pauseGame);
if (bombBtn) bombBtn.addEventListener('click', useBomb);
if (startBtn) startBtn.addEventListener('click', beginGame);
if (menuStoreBtn) menuStoreBtn.addEventListener('click', openStore);
if (pauseStoreBtn) pauseStoreBtn.addEventListener('click', openStore);
if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
if (pauseRestartBtn) pauseRestartBtn.addEventListener('click', restartGame);
if (storeBackBtn) storeBackBtn.addEventListener('click', closeStore);

continueBtn.addEventListener('click', continueGame);
restartBtn.addEventListener('click', restartGame);

shopItemsEl.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  buyItem(btn.dataset.id);
});

function loadPayPalSdk() {
  if (window.paypal) return Promise.resolve();
  if (paypalSdkPromise) return paypalSdkPromise;
  if (!guardMonetization('loadPayPalSdk') || currentScene !== SCENES.STORE) {
    return Promise.reject(new Error('PayPal SDK blocked outside Store scene.'));
  }

  paypalSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.paypal.com/sdk/js?client-id=REPLACE_WITH_YOUR_PAYPAL_CLIENT_ID&currency=USD';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return paypalSdkPromise;
}

function initPayPalButtons() {
  if (paypalButtonsRendered || !guardMonetization('initPayPalButtons')) return;
  if (currentScene !== SCENES.STORE) return;
  if (!window.paypal) {
    loadPayPalSdk()
      .then(() => {
        if (currentScene === SCENES.STORE) initPayPalButtons();
      })
      .catch(err => console.warn('PayPal SDK not loaded', err));
    return;
  }
  const premiumPacks = [
    { id: 'paypal-1k', amount: '1.00', credits: 3000 },
    { id: 'paypal-2k', amount: '2.00', credits: 7000 },
    { id: 'paypal-5k', amount: '5.00', credits: 20000 }
  ];
  premiumPacks.forEach(pack => {
    const container = document.getElementById(pack.id);
    if (!container) return;
    paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay' },
      createOrder: (data, actions) => {
        return actions.order.create({
          purchase_units: [{
            amount: { value: pack.amount },
            description: `${pack.credits} game credits`
          }]
        });
      },
      onApprove: (data, actions) => {
        return actions.order.capture().then(details => {
          purchaseCredits(pack.credits);
          console.log('PayPal payment completed', details);
        });
      },
      onError: err => {
        console.error('PayPal checkout error', err);
        messageEl.textContent = 'Payment failed, please try again.';
      }
    }).render(`#${pack.id}`);
  });
  paypalButtonsRendered = true;
}

window.addEventListener('resize', resizeGame);

const hud = document.createElement('div');
hud.className = 'hud-note';
hud.textContent = 'A / D or arrow keys move. Space shoots. Hit beats for sync shots. P pauses.';
document.body.appendChild(hud);

addShopItems();
resizeGame();
if (bombBtn) bombBtn.textContent = `BOMB x${bombs}`;
updateStatusLabels();
setScene(SCENES.MAIN_MENU);

// Initialize difficulty and leaderboard
const difficultySelect = document.getElementById('difficulty');
difficultySelect.value = difficulty;
difficultySelect.addEventListener('change', (e) => {
  changeDifficulty(e.target.value);
});

displayLeaderboard();

loop();





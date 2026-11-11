const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const startButton = document.getElementById("startButton");
const singleModeButton = document.getElementById("singleModeButton");
const versusModeButton = document.getElementById("versusModeButton");
const modeBadge = document.getElementById("modeBadge");
const mobileControls = document.getElementById("mobileControls");

const statEls = {
  score: document.getElementById("score"),
  level: document.getElementById("level"),
  enemies: document.getElementById("enemies"),
  baseHp: document.getElementById("baseHp"),
  p1Lives: document.getElementById("p1Lives"),
  p2Lives: document.getElementById("p2Lives"),
  p1Item: document.getElementById("p1Item"),
  p1Timer: document.getElementById("p1Timer"),
  p2Item: document.getElementById("p2Item"),
  p2Timer: document.getElementById("p2Timer")
};

const WORLD = { width: canvas.width, height: canvas.height };
const backdropCanvas = document.createElement("canvas");
backdropCanvas.width = WORLD.width;
backdropCanvas.height = WORLD.height;
const backdropCtx = backdropCanvas.getContext("2d");
const keys = new Set();
let selectedMode = "single";
let gameState = null;
let lastFrame = 0;

const DIRECTIONS = {
  up: { x: 0, y: -1, angle: -Math.PI / 2 },
  down: { x: 0, y: 1, angle: Math.PI / 2 },
  left: { x: -1, y: 0, angle: Math.PI },
  right: { x: 1, y: 0, angle: 0 }
};

const PLAYER_CONFIGS = [
  {
    id: "player1",
    label: "1P",
    color: "#7ef28d",
    accent: "116,242,141",
    spawnSingle: { x: WORLD.width / 2, y: WORLD.height - 92 },
    spawnVersus: { x: 180, y: WORLD.height / 2 },
    controls: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", fire: "KeyJ" }
  },
  {
    id: "player2",
    label: "2P",
    color: "#62c7ff",
    accent: "98,199,255",
    spawnVersus: { x: WORLD.width - 180, y: WORLD.height / 2 },
    controls: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", fire: "Enter" }
  }
];

const ITEM_TYPES = {
  laser: { label: "\u6fc0\u5149\u70ae", short: "\u6fc0", color: "#ff6666", duration: 6.5, kind: "timed" },
  rapid: { label: "\u901f\u5c04", short: "\u901f", color: "#ffd84f", duration: 7.2, kind: "timed" },
  boost: { label: "\u63a8\u8fdb\u5668", short: "\u51b2", color: "#59f0c2", duration: 6.5, kind: "timed" },
  shield: { label: "\u62a4\u76fe", short: "\u76fe", color: "#7fb4ff", duration: 4.5, kind: "timed", shieldHits: 2 },
  repair: { label: "\u7ef4\u4fee\u5305", short: "\u4fee", color: "#ff9f63", duration: 0, kind: "instant" }
};

const PLAYER_FIRE_COOLDOWN = 0.24;
const RAPID_FIRE_FACTOR = 0.65;

class Tank {
  constructor(config) {
    this.id = config.id;
    this.label = config.label || "";
    this.type = config.type;
    this.color = config.color;
    this.accent = config.accent;
    this.x = config.x;
    this.y = config.y;
    this.width = 34;
    this.height = 34;
    this.direction = config.direction || "up";
    this.speed = config.speed;
    this.hp = config.hp;
    this.cooldown = 0;
    this.aiTimer = 0;
    this.fireTimer = randomBetween(0.3, 0.7);
    this.alive = true;
    this.power = null;
    this.powerTime = 0;
    this.shieldHits = 0;
  }

  get bounds() {
    return {
      left: this.x - this.width / 2,
      right: this.x + this.width / 2,
      top: this.y - this.height / 2,
      bottom: this.y + this.height / 2
    };
  }
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function rangesOverlap(a1, a2, b1, b2) {
  return Math.max(a1, b1) < Math.min(a2, b2);
}

function createWall(x, y, w, h, options = {}) {
  const destructible = options.destructible !== false;
  const hp = destructible ? options.hp ?? 5 : Number.POSITIVE_INFINITY;
  return {
    x,
    y,
    w,
    h,
    hp,
    maxHp: destructible ? hp : Number.POSITIVE_INFINITY,
    destructible,
    style: options.style || (destructible ? "brick" : "steel")
  };
}

function getWallBounds(wall) {
  return {
    left: wall.x - wall.w / 2,
    right: wall.x + wall.w / 2,
    top: wall.y - wall.h / 2,
    bottom: wall.y + wall.h / 2
  };
}

function buildArenaBackdrop() {
  const gradient = backdropCtx.createLinearGradient(0, 0, 0, WORLD.height);
  gradient.addColorStop(0, "#355936");
  gradient.addColorStop(1, "#213823");
  backdropCtx.fillStyle = gradient;
  backdropCtx.fillRect(0, 0, WORLD.width, WORLD.height);

  backdropCtx.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (let x = 0; x < WORLD.width; x += 32) {
    backdropCtx.fillRect(x, 0, 1, WORLD.height);
  }
  for (let y = 0; y < WORLD.height; y += 32) {
    backdropCtx.fillRect(0, y, WORLD.width, 1);
  }
}

function sweepHitsRect(startX, startY, endX, endY, rect, padding = 0) {
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  return (
    maxX >= rect.left - padding &&
    minX <= rect.right + padding &&
    maxY >= rect.top - padding &&
    minY <= rect.bottom + padding
  );
}

function clampExplosions(state) {
  if (state.explosions.length > 28) {
    state.explosions.splice(0, state.explosions.length - 28);
  }
}

function createPlayer(config, mode) {
  const spawn = mode === "versus" ? config.spawnVersus : config.spawnSingle;
  return new Tank({
    id: config.id,
    label: config.label,
    type: "player",
    color: config.color,
    accent: config.accent,
    x: spawn.x,
    y: spawn.y,
    speed: mode === "single" ? 360 : 320,
    hp: 1
  });
}

function createSingleMapAlpha(includeSteel) {
  const walls = [
    createWall(180, 146, 144, 30, { hp: 4 }),
    createWall(780, 146, 144, 30, { hp: 4 }),
    createWall(300, 270, 30, 144, { hp: 4 }),
    createWall(660, 270, 30, 144, { hp: 4 }),
    createWall(480, 388, 220, 30, { hp: 4 }),
    createWall(200, 430, 150, 30, { hp: 4 }),
    createWall(760, 430, 150, 30, { hp: 4 })
  ];

  if (includeSteel) {
    walls.push(
      createWall(480, 180, 180, 30, { destructible: false, style: "steel" }),
      createWall(410, 540, 30, 86, { destructible: false, style: "steel" }),
      createWall(550, 540, 30, 86, { destructible: false, style: "steel" })
    );
  }

  return walls;
}

function createSingleMapBravo(includeSteel) {
  const walls = [
    createWall(208, 190, 30, 150, { hp: 4 }),
    createWall(752, 190, 30, 150, { hp: 4 }),
    createWall(480, 172, 164, 30, { hp: 4 }),
    createWall(332, 316, 144, 30, { hp: 4 }),
    createWall(628, 316, 144, 30, { hp: 4 }),
    createWall(480, 470, 144, 30, { hp: 4 }),
    createWall(260, 515, 112, 30, { hp: 4 }),
    createWall(700, 515, 112, 30, { hp: 4 })
  ];

  if (includeSteel) {
    walls.push(
      createWall(480, 258, 30, 120, { destructible: false, style: "steel" }),
      createWall(404, 570, 30, 72, { destructible: false, style: "steel" }),
      createWall(556, 570, 30, 72, { destructible: false, style: "steel" })
    );
  }

  return walls;
}

function createSingleMapCharlie(includeSteel) {
  const walls = [
    createWall(150, 150, 120, 30, { hp: 4 }),
    createWall(810, 150, 120, 30, { hp: 4 }),
    createWall(300, 210, 30, 112, { hp: 4 }),
    createWall(660, 210, 30, 112, { hp: 4 }),
    createWall(480, 278, 208, 30, { hp: 4 }),
    createWall(228, 380, 180, 30, { hp: 4 }),
    createWall(732, 380, 180, 30, { hp: 4 }),
    createWall(480, 474, 30, 126, { hp: 4 }),
    createWall(360, 566, 160, 30, { hp: 4 }),
    createWall(600, 566, 160, 30, { hp: 4 })
  ];

  if (includeSteel) {
    walls.push(
      createWall(480, 130, 30, 82, { destructible: false, style: "steel" }),
      createWall(420, 474, 30, 86, { destructible: false, style: "steel" }),
      createWall(540, 474, 30, 86, { destructible: false, style: "steel" })
    );
  }

  return walls;
}

function createVersusMapAlpha(includeSteel) {
  const walls = [
    createWall(WORLD.width / 2, 120, 160, 30, { hp: 4 }),
    createWall(WORLD.width / 2, WORLD.height - 120, 160, 30, { hp: 4 }),
    createWall(280, WORLD.height / 2, 30, 120, { hp: 4 }),
    createWall(WORLD.width - 280, WORLD.height / 2, 30, 120, { hp: 4 })
  ];

  if (includeSteel) {
    walls.push(createWall(WORLD.width / 2, WORLD.height / 2, 30, 160, { destructible: false, style: "steel" }));
  }

  return walls;
}

function createVersusMapBravo(includeSteel) {
  const walls = [
    createWall(310, 174, 150, 30, { hp: 4 }),
    createWall(WORLD.width - 310, WORLD.height - 174, 150, 30, { hp: 4 }),
    createWall(310, WORLD.height - 174, 30, 120, { hp: 4 }),
    createWall(WORLD.width - 310, 174, 30, 120, { hp: 4 }),
    createWall(WORLD.width / 2, WORLD.height / 2, 120, 30, { hp: 4 })
  ];

  if (includeSteel) {
    walls.push(
      createWall(WORLD.width / 2, 170, 30, 110, { destructible: false, style: "steel" }),
      createWall(WORLD.width / 2, WORLD.height - 170, 30, 110, { destructible: false, style: "steel" })
    );
  }

  return walls;
}

function createVersusMapCharlie(includeSteel) {
  const walls = [
    createWall(248, WORLD.height / 2, 160, 30, { hp: 4 }),
    createWall(WORLD.width - 248, WORLD.height / 2, 160, 30, { hp: 4 }),
    createWall(WORLD.width / 2, 150, 30, 120, { hp: 4 }),
    createWall(WORLD.width / 2, WORLD.height - 150, 30, 120, { hp: 4 }),
    createWall(WORLD.width / 2, WORLD.height / 2, 120, 30, { hp: 4 })
  ];

  if (includeSteel) {
    walls.push(
      createWall(390, WORLD.height / 2, 30, 120, { destructible: false, style: "steel" }),
      createWall(WORLD.width - 390, WORLD.height / 2, 30, 120, { destructible: false, style: "steel" })
    );
  }

  return walls;
}

function createWalls(mode) {
  const includeSteel = Math.random() > 0.45;
  const singleMaps = [createSingleMapAlpha, createSingleMapBravo, createSingleMapCharlie];
  const versusMaps = [createVersusMapAlpha, createVersusMapBravo, createVersusMapCharlie];
  const mapFactory = (mode === "versus" ? versusMaps : singleMaps)[Math.floor(Math.random() * 3)];
  return mapFactory(includeSteel);
}

function pointBlocked(x, y, radius, state) {
  const circleBounds = {
    left: x - radius,
    right: x + radius,
    top: y - radius,
    bottom: y + radius
  };

  for (const wall of state.walls) {
    if (wall.destructible && wall.hp <= 0) continue;
    if (rectsOverlap(circleBounds, getWallBounds(wall))) return true;
  }

  const baseBounds = getBaseBounds(state);
  if (baseBounds && rectsOverlap(circleBounds, baseBounds)) return true;

  for (const tank of [...state.players, ...state.enemies]) {
    if (!tank.alive || tank.hp <= 0) continue;
    if (rectsOverlap(circleBounds, tank.bounds)) return true;
  }

  for (const item of state.items) {
    const distance = Math.hypot(item.x - x, item.y - y);
    if (distance < item.radius + radius + 10) return true;
  }

  return false;
}

function findOpenPosition(state, radius, attempts = 40) {
  for (let index = 0; index < attempts; index++) {
    const x = randomBetween(120, WORLD.width - 120);
    const y = randomBetween(96, WORLD.height - 150);
    if (!pointBlocked(x, y, radius, state)) {
      return { x, y };
    }
  }
  return null;
}

function spawnStartingItems(state) {
  const count = Math.random() > 0.45 ? 2 : 1;
  for (let index = 0; index < count; index++) {
    spawnItem(state, { life: 12.5 });
  }
}

function createInitialState(mode, carry = {}) {
  const players = mode === "versus"
    ? PLAYER_CONFIGS.map((config) => createPlayer(config, mode))
    : [createPlayer(PLAYER_CONFIGS[0], mode)];

  const state = {
    mode,
    status: "idle",
    score: 0,
    round: 1,
    bullets: [],
    enemies: [],
    explosions: [],
    beams: [],
    items: [],
    walls: createWalls(mode),
    base: mode === "single" ? { x: WORLD.width / 2, y: WORLD.height - 32, width: 76, height: 28, hp: 6, maxHp: 6 } : null,
    players,
    lives: { player1: mode === "versus" ? 1 : 4, player2: mode === "versus" ? 1 : 0 },
    wins: carry.wins || { player1: 0, player2: 0 },
    itemTimer: mode === "versus" ? 4.8 : 4.8
  };

  if (mode === "single") spawnEnemyWave(state);
  spawnStartingItems(state);
  return state;
}

function spawnEnemyWave(state) {
  const stageTier = Math.floor((state.round - 1) / 5);
  const count = Math.min(4 + state.round + stageTier, 11);
  const spawnPoints = [92, 240, 388, 536, 684, 832];
  state.enemies = Array.from({ length: count }, (_, index) => {
    const lane = spawnPoints[index % spawnPoints.length];
    const row = Math.floor(index / spawnPoints.length);
    const isElite = index >= count - Math.min(stageTier + 1, 3);
    return new Tank({
      id: `enemy-${state.round}-${index}`,
      type: "enemy",
      color: "#ff785f",
      accent: "255,120,95",
      x: lane,
      y: 82 + row * 58,
      speed: 108 + state.round * 12 + stageTier * 8,
      direction: "down",
      hp: isElite ? Math.min(2 + stageTier, 4) : (state.round >= 4 ? 2 : 1)
    });
  });
}

function updateMobileControlsVisibility() {
  mobileControls.classList.toggle("hidden", selectedMode !== "single");
}

function setMode(mode) {
  selectedMode = mode;
  singleModeButton.classList.toggle("active", mode === "single");
  versusModeButton.classList.toggle("active", mode === "versus");
  modeBadge.textContent = mode === "versus" ? "\u53cc\u4eba\u5bf9\u6218" : "\u5355\u4eba\u95ef\u5173";
  updateMobileControlsVisibility();
  setOverlay(
    mode === "versus" ? "\u53cc\u4eba\u5bf9\u6218\u5df2\u5c31\u7eea" : "\u5355\u4eba\u95ef\u5173\u5df2\u5c31\u7eea",
    mode === "versus" ? "1P \u548c 2P \u4e92\u76f8\u5bf9\u8f70\uff0c\u8c01\u63a7\u8282\u594f\u8c01\u8d62\u3002" : "\u654c\u519b\u66f4\u5c11\u3001\u66f4\u6162\uff0c\u5b88\u4f4f\u57fa\u5730\u5e76\u5229\u7528\u9053\u5177\u63a8\u8fdb\u5173\u5361\u3002",
    true
  );
}

function setOverlay(title, text, visible) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.toggle("hidden", !visible);
}

function resetGame() {
  const carry = selectedMode === "versus" && gameState && gameState.mode === "versus"
    ? { wins: { ...gameState.wins } }
    : {};
  gameState = createInitialState(selectedMode, carry);
  gameState.status = "running";
  modeBadge.textContent = selectedMode === "versus" ? "\u53cc\u4eba\u5bf9\u6218" : "\u5355\u4eba\u95ef\u5173";
  updateMobileControlsVisibility();
  setOverlay("\u6218\u6597\u5f00\u59cb", selectedMode === "single" ? "\u79fb\u52a8\u7aef\u6309\u94ae\u5df2\u7ecf\u653e\u5230\u6218\u573a\u4e0b\u65b9\uff0c\u5148\u6e05\u7b2c\u4e00\u6ce2\u719f\u6089\u8282\u594f\u3002" : "\u62a2\u4f4d\u7f6e\u3001\u62a2\u8282\u594f\u3001\u62a2\u5148\u624b\u3002", false);
  syncStats();
}

function syncPlayerBuff(player, itemEl, timerEl) {
  if (!player || !player.alive || (!player.power && player.shieldHits <= 0)) {
    itemEl.textContent = "-";
    timerEl.textContent = "0s";
    return;
  }

  if (player.power === "shield" && player.shieldHits > 0) {
    itemEl.textContent = "\u62a4\u76fe";
    timerEl.textContent = `${player.shieldHits}\u5c42 ${Math.max(player.powerTime, 0).toFixed(1)}s`;
    return;
  }

  if (!player.power || player.powerTime <= 0) {
    itemEl.textContent = "-";
    timerEl.textContent = "0s";
    return;
  }

  itemEl.textContent = ITEM_TYPES[player.power].label;
  timerEl.textContent = `${player.powerTime.toFixed(1)}s`;
}

function syncStats() {
  if (gameState.mode === "versus") {
    statEls.score.textContent = `${gameState.wins.player1}:${gameState.wins.player2}`;
    statEls.level.textContent = String(gameState.round);
    statEls.enemies.textContent = "对战中";
    statEls.baseHp.textContent = "-";
  } else {
    statEls.score.textContent = String(gameState.score);
    statEls.level.textContent = String(gameState.round);
    statEls.enemies.textContent = String(gameState.enemies.length);
    statEls.baseHp.textContent = String(gameState.base.hp);
  }

  statEls.p1Lives.textContent = String(gameState.lives.player1);
  statEls.p2Lives.textContent = String(gameState.lives.player2);

  const p1 = gameState.players.find((player) => player.id === "player1");
  const p2 = gameState.players.find((player) => player.id === "player2");
  syncPlayerBuff(p1, statEls.p1Item, statEls.p1Timer);
  syncPlayerBuff(p2, statEls.p2Item, statEls.p2Timer);
}

function getBaseBounds(state) {
  if (!state.base) return null;
  return {
    left: state.base.x - state.base.width / 2,
    right: state.base.x + state.base.width / 2,
    top: state.base.y - state.base.height / 2,
    bottom: state.base.y + state.base.height / 2
  };
}

function getLivingPlayers(state) {
  return state.players.filter((player) => player.alive && player.hp > 0);
}

function hitsObstacle(tank, state) {
  const bounds = tank.bounds;

  for (const wall of state.walls) {
    if (wall.destructible && wall.hp <= 0) continue;
    if (rectsOverlap(bounds, getWallBounds(wall))) return true;
  }

  const baseBounds = getBaseBounds(state);
  if (tank.type === "enemy" && baseBounds && rectsOverlap(bounds, baseBounds)) return true;

  const allTanks = [...state.players, ...state.enemies];
  for (const other of allTanks) {
    if (other === tank || !other.alive || other.hp <= 0) continue;
    if (rectsOverlap(bounds, other.bounds)) return true;
  }
  return false;
}

function moveTank(tank, dt, state, intentX, intentY) {
  if (intentX === 0 && intentY === 0) return false;

  const speedBoost = tank.power === "boost" ? 1.5 : 1;
  const length = Math.hypot(intentX, intentY) || 1;
  const velocityX = (intentX / length) * tank.speed * speedBoost * dt;
  const velocityY = (intentY / length) * tank.speed * speedBoost * dt;

  if (Math.abs(intentX) > Math.abs(intentY)) {
    tank.direction = intentX > 0 ? "right" : "left";
  } else {
    tank.direction = intentY > 0 ? "down" : "up";
  }

  const originalX = tank.x;
  const originalY = tank.y;
  let moved = false;
  tank.x = clamp(tank.x + velocityX, tank.width / 2, WORLD.width - tank.width / 2);
  if (hitsObstacle(tank, state)) tank.x = originalX;
  else moved = moved || Math.abs(tank.x - originalX) > 0.01;
  tank.y = clamp(tank.y + velocityY, tank.height / 2, WORLD.height - tank.height / 2);
  if (hitsObstacle(tank, state)) tank.y = originalY;
  else moved = moved || Math.abs(tank.y - originalY) > 0.01;
  return moved;
}

function resolveTankOverlaps(state) {
  const tanks = [...state.players, ...state.enemies].filter((tank) => tank.alive && tank.hp > 0);
  for (let i = 0; i < tanks.length; i++) {
    for (let j = i + 1; j < tanks.length; j++) {
      const a = tanks[i];
      const b = tanks[j];
      if (!rectsOverlap(a.bounds, b.bounds)) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const overlapX = a.width - Math.abs(dx);
      const overlapY = a.height - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;

      if (overlapX < overlapY) {
        const push = overlapX / 2 + 0.5;
        const dir = dx >= 0 ? 1 : -1;
        a.x = clamp(a.x - dir * push, a.width / 2, WORLD.width - a.width / 2);
        b.x = clamp(b.x + dir * push, b.width / 2, WORLD.width - b.width / 2);
      } else {
        const push = overlapY / 2 + 0.5;
        const dir = dy >= 0 ? 1 : -1;
        a.y = clamp(a.y - dir * push, a.height / 2, WORLD.height - a.height / 2);
        b.y = clamp(b.y + dir * push, b.height / 2, WORLD.height - b.height / 2);
      }
    }
  }
}

function fireLaser(tank, state) {
  const dir = DIRECTIONS[tank.direction];
  const beamWidth = 18;
  const startX = tank.x + dir.x * 28;
  const startY = tank.y + dir.y * 28;
  let length = dir.x > 0 ? WORLD.width - startX : dir.x < 0 ? startX : dir.y > 0 ? WORLD.height - startY : startY;

  const targets = tank.type === "enemy"
    ? state.players
    : tank.type === "player" && state.mode === "versus"
      ? state.players.filter((player) => player.id !== tank.id)
      : state.enemies;

  for (const wall of state.walls) {
    if (wall.destructible || wall.hp <= 0) continue;
    const bounds = getWallBounds(wall);
    const aligned = dir.x !== 0
      ? rangesOverlap(startY - beamWidth / 2, startY + beamWidth / 2, bounds.top, bounds.bottom)
      : rangesOverlap(startX - beamWidth / 2, startX + beamWidth / 2, bounds.left, bounds.right);
    if (!aligned) continue;
    const distance = dir.x > 0 ? bounds.left - startX : dir.x < 0 ? startX - bounds.right : dir.y > 0 ? bounds.top - startY : startY - bounds.bottom;
    if (distance >= 0 && distance < length) length = distance;
  }

  const hitTank = (target) => {
    const bounds = target.bounds;
    const aligned = dir.x !== 0
      ? rangesOverlap(startY - beamWidth / 2, startY + beamWidth / 2, bounds.top, bounds.bottom)
      : rangesOverlap(startX - beamWidth / 2, startX + beamWidth / 2, bounds.left, bounds.right);
    if (!aligned) return false;
    const distance = dir.x > 0 ? bounds.left - startX : dir.x < 0 ? startX - bounds.right : dir.y > 0 ? bounds.top - startY : startY - bounds.bottom;
    return distance >= 0 && distance <= length;
  };

  for (const target of targets) {
    if (!target.alive || target.hp <= 0 || !hitTank(target)) continue;
    if (target.type === "player" && target.shieldHits > 0) {
      target.shieldHits -= 1;
      if (target.shieldHits === 0) {
        target.power = null;
        target.powerTime = 0;
      }
      state.explosions.push({ x: target.x, y: target.y, life: 0.22, size: 24, color: "127,180,255" });
      continue;
    }
    target.hp -= 2;
    if (state.mode === "versus" && target.type === "player") {
      state.lives[target.id] = Math.max(0, target.hp);
    }
    state.explosions.push({ x: target.x, y: target.y, life: 0.24, size: 32, color: "255,105,105" });
    if (target.hp <= 0) handleTankDestroyed(target, state);
  }

  for (const wall of state.walls) {
    if (!wall.destructible || wall.hp <= 0) continue;
    const bounds = getWallBounds(wall);
    const aligned = dir.x !== 0
      ? rangesOverlap(startY - beamWidth / 2, startY + beamWidth / 2, bounds.top, bounds.bottom)
      : rangesOverlap(startX - beamWidth / 2, startX + beamWidth / 2, bounds.left, bounds.right);
    if (!aligned) continue;
    const distance = dir.x > 0 ? bounds.left - startX : dir.x < 0 ? startX - bounds.right : dir.y > 0 ? bounds.top - startY : startY - bounds.bottom;
    if (distance < 0 || distance > length) continue;
    wall.hp -= 3;
    state.explosions.push({ x: wall.x, y: wall.y, life: 0.2, size: 26, color: "255,201,94" });
  }

  state.beams.push({ x1: startX, y1: startY, x2: startX + dir.x * length, y2: startY + dir.y * length, width: beamWidth, life: 0.14, color: "255,110,94" });
}

function shoot(tank, state) {
  if (!tank.alive || tank.cooldown > 0) return;

  if (tank.power === "laser") {
    fireLaser(tank, state);
    tank.cooldown = tank.type === "enemy" ? 0.5 : 0.2;
    return;
  }

  const dir = DIRECTIONS[tank.direction];
  const isEnemy = tank.type === "enemy";
  const rapidFactor = tank.power === "rapid" ? RAPID_FIRE_FACTOR : 1;
  const bulletSpeed = isEnemy ? 340 + state.round * 12 : state.mode === "single" ? 980 : 900;

  state.bullets.push({
    x: tank.x + dir.x * 28,
    y: tank.y + dir.y * 28,
    vx: dir.x * bulletSpeed,
    vy: dir.y * bulletSpeed,
    bounces: 1,
    radius: isEnemy ? 5 : 5.5,
    owner: tank.id,
    ownerType: tank.type,
    canHitOwner: false,
    canOwnerBeHit: !isEnemy,
    color: isEnemy
      ? "#ff8f5a"
      : state.mode === "versus"
        ? (tank.id === "player1" ? "#7ef28d" : "#62c7ff")
        : "#fff06a"
  });

  tank.cooldown = (isEnemy ? randomBetween(0.95, 1.45) : PLAYER_FIRE_COOLDOWN) * rapidFactor;
}

function updatePlayers(dt, state) {
  for (const config of PLAYER_CONFIGS) {
    const player = state.players.find((item) => item.id === config.id);
    if (!player || !player.alive || player.hp <= 0) continue;

    let intentX = 0;
    let intentY = 0;
    if (keys.has(config.controls.left)) intentX -= 1;
    if (keys.has(config.controls.right)) intentX += 1;
    if (keys.has(config.controls.up)) intentY -= 1;
    if (keys.has(config.controls.down)) intentY += 1;

    moveTank(player, dt, state, intentX, intentY);
    if (keys.has(config.controls.fire)) shoot(player, state);
  }
}

function getNearestPlayer(enemy, state) {
  const players = getLivingPlayers(state);
  if (players.length === 0) return null;
  let nearest = players[0];
  let best = Infinity;
  for (const player of players) {
    const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    if (distance < best) {
      best = distance;
      nearest = player;
    }
  }
  return nearest;
}

function updateEnemies(dt, state) {
  if (state.mode !== "single") return;

  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.hp <= 0) continue;
    enemy.aiTimer -= dt;
    enemy.fireTimer -= dt;
    const target = getNearestPlayer(enemy, state);

    if (enemy.aiTimer <= 0) {
      const dx = target ? target.x - enemy.x : 0;
      const dy = target ? target.y - enemy.y : 1;
      const chaseBias = Math.random() > 0.28;
      enemy.direction = chaseBias
        ? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up")
        : ["up", "down", "left", "right"][Math.floor(Math.random() * 4)];
      enemy.aiTimer = randomBetween(0.45, 0.95);
    }

    const dir = DIRECTIONS[enemy.direction];
    const moved = moveTank(enemy, dt, state, dir.x, dir.y);
    if (!moved) enemy.aiTimer = 0;

    if (enemy.fireTimer <= 0) {
      shoot(enemy, state);
      const stageTier = Math.floor((state.round - 1) / 5);
      enemy.fireTimer = randomBetween(
        Math.max(0.48, 0.95 - stageTier * 0.08 - state.round * 0.018),
        Math.max(0.85, 1.45 - stageTier * 0.1 - state.round * 0.02)
      );
    }
  }
}

function collideBulletWithWalls(bullet, state, prevX, prevY) {
  for (const wall of state.walls) {
    if (wall.destructible && wall.hp <= 0) continue;
    const bounds = getWallBounds(wall);
    if (!sweepHitsRect(prevX, prevY, bullet.x, bullet.y, bounds, bullet.radius)) continue;

    const hitHorizontal = Math.abs(prevX - bounds.left) < Math.abs(prevY - bounds.top)
      ? (bullet.vx !== 0)
      : Math.abs(bullet.vx) >= Math.abs(bullet.vy);

    if (wall.destructible) {
      wall.hp -= 1;
      state.explosions.push({ x: bullet.x, y: bullet.y, life: 0.16, size: 18, color: "255,201,94" });
    } else {
      state.explosions.push({ x: bullet.x, y: bullet.y, life: 0.18, size: 16, color: "168,190,214" });
    }
    clampExplosions(state);

    if (bullet.bounces > 0) {
      bullet.bounces -= 1;
      bullet.canHitOwner = bullet.canOwnerBeHit;
      if (Math.abs(bullet.vx) >= Math.abs(bullet.vy) || hitHorizontal) {
        bullet.vx *= -1;
        bullet.x = prevX;
      } else {
        bullet.vy *= -1;
        bullet.y = prevY;
      }
      return "bounce";
    }

    return "destroy";
  }
  return false;
}

function collideBulletWithBase(bullet, state) {
  const baseBounds = getBaseBounds(state);
  if (!baseBounds) return false;
  if (
    bullet.x > baseBounds.left &&
    bullet.x < baseBounds.right &&
    bullet.y > baseBounds.top &&
    bullet.y < baseBounds.bottom
  ) {
    if (bullet.ownerType === "enemy") {
      state.base.hp -= 1;
      state.explosions.push({ x: state.base.x, y: state.base.y, life: 0.24, size: 34, color: "255,141,99" });
      if (state.base.hp <= 0) endGame("基地失守", "这局没守住，重新开始再来。");
    }
    return true;
  }
  return false;
}

function collideBulletWithTanks(bullet, state, prevX, prevY) {
  const targets = [];

  if (bullet.ownerType === "enemy") {
    targets.push(...state.players);
  } else if (state.mode === "versus") {
    targets.push(...state.players.filter((player) => player.id !== bullet.owner));
  } else {
    targets.push(...state.enemies);
  }

  if (bullet.canHitOwner) {
    const owner = [...state.players, ...state.enemies].find((tank) => tank.id === bullet.owner);
    if (owner) targets.push(owner);
  }

  for (const tank of targets) {
    if (!tank.alive || tank.hp <= 0) continue;
    const bounds = tank.bounds;
    const hit = sweepHitsRect(prevX, prevY, bullet.x, bullet.y, bounds, bullet.radius);
    if (!hit) continue;

    if (tank.type === "player" && tank.shieldHits > 0) {
      tank.shieldHits -= 1;
      if (tank.shieldHits === 0) {
        tank.power = null;
        tank.powerTime = 0;
      }
      state.explosions.push({ x: bullet.x, y: bullet.y, life: 0.2, size: 22, color: "127,180,255" });
      return true;
    }

    tank.hp -= 1;
    if (state.mode === "versus" && tank.type === "player") {
      state.lives[tank.id] = Math.max(0, tank.hp);
    }
    state.explosions.push({ x: bullet.x, y: bullet.y, life: 0.2, size: 24, color: tank.type === "enemy" ? "255,141,99" : tank.accent });
    if (tank.hp <= 0) handleTankDestroyed(tank, state);
    return true;
  }
  return false;
}

function collideBulletWithBounds(bullet, state, prevX, prevY) {
  const hitLeft = bullet.x <= bullet.radius;
  const hitRight = bullet.x >= WORLD.width - bullet.radius;
  const hitTop = bullet.y <= bullet.radius;
  const hitBottom = bullet.y >= WORLD.height - bullet.radius;

  if (!hitLeft && !hitRight && !hitTop && !hitBottom) return false;

  state.explosions.push({ x: bullet.x, y: bullet.y, life: 0.14, size: 14, color: "191,220,255" });
  clampExplosions(state);

  if (bullet.bounces > 0) {
    bullet.bounces -= 1;
    bullet.canHitOwner = bullet.canOwnerBeHit;
    if (hitLeft || hitRight) {
      bullet.vx *= -1;
      bullet.x = clamp(prevX, bullet.radius, WORLD.width - bullet.radius);
    }
    if (hitTop || hitBottom) {
      bullet.vy *= -1;
      bullet.y = clamp(prevY, bullet.radius, WORLD.height - bullet.radius);
    }
    return "bounce";
  }

  return "destroy";
}

function updateBullets(dt, state) {
  for (const bullet of state.bullets) {
    bullet.prevX = bullet.x;
    bullet.prevY = bullet.y;
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
  }

  state.bullets = state.bullets.filter((bullet) => {
    const boundsResult = collideBulletWithBounds(bullet, state, bullet.prevX, bullet.prevY);
    if (boundsResult === "destroy") return false;
    if (boundsResult === "bounce") return true;
    const wallResult = collideBulletWithWalls(bullet, state, bullet.prevX, bullet.prevY);
    if (wallResult === "destroy") return false;
    if (wallResult === "bounce") return true;
    if (collideBulletWithBase(bullet, state)) return false;
    if (collideBulletWithTanks(bullet, state, bullet.prevX, bullet.prevY)) return false;
    return true;
  });
}

function spawnItem(state, options = {}) {
  if (state.items.length >= 2) return;
  const types = ["rapid", "boost", "shield", "laser", "repair", "rapid"];
  const type = types[Math.floor(Math.random() * types.length)];
  const position = findOpenPosition(state, 16);
  if (!position) return;
  state.items.push({
    type,
    x: position.x,
    y: position.y,
    radius: 16,
    life: options.life ?? 9
  });
}

function updateItems(dt, state) {
  state.itemTimer -= dt;
  if (state.itemTimer <= 0) {
    spawnItem(state);
    state.itemTimer = state.mode === "versus" ? randomBetween(6.2, 8.2) : randomBetween(7, 10);
  }

  for (const item of state.items) item.life -= dt;
  state.items = state.items.filter((item) => item.life > 0);

  for (const player of state.players) {
    if (!player.alive || player.hp <= 0) continue;
    for (const item of state.items) {
      const distance = Math.hypot(player.x - item.x, player.y - item.y);
      if (distance >= 24) continue;
      if (ITEM_TYPES[item.type].kind === "instant") {
        if (state.mode === "single" && state.base) {
          state.base.hp = Math.min(state.base.maxHp, state.base.hp + 2);
          state.score += 120;
        } else {
          player.hp += 1;
          state.lives[player.id] = player.hp;
        }
        state.explosions.push({ x: player.x, y: player.y, life: 0.22, size: 28, color: "255,176,109" });
      } else {
        player.power = item.type;
        player.powerTime = ITEM_TYPES[item.type].duration;
        if (item.type === "shield") player.shieldHits = ITEM_TYPES[item.type].shieldHits;
      }
      item.life = 0;
    }
  }
  state.items = state.items.filter((item) => item.life > 0);
}

function handleTankDestroyed(tank, state) {
  tank.alive = false;
  state.explosions.push({ x: tank.x, y: tank.y, life: 0.32, size: 38, color: tank.type === "enemy" ? "255,141,99" : tank.accent });

  if (tank.type === "enemy") {
    state.score += 100;
    if (state.mode === "single" && Math.random() < 0.18) {
      const types = ["rapid", "boost", "shield", "laser", "repair", "shield"];
      const type = types[Math.floor(Math.random() * types.length)];
      state.items.push({ type, x: tank.x, y: tank.y, radius: 16, life: 10 });
    }
    return;
  }

  if (state.mode === "versus") {
    state.lives[tank.id] = 0;
    const winnerId = tank.id === "player1" ? "player2" : "player1";
    state.wins[winnerId] += 1;
    state.status = "ended";
    setOverlay(`${winnerId === "player1" ? "1P" : "2P"} \u83b7\u80dc`, "\u70b9\u51fb\u5f00\u59cb\u6218\u6597\u7ee7\u7eed\u4e0b\u4e00\u56de\u5408\u3002", true);
    return;
  }

  state.lives[tank.id] = Math.max(0, state.lives[tank.id] - 1);
  if (state.lives[tank.id] > 0) {
    state.players[0] = createPlayer(PLAYER_CONFIGS[0], "single");
  } else {
    endGame("\u5168\u519b\u8986\u6ca1", "\u4f60\u7684\u5766\u514b\u88ab\u6253\u7206\u4e86\uff0c\u91cd\u65b0\u5f00\u59cb\u518d\u6765\u3002");
  }
}

function updateEffects(dt, state) {
  state.explosions = state.explosions.filter((effect) => {
    effect.life -= dt;
    effect.size += dt * 46;
    return effect.life > 0;
  });

  state.beams = (state.beams || []).filter((beam) => {
    beam.life -= dt;
    return beam.life > 0;
  });
  clampExplosions(state);
  if (state.beams.length > 8) {
    state.beams.splice(0, state.beams.length - 8);
  }

  for (const tank of [...state.players, ...state.enemies]) {
    if (!tank.alive) continue;
    tank.cooldown = Math.max(0, tank.cooldown - dt);
    if (tank.powerTime > 0) {
      tank.powerTime -= dt;
      if (tank.powerTime <= 0) {
        tank.power = null;
        tank.powerTime = 0;
        tank.shieldHits = 0;
      }
    }
  }
}

function cleanupState(state) {
  state.walls = state.walls.filter((wall) => !wall.destructible || wall.hp > 0);
  state.enemies = state.enemies.filter((enemy) => enemy.alive && enemy.hp > 0);

  if (state.mode === "single" && state.status === "running" && state.enemies.length === 0) {
    state.round += 1;
    state.walls = createWalls("single");
    state.base.hp = state.base.maxHp;
    state.lives.player1 = 4;
    state.items = [];
    state.players[0] = createPlayer(PLAYER_CONFIGS[0], "single");
    spawnEnemyWave(state);
    spawnStartingItems(state);
    setOverlay(`\u7b2c ${state.round} \u5173`, "\u8fd9\u4e00\u5173\u654c\u519b\u4f1a\u63d0\u901f\uff0c\u4f46\u6570\u91cf\u4fdd\u6301\u5728\u66f4\u8010\u73a9\u7684\u8303\u56f4\u5185\u3002", true);
    window.setTimeout(() => {
      if (gameState && gameState.status === "running") setOverlay("", "", false);
    }, 900);
  }
}

function endGame(title, text) {
  if (!gameState || gameState.status === "ended") return;
  gameState.status = "ended";
  setOverlay(title, text, true);
}

function togglePause() {
  if (!gameState || gameState.status === "ended" || gameState.status === "idle") return;
  if (gameState.status === "paused") {
    gameState.status = "running";
    setOverlay("", "", false);
  } else {
    gameState.status = "paused";
    setOverlay("\u5df2\u6682\u505c", "\u6309 P \u7ee7\u7eed\u3002", true);
  }
}

function update(dt) {
  if (!gameState || gameState.status !== "running") return;
  updatePlayers(dt, gameState);
  updateEnemies(dt, gameState);
  resolveTankOverlaps(gameState);
  updateBullets(dt, gameState);
  updateItems(dt, gameState);
  updateEffects(dt, gameState);
  cleanupState(gameState);
  syncStats();
}

function drawBackdrop() {
  ctx.drawImage(backdropCanvas, 0, 0);
}

function drawTank(tank) {
  if (!tank.alive || tank.hp <= 0) return;
  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(DIRECTIONS[tank.direction].angle);
  ctx.fillStyle = tank.color;
  ctx.fillRect(-tank.width / 2, -tank.height / 2, tank.width, tank.height);
  ctx.fillRect(-tank.width / 2 - 6, -tank.height / 2, 6, tank.height);
  ctx.fillRect(tank.width / 2, -tank.height / 2, 6, tank.height);
  ctx.fillStyle = "#18242b";
  ctx.fillRect(-9, -9, 18, 18);
  ctx.fillRect(0, -4, tank.width / 2 + 12, 8);
  if (tank.type === "player" && tank.shieldHits > 0) {
    ctx.strokeStyle = "rgba(127, 180, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (tank.type === "player") {
    ctx.fillStyle = "rgba(6, 15, 22, 0.58)";
    ctx.fillRect(-12, 16, 24, 12);
    ctx.fillStyle = "#f4f1e7";
    ctx.font = "bold 11px Bahnschrift, Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(tank.label, 0, 25);
  }
  ctx.restore();
}

function drawWalls(state) {
  for (const wall of state.walls) {
    if (wall.style === "steel") {
      ctx.fillStyle = "#91a3b4";
      ctx.fillRect(wall.x - wall.w / 2, wall.y - wall.h / 2, wall.w, wall.h);
      ctx.fillStyle = "#657687";
      ctx.fillRect(wall.x - wall.w / 2, wall.y - wall.h / 2, wall.w, 6);
      ctx.fillRect(wall.x - wall.w / 2, wall.y + wall.h / 2 - 6, wall.w, 6);
      continue;
    }

    const ratio = wall.hp / wall.maxHp;
    ctx.fillStyle = ratio > 0.6 ? "#c69152" : ratio > 0.25 ? "#9b673d" : "#6b472f";
    ctx.fillRect(wall.x - wall.w / 2, wall.y - wall.h / 2, wall.w, wall.h);
  }
}

function drawBase(state) {
  if (!state.base) return;
  ctx.fillStyle = state.base.hp > 2 ? "#56c4ff" : "#ff8d63";
  ctx.fillRect(state.base.x - state.base.width / 2, state.base.y - state.base.height / 2, state.base.width, state.base.height);
  ctx.fillStyle = "#0d171b";
  ctx.font = "bold 14px Bahnschrift, Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("BASE", state.base.x, state.base.y + 5);
}

function drawBullets(state) {
  for (const bullet of state.bullets) {
    ctx.beginPath();
    ctx.fillStyle = bullet.color;
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawItems(state) {
  for (const item of state.items) {
    ctx.beginPath();
    ctx.fillStyle = ITEM_TYPES[item.type].color;
    ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#091117";
    ctx.font = "bold 11px Bahnschrift, Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(ITEM_TYPES[item.type].short || ITEM_TYPES[item.type].label[0], item.x, item.y + 4);
  }
}

function drawExplosions(state) {
  for (const beam of state.beams || []) {
    const alpha = Math.max(beam.life / 0.14, 0);
    ctx.strokeStyle = `rgba(${beam.color}, ${0.3 + alpha * 0.45})`;
    ctx.lineWidth = beam.width + 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(beam.x1, beam.y1);
    ctx.lineTo(beam.x2, beam.y2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 244, 214, ${0.5 + alpha * 0.35})`;
    ctx.lineWidth = beam.width * 0.45;
    ctx.beginPath();
    ctx.moveTo(beam.x1, beam.y1);
    ctx.lineTo(beam.x2, beam.y2);
    ctx.stroke();
  }

  for (const effect of state.explosions) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(${effect.color}, ${Math.max(effect.life * 2.2, 0)})`;
    ctx.arc(effect.x, effect.y, effect.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHud(state) {
  const players = state.players.map((player, index) => ({ player, x: 18 + index * 220, y: 18 }));
  for (const card of players) {
    const player = card.player;
    ctx.fillStyle = "rgba(6, 15, 23, 0.62)";
    ctx.fillRect(card.x, card.y, 200, 76);
    ctx.fillStyle = player.color;
    ctx.font = "bold 16px Bahnschrift, Segoe UI";
    ctx.textAlign = "left";
    ctx.fillText(`${player.label} 战况`, card.x + 12, card.y + 22);
    ctx.fillStyle = "#edf4ef";
    ctx.font = "14px Bahnschrift, Segoe UI";
    ctx.fillText(`生命: ${state.lives[player.id]}`, card.x + 12, card.y + 46);
    const weapon = player.power ? ITEM_TYPES[player.power].label : "普通炮";
    ctx.fillText(`武器: ${weapon}`, card.x + 12, card.y + 66);
  }

  ctx.fillStyle = "rgba(6, 15, 23, 0.62)";
  ctx.fillRect(WORLD.width - 220, 18, 202, 92);
  ctx.fillStyle = "#edf4ef";
  ctx.font = "14px Bahnschrift, Segoe UI";
  ctx.fillText(
    gameState.mode === "versus" ? `比分: ${state.wins.player1}:${state.wins.player2}` : `基地耐久: ${state.base.hp}/${state.base.maxHp}`,
    WORLD.width - 206,
    44
  );
  ctx.fillText(
    gameState.mode === "versus" ? `回合: ${state.round}` : `敌军剩余: ${state.enemies.length}`,
    WORLD.width - 206,
    68
  );
  ctx.fillText(`状态: ${state.status === "paused" ? "暂停" : "战斗中"}`, WORLD.width - 206, 92);
}

function render() {
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  if (!gameState) return;
  drawBackdrop();
  drawWalls(gameState);
  drawBase(gameState);
  drawItems(gameState);
  for (const player of gameState.players) drawTank(player);
  for (const enemy of gameState.enemies) drawTank(enemy);
  drawBullets(gameState);
  drawExplosions(gameState);
  drawHud(gameState);
}

function bindTouchControls() {
  const touchButtons = document.querySelectorAll("[data-touch-key]");

  const press = (button) => {
    keys.add(button.dataset.touchKey);
    button.classList.add("is-pressed");
  };

  const release = (button) => {
    keys.delete(button.dataset.touchKey);
    button.classList.remove("is-pressed");
  };

  for (const button of touchButtons) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      press(button);
    });
    button.addEventListener("pointerup", () => release(button));
    button.addEventListener("pointercancel", () => release(button));
    button.addEventListener("pointerleave", () => release(button));
  }
}

function loop(timestamp) {
  if (!lastFrame) lastFrame = timestamp;
  const dt = Math.min((timestamp - lastFrame) / 1000, 0.033);
  lastFrame = timestamp;
  update(dt);
  render();
  window.requestAnimationFrame(loop);
}

document.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Space" && gameState) {
    event.preventDefault();
    if (gameState.status === "idle" || gameState.status === "ended") {
      resetGame();
    } else {
      togglePause();
    }
    return;
  }
  if (event.code === "KeyP") {
    event.preventDefault();
    togglePause();
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Space"].includes(event.code)) {
    event.preventDefault();
  }
});

document.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

singleModeButton.addEventListener("click", () => setMode("single"));
versusModeButton.addEventListener("click", () => setMode("versus"));
startButton.addEventListener("click", resetGame);

bindTouchControls();
buildArenaBackdrop();
gameState = createInitialState(selectedMode);
setMode("single");
syncStats();
window.requestAnimationFrame(loop);

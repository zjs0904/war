'use strict'

/* ============================================================
 * 小小大战争 · 双人对战 / 关卡模式
 * 21×13 随机战场：高地 / 树林 / 沼泽 / 河流 / 桥梁 / 岩石
 * 每局随机生成，两侧地形不镜像；单位击杀可晋升军衔
 * ============================================================ */

const VERSION = 'v1.7'

// ───────── 常量 ─────────
const COLS = 21
const ROWS = 13

const BASE_MAX_HP = 1000
const START_MONEY = 400
const BASE_INCOME = 150
const FIELD_INCOME = 50
const BASE_CAPTURE_TURNS = 2

const DIRS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
]

const BASE_POS = {
  red: { x: 0, y: 6 },
  blue: { x: 20, y: 6 },
}

// 兵营前的生产槽。注意避开基地相邻格（基地前的空格留给工程师占领）
const SPAWN_POS = {
  red: [
    { x: 2, y: 5 },
    { x: 2, y: 6 },
    { x: 2, y: 7 },
  ],
  blue: [
    { x: 18, y: 5 },
    { x: 18, y: 6 },
    { x: 18, y: 7 },
  ],
}

const FIELD_POS = [
  { x: 5, y: 4 },
  { x: 5, y: 8 },
  { x: 15, y: 4 },
  { x: 15, y: 8 },
]

const key = (x, y) => `${x},${y}`

// 地形表：move 为移动消耗，Infinity 表示不可通行
const TERRAIN = {
  '.': { key: 'flat', name: '平地', icon: '▦', move: 1, effect: '无特殊效果' },
  H: { key: 'hill', name: '高地', icon: '⛰️', move: 1, effect: '射程 +1' },
  F: { key: 'forest', name: '树林', icon: '🌲', move: 2, effect: '受到的伤害 -25%' },
  M: { key: 'swamp', name: '沼泽', icon: '🌿', move: 2, effect: '受到的伤害 +20%' },
  B: { key: 'bridge', name: '桥梁', icon: '🌉', move: 1, effect: '跨越水域的唯一通道' },
  W: { key: 'water', name: '水域', icon: '🌊', move: Infinity, effect: '无法通行' },
  '#': { key: 'rock', name: '岩石', icon: '🪨', move: Infinity, effect: '无法通行' },
}

// 地形字符：. 平地  H 高地  F 树林  M 沼泽  B 桥梁  W 水域  # 岩石
const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS
const randInt = (n) => Math.floor(Math.random() * n)

const TERRAIN_TILES = {}
for (const ch of Object.keys(TERRAIN)) TERRAIN_TILES[TERRAIN[ch].key] = new Set()

let MAP = []
let MAP_AT = []

const terrainAt = (x, y) => TERRAIN[MAP_AT[y]?.[x]] || TERRAIN['.']
const moveCostAt = (x, y) => terrainAt(x, y).move

function applyMap(rows) {
  MAP = rows
  MAP_AT = rows.map((row) => row.split(''))
  for (const k of Object.keys(TERRAIN_TILES)) TERRAIN_TILES[k].clear()
  rows.forEach((row, y) => {
    row.split('').forEach((ch, x) => {
      const t = TERRAIN[ch]
      if (t) TERRAIN_TILES[t.key].add(key(x, y))
    })
  })
}

// 生成失败时的兜底地图（对称手绘）
const FALLBACK_MAP = [
  '.....................',
  '...#....#....#....#..',
  '..FF...H.....H...FF..',
  '....#..M.....M..#....',
  '..M.F..H.....H..F.M..',
  '......WBWWWWWBW......',
  '......WBWWWWWBW......',
  '......WBWWWWWBW......',
  '..M.F..H.....H..F.M..',
  '....#..M.....M..#....',
  '..FF...H.....H...FF..',
  '..#....#....#....#...',
  '.....................',
]

// ───────── 随机地图 ─────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function addCluster(grid, reserved, ch, count, minSize, maxSize) {
  for (let i = 0; i < count; i++) {
    let x = -1
    let y = -1
    for (let t = 0; t < 40; t++) {
      const tx = randInt(COLS)
      const ty = randInt(ROWS)
      if (!reserved.has(key(tx, ty)) && grid[ty][tx] === '.') {
        x = tx
        y = ty
        break
      }
    }
    if (x < 0) continue

    const size = minSize + randInt(maxSize - minSize + 1)
    for (let k = 0; k < size; k++) {
      if (inBounds(x, y) && !reserved.has(key(x, y)) && grid[y][x] === '.') {
        grid[y][x] = ch
      }
      const [dx, dy] = DIRS[randInt(DIRS.length)]
      x += dx
      y += dy
    }
  }
}

function floodFill(grid, start) {
  const seen = new Set([key(start.x, start.y)])
  const queue = [start]
  while (queue.length) {
    const cur = queue.shift()
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx
      const ny = cur.y + dy
      if (!inBounds(nx, ny)) continue
      const k = key(nx, ny)
      if (seen.has(k)) continue
      if (!Number.isFinite(TERRAIN[grid[ny][nx]].move)) continue
      seen.add(k)
      queue.push({ x: nx, y: ny })
    }
  }
  return seen
}

function tryGenerateMap() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill('.'))
  const reserved = new Set()
  const reserve = (x, y) => {
    if (inBounds(x, y)) reserved.add(key(x, y))
  }

  // 基地、生产槽及其相邻格必须可通行
  for (const side of ['red', 'blue']) {
    const b = BASE_POS[side]
    reserve(b.x, b.y)
    for (const [dx, dy] of DIRS) reserve(b.x + dx, b.y + dy)
    for (const p of SPAWN_POS[side]) {
      reserve(p.x, p.y)
      for (const [dx, dy] of DIRS) reserve(p.x + dx, p.y + dy)
    }
  }
  for (const f of FIELD_POS) reserve(f.x, f.y)

  // 纵贯地图的随机河流：位置、弯折、宽度随机，2~3 座桥
  const width = Math.random() < 0.35 ? 2 : 1
  let rx = 8 + randInt(4)
  const riverX = []
  for (let y = 0; y < ROWS; y++) {
    rx = Math.max(7, Math.min(12, rx + randInt(3) - 1))
    for (let w = 0; w < width; w++) grid[y][rx + w] = 'W'
    riverX.push(rx)
  }
  const bridgeRows = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).slice(0, 2 + randInt(2))
  for (const y of bridgeRows) {
    const x = riverX[y]
    for (let w = 0; w < width; w++) grid[y][x + w] = 'B'
    reserve(x - 1, y)
    reserve(x + width, y)
  }

  // 两侧各自随机生成地形簇，不做镜像
  addCluster(grid, reserved, 'H', 3 + randInt(2), 1, 4)
  addCluster(grid, reserved, 'F', 4 + randInt(2), 2, 5)
  addCluster(grid, reserved, 'M', 2 + randInt(2), 1, 3)
  addCluster(grid, reserved, '#', 2 + randInt(3), 1, 2)

  // 校验：双方基地、油田、生产槽必须连通
  const reach = floodFill(grid, BASE_POS.red)
  const need = [BASE_POS.blue, ...FIELD_POS, ...SPAWN_POS.red, ...SPAWN_POS.blue]
  if (!need.every((p) => reach.has(key(p.x, p.y)))) return null

  return grid.map((row) => row.join(''))
}

function generateMap() {
  for (let i = 0; i < 60; i++) {
    const rows = tryGenerateMap()
    if (rows) {
      applyMap(rows)
      return
    }
  }
  applyMap(FALLBACK_MAP)
}

applyMap(FALLBACK_MAP)

const isHill = (x, y) => TERRAIN_TILES.hill.has(key(x, y))
const isForest = (x, y) => TERRAIN_TILES.forest.has(key(x, y))
const isSwamp = (x, y) => TERRAIN_TILES.swamp.has(key(x, y))

// 军衔：击杀数达到门槛晋升，攻击与生命上限提升，并回满血
const RANKS = [
  { name: '新兵', kills: 0, atk: 1.0, hp: 1.0 },
  { name: '下士', kills: 2, atk: 1.15, hp: 1.25 },
  { name: '中士', kills: 4, atk: 1.3, hp: 1.5 },
  { name: '上尉', kills: 7, atk: 1.5, hp: 1.8 },
  { name: '少校', kills: 11, atk: 1.7, hp: 2.2 },
]

const UNIT_TYPES = {
  infantry: {
    key: 'infantry',
    name: '步兵',
    emoji: '🪖',
    cost: 75,
    hp: 100,
    atk: 75,
    range: 2,
    move: 3,
    desc: '最基础的单位。射程 2，对砍一刀打掉对方 75% 生命。站在高地上射程 +1。',
  },
  sniper: {
    key: 'sniper',
    name: '狙击手',
    emoji: '🎯',
    cost: 200,
    hp: 60,
    atk: 200,
    range: 6,
    move: 2,
    desc: '射程 6，一击必杀步兵。移动后仍可攻击；站上高地射程可达 7。',
  },
  engineer: {
    key: 'engineer',
    name: '工程师',
    emoji: '🔧',
    cost: 100,
    hp: 50,
    atk: 0,
    range: 0,
    move: 3,
    canCapture: true,
    desc: '没有攻击力。站上油田一回合后占领；在敌方基地旁站 2 回合可占领基地获胜。',
  },
  grenadier: {
    key: 'grenadier',
    name: '手榴弹兵',
    emoji: '💣',
    cost: 200,
    hp: 90,
    atk: 80,
    range: 3,
    move: 2,
    splash: 40,
    desc: '射程 3，对目标周围敌人造成 40 溅射伤害。站上高地射程 +1。',
  },
  commando: {
    key: 'commando',
    name: '突击队员',
    emoji: '🥷',
    cost: 700,
    hp: 240,
    atk: 160,
    range: 2,
    move: 4,
    desc: '最昂贵的单位。240 生命、160 攻击、移动 4、射程 2，能单挑大部分单位。',
  },
}

const UNIT_ORDER = ['infantry', 'sniper', 'engineer', 'grenadier', 'commando']

const LEVELS = [
  { id: 1, name: '第一关', sub: '新兵', aiMoney: 300, aiIncome: 0, desc: '电脑起步较慢' },
  { id: 2, name: '第二关', sub: '老兵', aiMoney: 450, aiIncome: 50, desc: '电脑会攒钱出狙击手' },
  { id: 3, name: '第三关', sub: '精英', aiMoney: 600, aiIncome: 100, desc: '电脑经济更好' },
  { id: 4, name: '第四关', sub: '指挥官', aiMoney: 800, aiIncome: 150, desc: '电脑开局就有优势' },
]

// ───────── DOM ─────────
const els = {}
const cellEls = []
const unitEls = new Map()
let baseEls = {}
let spawnEls = []

// ───────── 状态 ─────────
let state = null
let unitSeq = 1
let hintTimer = null
let aiTimer = null

const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const sideName = (s) => (s === 'red' ? '红方' : '蓝方')
const enemyOf = (s) => (s === 'red' ? 'blue' : 'red')

// ───────── 初始化 ─────────
function init(mode = 'pvp', level = 1) {
  clearTimeout(aiTimer)
  generateMap()
  const lv = LEVELS.find((l) => l.id === level) || LEVELS[0]

  state = {
    mode,
    level: lv.id,
    levelConfig: lv,
    turn: 'red',
    money: { red: START_MONEY, blue: mode === 'ai' ? lv.aiMoney : START_MONEY },
    baseHp: { red: BASE_MAX_HP, blue: BASE_MAX_HP },
    baseProgress: { red: 0, blue: 0 },
    units: [],
    fields: FIELD_POS.map((p, i) => ({
      ...p,
      owner: i < FIELD_POS.length / 2 ? 'red' : 'blue',
    })),
    selectedId: null,
    hoverId: null,
    hoverCell: null,
    hoverType: null,
    log: [],
    gameOver: false,
    aiThinking: false,
    round: 1,
  }
  unitSeq = 1

  els.board.innerHTML = ''
  cellEls.length = 0
  unitEls.clear()

  buildBoard()
  buildBases()
  buildSpawns()

  els.overlay.hidden = true
  els.helpOverlay.hidden = true
  els.menuOverlay.hidden = true
  els.log.innerHTML = ''
  addLog(
    'sys',
    `${VERSION} 战斗开始。${mode === 'ai' ? `关卡模式：${lv.name} · ${lv.sub}` : '双人对战'}，红方先手。`
  )

  startTurn('red', true)
}

function buildBoard() {
  els.board.style.setProperty('--cols', COLS)
  els.board.style.setProperty('--rows', ROWS)
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = document.createElement('div')
      cell.className = 'cell'
      cell.dataset.x = x
      cell.dataset.y = y
      els.board.appendChild(cell)
      cellEls.push(cell)
    }
  }
}

function buildBases() {
  baseEls = {}
  for (const side of ['red', 'blue']) {
    const el = document.createElement('div')
    el.className = `base-el ${side}`
    el.style.setProperty('--ux', BASE_POS[side].x)
    el.style.setProperty('--uy', BASE_POS[side].y)
    el.innerHTML = `<span class="b-icon">🏰</span><div class="u-hpbar"><i></i></div>`
    els.board.appendChild(el)
    baseEls[side] = el
  }
}

function buildSpawns() {
  spawnEls = []
  for (const side of ['red', 'blue']) {
    for (const p of SPAWN_POS[side]) {
      const el = document.createElement('div')
      el.className = `spawn-el ${side}`
      el.style.setProperty('--ux', p.x)
      el.style.setProperty('--uy', p.y)
      el.innerHTML = `<span class="s-mark">＋</span>`
      els.board.appendChild(el)
      spawnEls.push(el)
    }
  }
}

// ───────── 回合 ─────────
function startTurn(side, first = false) {
  state.turn = side
  state.selectedId = null
  state.aiThinking = false

  if (!first) {
    resolveCaptures(side)
    if (state.gameOver) {
      render()
      return
    }
    resolveSpawnSlots(side)
  }

  const fieldCount = state.fields.filter((f) => f.owner === side).length
  let income = BASE_INCOME + fieldCount * FIELD_INCOME
  if (state.mode === 'ai' && side === 'blue') income += state.levelConfig.aiIncome
  state.money[side] += income
  addLog('sys', `${sideName(side)}回合开始，收入 +${income}（油田 ${fieldCount} 座）`)

  for (const u of state.units) {
    if (u.side === side) {
      u.moved = false
      u.acted = false
    }
  }

  showBanner(side)
  setHint(first ? '点击兵种卡片购买单位，或选中己方单位行动' : '')

  if (state.mode === 'ai' && side === 'blue') {
    state.aiThinking = true
    render()
    aiTimer = setTimeout(() => {
      if (!state.gameOver) aiTurn()
    }, 750)
  } else {
    render()
  }
}

function endTurn() {
  if (!canHumanAct()) return
  switchTurn()
}

function switchTurn() {
  if (state.gameOver) return
  if (state.turn === 'blue') state.round++
  startTurn(enemyOf(state.turn))
}

function resolveCaptures(side) {
  for (const f of state.fields) {
    if (f.owner === side) continue
    const eng = state.units.find(
      (u) => u.side === side && u.type === 'engineer' && u.x === f.x && u.y === f.y
    )
    if (eng) {
      f.owner = side
      addLog(side, `工程师占领了油田，每回合 +${FIELD_INCOME} 金币`)
      setHint(`${sideName(side)}占领了油田`)
    }
  }

  const eb = enemyBasePos(side)
  const adjacent = state.units.some(
    (u) => u.side === side && u.type === 'engineer' && dist(u, eb) <= 1
  )
  if (adjacent) {
    state.baseProgress[side] += 1
    addLog(side, `工程师正在占领敌方基地 ${state.baseProgress[side]}/${BASE_CAPTURE_TURNS}`)
    if (state.baseProgress[side] >= BASE_CAPTURE_TURNS) {
      endGame(side, 'capture')
    }
  } else {
    state.baseProgress[side] = 0
  }
}

// 生产槽：己方单位站满一回合回满血；敌方单位站满一回合被清除
function resolveSpawnSlots(side) {
  for (const p of SPAWN_POS[side]) {
    const u = unitAt(p.x, p.y)
    if (!u) continue
    if (u.side !== side) {
      state.units = state.units.filter((x) => x.id !== u.id)
      addLog(u.side, `${u.name} 在敌方生产槽上被清除`, true)
      floatText(p.x, p.y, '清除', 'dmg')
    } else if (u.hp < u.maxHp) {
      const healed = u.maxHp - u.hp
      u.hp = u.maxHp
      addLog(side, `${u.name} 在生产槽休整，生命回满`)
      floatText(p.x, p.y, `+${healed}`, 'heal')
    }
  }
}

// ───────── 购买 ─────────
function findSpawn(side) {
  for (const p of SPAWN_POS[side]) {
    if (!Number.isFinite(moveCostAt(p.x, p.y))) continue
    if (unitAt(p.x, p.y)) continue
    if (isBaseTile(p.x, p.y)) continue
    return p
  }
  return null
}

function buy(typeKey) {
  if (!canHumanAct()) return
  doBuy(typeKey, state.turn)
}

function doBuy(typeKey, side) {
  const type = UNIT_TYPES[typeKey]
  if (!type) return false
  if (state.money[side] < type.cost) {
    if (side === 'red') setHint(`金币不足，${type.name}需要 ${type.cost}`, true)
    return false
  }
  const spot = findSpawn(side)
  if (!spot) {
    if (side === 'red') setHint('生产槽已满，先让单位走开', true)
    return false
  }

  state.money[side] -= type.cost
  const u = makeUnit(type, side, spot.x, spot.y)
  state.units.push(u)
  addLog(side, `${sideName(side)}购买 ${type.name}`)
  if (side === 'red') setHint(`${type.name} 已部署到生产槽，本回合即可行动`)
  render()
  return true
}

function makeUnit(type, side, x, y) {
  return {
    id: `u${unitSeq++}`,
    side,
    type: type.key,
    name: type.name,
    emoji: type.emoji,
    x,
    y,
    hp: type.hp,
    maxHp: type.hp,
    baseAtk: type.atk,
    baseMaxHp: type.hp,
    atk: type.atk,
    range: type.range,
    move: type.move,
    splash: type.splash || 0,
    canCapture: !!type.canCapture,
    moveOrAttack: !!type.moveOrAttack,
    moved: false,
    acted: false,
    kills: 0,
    rank: 0,
  }
}

// ───────── 地形 / 数值 ─────────
function rangeAt(u, pos) {
  return u.range + (isHill(pos.x, pos.y) ? 1 : 0)
}

function rangeOf(u) {
  return rangeAt(u, u)
}

function damageOf(u) {
  return Math.max(1, Math.round((u.atk * u.hp) / u.maxHp))
}

function damageTo(u, target) {
  let mult = 1
  // 树林提供掩护，受到的伤害降低 25%
  if (isForest(target.x, target.y)) mult *= 0.75
  // 沼泽毫无遮掩，受到的伤害增加 20%
  if (isSwamp(target.x, target.y)) mult *= 1.2
  return Math.max(1, Math.round(damageOf(u) * mult))
}

function splashOf(u) {
  return Math.max(1, Math.round((u.splash * u.hp) / u.maxHp))
}

function creditKill(u) {
  u.kills += 1
  while (RANKS[u.rank + 1] && u.kills >= RANKS[u.rank + 1].kills) {
    u.rank += 1
    const r = RANKS[u.rank]
    u.atk = Math.round(u.baseAtk * r.atk)
    u.maxHp = Math.round(u.baseMaxHp * r.hp)
    u.hp = u.maxHp
    addLog(u.side, `${u.name} 晋升为 ${r.name}！攻击 ${u.atk}，生命回满 ${u.maxHp}`)
    floatText(u.x, u.y, `晋升 ${r.name}`, 'rank')
  }
}

// ───────── 交互 ─────────
function canHumanAct() {
  if (!state || state.gameOver) return false
  if (state.mode === 'ai' && (state.turn === 'blue' || state.aiThinking)) return false
  return true
}

function getSelected() {
  return state.units.find((u) => u.id === state.selectedId) || null
}

function unitAt(x, y) {
  return state.units.find((u) => u.x === x && u.y === y) || null
}

function fieldAt(x, y) {
  return state.fields.find((f) => f.x === x && f.y === y) || null
}

function isBaseTile(x, y) {
  return (
    (x === BASE_POS.red.x && y === BASE_POS.red.y) ||
    (x === BASE_POS.blue.x && y === BASE_POS.blue.y)
  )
}

function enemyBasePos(side) {
  return BASE_POS[enemyOf(side)]
}

function selectUnit(u) {
  if (!u || u.side !== state.turn || !canHumanAct()) return
  state.selectedId = u.id
  if (u.acted) setHint('该单位本回合已经行动过了')
  else if (u.moved) setHint('已移动，还可以攻击')
  else setHint('绿色格移动，红色格攻击')
  render()
}

function cellClicked(x, y) {
  if (!canHumanAct()) return

  const sel = getSelected()

  if (sel && !sel.acted) {
    if (!sel.moved && isMoveTile(sel, x, y)) {
      doMove(sel, x, y)
      return
    }
    const target = unitAt(x, y)
    if (target && target.side !== sel.side && canAttack(sel, target)) {
      doAttackUnit(sel, target)
      return
    }
    if (isEnemyBaseTile(sel.side, x, y) && canAttackBase(sel)) {
      doAttackBase(sel)
      return
    }
  }

  const clicked = unitAt(x, y)
  if (clicked && clicked.side === state.turn) {
    selectUnit(clicked)
    return
  }

  state.selectedId = null
  setHint('')
  render()
}

function isEnemyBaseTile(side, x, y) {
  const b = enemyBasePos(side)
  return b.x === x && b.y === y
}

function canAttack(u, target) {
  if (u.acted || u.atk <= 0) return false
  if (u.moveOrAttack && u.moved) return false
  return dist(u, target) <= rangeOf(u)
}

function canAttackBase(u) {
  if (u.acted || u.atk <= 0) return false
  if (u.moveOrAttack && u.moved) return false
  return dist(u, enemyBasePos(u.side)) <= rangeOf(u)
}

function doMove(u, x, y) {
  u.x = x
  u.y = y
  u.moved = true
  if (u.moveOrAttack) u.acted = true
  addLog(u.side, `${u.name} 移动到 (${x},${y})`)
  if (u.acted && state.selectedId === u.id) state.selectedId = null
  render()
}

function doAttackUnit(u, target) {
  const dmg = damageTo(u, target)
  target.hp -= dmg
  u.acted = true
  u.moved = true
  state.selectedId = null

  floatText(target.x, target.y, `-${dmg}`, 'dmg')
  pulse(unitEls.get(target.id))
  addLog(u.side, `${u.name} 攻击 ${target.name}，造成 ${dmg} 伤害`)

  const killed = []
  if (target.hp <= 0) killed.push(target)

  if (u.splash) {
    const sp = splashOf(u)
    for (const other of state.units) {
      if (other.id === target.id) continue
      if (other.side === u.side) continue
      if (dist(other, target) !== 1) continue
      other.hp -= sp
      floatText(other.x, other.y, `-${sp}`, 'dmg')
      pulse(unitEls.get(other.id))
      addLog(u.side, `手榴弹溅射 ${other.name}，造成 ${sp} 伤害`)
      if (other.hp <= 0) killed.push(other)
    }
  }

  for (let i = 0; i < killed.length; i++) creditKill(u)

  cleanupDead()
  render()
}

function doAttackBase(u) {
  const side = enemyOf(u.side)
  const b = BASE_POS[side]
  const dmg = damageOf(u)
  state.baseHp[side] -= dmg
  u.acted = true
  u.moved = true
  state.selectedId = null

  floatText(b.x, b.y, `-${dmg}`, 'dmg')
  pulse(baseEls[side])
  addLog(u.side, `${u.name} 攻击敌方基地，造成 ${dmg} 伤害`)

  render()
  checkWin()
}

function cleanupDead() {
  const dead = state.units.filter((u) => u.hp <= 0)
  if (!dead.length) return
  for (const d of dead) {
    addLog(d.side, `${d.name} 被消灭`, true)
  }
  state.units = state.units.filter((u) => u.hp > 0)
}

// ───────── 移动范围（树林 / 沼泽消耗 2 点移动力） ─────────
function reachable(unit) {
  const blocked = new Set()
  for (const u of state.units) if (u.id !== unit.id) blocked.add(key(u.x, u.y))
  blocked.add(key(BASE_POS.red.x, BASE_POS.red.y))
  blocked.add(key(BASE_POS.blue.x, BASE_POS.blue.y))

  const best = new Map([[key(unit.x, unit.y), 0]])
  const queue = [{ x: unit.x, y: unit.y, c: 0 }]
  const out = new Map()

  while (queue.length) {
    queue.sort((a, b) => a.c - b.c)
    const cur = queue.shift()
    if (cur.c !== best.get(key(cur.x, cur.y))) continue
    if (cur.c >= unit.move) continue

    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx
      const ny = cur.y + dy
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
      const k = key(nx, ny)
      if (blocked.has(k)) continue

      const step = moveCostAt(nx, ny)
      if (!Number.isFinite(step)) continue
      const nc = cur.c + step
      if (nc > unit.move) continue
      if (nc < (best.get(k) ?? Infinity)) {
        best.set(k, nc)
        out.set(k, { x: nx, y: ny })
        queue.push({ x: nx, y: ny, c: nc })
      }
    }
  }
  return [...out.values()]
}

function isMoveTile(u, x, y) {
  return reachable(u).some((p) => p.x === x && p.y === y)
}

// ───────── 胜负 ─────────
function checkWin() {
  if (state.baseHp.red <= 0) endGame('blue', 'destroy')
  else if (state.baseHp.blue <= 0) endGame('red', 'destroy')
}

function endGame(winner, reason = 'destroy') {
  if (state.gameOver) return
  state.gameOver = true
  state.aiThinking = false
  state.selectedId = null
  clearTimeout(aiTimer)

  els.overlayIcon.textContent = '🏆'
  els.overlayTitle.textContent = `${sideName(winner)}胜利`
  els.overlayTitle.className = winner
  els.overlaySub.textContent =
    reason === 'capture' ? '敌方基地被工程师占领' : '敌方基地被摧毁'
  els.overlay.hidden = false
  addLog('sys', `${sideName(winner)}获胜：${els.overlaySub.textContent}`)
  render()
}

// ───────── AI ─────────
function aiTurn() {
  if (state.gameOver || state.mode !== 'ai') {
    state.aiThinking = false
    return
  }

  aiBuy()
  render()

  const step = () => {
    if (state.gameOver) {
      state.aiThinking = false
      render()
      return
    }
    const u = state.units.find((x) => x.side === 'blue' && !x.acted)
    if (!u) {
      state.aiThinking = false
      switchTurn()
      return
    }
    aiActUnit(u)
    render()
    if (state.gameOver) {
      state.aiThinking = false
      return
    }
    aiTimer = setTimeout(step, 380)
  }

  aiTimer = setTimeout(step, 450)
}

function aiBuy() {
  for (let i = 0; i < 4; i++) {
    if (!findSpawn('blue')) break
    const t = choosePurchase()
    if (!t) break
    if (!doBuy(t, 'blue')) break
  }
}

function choosePurchase() {
  const money = state.money.blue
  const my = state.units.filter((u) => u.side === 'blue')
  const enemy = state.units.filter((u) => u.side === 'red')
  const hasEng = my.some((u) => u.type === 'engineer')
  const enemyInf = enemy.filter((u) => u.type === 'infantry').length
  const myValue = my.reduce((s, u) => s + UNIT_TYPES[u.type].cost, 0)
  const enemyValue = enemy.reduce((s, u) => s + UNIT_TYPES[u.type].cost, 0)

  if (!hasEng && money >= UNIT_TYPES.engineer.cost) return 'engineer'
  if (money >= UNIT_TYPES.commando.cost && myValue < enemyValue + 250) return 'commando'
  if (enemyInf >= 2 && money >= UNIT_TYPES.grenadier.cost) return 'grenadier'
  if (money >= UNIT_TYPES.sniper.cost && !my.some((u) => u.type === 'sniper')) return 'sniper'
  if (money >= UNIT_TYPES.infantry.cost) return 'infantry'
  return null
}

function aiActUnit(u) {
  if (u.type === 'engineer' && state.baseProgress.blue > 0 && dist(u, enemyBasePos('blue')) <= 1) {
    u.acted = true
    u.moved = true
    addLog('blue', '工程师原地继续占领基地')
    return
  }

  const options = [{ x: u.x, y: u.y }]
  if (!u.moved) options.push(...reachable(u))

  let best = null

  for (const pos of options) {
    const moved = pos.x !== u.x || pos.y !== u.y
    const canShoot = u.atk > 0 && !(u.moveOrAttack && moved)
    const targets = canShoot ? targetsFrom(u, pos) : []
    let score
    let target = null

    if (targets.length) {
      target = chooseTarget(u, targets)
      score = 600 + targetScore(u, target) - dangerAt(u.side, pos) * 0.3
      if (moved) score -= 12
    } else {
      score = -objectiveDistance(u, pos) * 14 - dangerAt(u.side, pos) * 0.55
      if (!moved) score -= 35
      if (isHill(pos.x, pos.y)) score += 10
      else if (isForest(pos.x, pos.y)) score += 8
      else if (isSwamp(pos.x, pos.y)) score -= 10
    }

    if (!best || score > best.score) {
      best = { pos, score, target, moved, canShoot }
    }
  }

  if (best && best.moved) doMove(u, best.pos.x, best.pos.y)
  if (best && best.target && best.canShoot) {
    if (best.target.kind === 'base') doAttackBase(u)
    else doAttackUnit(u, best.target.unit)
  }

  u.acted = true
  u.moved = true
  if (state.selectedId === u.id) state.selectedId = null
}

function targetsFrom(u, pos) {
  const list = []
  const range = rangeAt(u, pos)
  for (const e of state.units) {
    if (e.side === u.side) continue
    if (dist(pos, e) <= range) list.push({ kind: 'unit', unit: e })
  }
  const eb = enemyBasePos(u.side)
  if (dist(pos, eb) <= range) list.push({ kind: 'base' })
  return list
}

function chooseTarget(u, targets) {
  let best = null
  let bestScore = -Infinity
  for (const t of targets) {
    const s = targetScore(u, t)
    if (s > bestScore) {
      bestScore = s
      best = t
    }
  }
  return best
}

function targetScore(u, t) {
  if (t.kind === 'base') {
    const dmg = damageOf(u)
    const hp = state.baseHp[enemyOf(u.side)]
    return 90 + dmg * 0.2 + (dmg >= hp ? 900 : 0)
  }
  const e = t.unit
  const dmg = damageTo(u, e)
  let s = 100 + UNIT_TYPES[e.type].cost * 0.18
  if (dmg >= e.hp) s += 260
  s += (e.maxHp - e.hp) * 0.45
  if (e.type === 'engineer') s += 40
  return s
}

function objectiveDistance(u, pos) {
  if (u.type === 'engineer') {
    const targets = state.fields.filter((f) => f.owner !== 'blue').map((f) => dist(pos, f))
    if (targets.length) return Math.min(...targets)
    return dist(pos, enemyBasePos('blue'))
  }
  let nearest = Infinity
  for (const e of state.units) {
    if (e.side === u.side) continue
    nearest = Math.min(nearest, dist(pos, e))
  }
  const db = dist(pos, enemyBasePos('blue'))
  return nearest === Infinity ? db : Math.min(nearest, db + 2)
}

function dangerAt(side, pos) {
  let danger = 0
  for (const e of state.units) {
    if (e.side === side) continue
    if (dist(e, pos) <= rangeOf(e) + e.move) danger += damageOf(e) * 0.4
  }
  return danger
}

// ───────── 渲染 ─────────
function render() {
  renderCells()
  renderUnits()
  renderBases()
  renderHud()
  renderShop()
  renderInfo()
  renderLog()
}

function renderCells() {
  const sel = getSelected()
  const moveSet = new Set()
  const attackSet = new Set()

  if (sel && !sel.acted && !state.gameOver && canHumanAct()) {
    if (!sel.moved) for (const p of reachable(sel)) moveSet.add(key(p.x, p.y))
    if (canAttackBase(sel)) attackSet.add(key(enemyBasePos(sel.side).x, enemyBasePos(sel.side).y))
    for (const u of state.units) {
      if (u.side !== sel.side && canAttack(sel, u)) attackSet.add(key(u.x, u.y))
    }
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const el = cellEls[y * COLS + x]
      const k = key(x, y)
      const terrain = terrainAt(x, y)
      let cls = 'cell' + ((x + y) % 2 === 0 ? ' alt' : '')
      if (terrain.key !== 'flat') cls += ' ' + terrain.key

      if (x === BASE_POS.red.x && y === BASE_POS.red.y) cls += ' base-red'
      if (x === BASE_POS.blue.x && y === BASE_POS.blue.y) cls += ' base-blue'

      const field = fieldAt(x, y)
      if (field) {
        cls += ' well'
        if (field.owner) cls += ` well-${field.owner}`
      }

      if (moveSet.has(k)) cls += ' move'
      if (attackSet.has(k)) cls += ' attack'
      if (sel && sel.x === x && sel.y === y) cls += ' selected'

      el.className = cls
    }
  }
}

function renderUnits() {
  const alive = new Set()

  for (const u of state.units) {
    alive.add(u.id)
    let el = unitEls.get(u.id)
    if (!el) {
      el = document.createElement('div')
      el.innerHTML = `<span class="u-rank"></span><span class="u-emoji"></span><div class="u-hpbar"><i></i></div>`
      els.board.appendChild(el)
      unitEls.set(u.id, el)

      const emoji = el.querySelector('.u-emoji')
      if (emoji && emoji.animate) {
        emoji.animate(
          [
            { transform: 'scale(0.2)', opacity: 0 },
            { transform: 'scale(1.3)', opacity: 1, offset: 0.65 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 420, easing: 'ease-out' }
        )
      }
    }

    el.className =
      'unit side-' +
      u.side +
      (u.side === state.turn && u.acted ? ' spent' : '') +
      (state.selectedId === u.id ? ' selected' : '')

    el.style.setProperty('--ux', u.x)
    el.style.setProperty('--uy', u.y)
    el.querySelector('.u-emoji').textContent = u.emoji
    el.querySelector('.u-rank').textContent = u.rank > 0 ? '★'.repeat(u.rank) : ''

    const pct = Math.max(0, Math.min(100, (u.hp / u.maxHp) * 100))
    const fill = el.querySelector('.u-hpbar i')
    fill.style.width = pct + '%'
    fill.className = pct > 55 ? '' : pct > 25 ? 'mid' : 'low'
  }

  for (const [id, el] of unitEls) {
    if (!alive.has(id)) {
      el.remove()
      unitEls.delete(id)
    }
  }
}

function renderBases() {
  for (const side of ['red', 'blue']) {
    const el = baseEls[side]
    const pct = Math.max(0, (state.baseHp[side] / BASE_MAX_HP) * 100)
    const fill = el.querySelector('.u-hpbar i')
    fill.style.width = pct + '%'
    fill.className = pct > 55 ? '' : pct > 25 ? 'mid' : 'low'
  }
}

function renderHud() {
  els.redMoney.textContent = state.money.red
  els.blueMoney.textContent = state.money.blue
  els.shopMoney.textContent = state.money[state.turn]

  els.redBaseHp.textContent = Math.max(0, state.baseHp.red)
  els.blueBaseHp.textContent = Math.max(0, state.baseHp.blue)
  els.redBaseFill.style.width = Math.max(0, (state.baseHp.red / BASE_MAX_HP) * 100) + '%'
  els.blueBaseFill.style.width = Math.max(0, (state.baseHp.blue / BASE_MAX_HP) * 100) + '%'

  const redIncome = BASE_INCOME + state.fields.filter((f) => f.owner === 'red').length * FIELD_INCOME
  const blueIncome =
    BASE_INCOME +
    state.fields.filter((f) => f.owner === 'blue').length * FIELD_INCOME +
    (state.mode === 'ai' ? state.levelConfig.aiIncome : 0)
  els.redIncome.textContent = `+${redIncome}/回合`
  els.blueIncome.textContent = `+${blueIncome}/回合`

  els.redCapture.textContent = state.baseProgress.blue
    ? `⚠ 基地被占领 ${state.baseProgress.blue}/${BASE_CAPTURE_TURNS}`
    : ''
  els.blueCapture.textContent = state.baseProgress.red
    ? `⚠ 基地被占领 ${state.baseProgress.red}/${BASE_CAPTURE_TURNS}`
    : ''

  els.turnSide.textContent = state.aiThinking ? '电脑思考中' : sideName(state.turn)
  els.turnSide.className = 'turn-side ' + state.turn

  els.redPanel.classList.toggle('active', state.turn === 'red' && !state.gameOver)
  els.bluePanel.classList.toggle('active', state.turn === 'blue' && !state.gameOver)

  els.endTurnBtn.disabled = state.gameOver || !canHumanAct()

  if (state.mode === 'ai') {
    els.modeTag.textContent = `${state.levelConfig.name} · ${state.levelConfig.sub}`
    els.modeTag.hidden = false
  } else {
    els.modeTag.hidden = true
  }
}

function renderShop() {
  const canSpawn = !!findSpawn(state.turn)
  const interactive = canHumanAct() && !state.aiThinking
  for (const card of els.shop.querySelectorAll('.card')) {
    const type = UNIT_TYPES[card.dataset.type]
    const affordable = state.money[state.turn] >= type.cost
    card.disabled = state.gameOver || !interactive || !affordable || !canSpawn
  }
}

function renderInfo() {
  const hovered = state.units.find((x) => x.id === state.hoverId)
  if (hovered) {
    els.infoBody.innerHTML = unitInfoHtml(hovered)
    return
  }
  if (state.hoverType) {
    const t = UNIT_TYPES[state.hoverType]
    els.infoBody.innerHTML = `
      <div class="info-head">
        <span class="i-emoji">${t.emoji}</span>
        <span class="i-name">${t.name}</span>
      </div>
      <div class="info-grid">
        <span>生命 <b>${t.hp}</b></span>
        <span>攻击 <b>${t.atk || '—'}</b></span>
        <span>射程 <b>${t.range || '—'}</b></span>
        <span>移动 <b>${t.move}</b></span>
        <span>造价 <b>${t.cost}</b></span>
        <span>${t.splash ? '溅射 <b>' + t.splash + '</b>' : t.moveOrAttack ? '移动/攻击 <b>二选一</b>' : t.canCapture ? '可 <b>占领</b>' : '行动 <b>移动+攻击</b>'}</span>
      </div>
      <div class="info-desc">${t.desc}</div>`
    return
  }
  if (state.hoverCell) {
    els.infoBody.innerHTML = terrainInfoHtml(state.hoverCell.x, state.hoverCell.y)
    return
  }
  const selected = getSelected()
  if (selected) {
    els.infoBody.innerHTML = unitInfoHtml(selected)
    return
  }
  els.infoBody.innerHTML = `<div class="info-empty">选中或悬停一个单位查看属性</div>`
}

function terrainInfoHtml(x, y) {
  const t = terrainAt(x, y)
  const cost = Number.isFinite(t.move) ? t.move : '—'
  return `
    <div class="info-head">
      <span class="i-emoji">${t.icon}</span>
      <span class="i-name">${t.name}</span>
    </div>
    <div class="info-grid">
      <span>移动消耗 <b>${cost}</b></span>
      <span>坐标 <b>${x}, ${y}</b></span>
    </div>
    <div class="info-desc">${t.effect}</div>`
}

function unitInfoHtml(u) {
  const status = u.acted ? '本回合已行动' : u.moved ? '已移动，可继续攻击' : '可移动 + 攻击'
  const rank = RANKS[u.rank]
  const t = terrainAt(u.x, u.y)
  const terrain =
    t.key === 'flat' ? '平地' : `${t.name}（${t.effect}）`
  return `
    <div class="info-head">
      <span class="i-emoji">${u.emoji}</span>
      <span class="i-name">${u.name}</span>
      <span class="i-side ${u.side}">${sideName(u.side)}</span>
    </div>
    <div class="info-rank">
      <span class="rank-name ${u.rank ? 'has-rank' : ''}">${rank.name}</span>
      <span class="rank-stars">${u.rank ? '★'.repeat(u.rank) : ''}</span>
      <span class="rank-kills">击杀 ${u.kills}</span>
      ${u.rank < RANKS.length - 1 ? `<span class="rank-next">距下一军衔 ${RANKS[u.rank + 1].kills - u.kills}</span>` : '<span class="rank-next">已达最高军衔</span>'}
    </div>
    <div class="info-grid">
      <span>生命 <b>${Math.max(0, u.hp)} / ${u.maxHp}</b></span>
      <span>当前伤害 <b>${u.atk ? damageOf(u) : '—'}</b></span>
      <span>射程 <b>${u.range || '—'}${isHill(u.x, u.y) && u.range ? ' (+1)' : ''}</b></span>
      <span>移动 <b>${u.move}</b></span>
      <span>坐标 <b>${u.x}, ${u.y}</b></span>
      <span>地形 <b>${terrain}</b></span>
    </div>
    <div class="info-status">${status}</div>`
}

function renderLog() {
  els.log.innerHTML = state.log
    .map((e) => `<div class="log-entry ${e.side}">${escapeHtml(e.text)}</div>`)
    .join('')
}

// ───────── 提示 / 横幅 / 飘字 ─────────
function setHint(text, warn = false) {
  els.hint.textContent = text || '点击己方单位选择，绿色格可移动，红色格可攻击'
  els.hint.className = 'hint' + (warn ? ' warn' : '')
  clearTimeout(hintTimer)
  if (text) {
    hintTimer = setTimeout(() => {
      els.hint.textContent = '点击己方单位选择，绿色格可移动，红色格可攻击'
      els.hint.className = 'hint'
    }, 2600)
  }
}

function showBanner(side) {
  els.banner.textContent = `${sideName(side)}回合`
  els.banner.className = 'banner ' + side
  void els.banner.offsetWidth
  els.banner.classList.add('show')
}

function floatText(x, y, text, cls) {
  const el = document.createElement('div')
  el.className = `float-text ${cls}`
  el.style.setProperty('--fx', x)
  el.style.setProperty('--fy', y)
  el.textContent = text
  els.board.appendChild(el)
  setTimeout(() => el.remove(), 900)
}

function pulse(el) {
  if (!el || !el.animate) return
  el.animate(
    [{ filter: 'brightness(2.2) saturate(1.6)' }, { filter: 'brightness(1) saturate(1)' }],
    { duration: 280, easing: 'ease-out' }
  )
}

function addLog(side, text, faint = false) {
  if (!state) return
  state.log.unshift({ side, text, faint })
  if (state.log.length > 60) state.log.length = 60
  renderLog()
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ───────── 事件 ─────────
function bindEvents() {
  els.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell')
    if (!cell) return
    cellClicked(Number(cell.dataset.x), Number(cell.dataset.y))
  })

  els.board.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.cell')
    if (!cell) return
    const x = Number(cell.dataset.x)
    const y = Number(cell.dataset.y)
    const u = unitAt(x, y)
    const id = u ? u.id : null
    const cellChanged =
      !u && (!state.hoverCell || state.hoverCell.x !== x || state.hoverCell.y !== y)
    if (state.hoverId !== id || cellChanged) {
      state.hoverId = id
      state.hoverCell = u ? null : { x, y }
      renderInfo()
    }
  })

  els.board.addEventListener('mouseleave', () => {
    if (state.hoverId || state.hoverCell) {
      state.hoverId = null
      state.hoverCell = null
      renderInfo()
    }
  })

  els.shop.addEventListener('click', (e) => {
    const card = e.target.closest('.card')
    if (!card || card.disabled) return
    buy(card.dataset.type)
  })

  els.shop.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.card')
    if (!card) return
    if (state.hoverType !== card.dataset.type) {
      state.hoverType = card.dataset.type
      renderInfo()
    }
  })

  els.shop.addEventListener('mouseleave', () => {
    state.hoverType = null
    renderInfo()
  })

  els.endTurnBtn.addEventListener('click', endTurn)
  els.restartBtn.addEventListener('click', () => {
    els.overlay.hidden = true
    init(state.mode, state.level)
  })

  els.helpBtn.addEventListener('click', () => {
    els.helpOverlay.hidden = false
  })
  els.closeHelpBtn.addEventListener('click', () => {
    els.helpOverlay.hidden = true
  })
  els.helpOverlay.addEventListener('click', (e) => {
    if (e.target === els.helpOverlay) els.helpOverlay.hidden = true
  })

  els.menuBtn.addEventListener('click', () => {
    els.resumeBtn.hidden = false
    els.menuOverlay.hidden = false
  })

  els.resumeBtn.addEventListener('click', () => {
    els.menuOverlay.hidden = true
  })

  els.pvpBtn.addEventListener('click', () => {
    els.menuOverlay.hidden = true
    init('pvp', 1)
  })

  els.levelGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.level-card')
    if (!card) return
    els.menuOverlay.hidden = true
    init('ai', Number(card.dataset.level))
  })

  els.menuHelpBtn.addEventListener('click', () => {
    els.helpOverlay.hidden = false
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (state.gameOver) return
      if (e.target && /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) return
      e.preventDefault()
      endTurn()
    }
  })
}

// ───────── 商店 / 关卡卡片 ─────────
function buildShop() {
  els.shop.innerHTML = UNIT_ORDER.map((k) => {
    const t = UNIT_TYPES[k]
    const special = t.splash
      ? `溅射${t.splash}`
      : t.moveOrAttack
        ? '移动/攻击二选一'
        : t.canCapture
          ? '占领'
          : '强力'
    return `
      <button class="card" data-type="${k}" type="button">
        <span class="c-emoji">${t.emoji}</span>
        <span class="c-name">${t.name}</span>
        <span class="c-cost">${t.cost}</span>
        <span class="c-stats">血 ${t.hp} · 攻 ${t.atk || '—'} · 程 ${t.range || '—'} · 移 ${t.move} · ${special}</span>
      </button>`
  }).join('')
}

function buildLegend() {
  const order = ['.', 'H', 'F', 'M', 'B', 'W', '#']
  els.legend.innerHTML = order
    .map((ch) => {
      const t = TERRAIN[ch]
      return `<span class="lg-item" title="${t.effect}"><span class="lg-icon">${t.icon}</span>${t.name}</span>`
    })
    .join('')
}

function buildLevels() {
  els.levelGrid.innerHTML = LEVELS.map(
    (l) => `
      <button class="level-card" data-level="${l.id}" type="button">
        <span class="lv-num">${l.id}</span>
        <span class="lv-main">
          <span class="lv-name">${l.name} · ${l.sub}</span>
          <span class="lv-desc">${l.desc}</span>
        </span>
        <span class="lv-arrow">▶</span>
      </button>`
  ).join('')
}

// ───────── 启动 ─────────
function boot() {
  const ids = [
    'board', 'banner', 'hint', 'legend', 'turnSide', 'endTurnBtn',
    'redMoney', 'blueMoney', 'redBaseHp', 'blueBaseHp', 'redBaseFill', 'blueBaseFill',
    'redPanel', 'bluePanel', 'shop', 'shopMoney', 'infoBody', 'log',
    'overlay', 'overlayIcon', 'overlayTitle', 'overlaySub', 'restartBtn',
    'helpBtn', 'helpOverlay', 'closeHelpBtn',
    'menuOverlay', 'pvpBtn', 'levelGrid', 'menuHelpBtn', 'menuBtn', 'resumeBtn',
    'redIncome', 'blueIncome', 'redCapture', 'blueCapture', 'modeTag', 'versionTag',
  ]
  for (const id of ids) els[id] = document.getElementById(id)

  if (els.versionTag) els.versionTag.textContent = VERSION

  buildShop()
  buildLevels()
  buildLegend()
  bindEvents()
  init('pvp', 1)
  els.resumeBtn.hidden = true
  els.menuOverlay.hidden = false
}

boot()

// 调试接口
window.__war = {
  get state() {
    return state
  },
  get map() {
    return MAP
  },
  generateMap,
  init,
  endTurn,
  render,
  makeUnit,
  cellClicked,
  doMove,
  doAttackUnit,
  doAttackBase,
  canHumanAct,
  UNIT_TYPES,
  LEVELS,
  RANKS,
  VERSION,
}

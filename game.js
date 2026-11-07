'use strict'

/* ============================================================
 * 小小大战争 · 双人对战 / 关卡模式
 * 红蓝双方轮流行动：购买兵种、移动、攻击、占领油井与基地
 * ============================================================ */

// ───────── 常量 ─────────
const COLS = 13
const ROWS = 9

const BASE_MAX_HP = 1000
const START_MONEY = 400
const BASE_INCOME = 150
const FIELD_INCOME = 50
const BASE_CAPTURE_TURNS = 2

const BASE_POS = {
  red: { x: 0, y: 4 },
  blue: { x: 12, y: 4 },
}

const SPAWN_POS = {
  red: [
    { x: 1, y: 3 },
    { x: 1, y: 4 },
    { x: 1, y: 5 },
  ],
  blue: [
    { x: 11, y: 3 },
    { x: 11, y: 4 },
    { x: 11, y: 5 },
  ],
}

// 红蓝各有一块油田（左右对称），工程师可以互相夺取
const FIELD_POS = [
  { x: 4, y: 2 },
  { x: 8, y: 6 },
]

const ROCKS = new Set(['3,2', '3,6', '9,2', '9,6', '6,4'])

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
    desc: '最基础的单位。射程 2，对砍一刀打掉对方 75% 生命，便宜、耐打、数量优势。',
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
    moveOrAttack: true,
    desc: '射程 6，一击必杀步兵、工程师、手榴弹兵。移动后不能攻击，且非常脆。',
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
    desc: '没有攻击力。站在油田上，下一回合开始即可占领（+50/回合）；站在敌方基地旁 2 回合可占领基地获胜。',
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
    desc: '射程 3 投掷手榴弹，对目标造成 80 伤害，并对其周围敌人造成 40 溅射伤害。',
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

// ───────── 状态 ─────────
let state = null
let unitSeq = 1
let hintTimer = null
let aiTimer = null

const key = (x, y) => `${x},${y}`
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const sideName = (s) => (s === 'red' ? '红方' : '蓝方')
const enemyOf = (s) => (s === 'red' ? 'blue' : 'red')

// ───────── 初始化 ─────────
function init(mode = 'pvp', level = 1) {
  clearTimeout(aiTimer)
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
    fields: FIELD_POS.map((p, i) => ({ ...p, owner: i === 0 ? 'red' : 'blue' })),
    selectedId: null,
    hoverId: null,
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

  els.overlay.hidden = true
  els.helpOverlay.hidden = true
  els.menuOverlay.hidden = true
  els.log.innerHTML = ''
  addLog('sys', `战斗开始。${mode === 'ai' ? `关卡模式：${lv.name} · ${lv.sub}` : '双人对战'}，红方先手。`)

  startTurn('red', true)
}

function buildBoard() {
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

// ───────── 回合 ─────────
function startTurn(side, first = false) {
  state.turn = side
  state.selectedId = null
  state.aiThinking = false

  // 1. 占领结算（工程师上一回合站桩）
  if (!first) {
    resolveCaptures(side)
    if (state.gameOver) {
      render()
      return
    }
  }

  // 2. 收入
  const fieldCount = state.fields.filter((f) => f.owner === side).length
  let income = BASE_INCOME + fieldCount * FIELD_INCOME
  if (state.mode === 'ai' && side === 'blue') income += state.levelConfig.aiIncome
  state.money[side] += income
  addLog('sys', `${sideName(side)}回合开始，收入 +${income}（油田 ${fieldCount} 座）`)

  // 3. 重置本方单位
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

// 内部切回合（AI 也走这里）
function switchTurn() {
  if (state.gameOver) return
  if (state.turn === 'blue') state.round++
  startTurn(enemyOf(state.turn))
}

function resolveCaptures(side) {
  // 油田：工程师站在敌方/中立油田上，一回合结算
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

  // 基地：工程师站在敌方基地旁，两回合占领
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

// ───────── 购买 ─────────
function findSpawn(side) {
  for (const p of SPAWN_POS[side]) {
    if (ROCKS.has(key(p.x, p.y))) continue
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
    if (side === 'red') setHint('兵营周围没有空位，先让单位走开', true)
    return false
  }

  state.money[side] -= type.cost
  const u = makeUnit(type, side, spot.x, spot.y)
  u.moved = true
  u.acted = true
  state.units.push(u)
  addLog(side, `${sideName(side)}购买 ${type.name}`)
  if (side === 'red') setHint(`${type.name} 已部署，本回合不能行动`)
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
    atk: type.atk,
    range: type.range,
    move: type.move,
    splash: type.splash || 0,
    canCapture: !!type.canCapture,
    moveOrAttack: !!type.moveOrAttack,
    moved: false,
    acted: false,
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

function damageOf(u) {
  return Math.max(1, Math.round((u.atk * u.hp) / u.maxHp))
}

function splashOf(u) {
  return Math.max(1, Math.round((u.splash * u.hp) / u.maxHp))
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
  return dist(u, target) <= u.range
}

function canAttackBase(u) {
  if (u.acted || u.atk <= 0) return false
  if (u.moveOrAttack && u.moved) return false
  return dist(u, enemyBasePos(u.side)) <= u.range
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
  const dmg = damageOf(u)
  target.hp -= dmg
  u.acted = true
  u.moved = true
  state.selectedId = null

  floatText(target.x, target.y, `-${dmg}`, 'dmg')
  pulse(unitEls.get(target.id))
  addLog(u.side, `${u.name} 攻击 ${target.name}，造成 ${dmg} 伤害`)

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
    }
  }

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

// ───────── 可达范围 ─────────
function reachable(unit) {
  const blocked = new Set()
  for (const u of state.units) if (u.id !== unit.id) blocked.add(key(u.x, u.y))
  blocked.add(key(BASE_POS.red.x, BASE_POS.red.y))
  blocked.add(key(BASE_POS.blue.x, BASE_POS.blue.y))

  const seen = new Set([key(unit.x, unit.y)])
  const q = [{ x: unit.x, y: unit.y, d: 0 }]
  const out = []

  while (q.length) {
    const cur = q.shift()
    if (cur.d >= unit.move) continue
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const nx = cur.x + dx
      const ny = cur.y + dy
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
      const k = key(nx, ny)
      if (seen.has(k) || blocked.has(k) || ROCKS.has(k)) continue
      seen.add(k)
      out.push({ x: nx, y: ny })
      q.push({ x: nx, y: ny, d: cur.d + 1 })
    }
  }
  return out
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
  // 工程师：已在敌方基地旁并开始占领，原地继续
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
  for (const e of state.units) {
    if (e.side === u.side) continue
    if (dist(pos, e) <= u.range) list.push({ kind: 'unit', unit: e })
  }
  const eb = enemyBasePos(u.side)
  if (dist(pos, eb) <= u.range) list.push({ kind: 'base' })
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
  const dmg = damageOf(u)
  if (t.kind === 'base') {
    const hp = state.baseHp[enemyOf(u.side)]
    return 90 + dmg * 0.2 + (dmg >= hp ? 900 : 0)
  }
  const e = t.unit
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
    if (dist(e, pos) <= e.range + e.move) danger += damageOf(e) * 0.4
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
      let cls = 'cell' + ((x + y) % 2 === 0 ? ' alt' : '')

      if (ROCKS.has(k)) cls += ' rock'
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
      el.innerHTML = `<span class="u-emoji"></span><div class="u-hpbar"><i></i></div>`
      els.board.appendChild(el)
      unitEls.set(u.id, el)

      // 出生动画，让新买的单位一眼可见
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
  const id = state.hoverId || state.selectedId
  const u = state.units.find((x) => x.id === id)
  if (u) {
    els.infoBody.innerHTML = unitInfoHtml(u)
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
  els.infoBody.innerHTML = `<div class="info-empty">选中或悬停一个单位查看属性</div>`
}

function unitInfoHtml(u) {
  const status = u.acted ? '本回合已行动' : u.moved ? '已移动，可继续攻击' : '可移动 + 攻击'
  const dmg = damageOf(u)
  return `
    <div class="info-head">
      <span class="i-emoji">${u.emoji}</span>
      <span class="i-name">${u.name}</span>
      <span class="i-side ${u.side}">${sideName(u.side)}</span>
    </div>
    <div class="info-grid">
      <span>生命 <b>${Math.max(0, u.hp)} / ${u.maxHp}</b></span>
      <span>当前伤害 <b>${u.atk ? dmg : '—'}</b></span>
      <span>射程 <b>${u.range || '—'}</b></span>
      <span>移动 <b>${u.move}</b></span>
      <span>坐标 <b>${u.x}, ${u.y}</b></span>
      <span>${u.splash ? '溅射 <b>' + splashOf(u) + '</b>' : ''}</span>
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
    const u = unitAt(Number(cell.dataset.x), Number(cell.dataset.y))
    const id = u ? u.id : null
    if (state.hoverId !== id) {
      state.hoverId = id
      renderInfo()
    }
  })

  els.board.addEventListener('mouseleave', () => {
    if (state.hoverId) {
      state.hoverId = null
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
    'board', 'banner', 'hint', 'turnSide', 'endTurnBtn',
    'redMoney', 'blueMoney', 'redBaseHp', 'blueBaseHp', 'redBaseFill', 'blueBaseFill',
    'redPanel', 'bluePanel', 'shop', 'shopMoney', 'infoBody', 'log',
    'overlay', 'overlayIcon', 'overlayTitle', 'overlaySub', 'restartBtn',
    'helpBtn', 'helpOverlay', 'closeHelpBtn',
    'menuOverlay', 'pvpBtn', 'levelGrid', 'menuHelpBtn', 'menuBtn', 'resumeBtn',
    'redIncome', 'blueIncome', 'redCapture', 'blueCapture', 'modeTag',
  ]
  for (const id of ids) els[id] = document.getElementById(id)

  buildShop()
  buildLevels()
  bindEvents()
  init('pvp', 1)
  els.resumeBtn.hidden = true
  els.menuOverlay.hidden = false
}

boot()

// 调试接口：浏览器控制台可用 __war.state 查看对局状态
window.__war = {
  get state() {
    return state
  },
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
}

const fs = require('fs'), vm = require('vm'), assert = require('assert/strict')
class El {
 constructor(){this.style={setProperty(){}};this.dataset={};this.children=[];this.classList={add(){},toggle(){}};this.hidden=false;this.value='land';this._html=''}
 set innerHTML(v){this._html=v;this.children=[]} get innerHTML(){return this._html}
 appendChild(e){this.children.push(e)} addEventListener(){} querySelector(){return new El()} querySelectorAll(){return []} remove(){} animate(){}
}
const nodes=new Map(), context={console,document:{createElement:()=>new El(),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id)}},window:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){}}
vm.createContext(context);vm.runInContext(fs.readFileSync('game.js','utf8'),context)
const w=context.window.__war
w.init('pvp',1,'island');assert.equal(w.map.length,11);assert(w.map.every(r=>r.length===19));assert.equal(w.state.supplies.length,1)
assert(w.doBuy('transport','red'));let ship=w.state.units[0];assert.equal(ship.x,4)
function unit(type,side,x,y){const u=w.makeUnit(w.UNIT_TYPES[type],side,x,y);w.state.units.push(u);return u}
let a=unit('infantry','red',3,4),b=unit('engineer','red',3,5)
assert(w.canBoard(a,ship));assert(w.boardUnit(a,ship));assert.equal(w.reachable(a).length,0)
w.doMove(ship,4,5);assert.equal(a.y,5);assert(w.boardUnit(b,ship));assert.equal(ship.cargo.length,2)
const c=unit('infantry','red',3,6);assert(!w.canBoard(c,ship))
w.doMove(ship,7,5);assert(w.canUnload(ship,8,5));assert(w.unloadUnit(ship,8,5));assert.equal(a.carrierId,null);assert(a.moved&&a.acted)
w.undo();ship=w.state.units.find(u=>u.type==='transport');assert.equal(ship.cargo.length,2)
ship.hp=0;w.cleanupDead();assert(!w.state.units.some(u=>u.carrierId===ship.id));assert(!w.state.units.some(u=>u.id===a.id))
w.init('pvp',1,'island');const torp=unit('torpedo','red',6,5),enemy=unit('gunboat','blue',6,6),inf=unit('infantry','blue',8,5)
assert(w.canAttack(torp,enemy));assert(!w.canAttack(torp,inf));assert(!w.canAttackBase(torp));assert(!w.reachable(torp).some(p=>p.x===8&&p.y===5))
const soldier=unit('infantry','red',9,5);soldier.hp=20;w.resolveSupplies('red');assert.equal(w.state.supplies[0].owner,'red');assert.equal(soldier.hp,50)
assert(!w.reachable(soldier).some(p=>w.map[p.y][p.x]==='W'))
w.init('pvp',1,'land');assert.equal(w.state.supplies.length,0);assert(!w.doBuy('transport','red'));assert(w.doBuy('infantry','red'))
w.init('pvp',1,'island');w.state.money.blue=3000;w.aiBuy();assert(w.state.units.some(u=>u.type==='transport'))
let landed=false
for(let round=0;round<18;round++){
 w.state.money.blue+=300;w.aiBuy()
 for(const u of [...w.state.units]) if(u.side==='blue'){u.moved=false;u.acted=false}
 for(const u of [...w.state.units]) if(u.side==='blue'&&!u.carrierId)w.aiActUnit(u)
 if(w.state.units.some(u=>u.side==='blue'&&!u.carrierId&&u.x>=8&&u.x<=10))landed=true
 const tiles=new Set();for(const u of w.state.units){if(u.carrierId)continue;const k=`${u.x},${u.y}`;assert(!tiles.has(k),'overlapping units');tiles.add(k)}
}
assert(landed,'AI should land on central island')
console.log('PASS: island/land switching, naval production, boarding/capacity, movement, unloading/undo, sinking, torpedo restrictions, supply capture/healing, AI fleet and landing (18 turns)')

// 战略目标、支援和撤销回归。
w.init('pvp',1,'land');w.state.round=3;w.updateDrops();assert.equal(w.state.drops.length,1)
const drop={...w.state.drops[0]},cash=w.state.money.red
const scout=unit('infantry','red',2,4);scout.hp=50
w.doMove(scout,drop.x,drop.y);assert.equal(w.state.money.red,cash+125);assert.equal(scout.hp,75);assert.equal(w.state.drops.length,0)
w.undo();assert.equal(w.state.money.red,cash);assert.equal(w.state.drops.length,1)
w.state.round=6;w.updateDrops();assert.equal(w.state.drops.length,0)
w.state.round=7;w.updateDrops();w.updateDrops();assert.equal(w.state.drops.length,1)
w.init('pvp',1,'land');let eng=unit('engineer','red',5,5),patient=unit('infantry','red',5,6);patient.hp=10
assert(w.repairUnit(eng,patient));assert.equal(patient.hp,55);assert(eng.acted);assert(!eng.moved);assert(!w.repairUnit(eng,patient))
w.undo();eng=w.state.units.find(u=>u.type==='engineer');patient=w.state.units.find(u=>u.type==='infantry');assert.equal(patient.hp,10);assert(!eng.acted)
const before=w.state.money.red;assert(w.rescue(patient));assert.equal(patient.hp,50);assert.equal(w.state.money.red,before-100);assert(!w.rescue(patient))
w.undo();assert.equal(w.state.money.red,before);assert.equal(w.state.rescueReady.red,1)
w.state.round=2;w.state.fields.find(p=>p.x===6&&p.y===5).owner='red';w.scoreTurn('red');assert.equal(w.state.score.red,0)
w.state.round=3;w.scoreTurn('red');assert.equal(w.state.score.red,1)
let blocker=unit('infantry','blue',6,4);w.scoreTurn('red');assert.equal(w.state.score.red,1)
blocker.x=15;w.state.round=12;w.scoreTurn('red');assert.equal(w.state.score.red,3)
w.state.score.red=19;w.scoreTurn('red');assert(w.state.gameOver);assert.match(nodes.get('overlaySub').textContent,/20/)
w.init('pvp',1,'island');w.state.round=3;w.state.supplies[0].owner='blue';w.scoreTurn('blue');assert.equal(w.state.score.blue,1)
console.log('PASS: timed drops/expiry/undo, engineer repair/action limits, rescue cost/cooldown/undo, strategic scoring/contesting/double points/victory')

// 用量桥的判定单测：node tools/test-bridge.mjs
//
// 只测纯函数 analyzeTurn（不发网络请求、不动任何数据）。
// 重点是这条回归：消息接口【只返回最近 50 条】，长对话的页里看不到 user 消息 ——
// 以前这会把它判成"不是用户会话"，导致桥跳到别的旧会话、再也不弹消耗提示。
import { analyzeTurn } from '../src/bridge.mjs'

const results = []
const say = (okFlag, name, detail = '') => {
  results.push(okFlag)
  console.log((okFlag ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''))
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let uid = 0
const mk = (type, created, cost = 0) => ({ id: type + '_' + (++uid), type, time: { created }, cost })

// ---------------------------------------------------------------------------
// T1 回归：页面被截断（= 上限条数）且**没有 user 消息** → 必须照常发布
// ---------------------------------------------------------------------------
{
  const page = []
  for (let i = 0; i < 48; i++) page.push(mk('assistant', 1000 + i, 0.001))
  page.push(mk('synthetic', 900))
  page.push({ id: 'idle-new', type: 'idle', time: { created: 1100 } })   // 共 50 条
  const r = analyzeTurn(page, { lastIdleId: 'idle-old', lastIdleTime: 900 })
  say(r.action === 'publish', 'T1 截断页(50 条)无 user 消息 → 仍然发布', 'action=' + r.action)
  say(r.userKnown === false, 'T1 且明确标注「归属不可判定」', 'userKnown=' + r.userKnown)
  say(r.entries.length === 48, 'T1 本轮窗口内的 assistant 全部计入', 'calls=' + r.entries.length)
  let usd = 0
  for (const m of r.entries) usd += m.cost
  say(Math.abs(usd - 0.048) < 1e-9, 'T1 金额合计正确', '$' + usd.toFixed(6))
}

// ---------------------------------------------------------------------------
// T2 短页且没有 user 消息 → 这才是真正的"不是用户会话"，要拦住
// ---------------------------------------------------------------------------
{
  const page = [mk('assistant', 100, 0.01), mk('assistant', 200, 0.01), { id: 'i1', type: 'idle', time: { created: 300 } }]
  const r = analyzeTurn(page, { lastIdleId: 'i0', lastIdleTime: 0 })
  say(r.action === 'not-user', 'T2 短页无 user 消息 → 判为非用户会话', 'action=' + r.action)
  say(r.userKnown === true, 'T2 且标注「归属可判定」', 'userKnown=' + r.userKnown)
}

// ---------------------------------------------------------------------------
// T3 回归：截断页只剩 1 条 idle → 用「上次观测到的 idle 时刻」当起点，
//    不能把上一轮/上几轮的消耗也算进来（否则金额会虚高）
// ---------------------------------------------------------------------------
{
  const page = []
  for (let i = 0; i < 49; i++) page.push(mk('assistant', i < 20 ? 500 : 2000, 0.01))  // 前 20 条属于上一轮
  page.push({ id: 'idle-2', type: 'idle', time: { created: 2500 } })
  const r = analyzeTurn(page, { lastIdleId: 'idle-1', lastIdleTime: 1000 })
  say(r.action === 'publish', 'T3 截断页只有 1 条 idle → 仍然发布', 'action=' + r.action)
  say(r.entries.length === 29, 'T3 只算本轮窗口内的（没把上一轮的 20 条算进来）', 'calls=' + r.entries.length + '（若为 49 就是虚高）')
}

// ---------------------------------------------------------------------------
// T4 正常页（含 user + 两条 idle）→ 用"上一条 idle"当起点
// ---------------------------------------------------------------------------
{
  const page = [
    mk('user', 10), mk('assistant', 20, 0.02), { id: 'i1', type: 'idle', time: { created: 30 } },
    mk('user', 40), mk('assistant', 50, 0.05), mk('assistant', 60, 0.03), { id: 'i2', type: 'idle', time: { created: 70 } },
  ]
  const r = analyzeTurn(page, { lastIdleId: 'i1', lastIdleTime: 30 })
  say(r.action === 'publish', 'T4 正常页 → 发布', 'action=' + r.action)
  say(r.entries.length === 2 && eq(r.entries.map((m) => m.cost), [0.05, 0.03]), 'T4 只取本轮的两条调用', 'calls=' + r.entries.length)
  say(r.latestId === 'i2' && r.latestTime === 70, 'T4 记录最新 idle 与其时刻', r.latestId + '@' + r.latestTime)
}

// ---------------------------------------------------------------------------
// T5 首次观测 / 重复 / 无 idle / 无花费
// ---------------------------------------------------------------------------
{
  const page = [mk('user', 10), mk('assistant', 20, 0.02), { id: 'i9', type: 'idle', time: { created: 30 } }]
  const base = analyzeTurn(page, { lastIdleId: null, lastIdleTime: 0 })
  say(base.action === 'baseline' && base.latestId === 'i9', 'T5 首次观测 → 只记基准不发布', 'action=' + base.action)

  const dup = analyzeTurn(page, { lastIdleId: 'i9', lastIdleTime: 30 })
  say(dup.action === 'duplicate', 'T5 同一个 idle 再拉 → 不重复发布', 'action=' + dup.action)

  const noIdle = analyzeTurn([mk('user', 10), mk('assistant', 20, 0.02)], { lastIdleId: 'x', lastIdleTime: 0 })
  say(noIdle.action === 'no-idle', 'T5 页里没有 idle → 跳过', 'action=' + noIdle.action)

  const noCost = analyzeTurn([mk('user', 10), { id: 'i7', type: 'idle', time: { created: 30 } }], { lastIdleId: 'i6', lastIdleTime: 5 })
  say(noCost.action === 'no-cost', 'T5 本轮没有任何计费调用 → 跳过（但会记住 idle）', 'action=' + noCost.action)
  say(noCost.latestId === 'i7', 'T5 且返回最新 idle 供调用方记账', String(noCost.latestId))
}

// ---------------------------------------------------------------------------
// T6 截断页 + 无 idle → 不能误判成 not-user（先看 idle，再谈归属）
// ---------------------------------------------------------------------------
{
  const page = []
  for (let i = 0; i < 50; i++) page.push(mk('assistant', 100 + i, 0.001))
  const r = analyzeTurn(page, { lastIdleId: 'x', lastIdleTime: 0 })
  say(r.action === 'no-idle', 'T6 截断页无 idle → no-idle（不是 not-user）', 'action=' + r.action)
}

const fails = results.filter((r) => !r).length
console.log('\n===== ' + (results.length - fails) + '/' + results.length + ' 通过 =====')
process.exitCode = fails ? 1 : 0

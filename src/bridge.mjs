// OpenCode 用量桥：把「一轮对话」的消耗喂给挂件的「每轮消耗」端点。
//
// 与原版（DSH）语义对齐：
//   · 一轮 = 用户发言 → 模型答完。OpenCode 在一轮结束时写一条 `idle` 消息，
//     它就是原版宿主 `turn/end` 事件的等价物。
//   · 轮结束时才发布一次 seq/amount：挂件前端因此保持原版行为 ——
//     响一次「任务结束音」+ 弹一次「本轮消耗金额」泡泡。
//   · amount = 本轮所有模型调用（assistant 消息）的 cost 合计，逐轮取自消息级 cost，
//     与轮询间隔无关，不会因为轮询抖动丢数字。
// 数据来源：OpenCode 本地服务 HTTP API（Basic 鉴权：opencode : service.json.password）
//
// 两处防坑：
//   ① 归属：只在「含用户消息」的会话上记账。子代理会话（task 工具起的）没有 user 消息，
//      否则并行跑子代理时，花费会被记到它头上。
//   ② 开销：用 `session.time.idle`（= 最近一次「变空闲」的时刻）做门控，只在轮结束时
//      才拉一次消息列表；之前是「会话有更新就拉」，一轮对话里会反复拉全量。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { setOverride, DATA } from './shim.mjs'

const SERVICE_JSON = path.join(os.homedir(), '.config', 'opencode', 'service.json')
// OpenCode 的 cost 以美元计价（模型 cost tier）；换算成人民币便于和余额同币种显示。
// 设 WHALE_USD_CNY=0 可关闭换算，直接显示原始数值。
const USD_CNY = Number(process.env.WHALE_USD_CNY ?? 7.1)
const POLL_MS = Number(process.env.WHALE_POLL_MS || 2000)
const PICK_LIMIT = 6          // 归属筛选最多检查几个候选会话
const USER_CACHE_TTL = 10 * 60 * 1000  // 「不是用户会话」的判定缓存（子代理会话不会再收到用户消息）
const MSG_CACHE_TTL = 60 * 1000

function readPassword() {
  try { return JSON.parse(fs.readFileSync(SERVICE_JSON, 'utf8')).password || '' } catch { return '' }
}

let password = readPassword()
let baseUrl = ''
let discoverAt = 0
let seq = 0
let lastTurn = null
let lastSessionId = null  // 会话切换时重置基线
let lastIdleId = null     // 已发布的「轮结束」标记（idle 消息 id）
let lastIdleAt = 0        // session.time.idle 门控：没变就不拉消息
let turnBusy = false

// sessionID -> { arr, at }          消息缓存（给归属判定复用，省请求）
// sessionID -> { hasUser, at }      「是否用户会话」判定缓存
const messageCache = new Map()
const userSessionCache = new Map()

function basicAuth() {
  return 'Basic ' + Buffer.from('opencode:' + password).toString('base64')
}

// —— 服务地址发现（全程不起 shell）——
// 地址缓存：上次成功过的 URL 写在数据目录里，重启时先试它（一次 HTTP，零子进程）。
const URL_CACHE_FILE = path.join(DATA, 'opencode-url.json')

function readCachedUrl() {
  try { return String(JSON.parse(fs.readFileSync(URL_CACHE_FILE, 'utf8')).url || '') } catch { return '' }
}

function writeCachedUrl(url) {
  try { fs.writeFileSync(URL_CACHE_FILE, JSON.stringify({ url, at: Date.now() }), 'utf8') } catch { /* ignore */ }
}

// 只认真正的 .exe：npm 装的 opencode.cmd / opencode.ps1 需要 shell，刻意跳过
function findOpencodeExe() {
  const cands = [
    process.env.OPENCODE_BIN,
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'),
    path.join(os.homedir(), '.bun', 'bin', 'opencode.exe'),
  ]
  for (const p of cands) {
    try { if (p && fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, 'opencode.exe')
    try { if (fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return ''
}

async function pingUrl(url) {
  try {
    const r = await fetch(url + '/api/info', { headers: { Authorization: basicAuth() }, signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch { return false }
}

// 直接执行 opencode.exe（execFile + windowsHide，无 shell、无参数拼接）
function askCliForUrl() {
  return new Promise((resolve) => {
    const exe = findOpencodeExe()
    if (!exe) return resolve('')
    try {
      execFile(exe, ['api', 'get', '/api/info'], { timeout: 20000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve('')
        try { const j = JSON.parse(String(stdout)); resolve((j.urls && j.urls[0]) || '') } catch { resolve('') }
      })
    } catch { resolve('') }
  })
}

async function discoverBaseUrl() {
  // 不起 shell：PATH 上的 `opencode` 是 npm 的 .ps1/.cmd shim，必须经 shell 才能执行 ——
  // 那正是杀软最敏感的行为（起 shell + 跑陌生二进制）。这里的优先级：
  //   ① 环境变量 WHALE_OPENCODE_URL（需要手填/调试时用）
  //   ② 上次成功过的地址（DATA/opencode-url.json）—— 只发一次 HTTP 探活，零子进程
  //   ③ 直接执行真实的 opencode.exe（不带 shell）问它自己，并缓存结果
  const env = String(process.env.WHALE_OPENCODE_URL || '').replace(/\/+$/, '')
  if (env && await pingUrl(env)) return env

  const cached = readCachedUrl()
  if (cached && await pingUrl(cached)) return cached

  const fromCli = await askCliForUrl()
  if (fromCli) {
    writeCachedUrl(fromCli)
    console.log('[bridge] OpenCode 服务地址（来自 opencode.exe）:', fromCli)
    return fromCli
  }
  if (!findOpencodeExe()) {
    console.log('[bridge] 未找到 opencode.exe；可用 WHALE_OPENCODE_URL 或 OPENCODE_BIN 手动指定')
  }
  return ''
}

async function apiGet(p) {
  const res = await fetch(baseUrl + p, { headers: { Authorization: basicAuth() }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

function isEmptyCache(map, limit) {
  if (map.size <= limit) return
  const oldest = [...map.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0)).slice(0, map.size - limit)
  for (const [k] of oldest) map.delete(k)
}

async function fetchMessages(id, force) {
  const hit = messageCache.get(id)
  if (!force && hit && Date.now() - hit.at < MSG_CACHE_TTL) return hit.arr
  const res = await apiGet('/api/session/' + encodeURIComponent(id) + '/message')
  const arr = (res && (res.data || res)) || []
  messageCache.set(id, { arr, at: Date.now() })
  isEmptyCache(messageCache, 20)
  return Array.isArray(arr) ? arr : []
}

function hasUserMessage(arr) {
  return Array.isArray(arr) && arr.some((m) => m && m.type === 'user')
}

function rememberUserSession(id, hasUser) {
  userSessionCache.set(id, { hasUser, at: Date.now() })
  isEmptyCache(userSessionCache, 40)
}

// 这个会话是「用户在用的会话」吗？（子代理会话没有 user 消息 → 不参与记账）
async function isUserSession(id) {
  const hit = userSessionCache.get(id)
  if (hit) {
    if (hit.hasUser) return true
    if (Date.now() - hit.at < USER_CACHE_TTL) return false
  }
  try {
    const arr = await fetchMessages(id, false)
    const ok = hasUserMessage(arr)
    rememberUserSession(id, ok)
    return ok
  } catch {
    return true // 拿不到就当作可用，别把功能整个卡死
  }
}

// 归属策略：
//   ① 只认主会话：`agent` 必须是字符串。子代理会话（task 工具起的）agent 是 undefined，
//      而且它们同样含 user 消息 —— 光看「有没有 user 消息」挡不住它们。
//   ② running（出现在 /api/session/active 里）优先：用户正在跑的会话就是他此刻在用的，
//      这样任何会话跑完一轮都能准确对应到"他的任务"，不会串到别的空闲聊天上。
//   ③ 同档内按 `viewed` 最新 → `updated` 最新排序（viewed = 用户最后查看该会话的时刻）。
//   ④ 稳定优先：上次选中的会话若仍在 running 档里就继续用它，避免多个 running 会话来回跳。
function isRootSession(s) {
  return !!s && s.id && typeof s.agent === 'string' && s.agent.length > 0
}

async function pickSession() {
  // /api/session/active 的两种返回形态：
  //   旧版：{ id, ... } 直接就是会话；新版：{ data: { ses_xxx: { type: 'running' } } } 是「id → 状态」映射
  const activeIds = []
  try {
    const active = await apiGet('/api/session/active')
    const d = active && (active.data || active)
    if (d && typeof d === 'object') {
      if (typeof d.id === 'string') {
        const list0 = await apiGet('/api/session')
        const arr0 = (list0 && (list0.data || list0)) || []
        const hit = Array.isArray(arr0) ? arr0.find((s) => s && s.id === d.id) : null
        return hit || d
      }
      for (const k of Object.keys(d)) if (/^ses_/.test(k)) activeIds.push(k)
    }
  } catch { /* ignore */ }

  const list = await apiGet('/api/session')
  const arr = (list && (list.data || list)) || []
  if (!Array.isArray(arr) || !arr.length) return null

  const byViewed = (a, b) =>
    (((b.time && b.time.viewed) || 0) - ((a.time && a.time.viewed) || 0)) ||
    (((b.time && b.time.updated) || 0) - ((a.time && a.time.updated) || 0))

  const roots = arr.filter(isRootSession)
  const running = roots.filter((s) => activeIds.includes(s.id)).sort(byViewed)
  const others = roots.filter((s) => !activeIds.includes(s.id)).sort(byViewed)

  if (lastSessionId) {
    const stick = running.find((s) => s.id === lastSessionId)
    if (stick) return stick
  }

  const ordered = [...running, ...others]
  for (const s of ordered.slice(0, PICK_LIMIT)) {
    if (await isUserSession(s.id)) return s
  }
  return null
}

function sumTokens(msgs) {
  const out = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  for (const m of msgs) {
    const t = m.tokens || {}
    out.input += Number(t.input) || 0
    out.output += Number(t.output) || 0
    out.reasoning += Number(t.reasoning) || 0
    out.cache.read += (t.cache && Number(t.cache.read)) || 0
    out.cache.write += (t.cache && Number(t.cache.write)) || 0
  }
  return out
}

// 轮结束检测：会话消息里最新一条 `idle` 就是「这一轮答完了」。
// 新 idle 出现 → 把「上一条 idle 之后 ~ 这条 idle 之前」的所有 assistant 消息算作本轮消耗，发布一次。
async function pollTurn(session) {
  if (turnBusy || !session || !session.id) return

  if (lastSessionId !== session.id) {
    // 切会话：重置基线，避免把上一会话的 idle 当成本轮的
    lastSessionId = session.id
    lastIdleId = null
    lastIdleAt = 0
    const dir = (session.location && session.location.directory) || ''
    console.log('[bridge] tracking session ' + session.id.slice(0, 12) + '  agent=' + session.agent + '  dir=' + dir)
  }

  // ② 开销门控：time.idle 只在「一轮结束」时变化 → 一轮最多拉一次消息列表
  const idleAt = (session.time && session.time.idle) || 0
  if (idleAt && idleAt === lastIdleAt) return
  if (idleAt) lastIdleAt = idleAt

  turnBusy = true
  try {
    const arr = await fetchMessages(session.id, true)

    // ① 归属：只认「含用户消息」的会话（子代理/系统会话不记账）
    const hasUser = hasUserMessage(arr)
    rememberUserSession(session.id, hasUser)
    if (!hasUser) return

    const idles = []
    const assistants = []
    for (const m of arr) {
      if (!m || !m.time || typeof m.time.created !== 'number') continue
      if (m.type === 'idle') idles.push(m)
      else if (m.type === 'assistant' && Number(m.cost)) assistants.push(m)
    }
    if (!idles.length) return
    idles.sort((a, b) => a.time.created - b.time.created)

    const latest = idles[idles.length - 1]
    // 首次观测：只记基准，不发布（避免把启动前的老账翻出来）
    if (lastIdleId === null) { lastIdleId = latest.id; return }
    if (latest.id === lastIdleId) return

    const prevIdle = idles[idles.length - 2] || null
    lastIdleId = latest.id

    const from = prevIdle ? prevIdle.time.created : 0
    const to = latest.time.created
    const turnCost = assistants.filter((m) => m.time.created > from && m.time.created < to)
    if (!turnCost.length) return

    let usd = 0
    for (const m of turnCost) usd += Number(m.cost) || 0

    seq += 1
    lastTurn = {
      turn: seq,
      amount: USD_CNY > 0 ? usd * USD_CNY : usd,
      tokens: sumTokens(turnCost),
      calls: turnCost.length,
      ts: Date.now(),
    }
    console.log('[bridge] turn', seq, 'session', session.id.slice(0, 12), 'calls', turnCost.length,
      'cost$', usd.toFixed(6), '-> amount', lastTurn.amount.toFixed(4))
  } catch (err) {
    // 消息接口不可用（旧版 host / 权限变化）：静默跳过，下一轮再试
  } finally {
    turnBusy = false
  }
}

async function poll() {
  if (!password) password = readPassword()

  // 只在「还没地址」时发现；失败后按 10 秒冷却重试，避免异常时反复起子进程
  if (!baseUrl && Date.now() - discoverAt > 10000) {
    discoverAt = Date.now()
    const u = await discoverBaseUrl()
    if (u) baseUrl = u
  }
  if (!baseUrl) return

  let session
  try { session = await pickSession() } catch (err) {
    // 服务可能重启换了端口：清掉地址，冷却后重新发现（下一轮会用缓存/CLI 重新问）
    baseUrl = ''
    return
  }
  if (!session) return

  await pollTurn(session)
}

// 与原版 host 的 last-turn.json 同形状：seq 递增即代表「新的一轮结束」，前端据此响铃 + 弹泡泡
function lastTurnHandler(_req, res) {
  const payload = lastTurn
    ? { ok: true, seq, turn: lastTurn.turn, amount: lastTurn.amount, tokens: lastTurn.tokens, calls: lastTurn.calls, ts: lastTurn.ts }
    : { ok: true, seq, turn: null, amount: null, tokens: null, calls: null, ts: null }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

export function startBridge() {
  setOverride('/dsh-whale/last-turn.json', lastTurnHandler)
  const tick = () => { poll().catch((e) => { console.log('[bridge] poll error:', e && e.message) }) }
  tick()
  const t = setInterval(tick, POLL_MS)
  if (t.unref) t.unref()
  console.log('[bridge] OpenCode usage bridge started (turn-end driven, poll ' + POLL_MS + 'ms, USD->CNY ' + USD_CNY + ')')
  return () => clearInterval(t)
}

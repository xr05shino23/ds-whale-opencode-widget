// DSH host shim —— 让原版 dsh-whale-widget 插件在普通 Node 进程里原样运行。
// 目标：前端 whale-widget.js 一行不改，21 个 /dsh-whale/* 端点全部由原插件提供。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLACEHOLDER_IMAGE } from './placeholder.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
export const VENDOR = path.join(ROOT, 'vendor', 'dsh-whale-widget')
export const DATA = path.join(ROOT, 'data')
fs.mkdirSync(DATA, { recursive: true })

// 让原插件把运行时数据写进我们的 data 目录（它默认用 $DSH_HOME 或 ~/.dsh）
if (!process.env.DSH_HOME) process.env.DSH_HOME = DATA

// ---------------------------------------------------------------------------
// 凭据服务（替代 DSH ctx.credentials）
// ---------------------------------------------------------------------------
const CRED_FILE = path.join(DATA, 'credentials.json')
let credStore = {}
try { credStore = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')) } catch { credStore = {} }

function persistCreds() {
  try { fs.writeFileSync(CRED_FILE, JSON.stringify(credStore, null, 2), 'utf8') } catch (e) { console.error('[creds] save failed', e) }
}

// 首次启动：从环境变量 / DSH 的凭据文件里找 DeepSeek key
function seedDeepseekKey() {
  if (credStore.DEEPSEEK_API_KEY) return
  const fromEnv = process.env.DEEPSEEK_API_KEY
  if (fromEnv) { credStore.DEEPSEEK_API_KEY = fromEnv; persistCreds(); return }
  // dsh 的 .credentials.yaml（简单解析，失败就跳过）
  const cands = [
    path.join(os.homedir(), '.dsh', '.credentials.yaml'),
    path.join(os.homedir(), '.config', 'dsh', '.credentials.yaml'),
  ]
  for (const p of cands) {
    try {
      const txt = fs.readFileSync(p, 'utf8')
      const m = txt.match(/DEEPSEEK_API_KEY\s*:\s*['"]?([A-Za-z0-9_\-]+)['"]?/)
      if (m && m[1]) { credStore.DEEPSEEK_API_KEY = m[1]; persistCreds(); return }
    } catch { /* ignore */ }
  }
}
seedDeepseekKey()

const credentials = {
  async resolve(name) {
    const v = credStore[name]
    if (!v) return null
    return { value: String(v) }
  },
  async set(name, value) {
    const v = value && typeof value === 'object' ? (value.value ?? value.secret ?? '') : value
    credStore[name] = v
    persistCreds()
    return { ok: true }
  },
  async remove(name) { delete credStore[name]; persistCreds() },
}

// ---------------------------------------------------------------------------
// 事件总线
// ---------------------------------------------------------------------------
const listeners = new Map()
function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(cb)
  return () => { const s = listeners.get(event); if (s) s.delete(cb) }
}
export function emit(event, ...args) {
  const set = listeners.get(event)
  if (!set) return
  for (const cb of [...set]) { try { cb(...args) } catch (err) { console.error('[emit]', event, err) } }
}

// ---------------------------------------------------------------------------
// webServer（替代 DSH ctx.webServer）
// ---------------------------------------------------------------------------
const routes = []
const indexTaps = []
const webServer = {
  register(route) {
    routes.push(route)
    return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1) }
  },
  tapIndex(fn) {
    indexTaps.push(fn)
    return () => { const i = indexTaps.indexOf(fn); if (i >= 0) indexTaps.splice(i, 1) }
  },
}

// ---------------------------------------------------------------------------
// ctx / root
// ---------------------------------------------------------------------------
const ctx = {
  webServer,
  credentials,
  connection: null,
  deepseekAccount: null,
  get(name) {
    if (name === 'sessionTitle') return { get: () => '' }
    if (name === 'connection') return null
    if (name === 'deepseekAccount') return null
    return null
  },
  on,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
}
const root = {
  inject(_deps, cb) { try { cb(ctx) } catch (e) { console.error('[inject]', e) } return () => {} },
  on,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
}

// ---------------------------------------------------------------------------
// 加载原插件
// ---------------------------------------------------------------------------
let pluginLoaded = null
export async function loadPlugin() {
  if (pluginLoaded) return pluginLoaded
  const entry = path.join(VENDOR, 'lib', 'index.js')
  const mod = await import('file://' + entry.replace(/\\/g, '/'))
  const plugin = mod.default || mod
  if (plugin && typeof plugin.apply === 'function') plugin.apply(root)
  else if (typeof plugin === 'function') plugin(root)
  else throw new Error('unexpected plugin export shape')
  pluginLoaded = { routes, indexTaps }
  return pluginLoaded
}

// ---------------------------------------------------------------------------
// 素材缺失兜底（发布版）
// ---------------------------------------------------------------------------
// 上游 PROVENANCE 约定 assets/ 美术素材不随 MIT 代码分发，所以「未取回素材」是发布版的
// 正常状态而不是异常。这些路由在素材缺失时原本会 404，导致挂件空白、点击也没反应；
// 这里让它们优雅降级为内置占位图（SVG 也能被 <img> 正常渲染）。
const ASSET_FALLBACKS = new Map([
  ['/dsh-whale/image.png', PLACEHOLDER_IMAGE], // 角色本体
  ['/dsh-whale/rua.gif', PLACEHOLDER_IMAGE],   // 内置 rua 动图（缺失时给静态占位）
])

function servePlaceholder(res, ph) {
  res.writeHead(200, {
    'Content-Type': ph.type,
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(ph.body)),
  })
  res.end(ph.body)
}

// 先让插件自己的路由处理；只有当它给出 >=400（素材缺失时是 404）才换成占位图。
// 这样「素材存在」时行为与上游完全一致，不复制也不改动插件的取图逻辑。
async function runRouteWithFallback(handler, req, res, ph) {
  const origWriteHead = res.writeHead.bind(res)
  const origEnd = res.end.bind(res)
  let replaced = false
  res.writeHead = (status, headers, ...rest) => {
    if (!replaced && Number(status) >= 400) {
      replaced = true
      res.writeHead = origWriteHead
      try {
        res.writeHead(200, {
          'Content-Type': ph.type,
          'Cache-Control': 'no-store',
          'Content-Length': String(Buffer.byteLength(ph.body)),
        })
        origEnd(ph.body)
      } catch { /* ignore */ }
      res.end = () => res // 屏蔽插件随后写的 404 文案
      return res
    }
    return origWriteHead(status, headers, ...rest)
  }
  try {
    await handler(req, res)
  } finally {
    res.writeHead = origWriteHead
    if (!replaced) res.end = origEnd
  }
}

// ---------------------------------------------------------------------------
// 路由匹配 + HTTP server
// ---------------------------------------------------------------------------
// 数据源覆盖：把某些 /dsh-whale/* 端点改由外部数据源（如 OpenCode）提供
const overrides = new Map()
export function setOverride(pathname, handler) { overrides.set(pathname, handler) }
export function clearOverride(pathname) { overrides.delete(pathname) }

function matchRoute(rawUrl) {
  let pathname = rawUrl || '/'
  try { pathname = new URL(rawUrl, 'http://127.0.0.1').pathname } catch { /* keep */ }
  for (const r of routes) {
    if (!r) continue
    if (r.kind === 'exact' && r.path === pathname) return r
    if (r.kind === 'prefix' && pathname.startsWith(r.path)) return r
    if (r.kind === 'regex' && r.regex && r.regex.test(pathname)) return r
  }
  for (const r of routes) { if (r && r.path === pathname) return r }
  return null
}

const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DeepSeek Whale</title>
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; background:transparent; overflow:hidden; }
</style>
</head>
<body>
<!-- 假 composer：whale-widget.js 只在检测到聊天输入框时才挂载，这里给它一个隐藏的 -->
<div id="root">
  <textarea data-composer-input aria-multiline="true" style="position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;"></textarea>
</div>
<script defer src="/dsh-whale/widget.js"></script>
<script>
// 鼠标穿透：指针悬在挂件元素上时临时接收鼠标事件，否则让点击穿透到下层应用
(function () {
  var host = window.__whaleHost
  if (!host) return
  var ignoring = true
  function onMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY)
    var onWidget = !!(el && el.closest && el.closest('[class*="dshwv"]'))
    if (onWidget === !ignoring) return
    ignoring = !onWidget
    host.setIgnore(ignoring)
  }
  document.addEventListener('mousemove', onMove, true)
})();
</script>
</body>
</html>`

export async function startServer(port = 38900) {
  await loadPlugin()
  const server = http.createServer(async (req, res) => {
    try {
      let pathname = '/'
      try { pathname = new URL(req.url, 'http://127.0.0.1').pathname } catch { /* keep */ }
      const ov = overrides.get(pathname)
      if (ov) { return await ov(req, res) }
      const route = matchRoute(req.url)
      if (route && typeof route.handler === 'function') {
        const ph = ASSET_FALLBACKS.get(pathname)
        if (ph) return await runRouteWithFallback(route.handler, req, res, ph)
        return await route.handler(req, res)
      }
      const phOnly = ASSET_FALLBACKS.get(pathname)
      if (phOnly) return servePlaceholder(res, phOnly)
      if (pathname === '/' || pathname === '/index.html') {
        let html = INDEX_HTML
        for (const tap of indexTaps) { try { const out = tap(html); if (typeof out === 'string' && out) html = out } catch { /* ignore */ } }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(html)
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found: ' + pathname)
    } catch (err) {
      console.error('[server]', err)
      try { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(String((err && err.message) || err)) } catch { /* ignore */ }
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

export function listRoutes() {
  return routes.map((r) => `${r && r.kind} ${r && r.path}`)
}

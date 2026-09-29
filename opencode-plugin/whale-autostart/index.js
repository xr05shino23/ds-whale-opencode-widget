// OpenCode V2 插件：启动 OpenCode 时自动拉起「桌面小鲸鱼挂件」。
//
// 为什么是「目录 + package.json」而不是单个 .js：
//   V2 的 plugins 配置项只接受「插件目录 / 包名」，指向单个文件会被跳过并警告
//   （configured plugin path must be a directory）。所以入口放在 index.js，由 package.json 声明。
//
// ⚠️ 安全软件（行为检测 / PDM）注意 —— 改这个文件前先读仓库根目录的 AGENTS.md：
//   本插件曾触发卡巴斯基的 PDM:Trojan.Win32.Generic 误报（详见 README「已知问题：安全软件误报」），
//   触发点就是下面这次 spawn 的参数组合。所以这里几条是硬约束：
//     · 不传 windowsHide（隐藏启动是最刺眼的特征；挂件本来就要显示窗口，这个 flag 纯属多余）
//     · 不静默丢弃输出（stdio 落日志文件，而不是 'ignore'）
//     · 绝不写注册表自启项 / 计划任务（"autostart" 只是本插件的名字，不是真的去写开机启动）
//
// ⚠️ 关于 detached：**默认 detached: true**。原因是实测踩过坑 ——
//   OpenCode 会在**多个进程**里加载插件（服务端、TUI、每次 CLI 调用…），
//   若 detached:false，挂件就成了"某个 OpenCode 进程的子进程"，那个进程一退出（例如重启 TUI）
//   **挂件会被一起带走**，而服务端上的插件并不会因此重新加载 → 没人再把它拉起来（"鱼不见了"）。
//   想改成非 detached（少一个 PDM 特征、代价是不稳定）就设 WHALE_DETACH=0。
//
// 环境变量：
//   WHALE_DIR        挂件项目根（默认从本文件位置上跳两级；不硬编码盘符）
//   WHALE_LOG_DIR    日志目录（默认 <项目根>/logs）
//   WHALE_DETACH=0   不让挂件脱离父进程（少一个特征，但会随加载插件的那次进程退出而消失）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 宿主会提供 @opencode/plugin；万一解析不到，退化成普通对象定义（{ id, setup } 就是 V2 的定义形状）
let Plugin
try {
  ({ Plugin } = await import('@opencode/plugin'))
} catch (err) {
  console.log('[whale] @opencode/plugin unavailable, using plain definition:', err && err.message)
}
const define = (Plugin && typeof Plugin.define === 'function') ? Plugin.define.bind(Plugin) : (d) => d

// 挂件目录：本插件在 <项目根>/opencode-plugin/whale-autostart/index.js，上跳两级就是项目根。
// 这样 clone 到任何路径都能用；特殊布局可用环境变量 WHALE_DIR 覆盖。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WHALE_DIR = process.env.WHALE_DIR || path.resolve(HERE, '..', '..')
const LOG_DIR = process.env.WHALE_LOG_DIR || path.join(WHALE_DIR, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'widget.log')
// 默认 detached（见文件头说明）：只有显式 WHALE_DETACH=0 才不脱离父进程
const DETACH = process.env.WHALE_DETACH !== '0'

// 插件日志：同时写插件日志文件（持久、可事后排查）与宿主 stdout（OpenCode 日志里能看到）。
// 以前是 console 完就算了 —— 但挂件由 OpenCode 拉起时，宿主 stdout 未必有人看，
// 出了事就是"静默失败"，所以这里必须落盘。
function log(line) {
  try { console.log('[whale] ' + line) } catch { /* ignore */ }
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + line + '\n')
  } catch { /* 日志失败绝不能影响主流程 */ }
}

// 定位 Electron 可执行文件（跨平台：Windows / Linux / macOS 的路径都试）
function findElectron() {
  const dist = path.join(WHALE_DIR, 'node_modules', 'electron', 'dist')
  const cands = [
    path.join(dist, 'electron.exe'),                                  // Windows
    path.join(dist, 'electron'),                                      // Linux
    path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron'),  // macOS
  ]
  for (const p of cands) {
    try { if (fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return ''
}

// 刻意**不做**"本进程只启动一次"的模块级去重：
//   · Electron 侧有单实例锁（main.js 里的 requestSingleInstanceLock），重复 spawn 会自己退出；
//   · 而模块级 flag 有个坑：插件热重载时 ESM 模块被缓存、flag 仍是 true，
//     于是"挂件被关掉后重新加载插件"就再也拉不起来了（实测踩到过）。
function launchWidget() {
  const exe = findElectron()
  if (!exe) {
    log('ERROR: 没找到 Electron 可执行文件，请先在挂件目录执行 npm install（或用 WHALE_DIR 指定目录）: ' + WHALE_DIR)
    return
  }

  // 子进程的 stdout/stderr 落日志文件（而不是 'ignore'）
  let out = 'ignore'
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    out = fs.openSync(LOG_FILE, 'a')
  } catch { /* 打不开就退化为 ignore —— 启动本身不能因此受影响 */ }

  try {
    // 注意：这里刻意【不】传 windowsHide
    const child = spawn(exe, ['.'], {
      cwd: WHALE_DIR,
      detached: DETACH,
      stdio: ['ignore', out, out],
      env: { ...process.env, WHALE_LAUNCHED_BY: 'opencode-plugin' },
    })

    // 关掉父进程这边的副本句柄（子进程持有自己的那份，照常写日志）—— 热重载多次也不会堆积 fd
    if (typeof out === 'number') { try { fs.closeSync(out) } catch { /* ignore */ } }

    // 只有真正 detached 时才 unref：否则会收不到 exit/error，日志与退出码全丢
    if (DETACH) child.unref()

    child.on('error', (err) => log('ERROR: launch failed: ' + (err && err.message)))
    child.on('exit', (code, signal) => log('widget exited code=' + code + ' signal=' + signal + ' detached=' + DETACH))

    log('widget launched pid=' + child.pid + ' detached=' + DETACH + ' exe=' + exe)
  } catch (err) {
    log('ERROR: spawn threw: ' + (err && err.message))
  }
}

export default define({
  id: 'whale-autostart',
  async setup(_ctx) {
    log('plugin loaded, widget dir = ' + WHALE_DIR + '  (detached=' + DETACH + '  log=' + LOG_FILE + ')')
    launchWidget()
  },
})

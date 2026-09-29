// OpenCode V2 插件：启动 OpenCode 时自动拉起「桌面小鲸鱼挂件」。
//
// 为什么是「目录 + package.json」而不是单个 .js：
//   V2 的 plugins 配置项只接受「插件目录 / 包名」，指向单个文件会被跳过并警告
//   （configured plugin path must be a directory）。所以入口放在 index.js，由 package.json 声明。
//
// 挂件独立运行（detached），不阻塞 OpenCode。
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
    console.error('[whale] 没找到 Electron 可执行文件，请先在挂件目录执行 npm install（或用 WHALE_DIR 指定目录）: ' + WHALE_DIR)
    return
  }
  try {
    const child = spawn(exe, ['.'], {
      cwd: WHALE_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    console.log('[whale] desktop widget launched, pid=' + child.pid)
  } catch (err) {
    console.error('[whale] launch failed:', err && err.message)
  }
}

export default define({
  id: 'whale-autostart',
  async setup(_ctx) {
    console.log('[whale] plugin loaded, widget dir = ' + WHALE_DIR)
    launchWidget()
  },
})

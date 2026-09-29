// 安装期兜底：确保 Electron 的**二进制**真的在。
//
// 为什么需要它（实测踩到过两次，别人也踩到过）：
//   `npm install` 经常在**没有装好 Electron 二进制**的情况下报"added N packages"成功，
//   `node_modules/electron/dist/` 是空的 —— 于是 `npm start` 起不来，错误还很不直观。
//   这不是本项目的 bug，但它是"装完就能跑"路上最常见的一块石头，所以我们自己兜住。
//
// 做法：只在【二进制确实缺失】时才补跑 Electron 自带的 install.js，并且带**时间上限**：
//   · 本机缓存/镜像热 → 通常几秒完成（缓存里那个 zip 就是干这个用的）
//   · 需要真下载 → 到点就放弃，打印指引，**绝不让 npm install 卡几十分钟**
//
// 铁律：无论成功失败，**退出码恒为 0** —— 安装期脚本绝不能把用户的 `npm install` 搞失败。
//
// 相关环境变量：
//   WHALE_DIR               指定项目根（默认从本文件位置推导；测试用）
//   WHALE_SKIP_SETUP=1      跳过安装期所有自动处理（含本脚本）
//   WHALE_ENSURE_TIMEOUT_MS 补跑 install.js 的时间上限（默认 60000）
//   ELECTRON_MIRROR         下载镜像（可参考 README 常见问题）
//   CI=1                    跳过（CI 里不做网络补救）
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.WHALE_DIR
  ? path.resolve(process.env.WHALE_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron')
const TIMEOUT_MS = Number(process.env.WHALE_ENSURE_TIMEOUT_MS || 60000)

const say = (m) => console.log('  ' + m)

function findBinary() {
  const dist = path.join(ELECTRON_DIR, 'dist')
  const cands = [
    path.join(dist, 'electron.exe'),                                   // Windows
    path.join(dist, 'electron'),                                       // Linux
    path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron'),   // macOS
  ]
  for (const p of cands) { try { if (fs.existsSync(p)) return p } catch { /* ignore */ } }
  return ''
}

function runWithTimeout(args, ms) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
    } catch (e) {
      return resolve({ ok: false, why: 'spawn failed: ' + (e && e.message) })
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }, ms)
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, why: e && e.message }) })
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, timedOut }) })
  })
}

console.log('=== 小鲸鱼挂件 · Electron 二进制检查 ===')

if (process.env.WHALE_SKIP_SETUP === '1' || process.env.CI) {
  say('· 已跳过（' + (process.env.WHALE_SKIP_SETUP === '1' ? 'WHALE_SKIP_SETUP=1' : 'CI 环境') + '）')
} else if (findBinary()) {
  say('✓ 二进制在位，无需处理')
} else if (!fs.existsSync(ELECTRON_DIR)) {
  say('⚠ node_modules/electron 不存在（npm 没装上？）')
  say('  · 先执行 npm install；若仍不行见 README「常见问题」')
} else {
  const installer = path.join(ELECTRON_DIR, 'install.js')
  say('⚠ 二进制缺失（npm 有时只报"装好了"，其实 dist/ 是空的）')
  if (!fs.existsSync(installer)) {
    say('  · 也没找到 ' + path.relative(ROOT, installer) + '，见 README「Electron failed to install correctly」')
  } else {
    say('· 补跑安装脚本（上限 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒；有本机缓存时通常几秒完成）…')
    say('')
    const r = await runWithTimeout([installer], TIMEOUT_MS)
    say('')
    if (findBinary()) {
      say('✓ 已修复：Electron 二进制到位')
    } else if (r.timedOut) {
      say('⚠ 超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒还没下完，已放弃（不影响本次安装继续）')
      say('  · 用国内镜像重试会快很多：')
      say('      Windows:      set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/')
      say('                    node node_modules\\electron\\install.js')
      say('      macOS/Linux:  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/')
      say('                    node node_modules/electron/install.js')
    } else {
      say('⚠ 补跑失败（退出码 ' + r.code + (r.why ? '，' + r.why : '') + '），不影响本次安装继续')
      say('  · 见 README「Electron failed to install correctly」，或先跑 npm run doctor 看结论')
    }
  }
}

// 铁律：安装期绝不失败
process.exitCode = 0

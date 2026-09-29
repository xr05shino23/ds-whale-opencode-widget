// 在桌面创建「大肥鱼」快捷方式 —— 双击即起挂件。
//
// 为什么需要它：OpenCode 的 TUI **只自动加载"带 TUI 入口"的插件**，本插件是"只做事"的那种，
// 所以"一开 TUI 就有鱼"做不到（实测）。而"重启电脑后启动 OpenCode"是能自动拉起的（服务启动时加载）。
// 于是缺的就是"服务还跑着、我只重开了 TUI"这个场景 —— 一个桌面快捷方式正好补上，
// 而且**对卡巴斯基等主防最安全**：用户主动双击启动，没有"宿主进程拉起未签名大二进制"的特征。
//
// 用法：
//   node scripts/shortcut.mjs              创建（已存在则更新）
//   node scripts/shortcut.mjs --remove     删除
//   node scripts/shortcut.mjs --soft       失败只警告（postinstall 用，退出码恒为 0）
//   node scripts/shortcut.mjs --quiet      少输出
//
// 环境变量：
//   WHALE_NO_SHORTCUT=1  跳过（postinstall 不再创建）
//   WHALE_DESKTOP_DIR    覆盖目标目录（测试用；默认由系统给出，能正确处理 OneDrive 重定向的桌面）
//   CI=1                 跳过
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const REMOVE = has('--remove')
const SOFT = has('--soft')
const QUIET = has('--quiet')

const log = (...a) => { if (!QUIET) console.log(...a) }
const ok = (m) => log('  ✓ ' + m)
const hi = (m) => log('  ⚠ ' + m)
const no = (m) => log('  ✗ ' + m)

const LNK_NAME = process.env.WHALE_SHORTCUT_NAME || 'deepseek桌宠.lnk'

// 把 PNG 包成 .ico。
// 为什么要转换：`.lnk` 的 IconLocation 只认图标资源（.ico/.exe/.dll），**给 PNG 路径它会显示一张白纸** ✗。
// ICO 自 Vista 起支持直接内嵌 PNG 数据 → 我们只要拼个 6+16 字节的头，不需要任何图像库 ✓。
// ⚠️ 生成的 .ico 是从上游美术素材派生的，**绝不能入库**（仓库不分发素材）→ 固定写到 data/（已被 .gitignore 忽略）
function readPngSize(buf) {
  // PNG: 8 字节签名 + IHDR；宽在 16、高在 20（大端 uint32）
  if (buf.length < 24) return { w: 0, h: 0 }
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return { w: 0, h: 0 }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}
function pngToIco(pngBuf) {
  const { w, h } = readPngSize(pngBuf)
  const dim = (v) => (v >= 256 ? 0 : v)   // 0 表示 256
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)              // reserved
  header.writeUInt16LE(1, 2)              // type = icon
  header.writeUInt16LE(1, 4)              // 只放一张图
  const entry = Buffer.alloc(16)
  entry.writeUInt8(dim(w || 256), 0)
  entry.writeUInt8(dim(h || 256), 1)
  entry.writeUInt8(0, 2)                  // 调色板数
  entry.writeUInt8(0, 3)                  // reserved
  entry.writeUInt16LE(1, 4)               // color planes
  entry.writeUInt16LE(32, 6)              // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8)   // 数据长度
  entry.writeUInt32LE(6 + 16, 12)         // 数据偏移
  return Buffer.concat([header, entry, pngBuf])
}

// 图标：优先用鲸鱼形象图 → 转成 .ico（放 data/，不入库）；失败则退回 Electron 自带图标
function makeIcon(exe) {
  const whalePng = path.join(ROOT, 'vendor', 'dsh-whale-widget', 'assets', 'DSniang1.png')
  const icoPath = path.join(ROOT, 'data', 'whale.ico')
  try {
    if (!fs.existsSync(whalePng)) return { icon: exe, note: '（素材未取回，先用 Electron 图标；取回素材后重跑本脚本即可换成鲸鱼图标）' }
    const need = !fs.existsSync(icoPath) || fs.statSync(icoPath).mtimeMs < fs.statSync(whalePng).mtimeMs
    if (need) {
      fs.mkdirSync(path.dirname(icoPath), { recursive: true })
      fs.writeFileSync(icoPath, pngToIco(fs.readFileSync(whalePng)))
    }
    return { icon: icoPath, note: '' }
  } catch (e) {
    return { icon: exe, note: '（生成 .ico 失败：' + (e && e.message) + '，先用 Electron 图标）' }
  }
}

function electronBinary() {
  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist')
  const cands = [
    path.join(dist, 'electron.exe'),
    path.join(dist, 'electron'),
    path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ]
  for (const p of cands) { try { if (fs.existsSync(p)) return p } catch { /* ignore */ } }
  return ''
}

// 用 PowerShell 的 WScript.Shell 写 .lnk。
// 关键：脚本内容走 -EncodedCommand（base64/UTF-16LE），路径走环境变量 —— 两者都不受控制台编码影响，
// 中文路径（本项目的目录名就是中文）不会出乱码。
const PS_TEMPLATE = (action) => `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$sh = New-Object -ComObject WScript.Shell
$desktop = if ($env:WHALE_DESKTOP_DIR) { $env:WHALE_DESKTOP_DIR } else { [Environment]::GetFolderPath('Desktop') }
$lnk = Join-Path $desktop $env:WHALE_LNK_NAME
${action === 'remove'
    ? "if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }; Write-Output $lnk"
    : `$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $env:WHALE_LNK_TARGET
$s.Arguments = '.'
$s.WorkingDirectory = $env:WHALE_LNK_CWD
$s.IconLocation = $env:WHALE_LNK_ICON
$s.Description = 'Launch the whale widget (ds-whale-opencode-widget)'
$s.Save()
Write-Output $lnk`}
`

function runPowerShell(action, env) {
  const script = PS_TEMPLATE(action)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const out = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ...env },
  })
  return String(out).trim()
}

function main() {
  if (process.platform !== 'win32') {
    hi('非 Windows 平台：本脚本只做 Windows 快捷方式（mac/Linux 可自行建 .desktop / 别名）')
    return true
  }
  if (process.env.WHALE_NO_SHORTCUT === '1' || process.env.CI) {
    log('  · 已跳过快捷方式（' + (process.env.WHALE_NO_SHORTCUT === '1' ? 'WHALE_NO_SHORTCUT=1' : 'CI 环境') + '）')
    return true
  }

// 删除时用同一个名字（也是从环境变量来，测试可覆盖）
  if (REMOVE) {
    const p = runPowerShell('remove', { WHALE_LNK_NAME: LNK_NAME })
    ok('已删除快捷方式：' + p)
    return true
  }

  const exe = electronBinary()
  if (!exe) {
    no('找不到 Electron 可执行文件，先 npm install')
    return false
  }
  if (!fs.existsSync(path.join(ROOT, '启动大肥鱼.cmd')) && !fs.existsSync(path.join(ROOT, 'main.js'))) {
    no('项目目录看起来不完整：' + ROOT)
    return false
  }

  const ic = makeIcon(exe)
  const lnk = runPowerShell('create', {
    WHALE_LNK_NAME: LNK_NAME,
    WHALE_LNK_TARGET: exe,
    WHALE_LNK_CWD: ROOT,
    WHALE_LNK_ICON: ic.icon,
  })
  ok('已创建桌面快捷方式：' + lnk)
  if (ic.note) hi(ic.note)
  log('    双击它即可启动挂件（不需要 OpenCode 在场）')
  log('    不想要？node scripts/shortcut.mjs --remove，或设 WHALE_NO_SHORTCUT=1 后重装')
  return true
}

let presented = false
try {
  const r = main()
  presented = r !== false
} catch (e) {
  no('创建快捷方式失败：' + (e && e.message))
  presented = false
}

if (!presented) {
  if (SOFT) {
    log('  （不影响安装继续；稍后可手动跑：node scripts/shortcut.mjs）')
    process.exitCode = 0
  } else {
    process.exitCode = 1
  }
}

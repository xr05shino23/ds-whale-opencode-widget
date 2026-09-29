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

const LNK_NAME = '大肥鱼.lnk'

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

// 图标：优先用鲸鱼形象图（取了素材就有），否则退回 Electron 自己的图标
function iconPath(exe) {
  const whale = path.join(ROOT, 'vendor', 'dsh-whale-widget', 'assets', 'DSniang1.png')
  try { if (fs.existsSync(whale)) return whale } catch { /* ignore */ }
  return exe
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

  const lnk = runPowerShell('create', {
    WHALE_LNK_NAME: LNK_NAME,
    WHALE_LNK_TARGET: exe,
    WHALE_LNK_CWD: ROOT,
    WHALE_LNK_ICON: iconPath(exe),
  })
  ok('已创建桌面快捷方式：' + lnk)
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

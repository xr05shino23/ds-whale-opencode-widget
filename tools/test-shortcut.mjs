// 桌面快捷方式脚本的自测：node tools/test-shortcut.mjs
//
// 全程用临时目录当"桌面"（WHALE_DESKTOP_DIR），不碰你真实的桌面。
// 关键验证：真的生成 .lnk、真的指向 electron.exe、能重复跑、能删掉、能被开关跳过。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'shortcut.mjs')
const LNK_NAME = '大肥鱼.lnk'

const results = []
const say = (okFlag, name, detail = '') => {
  results.push(okFlag)
  console.log((okFlag ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''))
}
const freshDesktop = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whale-desktop-test-'))

function run(args = [], env = {}) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, WHALE_NO_SHORTCUT: '', ...env },
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

// 用 PowerShell 把 .lnk 读回来（WScript.Shell 能读也能写），确认目标/参数/工作目录都对
function readLnk(lnkPath) {
  const ps = `
$ErrorActionPreference='Stop'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($env:P)
[pscustomobject]@{ Target=$s.TargetPath; Args=$s.Arguments; Cwd=$s.WorkingDirectory; Icon=$s.IconLocation } | ConvertTo-Json -Compress
`
  const enc = Buffer.from(ps, 'utf16le').toString('base64')
  const out = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', enc], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, P: lnkPath },
  })
  return JSON.parse(String(out).trim())
}

if (process.platform !== 'win32') {
  console.log('  PASS  （非 Windows：本脚本只做 Windows 快捷方式，跳过）')
  process.exit(0)
}

const nl = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

// ---------------------------------------------------------------------------
// T1 创建：真的生成 .lnk，且指向 electron.exe、参数是 '.'、工作目录是项目根
// ---------------------------------------------------------------------------
{
  const d = freshDesktop()
  const r = run([], { WHALE_DESKTOP_DIR: d })
  const lnk = path.join(d, LNK_NAME)
  say(r.code === 0, 'T1 退出码 0')
  say(fs.existsSync(lnk), 'T1 桌面目录里生成了 ' + LNK_NAME)
  say(fs.existsSync(lnk) && fs.statSync(lnk).size > 0, 'T1 .lnk 不是空文件', fs.existsSync(lnk) ? fs.statSync(lnk).size + ' 字节' : '-')
  if (fs.existsSync(lnk) && fs.existsSync(nl)) {
    const info = readLnk(lnk)
    say(String(info.Target).toLowerCase() === nl.toLowerCase(), 'T1 目标 = electron.exe', info.Target)
    say(String(info.Args).trim() === '.', 'T1 参数 = "."（在当前目录启动挂件）', JSON.stringify(info.Args))
    say(path.resolve(info.Cwd).toLowerCase() === ROOT.toLowerCase(), 'T1 工作目录 = 项目根', info.Cwd)
    say(String(info.Icon).length > 0, 'T1 设置了图标', info.Icon)
  } else {
    say(false, 'T1 （node_modules/electron 不存在，跳过目标校验）')
  }
  // 幂等：再跑一次不报错
  const again = run([], { WHALE_DESKTOP_DIR: d })
  say(again.code === 0 && fs.existsSync(lnk), 'T1 幂等：重复运行不报错且文件还在')

  // 删除
  const rm = run(['--remove'], { WHALE_DESKTOP_DIR: d })
  say(rm.code === 0 && !fs.existsSync(lnk), 'T1 --remove 删掉了快捷方式')
  fs.rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T2 开关：WHALE_NO_SHORTCUT=1 / CI 时不创建
// ---------------------------------------------------------------------------
{
  for (const [name, env] of [['T2 WHALE_NO_SHORTCUT=1', { WHALE_NO_SHORTCUT: '1' }], ['T2 CI=1', { CI: '1' }]]) {
    const d = freshDesktop()
    const r = run([], { WHALE_DESKTOP_DIR: d, ...env })
    say(r.code === 0, name + ' 退出码 0')
    say(!fs.existsSync(path.join(d, LNK_NAME)), name + ' 没有创建快捷方式')
    say(/已跳过/.test(r.out), name + ' 报告"已跳过"')
    fs.rmSync(d, { recursive: true, force: true })
  }
}

const fails = results.filter((r) => !r).length
console.log('\n===== ' + (results.length - fails) + '/' + results.length + ' 通过 =====')
process.exitCode = fails ? 1 : 0

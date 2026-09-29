// 环境自检：npm run doctor
//
// 与 npm run health 的分工：
//   health = 功能体检（接口/渲染/交互/音效；**需要挂件已经在运行**）
//   doctor = 环境体检（装完就能跑；专抓"还没跑起来就崩"的那类问题）
//            例如：目录权限/沙箱（Electron EXCEPTION_BREAKPOINT）、二进制没下下来、
//            目录不可写、端口被占、OpenCode 插件没登记…
//
// 用法：
//   node tools/doctor.mjs                全量检查
//   node tools/doctor.mjs --no-launch    跳过"Electron 能否启动"探测（CI / 无显示环境）
//   node tools/doctor.mjs --dir <路径>   指定要做权限检查的目录（默认挂件目录）
//   node tools/doctor.mjs --fix          发现项目文件缺失时自动 git restore（**只动 git 跟踪的文件**）
//
// 退出码：0 = 没有 ✗（警告不失败）；1 = 有 ✗
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const NO_LAUNCH = argv.includes('--no-launch') || !!process.env.CI
const dirArgIdx = argv.indexOf('--dir')
const CHECK_DIR = dirArgIdx >= 0 && argv[dirArgIdx + 1] ? path.resolve(argv[dirArgIdx + 1]) : ROOT
const PORT = Number(process.env.WHALE_PORT || 38900)
const PLUGIN_DIR = path.join(ROOT, 'opencode-plugin', 'whale-autostart')
const ASSET_DIR = path.join(ROOT, 'vendor', 'dsh-whale-widget', 'assets')

const results = []
const ok = (name, detail = '') => { results.push({ s: 'ok', name, detail }); console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
const hi = (name, detail = '', fix = '') => { results.push({ s: 'warn', name, detail, fix }); console.log('  ⚠ ' + name + (detail ? '  ' + detail : '')) }
const no = (name, detail = '', fix = '') => { results.push({ s: 'fail', name, detail, fix }); console.log('  ✗ ' + name + (detail ? '  ' + detail : '')) }
const note = (name, detail = '') => { results.push({ s: 'info', name, detail }); console.log('  · ' + name + (detail ? '  ' + detail : '')) }

// ---------------------------------------------------------------------------
// [1] 运行时环境
// ---------------------------------------------------------------------------
function checkRuntime() {
  console.log('\n[1] 运行时环境')
  const major = Number(process.versions.node.split('.')[0])
  if (major >= 18) ok('Node.js ' + process.versions.node + '（要求 ≥ 18）')
  else no('Node.js 版本过低 ' + process.versions.node, '', '升级到 Node 20+（本项目用了 fetch / AbortSignal.timeout）')
  note('平台 ' + process.platform + ' ' + process.arch)
}

// ---------------------------------------------------------------------------
// [2] 目录权限（重点：沙箱 / 显式 DENY / 低完整性）
//     Electron 启动时要 MapViewOfFile 内存映射 snapshot_blob.bin，
//     若是被 DENY 掉 Synchronize 的沙箱目录 → 直接 EXCEPTION_BREAKPOINT。
//     判定思路：拿一个"全新普通目录"当基准，对比出目标目录多出来的 ACL 条目。
//     这样不依赖 icacls 输出的本地化文字，中文 Windows 也不会漏判。
// ---------------------------------------------------------------------------
function icaclsLines(dir) {
  if (process.platform !== 'win32') return null
  try {
    // 用 latin1 读原始字节：我们只匹配 ASCII 片段，避开控制台编码问题
    const buf = execFileSync('icacls', [dir], { encoding: 'buffer', timeout: 15000 })
    return buf.toString('latin1').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.includes('(') && s.includes(')'))
  } catch {
    return null
  }
}

function checkDir() {
  console.log('\n[2] 目录与权限' + (CHECK_DIR === ROOT ? '' : '  （检查目录：' + CHECK_DIR + '）'))
  if (!fs.existsSync(CHECK_DIR)) { no('目录不存在', CHECK_DIR); return }
  ok('目录存在', CHECK_DIR)

  // 可写
  const dataDir = path.join(ROOT, 'data')
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const probe = path.join(dataDir, '.doctor-probe')
    fs.writeFileSync(probe, 'ok')
    const back = fs.readFileSync(probe, 'utf8')
    fs.rmSync(probe, { force: true })
    if (back === 'ok') ok('data/ 可写')
    else no('data/ 写入校验不一致')
  } catch (e) {
    no('data/ 不可写', (e && e.code) || (e && e.message), '受控文件夹访问 / 只读目录 / 沙箱目录 —— 把项目移到普通目录（如 文档\\某文件夹），或把项目目录加入安全软件信任区')
  }

  // ACL 对比
  if (process.platform !== 'win32') { note('ACL 检查仅 Windows 有效（已跳过）'); return }
  const target = icaclsLines(CHECK_DIR)
  if (!target) { hi('无法读取目录 ACL（icacls 执行失败）'); return }

  let base = null
  let tmp = ''
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-doctor-'))
    base = icaclsLines(tmp)
  } catch { /* ignore */ } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
  }

  const labelOf = (lines) => (lines || []).find((l) => /\(NW\)\s*$/.test(l)) || ''
  const tLabel = labelOf(target)
  const bLabel = labelOf(base)
  if (tLabel !== bLabel) {
    // 普通目录通常**没有**这一行（icacls 只在非默认完整性级别时才打印）
    hi('目录带强制性完整性标签（普通目录没有）或与普通目录不同', tLabel || '(普通目录无标签，本目录有)',
      '这通常意味着目录是沙箱/低完整性环境创建的 → 建议把项目移到普通目录')
  }

  const deny = target.filter((l) => l.includes('(DENY)'))
  const baseSet = new Set(base || [])
  const newDeny = deny.filter((l) => !baseSet.has(l))
  if (newDeny.length) {
    no('目录含显式 DENY 权限（普通目录没有）', newDeny.slice(0, 2).join('  |  '),
      'Electron 需要 Synchronize 权限来内存映射资源文件；被 DENY 后会 EXCEPTION_BREAKPOINT 崩溃 → 把项目移到普通目录')
  } else if (deny.length) {
    hi('目录含 DENY 权限（与基准目录相同，可能是环境惯例）', deny[0])
  } else {
    ok('没有显式 DENY 权限')
  }

  const sandboxSid = target.filter((l) => /S-1-4-\d+/.test(l))
  if (sandboxSid.length) hi('目录含沙箱/受限 SID（S-1-4-*）', sandboxSid[0], '这类 SID 由沙箱环境创建，建议换到普通目录')
}

// ---------------------------------------------------------------------------
// [3] 关键文件完整性（安全软件隔离检查）
//     本项目被安全软件的行为检测（PDM）误杀过一次：项目内 3 个关键文件被移除，
//     连 opencode.exe 也被隔离（详见 README「已知问题：安全软件误报」）。
//     这里只查"在不在"，缺失就给可直接复制执行的恢复命令；--fix 只跑 git restore。
// ---------------------------------------------------------------------------
const TRACKED_KEYS = [
  ['main.js', '挂件主进程'],
  ['opencode-plugin/whale-autostart/index.js', 'OpenCode 插件入口（启动时自动拉起挂件）'],
  ['vendor/dsh-whale-widget/assets/whale-widget.js', '上游前端（本版改过默认字号）'],
]

function checkIntegrity() {
  console.log('\n[3] 关键文件（安全软件隔离检查）')
  const missing = []

  // ① 项目内、git 跟踪的关键文件 —— 缺了可以直接 git restore（这三个就是上次被删的）
  for (const [rel, why] of TRACKED_KEYS) {
    if (fs.existsSync(path.join(ROOT, rel))) ok(rel, why)
    else {
      missing.push(rel)
      no(rel + ' 缺失', why, 'npm run doctor -- --fix   （就是 git restore，只动 git 跟踪的文件）')
    }
  }

  // ② Electron 可执行文件（大、未签名，最容易招行为检测）
  const exe = electronBinary()
  if (exe) ok('Electron 可执行文件在位', path.relative(ROOT, exe))
  else no('Electron 可执行文件缺失', 'node_modules/electron/dist',
    'npm run ensure:electron   （用本机缓存/镜像补跑安装脚本）')

  // ③ OpenCode 自己的二进制：npm postinstall 用硬链接生成三处指向同一份数据，一损俱损
  const npmRoot = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@opencode', 'cli')
  const ocPaths = [
    path.join(npmRoot, 'bin', 'opencode.exe'),
    path.join(npmRoot, 'node_modules', '@opencode', 'cli-windows-x64-baseline', 'bin', 'opencode.exe'),
  ].filter((p) => p.indexOf('node_modules') !== -1)
  let hit = 0
  for (const p of ocPaths) { try { if (fs.existsSync(p)) hit++ } catch { /* ignore */ } }
  let svcCount = 0
  try {
    svcCount = fs.readdirSync(path.join(os.homedir(), '.cache', 'opencode'))
      .filter((f) => /^opencode-service-.*\.exe$/i.test(f)).length
  } catch { /* ignore */ }

  if (ocPaths.length && hit === ocPaths.length && svcCount > 0) {
    ok('OpenCode 可执行文件在位', hit + '/' + ocPaths.length + ' 处硬链接 + .cache 里 ' + svcCount + ' 个 service')
  } else {
    no('OpenCode 可执行文件疑似被隔离', '命中 ' + hit + '/' + ocPaths.length + ' 处硬链接、.cache 里 ' + svcCount + ' 个 service',
      '从安全软件的「隔离区」恢复；或重装 CLI：npm i -g @opencode/cli（它与 npm 缓存里的副本是硬链接，一荣俱荣）')
  }
  // ④ 主防检测（只看目录，不启动进程）：本项目的"自动拉起"行为链可能被行为检测误判
  const kav = detectKaspersky()
  if (kav) {
    hi('检测到卡巴斯基（' + kav[0] + '）—— 请确认排除项已配好',
      '本插件会在 opencode.exe 里拉起未签名的 electron.exe，可能被行为检测(PDM)误判为木马；实测后果包括文件被隔离、opencode.exe 被删，严重时 Windows 登录失败',
      '先配排除项：本仓库目录 / %APPDATA%\\npm\\node_modules\\@opencode\\ / %USERPROFILE%\\.cache\\opencode\\；' +
      '把 opencode.exe、opencode-service-*.exe、<仓库>\\node_modules\\electron\\dist\\electron.exe 加进「受信任的应用程序」' +
      '并勾选「不监控应用程序活动」；详见 README「已知问题：安全软件误报」。不想冒险可设 WHALE_NO_AUTOSTART=1（改为自己 npm start）')
  }
  return missing
}

// 主防检测：只看安装目录，不启动任何进程（避免自己又造出一个可疑行为）
function detectKaspersky() {
  const cands = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Kaspersky Lab'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Kaspersky Lab'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Kaspersky Lab'),
  ]
  const hit = []
  for (const p of cands) { try { if (fs.existsSync(p)) hit.push(p) } catch { /* ignore */ } }
  return hit.length ? hit : null
}

// --fix：只恢复"git 跟踪的"关键文件 —— 逐条确认被跟踪才动手，
// 绝不碰 DLL / 系统目录 / 未跟踪文件（自动改系统状态正是我们要避免的行为）
function fixMissing(missing) {
  if (!missing.length) return
  console.log('\n[--fix] 用 git restore 恢复缺失的项目文件：')
  for (const rel of missing) {
    let tracked = false
    try {
      execFileSync('git', ['-C', ROOT, 'ls-files', '--error-unmatch', '--', rel], { stdio: 'ignore' })
      tracked = true
    } catch { tracked = false }
    if (!tracked) { hi('跳过（未被 git 跟踪）', rel, '请手动确认这个文件应该从哪里来'); continue }
    try {
      execFileSync('git', ['-C', ROOT, 'restore', '--', rel], { stdio: 'inherit' })
      if (fs.existsSync(path.join(ROOT, rel))) ok('已恢复 ' + rel)
      else no('恢复后仍不存在 ' + rel)
    } catch (e) {
      no('恢复失败 ' + rel, (e && e.message) || '')
    }
  }
}

// ---------------------------------------------------------------------------
// [4] Electron 二进制与启动能力
// ---------------------------------------------------------------------------
function electronBinary() {
  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist')
  const cands = [
    path.join(dist, 'electron.exe'),
    path.join(dist, 'electron'),
    path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ]
  for (const p of cands) if (fs.existsSync(p)) return p
  return ''
}

function checkElectron() {
  console.log('\n[4] Electron')
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    no('node_modules 不存在', '', '先执行 npm install')
    return
  }
  let ver = ''
  try { ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version } catch { /* ignore */ }

  const exe = electronBinary()
  if (!exe) {
    no('Electron 二进制缺失', 'node_modules/electron/dist 下没有可执行文件',
      '多半是下载失败（npm 有时只报"装好了"）：node node_modules/electron/install.js\n' +
      '    国内网络可先设置镜像：set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/  然后重跑上面的命令')
    return
  }
  ok('Electron 二进制存在' + (ver ? '（版本 ' + ver + '）' : ''), path.relative(ROOT, exe))

  if (NO_LAUNCH) { note('已跳过启动探测', process.env.CI ? '(CI 环境)' : '(--no-launch)'); return }
  const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 25000 })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const codeUnsigned = typeof r.status === 'number' ? (r.status >>> 0) : 0
  if (r.status === 0 && /v\d+/.test(out)) {
    ok('Electron 能正常启动', out.trim().split(/\r?\n/)[0])
  } else {
    const hex = '0x' + codeUnsigned.toString(16).toUpperCase()
    const lines = out.trim().split(/\r?\n/).filter(Boolean)
    no('Electron 无法启动', '退出码 ' + r.status + '（' + hex + '）' + (lines.length ? '  ' + lines[lines.length - 1].slice(0, 120) : ''),
      codeUnsigned === 0x80000003 || codeUnsigned === 0xc0000005
        ? '这正是「沙箱/权限目录」的典型崩溃（EXCEPTION_BREAKPOINT / V8 快照映射失败）\n' +
          '    → 先看上面 [2] 的 ACL 结论；把项目移到普通目录（例：文档下的新建文件夹）再试'
        : '试试重装 Electron：npm install --force  或用镜像重装（见 README 常见问题）')
  }
}

// ---------------------------------------------------------------------------
// [4] 本地服务端口
// ---------------------------------------------------------------------------
function checkPort() {
  return new Promise((resolve) => {
    console.log('\n[5] 本地服务端口')
    const s = net.connect({ host: '127.0.0.1', port: PORT })
    const done = (v) => { try { s.destroy() } catch { /* ignore */ } resolve(v) }
    s.setTimeout(1500)
    s.once('connect', () => {
      ok('端口 ' + PORT + ' 上有服务在响应')
      note('如果这就是已运行的挂件，正常；若是别的程序占着，启动挂件时用 WHALE_PORT=38901 换端口')
      done()
    })
    s.once('timeout', () => { hi('端口 ' + PORT + ' 探测超时'); done() })
    s.once('error', (e) => {
      if (e && e.code === 'ECONNREFUSED') ok('端口 ' + PORT + ' 空闲（挂件未运行，属正常）')
      else hi('端口 ' + PORT + ' 探测异常', (e && e.code) || (e && e.message))
      done()
    })
  })
}

// ---------------------------------------------------------------------------
// [5] 美术素材
// ---------------------------------------------------------------------------
function checkAssets() {
  console.log('\n[6] 美术素材')
  let media = []
  try { media = fs.readdirSync(ASSET_DIR).filter((f) => /\.(png|gif|mp3|wav)$/i.test(f)) } catch { /* ignore */ }
  if (media.length) ok('素材已就位', media.length + ' 个媒体文件')
  else hi('还没取回素材', '会用内置占位形象（能跑，但不好看）', 'node scripts/fetch-assets.mjs')
}

// ---------------------------------------------------------------------------
// [6] OpenCode 集成
// ---------------------------------------------------------------------------
function checkOpenCode() {
  console.log('\n[7] OpenCode 集成')
  const cfgDir = process.env.WHALE_OPENCODE_CONFIG_DIR
    || (process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'opencode') : path.join(os.homedir(), '.config', 'opencode'))
  note('配置目录 ' + cfgDir)

  const service = path.join(cfgDir, 'service.json')
  if (fs.existsSync(service)) ok('找到 service.json（用量桥可用）')
  else if (process.env.WHALE_OPENCODE_URL) ok('已用 WHALE_OPENCODE_URL 指定服务地址', process.env.WHALE_OPENCODE_URL)
  else hi('没找到 service.json', service, '若用独立服务器，设 WHALE_OPENCODE_URL=http://127.0.0.1:<端口>')

  // 插件登记：① 自动发现目录里 —— 指向本仓库的链接 / 我们自己复制过去的副本  ② 配置里的 plugins 数组
  const norm = (s) => s.replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  const want = norm(PLUGIN_DIR)
  const autoPath = path.join(cfgDir, 'plugins', 'whale-autostart')
  let viaAuto = false   // 链接 → 本仓库（首选，改代码立即生效）
  let viaCopy = false   // 我们复制过去的副本（也算登记，但不随仓库更新）
  let autoDetail = ''
  try {
    const real = fs.realpathSync(autoPath)
    if (norm(real) === want) { viaAuto = true; autoDetail = '（链接 → ' + real + '）' }
    else {
      let isOurs = false
      try {
        isOurs = JSON.parse(fs.readFileSync(path.join(autoPath, 'package.json'), 'utf8')).name === 'whale-autostart'
      } catch { /* ignore */ }
      if (isOurs) { viaCopy = true; autoDetail = '（副本 → ' + real + '）' }
      else autoDetail = '（指向别处：' + real + '）'
    }
  } catch { /* 不存在 */ }

  let viaConfig = false
  for (const n of ['opencode.json', 'opencode.jsonc']) {
    const p = path.join(cfgDir, n)
    if (!fs.existsSync(p)) continue
    try { if (norm(fs.readFileSync(p, 'utf8')).includes(want)) { viaConfig = true; break } } catch { /* ignore */ }
  }
  // 顺带查一下 cli.json 里有没有那条"无效登记"（实测：cli.json 只对带 TUI 入口的插件生效）
  let staleCli = false
  try { staleCli = norm(fs.readFileSync(path.join(cfgDir, 'cli.json'), 'utf8')).includes(want) } catch { /* ignore */ }

  if (viaConfig && (viaAuto || viaCopy)) {
    ok('插件已登记（opencode.json 的 plugins 数组）')
    hi('自动发现目录里也有一份', autoDetail,
      '多余的：npm run setup:opencode -- --migrate 可清掉（不会双开，只是多一次无用启动）')
  } else if (viaConfig) {
    ok('插件已登记（opencode.json 的 plugins 数组）', 'OpenCode 后台服务启动时会加载它')
    note('TUI 启动不会触发自动拉起（实测：cli.json 只对带 TUI 入口的插件生效）—— 想随时见到鱼：双击项目根目录的「启动大肥鱼.cmd」，或 npm start')
  } else if (viaAuto) {
    hi('自动发现目录里是"目录链接" —— 全新启动时会被跳过', autoDetail,
      'npm run setup:opencode   （改成写 opencode.json）')
  } else if (viaCopy) {
    ok('插件已登记（自动发现目录 · 副本）', autoDetail)
    hi('副本不随仓库更新', '改了代码或升级版本后，副本还是旧的', 'npm run setup:opencode')
  } else {
    no('插件尚未登记', 'OpenCode 启动时不会自动拉起挂件',
      'npm run setup:opencode   （或看 npm run setup:opencode -- --dry-run 先预览）')
  }

  if (staleCli) {
    hi('cli.json 里还留着一份无效登记', 'cli.json 只对"带 TUI 入口"的插件生效，我们这条不会被 TUI 加载（实测）',
      'npm run setup:opencode   （会自动清掉它）')
  }
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
console.log('=== 小鲸鱼挂件 · 环境自检 ===  ' + new Date().toLocaleString('zh-CN'))
console.log('挂件目录：' + ROOT)

checkRuntime()
checkDir()
const missingKeys = checkIntegrity()
checkElectron()
await checkPort()
checkAssets()
checkOpenCode()
if (argv.includes('--fix')) fixMissing(missingKeys)

const fails = results.filter((r) => r.s === 'fail')
const warns = results.filter((r) => r.s === 'warn')
console.log('\n=== 汇总：' + results.filter((r) => r.s === 'ok').length + ' 通过 / ' + warns.length + ' 警告 / ' + fails.length + ' 失败 ===')

if (warns.length) {
  console.log('\n警告（不影响启动）：')
  warns.forEach((w) => {
    console.log('  ⚠ ' + w.name + (w.detail ? '  ' + w.detail : ''))
    if (w.fix) console.log('     → ' + w.fix)
  })
}
if (fails.length) {
  console.log('\n失败（需要处理）：')
  fails.forEach((f) => {
    console.log('  ✗ ' + f.name + (f.detail ? '  ' + f.detail : ''))
    if (f.fix) console.log('     → ' + f.fix)
  })
  console.log('\n处理完再跑一次 npm run doctor；环境通过后，用 npm start 启动挂件。')
} else {
  console.log('\n环境没问题 🐋  用 npm start 启动挂件；跑起来后可用 npm run health 做功能体检。')
}
process.exitCode = fails.length ? 1 : 0

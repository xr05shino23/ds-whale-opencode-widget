// 把「小鲸鱼挂件」的 OpenCode 插件登记好 —— 让用户装完不必再手工改配置。
//
// 为什么需要它：OpenCode 不会自动加载「仓库里的」插件目录，必须有人把它接进去。
// 以前这一步写在 README 里让用户手工编辑 opencode.json；现在改成自动完成。
//
// 三层兜底（从上到下依次尝试，成功即停）：
//   ① 目录链接：把 opencode-plugin/whale-autostart 链接进 OpenCode 的
//      【自动发现目录】<配置目录>/plugins/ —— 零配置即被加载，且改代码立即生效（不用复制）。
//   ② 复制兜底：链接失败（策略 / 权限 / 文件系统不支持）时，复制一份过去。
//   ③ 配置兜底：复制也失败时，把插件路径【插入】opencode.json(c) 的 plugins 数组
//      （只做最小文本插入，保留注释与格式；改前自动备份）。
//
// 用法：
//   node scripts/setup-opencode.mjs              登记（幂等，可重复跑）
//   node scripts/setup-opencode.mjs --dry-run    只报告会做什么，不落盘
//   node scripts/setup-opencode.mjs --migrate    登记 + 顺手清掉配置里重复的老条目
//                                                （老用户从"手工改 opencode.json"迁过来的那种）
//   node scripts/setup-opencode.mjs --remove     撤销（删链接/副本，并摘掉配置条目）
//   node scripts/setup-opencode.mjs --soft       postinstall 用：任何失败只警告，退出码恒为 0
//   node scripts/setup-opencode.mjs --quiet      少输出
//
// 环境变量：
//   WHALE_OPENCODE_CONFIG_DIR   指定 OpenCode 配置目录（默认 ~/.config/opencode）
//   WHALE_SETUP_FORCE=copy      调试/逃生：强制走第②层（复制）
//   WHALE_SETUP_FORCE=config    调试/逃生：强制走第③层（写配置）
//   WHALE_SKIP_SETUP=1          跳过（postinstall 会尊重它）
//   CI=1                        跳过（CI 里不去动用户配置）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_DIR = path.join(ROOT, 'opencode-plugin', 'whale-autostart')
const PLUGIN_NAME = 'whale-autostart'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const DRY = has('--dry-run')
const REMOVE = has('--remove')
const MIGRATE = has('--migrate')
const SOFT = has('--soft')
const QUIET = has('--quiet')
const FORCE = (process.env.WHALE_SETUP_FORCE || '').toLowerCase()   // copy | config

const log = (...a) => { if (!QUIET) console.log(...a) }
const ok = (m) => log('  ✓ ' + m)
const no = (m) => log('  ✗ ' + m)
const hi = (m) => log('  ⚠ ' + m)

// OpenCode 配置里统一用正斜杠（反斜杠在 JSON 里要转义；实测正斜杠可用）
const posix = (p) => p.split(path.sep).join('/')
// 比较路径时先把两种斜杠、大小写都归一化
const normPath = (s) => s.replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()

function configDir() {
  if (process.env.WHALE_OPENCODE_CONFIG_DIR) return path.resolve(process.env.WHALE_OPENCODE_CONFIG_DIR)
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'opencode')
  return path.join(os.homedir(), '.config', 'opencode')
}

// 配置文件名：优先已存在的那个（.jsonc 可能带注释）；都没有就用 opencode.json 新建。
// 纯 JSON 本身就是合法 JSONC，所以新建 .json 是安全的。
function configFile(dir) {
  for (const n of ['opencode.jsonc', 'opencode.json']) {
    const p = path.join(dir, n)
    if (fs.existsSync(p)) return p
  }
  return path.join(dir, 'opencode.json')
}

// ---------------------------------------------------------------------------
// 目标位置的状态
// ---------------------------------------------------------------------------
function linkState(target) {
  let st
  try { st = fs.lstatSync(target) } catch { return { kind: 'missing' } }
  if (st.isSymbolicLink()) {
    let real = ''
    try { real = fs.realpathSync(target) } catch { return { kind: 'link-broken' } }
    return { kind: normPath(real) === normPath(PLUGIN_DIR) ? 'link-ok' : 'link-other', real }
  }
  if (st.isDirectory()) {
    // 是不是我们自己复制过去的副本？认 package.json 的 name（不认识的一律不碰）
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
      if (pj && pj.name === PLUGIN_NAME) return { kind: 'copy-ours' }
    } catch { /* ignore */ }
    return { kind: 'dir-foreign' }
  }
  return { kind: 'other' }
}

// ---------------------------------------------------------------------------
// ③ 配置兜底：在 opencode.json(c) 的 plugins 数组里插入 / 移除路径
//    —— 只做最小文本改动，不整体重写（避免毁掉用户的注释与格式）
// ---------------------------------------------------------------------------
function pluginsArray(text) {
  const m = /"plugins"\s*:\s*\[/.exec(text)
  if (!m) return null
  const start = m.index + m[0].length
  let depth = 1, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) return { start, end: i } }
  }
  return null
}

function insertEntry(text, entry) {
  const arr = pluginsArray(text)
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  if (!arr) {
    // 没有 plugins 键 → 插入到第一个 { 之后
    const i = text.indexOf('{')
    if (i < 0) throw new Error('配置文件里找不到 {')
    const rest = text.slice(i + 1)
    const empty = /^\s*\}\s*$/.test(rest)   // 空对象：不加逗号，保证仍是严格合法 JSON
    return text.slice(0, i + 1) + nl + '  "plugins": [' + nl + '    ' + entry + nl + '  ]' + (empty ? '' : ',') + rest
  }
  const content = text.slice(arr.start, arr.end)        // 数组内部内容（不含 [ ]）
  const body = content.replace(/[ \t\r\n]+$/, '')       // 去掉结尾空白
  if (body.trim() === '') {
    // 空数组
    return text.slice(0, arr.start) + nl + '    ' + entry + nl + '  ' + text.slice(arr.end)
  }
  // 在最后一个元素之后追加：沿用最后一行的缩进；若已有尾逗号（JSONC 写法）就不再补逗号
  const nlAt = body.lastIndexOf('\n')
  const lastLine = body.slice(nlAt + 1)
  const indentMatch = /^[ \t]*/.exec(lastLine)
  const indent = indentMatch ? indentMatch[0] : '    '
  const sep = body.endsWith(',') ? '' : ','
  return text.slice(0, arr.start) + body + sep + nl + indent + entry + content.slice(body.length) + text.slice(arr.end)
}

function removeEntry(text, entryPath) {
  const arr = pluginsArray(text)
  if (!arr) return null
  const want = normPath(entryPath)
  // 扫描数组内所有 JSON 字符串元素
  const els = []
  for (let i = arr.start; i < arr.end; i++) {
    if (text[i] !== '"') continue
    let j = i + 1, esc = false
    for (; j < arr.end; j++) {
      if (esc) { esc = false; continue }
      if (text[j] === '\\') { esc = true; continue }
      if (text[j] === '"') break
    }
    const raw = text.slice(i, j + 1)
    let val = ''
    try { val = JSON.parse(raw) } catch { val = raw.slice(1, -1) }
    if (normPath(val) === want) els.push({ from: i, to: j + 1 })
    i = j
  }
  if (!els.length) return null
  // 只摘第一处，连同相邻的一个逗号
  const { from, to } = els[0]
  let cutFrom = from, cutTo = to
  const rest = text.slice(to, arr.end)
  if (/^\s*,/.test(rest)) cutTo = to + rest.indexOf(',') + 1
  else {
    const before = text.slice(arr.start, from)
    const ci = before.lastIndexOf(',')
    if (ci >= 0) cutFrom = arr.start + ci
  }
  return text.slice(0, cutFrom) + text.slice(cutTo)
}

// 读配置文件文本：顺手去掉 BOM。
// PowerShell 的 Set-Content / 记事本写出来的 JSON 常带 BOM，而 Node 的 readFileSync 不会替你去掉 ——
// 留着会让严格 JSON.parse 失败、写回也会把脏字节带回去（实测踩到过）。
function readConfig(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') } catch { return '' }
}

function configHasEntry(file, entryPath) {
  const text = readConfig(file)
  return text ? normPath(text).includes(normPath(entryPath)) : false
}

function writeConfig(file, newText, why) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const backup = file + '.bak-' + stamp
  if (DRY) { ok('[dry-run] 会改写 ' + file + '（' + why + '，改前备份为 ' + path.basename(backup) + '）'); return }
  const existed = fs.existsSync(file)
  if (existed) fs.copyFileSync(file, backup)   // 只备份已存在的文件（首次新建时没有可备份的）
  fs.writeFileSync(file, newText, 'utf8')
  ok('已更新 ' + file + '（' + why + '）')
  log(existed ? '    备份：' + backup : '    （原本没有这个文件，已新建）')
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function inspect() {
  const dir = configDir()
  const target = path.join(dir, 'plugins', PLUGIN_NAME)
  return { dir, target, state: linkState(target), file: configFile(dir) }
}

function doInstall() {
  const { dir, target, state, file } = inspect()
  log('挂件插件目录: ' + PLUGIN_DIR)
  log('OpenCode 配置目录: ' + dir)

  if (!fs.existsSync(path.join(PLUGIN_DIR, 'index.js'))) {
    no('插件目录里没有 index.js，仓库可能不完整：' + PLUGIN_DIR)
    return false
  }

  let via = ''
  let alreadyOk = false   // 已就绪 → 什么都不做（不要再建一次链接！）

  // ① 链接进自动发现目录
  if (state.kind === 'link-ok') { ok('已就绪（目录链接 → 自动发现目录）'); alreadyOk = true }
  else if (state.kind === 'link-other') {
    hi('链接已存在但指向别处（仓库可能搬过家）→ 重建：' + (state.real || '?'))
    via = 'link'
    if (!DRY) { try { fs.rmSync(target, { force: true }) } catch { /* 接着按失败处理 */ } }
  } else if (state.kind === 'link-broken') {
    hi('发现失效链接（目标已不存在）→ 重建')
    via = 'link'
    if (!DRY) { try { fs.rmSync(target, { force: true }) } catch { /* ignore */ } }
  } else if (state.kind === 'copy-ours') {
    // 旧版本曾经用过"复制"兜底；链接更好（改代码立即生效、升级不用重跑）。
    // 认得出是自己的副本（package.json 的 name）才敢删，删完换成链接；换不成再退回刷新副本。
    hi('发现自己复制过去的副本 → 换成目录链接（更好：改代码立即生效）')
    via = 'link'
    if (!DRY) { try { fs.rmSync(target, { recursive: true, force: true }) } catch { /* ignore */ } }
  } else if (state.kind === 'dir-foreign') {
    hi('目标已存在，且不是本插件的目录 —— 不碰它，改用配置登记：' + target)
    via = 'config'
  } else if (state.kind === 'other') {
    hi('目标已存在同名文件 —— 不碰它，改用配置登记：' + target)
    via = 'config'
  } else {
    via = 'link'
  }

  // 调试/逃生通道：强制走某一层（用来验证三层兜底都是真能用的，不是摆设）
  if (FORCE === 'copy' && (via === 'link' || state.kind === 'missing')) {
    hi('（WHALE_SETUP_FORCE=copy）跳过链接，直接复制')
    via = 'copy'
  } else if (FORCE === 'config' && (via === 'link' || via === 'copy')) {
    hi('（WHALE_SETUP_FORCE=config）跳过链接与复制，直接写配置')
    via = 'config'
  }

  if (via === 'link') {
    if (DRY) ok('[dry-run] 会创建目录链接 ' + target + '  →  ' + PLUGIN_DIR)
    else {
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.symlinkSync(PLUGIN_DIR, target, process.platform === 'win32' ? 'junction' : 'dir')
        ok('已创建目录链接 → ' + target)
      } catch (e) {
        hi('创建链接失败（' + (e && e.code ? e.code : e.message) + '）→ 改用复制')
        via = 'copy'
      }
    }
  }

  if (via === 'copy' && !DRY) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.rmSync(target, { recursive: true, force: true })
      fs.cpSync(PLUGIN_DIR, target, { recursive: true, force: true })
      ok('已复制插件到 ' + target)
      log('    注意：副本不会随仓库更新，升级后请重新跑一次 npm run setup:opencode')
    } catch (e) {
      hi('复制失败（' + (e && e.code ? e.code : e.message) + '）→ 改用配置登记')
      via = 'config'
    }
  }

  // ③ 配置登记（仅在 ①② 没成功时做）
  let viaConfig = false
  if (!alreadyOk && (via === 'config' || (DRY && via === 'link' && state.kind === 'dir-foreign'))) {
    try {
      fs.mkdirSync(dir, { recursive: true })   // 配置目录可能还不存在（首次新建）
      if (configHasEntry(file, posix(PLUGIN_DIR))) { ok('配置里已登记该插件，无需改动：' + file); viaConfig = true }
      else {
        const text = readConfig(file) || '{\n}\n'
        writeConfig(file, insertEntry(text, JSON.stringify(posix(PLUGIN_DIR))), '插入 plugins 条目')
        viaConfig = true
      }
    } catch (e) {
      no('写入配置失败：' + (e && e.message))
      return false
    }
  }

  // 双重登记：链接/副本已生效，配置里又列了一遍
  //   → 默认只提醒（不动用户的文件）；加 --migrate 才顺手清掉那个冗余条目。
  if (!alreadyOk && !viaConfig && (via === 'link' || via === 'copy') && configHasEntry(file, posix(PLUGIN_DIR))) {
    if (DRY) {
      hi('提醒：' + path.basename(file) + ' 的 plugins 数组里也登记了同一路径（dry-run 未改动）')
    } else if (MIGRATE) {
      try {
        const text = readConfig(file)
        const nxt = removeEntry(text, posix(PLUGIN_DIR))
        if (nxt === null) hi('配置里找不到可移除的条目（写法特殊？），请手动检查：' + file)
        else writeConfig(file, nxt, '移除冗余的 plugins 条目（已改用自动发现目录）')
      } catch (e) {
        hi('清理冗余条目失败：' + (e && e.message))
      }
    } else {
      hi('提醒：' + path.basename(file) + ' 的 plugins 数组里也登记了同一路径。')
      hi('      两处同时生效会重复加载（挂件有单实例锁、不会双开，但多一次无用启动）。')
      hi('      要清理就再跑一次：npm run setup:opencode -- --migrate')
    }
  }

  log('')
  log('完成 ✅  下一步：重启 OpenCode（或让它重载插件）即可自动拉起挂件。')
  log('撤销：node scripts/setup-opencode.mjs --remove')
  return true
}

function doRemove() {
  const { target, state, file } = inspect()
  let touched = false
  if (state.kind === 'link-ok' || state.kind === 'link-broken' || state.kind === 'link-other') {
    if (DRY) ok('[dry-run] 会删除链接 ' + target)
    else { try { fs.rmSync(target, { force: true }); ok('已删除链接 ' + target); touched = true } catch (e) { no('删除链接失败：' + (e && e.message)) } }
  } else if (state.kind === 'copy-ours') {
    if (DRY) ok('[dry-run] 会删除副本 ' + target)
    else { try { fs.rmSync(target, { recursive: true, force: true }); ok('已删除副本 ' + target); touched = true } catch (e) { no('删除副本失败：' + (e && e.message)) } }
  } else if (state.kind === 'missing') {
    log('  · 自动发现目录里本来就没有本插件')
  } else {
    hi('目标不是本插件的内容，保持不动：' + target)
  }

  // 配置里的条目
  try {
    const text = readConfig(file)
    const nxt = removeEntry(text, posix(PLUGIN_DIR))
    if (nxt === null) log('  · 配置里没有本插件的条目')
    else writeConfig(file, nxt, '移除 plugins 条目'), touched = true
  } catch { /* 配置不存在就算了 */ }

  log('')
  if (!touched) log('没有需要撤销的内容。')
  else log('已撤销 ✅  重启 OpenCode 后不再自动拉起挂件。')
  return true
}

let failed = false
try {
  const skip = process.env.CI && !has('--force')
  if (process.env.WHALE_SKIP_SETUP === '1' || skip) {
    log('  · 已跳过插件登记（' + (process.env.WHALE_SKIP_SETUP === '1' ? 'WHALE_SKIP_SETUP=1' : 'CI 环境') + '）')
  } else if (REMOVE) {
    log('=== 小鲸鱼挂件 · 撤销 OpenCode 插件登记 ===')
    failed = !doRemove()
  } else {
    log('=== 小鲸鱼挂件 · 登记 OpenCode 插件 ===' + (DRY ? '（dry-run）' : ''))
    failed = !doInstall()
  }
} catch (e) {
  no('意外错误：' + (e && e.stack ? e.stack : e))
  failed = true
}

if (failed) {
  if (SOFT) {
    log('')
    log('（安装流程继续；稍后可用 npm run setup:opencode 重试）')
  } else {
    process.exitCode = 1
  }
}

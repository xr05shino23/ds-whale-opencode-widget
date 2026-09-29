// 把「小鲸鱼挂件」的 OpenCode 插件登记好 —— 让用户装完不必再手工改配置。
//
// 为什么需要它：OpenCode 不会自动加载「仓库里的」插件目录，必须有人把它接进去。
// 以前这一步写在 README 里让用户手工编辑 opencode.json；现在改成自动完成。
//
// 登记策略（v0.1.3 起调整过优先级 —— 原因很重要）：
//   ① 首选：把插件路径【插入】opencode.json(c) 的 plugins 数组。
//      只做最小文本插入（保留注释与格式），改前自动备份。
//   ② 兜底：写不了配置时，复制到【自动发现目录】<配置目录>/plugins/。
//      真实目录会被扫到；代价是副本不随仓库更新，升级后要重跑一次本脚本。
//   ✗ 不再使用"目录链接 / junction"：OpenCode 扫目录时按真实目录判断，符号链接会被跳过 ——
//     实测结果是"热重载能加载、**全新启动扫不到**"，一个会静默失效的陷阱（用户踩到过）。
//     如果检测到旧版留下的链接，会自动清掉。
//
// 用法：
//   node scripts/setup-opencode.mjs              登记（幂等，可重复跑）
//   node scripts/setup-opencode.mjs --dry-run    只报告会做什么，不落盘
//   node scripts/setup-opencode.mjs --migrate    登记 + 顺手清掉自动发现目录里冗余的旧副本
//   node scripts/setup-opencode.mjs --remove     撤销（删配置条目/副本，并清掉旧链接）
//   node scripts/setup-opencode.mjs --soft       postinstall 用：任何失败只警告，退出码恒为 0
//   node scripts/setup-opencode.mjs --quiet      少输出
//
// 环境变量：
//   WHALE_OPENCODE_CONFIG_DIR   指定 OpenCode 配置目录（默认 ~/.config/opencode）
//   WHALE_SETUP_FORCE=copy      调试/逃生：强制走第②层（复制到自动发现目录）
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

  // —— 登记策略（v0.1.3 起调整了优先级，原因见文件头）——
  //   ① 首选：写 opencode.json(c) 的 plugins 数组 —— 唯一被实测证明"全新启动也能加载"的方式
  //   ② 兜底：复制到自动发现目录（真实目录；会变旧，但至少能被扫到）
  //   ✗ 不再用"目录链接 / junction"：OpenCode 扫目录时按真实目录判断，符号链接会被跳过 ——
  //     热重载能加载、**全新启动扫不到**（实测踩到），是个会静默失效的陷阱。发现旧链接就清掉。
  const isOldLink = state.kind === 'link-ok' || state.kind === 'link-other' || state.kind === 'link-broken'
  if (isOldLink) {
    hi('清理旧版留下的目录链接（' + state.kind + '）—— 它在全新启动时会被跳过')
    if (!DRY) { try { fs.rmSync(target, { force: true }) } catch { /* ignore */ } }
  }

  let via = ''
  let alreadyOk = false   // 已就绪 → 什么都不做

  if (FORCE === 'copy') {
    hi('（WHALE_SETUP_FORCE=copy）强制走"复制到自动发现目录"')
    via = 'copy'
  } else if (configHasEntry(file, posix(PLUGIN_DIR))) {
    ok('已就绪（opencode.json(c) 的 plugins 数组已登记）')
    alreadyOk = true
  } else {
    via = 'config'   // 首选写配置；写失败会自动退回"复制"（见下面 try/catch）
  }

  // ① 首选：写进 opencode.json(c) 的 plugins 数组（唯一被实测证明"全新启动也能加载"的方式）
  let viaConfig = false
  if (!alreadyOk && via === 'config') {
    try {
      fs.mkdirSync(dir, { recursive: true })   // 配置目录可能还不存在（首次新建）
      const text = readConfig(file) || '{\n}\n'
      writeConfig(file, insertEntry(text, JSON.stringify(posix(PLUGIN_DIR))), '插入 plugins 条目')
      viaConfig = true
    } catch (e) {
      hi('写配置失败（' + (e && e.message) + '）→ 退回：复制到自动发现目录')
      via = 'copy'
    }
  }

  // ② 兜底：复制到自动发现目录（真实目录，能被扫到；代价是升级后要重跑一次）
  if (!alreadyOk && !viaConfig && via === 'copy') {
    // 安全护栏：那个位置如果是"别人的"目录/文件，绝不覆盖（宁可登记失败，也不删用户的东西）
    if (state.kind === 'dir-foreign' || state.kind === 'other') {
      no('自动发现目录里已存在非本插件的内容，不覆盖它：' + target)
      no('      → 请手动处理那个位置，或用 WHALE_OPENCODE_CONFIG_DIR 指向别的配置目录')
      return false
    }
    if (DRY) ok('[dry-run] 会复制插件到 ' + target)
    else {
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.rmSync(target, { recursive: true, force: true })
        fs.cpSync(PLUGIN_DIR, target, { recursive: true, force: true })
        ok('已复制插件到 ' + target)
        log('    注意：副本不会随仓库更新，升级后请重新跑一次 npm run setup:opencode')
      } catch (e) {
        no('复制也失败（' + (e && e.code ? e.code : e.message) + '）：登记没能完成')
        return false
      }
    }
  }

  // 重复登记：数组已经生效（本次刚写入，或本来就有），自动发现目录里还留着旧版本复制过去的副本
  //   → 默认只提醒（不动用户的文件）；加 --migrate 才把那份副本删掉（数组才是权威登记）
  if ((alreadyOk || viaConfig) && via !== 'copy') {
    let ours = false
    try { ours = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).name === PLUGIN_NAME } catch { ours = false }
    if (ours) {
      if (DRY) hi('提醒：自动发现目录里还有一份副本（dry-run 未改动）：' + target)
      else if (MIGRATE) {
        try { fs.rmSync(target, { recursive: true, force: true }); ok('已清掉自动发现目录里的冗余副本：' + target) } catch (e) { hi('清理冗余副本失败：' + (e && e.message)) }
      } else {
        hi('提醒：自动发现目录里还有一份旧副本：' + target)
        hi('      两处同时生效会重复加载（有单实例锁、不会双开，但多一次无用启动）。')
        hi('      要清理就再跑一次：npm run setup:opencode -- --migrate')
      }
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

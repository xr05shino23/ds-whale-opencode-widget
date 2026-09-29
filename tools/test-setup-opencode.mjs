// 本地回归测试（不入库）：验证 scripts/setup-opencode.mjs 的三层兜底 + 撤销
// 用法： node _private/test-setup-opencode.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'setup-opencode.mjs')
const PLUGIN = path.join(ROOT, 'opencode-plugin', 'whale-autostart')

const results = []
const say = (okFlag, name, detail = '') => {
  results.push(okFlag)
  console.log((okFlag ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''))
}

function run(args = [], env = {}) {
  try {
    return execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, WHALE_SETUP_FORCE: '', ...env },
    })
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '')
  }
}

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-setup-test-'))
  return d
}

// ---------------------------------------------------------------------------
// T1 默认 → 目录链接
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  const t = path.join(cfg, 'plugins', 'whale-autostart')
  const st = fs.lstatSync(t)
  say(st.isSymbolicLink(), 'T1 默认走①：创建了目录链接', t)
  const real = fs.realpathSync(t)
  say(path.resolve(real).toLowerCase() === path.resolve(PLUGIN).toLowerCase(), 'T1 链接指向挂件插件目录')
  say(fs.existsSync(path.join(t, 'index.js')) && fs.existsSync(path.join(t, 'package.json')), 'T1 经链接能读到 index.js / package.json')

  // 幂等：再跑一次不应报错、也不该重复创建，更**不该把链接降级成副本**
  const again = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(/已就绪/.test(again), 'T1 幂等：第二次运行识别为已就绪')
  say(!/创建链接失败/.test(again), 'T1 幂等：没有再去重复创建链接（避免 EEXIST 掉进复制兜底）')
  say(fs.lstatSync(t).isSymbolicLink(), 'T1 幂等：跑第二遍之后链接**仍然是链接**（这条曾经漏测，导致真把链接换成了副本）')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T2 强制走② → 复制
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'copy' })
  const t = path.join(cfg, 'plugins', 'whale-autostart')
  const st = fs.lstatSync(t)
  say(!st.isSymbolicLink() && st.isDirectory(), 'T2 强制走②：是真实目录（复制）')
  say(fs.existsSync(path.join(t, 'index.js')), 'T2 复制内容完整（index.js 在位）')
  // 再跑一次：应识别为"我们的副本"并刷新，不报错
  const again = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'copy' })
  say(!/失败/.test(again), 'T2 幂等：重复运行不报失败')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T3 强制走③ → 写配置（三种起点：无文件 / 空对象 / 已有 plugins 数组）
// ---------------------------------------------------------------------------
{
  // 3a 完全没有配置文件
  const cfg = freshDir()
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'config' })
  const f = path.join(cfg, 'opencode.json')
  say(fs.existsSync(f), 'T3a 走③：新建了配置文件')
  let j = null
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { say(false, 'T3a 生成的配置是合法 JSON', e.message) }
  if (j) say(Array.isArray(j.plugins) && j.plugins.length === 1 && /whale-autostart$/.test(j.plugins[0]), 'T3a plugins 数组正确', JSON.stringify(j.plugins))
  fs.rmSync(cfg, { recursive: true, force: true })

  // 3b 空对象 {}
  const cfg2 = freshDir()
  fs.writeFileSync(path.join(cfg2, 'opencode.json'), '{\n}\n')
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg2, WHALE_SETUP_FORCE: 'config' })
  const f2 = path.join(cfg2, 'opencode.json')
  try {
    const j2 = JSON.parse(fs.readFileSync(f2, 'utf8'))
    say(Array.isArray(j2.plugins) && j2.plugins.length === 1, 'T3b 空对象：插入后仍是合法 JSON', JSON.stringify(j2.plugins))
  } catch (e) { say(false, 'T3b 空对象：插入后仍是合法 JSON', e.message) }
  fs.rmSync(cfg2, { recursive: true, force: true })

  // 3c 已有其它插件（CRLF + 注释 —— JSONC 风格）
  const cfg3 = freshDir()
  const fixture = [
    '{',
    '  // 用户的注释：不要弄丢我',
    '  "model": "deepseek/deepseek-flash",',
    '  "plugins": [',
    '    "some-other-plugin"',
    '  ]',
    '}',
    '',
  ].join('\r\n')
  fs.writeFileSync(path.join(cfg3, 'opencode.json'), fixture)
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg3, WHALE_SETUP_FORCE: 'config' })
  const f3 = path.join(cfg3, 'opencode.json')
  const after = fs.readFileSync(f3, 'utf8')
  say(after.includes('// 用户的注释：不要弄丢我'), 'T3c JSONC：注释被保留')
  say(after.includes('"some-other-plugin"'), 'T3c 别人的插件条目被保留')
  say(/\r\n/.test(after) && !/[^\r]\n/.test(after), 'T3c CRLF 行尾保持一致')
  try {
    const j3 = JSON.parse(after.replace(/^\s*\/\/.*$/gm, ''))
    say(j3.plugins.length === 2 && /whale-autostart$/.test(j3.plugins[1]), 'T3c 数组里两个条目且顺序正确', JSON.stringify(j3.plugins))
  } catch (e) { say(false, 'T3c 去注释后可解析为 JSON', e.message) }
  say(fs.readdirSync(cfg3).some((n) => n.includes('.bak-')), 'T3c 改配置前留了备份')

  // 3d 幂等 + 撤销只摘自己的
  const again3 = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg3, WHALE_SETUP_FORCE: 'config' })
  say(/已登记/.test(again3), 'T3d 幂等：识别为已登记，不重复插入')
  run(['--remove'], { WHALE_OPENCODE_CONFIG_DIR: cfg3 })
  const after3 = fs.readFileSync(f3, 'utf8')
  say(after3.includes('"some-other-plugin"'), 'T3d 撤销：别人的条目仍在')
  say(!after3.includes('whale-autostart'), 'T3d 撤销：我们的条目已摘掉')
  say(after3.includes('// 用户的注释：不要弄丢我'), 'T3d 撤销：注释仍在')
  try { JSON.parse(after3.replace(/^\s*\/\/.*$/gm, '')); say(true, 'T3d 撤销后仍是合法 JSON') } catch (e) { say(false, 'T3d 撤销后仍是合法 JSON', e.message) }
  fs.rmSync(cfg3, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T4 撤销链接
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  const t = path.join(cfg, 'plugins', 'whale-autostart')
  run(['--remove'], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(!fs.existsSync(t), 'T4 --remove 删掉了链接')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T5 不碰用户自己的同名目录（安全底线）
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const t = path.join(cfg, 'plugins', 'whale-autostart')
  fs.mkdirSync(t, { recursive: true })
  fs.writeFileSync(path.join(t, '我的东西.txt'), '别删我')
  const out = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(fs.existsSync(path.join(t, '我的东西.txt')), 'T5 陌生同名目录：内容没被动过')
  say(/不是本插件的目录/.test(out), 'T5 并明确提示不会碰它')
  say(fs.readFileSync(path.join(cfg, 'opencode.json'), 'utf8').includes('whale-autostart'), 'T5 自动改走③：写进配置')
  run(['--remove'], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(fs.existsSync(path.join(t, '我的东西.txt')), 'T5 --remove 也不会删用户自己的目录')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T6 postinstall 的 --soft：配置目录不可用时也必须退出码 0
// ---------------------------------------------------------------------------
{
  const out = run(['--soft'], { WHALE_OPENCODE_CONFIG_DIR: path.join(os.tmpdir(), 'no-such-parent-' + Date.now(), 'deep', 'oc') })
  say(!/失败/.test(out) || /继续/.test(out), 'T6 --soft 失败也只警告、不报错')
}

// ---------------------------------------------------------------------------
// T7 发现自己复制过去的副本 → 应该换成链接（链接更好：改代码立即生效）
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const t = path.join(cfg, 'plugins', 'whale-autostart')
  fs.mkdirSync(t, { recursive: true })
  fs.writeFileSync(path.join(t, 'package.json'), JSON.stringify({ name: 'whale-autostart', version: '0.0.0', main: 'index.js' }))
  fs.writeFileSync(path.join(t, 'index.js'), '// 旧副本')
  say(!fs.lstatSync(t).isSymbolicLink(), 'T7 前置：现在是"副本"（真实目录）')
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(fs.lstatSync(t).isSymbolicLink(), 'T7 副本被换成链接')
  say(path.resolve(fs.realpathSync(t)).toLowerCase() === path.resolve(PLUGIN).toLowerCase(), 'T7 链接指向仓库插件目录')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T8 配置文件带 BOM（PowerShell/记事本写的常见）→ 写回时应去掉 BOM 且仍是合法 JSON
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const f = path.join(cfg, 'opencode.json')
  fs.writeFileSync(f, '\uFEFF{\r\n  "plugins": [\r\n    "some-other-plugin"\r\n  ]\r\n}\r\n')
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'config' })
  const after = fs.readFileSync(f, 'utf8')
  say(!after.startsWith('\uFEFF'), 'T8 写回后不带 BOM')
  say(after.includes('"some-other-plugin"'), 'T8 别人的条目保留')
  try {
    const j = JSON.parse(after)
    say(j.plugins.length === 2 && /whale-autostart$/.test(j.plugins[1]), 'T8 去 BOM 后是严格合法 JSON（可被 JSON.parse 解析）', JSON.stringify(j.plugins))
  } catch (e) { say(false, 'T8 严格 JSON 解析', e.message) }
  fs.rmSync(cfg, { recursive: true, force: true })
}

const fails = results.filter((r) => !r).length
console.log('\n===== ' + (results.length - fails) + '/' + results.length + ' 通过 =====')
process.exitCode = fails ? 1 : 0

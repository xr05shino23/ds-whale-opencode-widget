// 本地回归测试（不入库）：验证 scripts/setup-opencode.mjs 的登记策略与安全底线
// 用法： node tools/test-setup-opencode.mjs
//
// v0.1.3 起登记策略变了（原因见脚本头部注释）：
//   ① 首选写 opencode.json(c) 的 plugins 数组（唯一被实测证明"全新启动也能加载"）
//   ② 兜底才复制到自动发现目录
//   ✗ 不再用目录链接/junction（全新启动会被跳过）→ 发现旧链接要清掉
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

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whale-setup-test-'))
// 登记只写一个文件：opencode.json（cli.json 那条已实测无效 —— cli.json 只对"带 TUI 入口"的插件生效）
const readCfg = (cfg, name = 'opencode.json') => {
  const f = path.join(cfg, name)
  try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '') } catch { return '' }
}
const pluginsOf = (cfg, name = 'opencode.json') => { try { return JSON.parse(readCfg(cfg, name)).plugins } catch { return null } }
const registered = (cfg) => {
  const want = path.join(PLUGIN).split(path.sep).join('/')
  return (pluginsOf(cfg) || []).includes(want)
}
const autoTarget = (cfg) => path.join(cfg, 'plugins', 'whale-autostart')

// ---------------------------------------------------------------------------
// T1 默认 = 写配置数组（首选）；幂等；不再产生任何链接/副本
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const out = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(registered(cfg), 'T1 默认：路径写进了 opencode.json 的 plugins 数组', JSON.stringify(pluginsOf(cfg)))
  say(/已更新/.test(out) && /插入 plugins 条目/.test(out), 'T1 输出了"插入 plugins 条目"')
  say(!fs.existsSync(autoTarget(cfg)), 'T1 没有在自动发现目录里留链接/副本（不需要）')
  say(/TUI 启动不会触发自动拉起/.test(out), 'T1 诚实告知"TUI 启动不会触发"（实测结论）')

  const again = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(/已就绪/.test(again), 'T1 幂等：第二次运行识别为已就绪')
  say((pluginsOf(cfg) || []).length === 1, 'T1 幂等：没有重复条目')
  say(!fs.existsSync(autoTarget(cfg)), 'T1 幂等：仍然没有多出副本')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T2 强制走②：复制到自动发现目录（真实目录，能被扫到）
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'copy' })
  const t = autoTarget(cfg)
  const st = fs.existsSync(t) ? fs.lstatSync(t) : null
  say(!!st && st.isDirectory() && !st.isSymbolicLink(), 'T2 强制走②：是真实目录（不是链接）')
  say(fs.existsSync(path.join(t, 'index.js')) && fs.existsSync(path.join(t, 'package.json')), 'T2 复制内容完整')
  say(!pluginsOf(cfg) || pluginsOf(cfg).length === 0, 'T2 此时没有往配置里塞条目（走的是②）')
  const again = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'copy' })
  // 判据用脚本真正的失败标记「✗ 」（注意别拿"失败"二字当判据 —— 卡巴斯基警告文本里就有"服务登录失败"）
  say(!/✗ /.test(again), 'T2 幂等：重复运行不报失败')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T3 配置文件的三种起点（无文件 / 空对象 / JSONC 带注释与 CRLF）
// ---------------------------------------------------------------------------
{
  // 3a 完全没有配置文件
  const cfg = freshDir()
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  const f = path.join(cfg, 'opencode.json')
  say(fs.existsSync(f), 'T3a 新建了配置文件')
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    say(Array.isArray(j.plugins) && j.plugins.length === 1, 'T3a 生成的是严格合法 JSON', JSON.stringify(j.plugins))
  } catch (e) { say(false, 'T3a 严格 JSON 解析', e.message) }
  fs.rmSync(cfg, { recursive: true, force: true })

  // 3b 空对象 {}
  const cfg2 = freshDir()
  fs.writeFileSync(path.join(cfg2, 'opencode.json'), '{\n}\n')
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg2 })
  try {
    const j2 = JSON.parse(readCfg(cfg2))
    say(Array.isArray(j2.plugins) && j2.plugins.length === 1, 'T3b 空对象：插入后仍是合法 JSON', JSON.stringify(j2.plugins))
  } catch (e) { say(false, 'T3b 空对象：插入后仍是合法 JSON', e.message) }
  fs.rmSync(cfg2, { recursive: true, force: true })

  // 3c 已有其它插件 + 注释 + CRLF
  const cfg3 = freshDir()
  const fixture = ['{', '  // 用户的注释：不要弄丢我', '  "model": "deepseek/deepseek-flash",', '  "plugins": [', '    "some-other-plugin"', '  ]', '}', ''].join('\r\n')
  fs.writeFileSync(path.join(cfg3, 'opencode.json'), fixture)
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg3 })
  const after = readCfg(cfg3)
  say(after.includes('// 用户的注释：不要弄丢我'), 'T3c JSONC：注释被保留')
  say(after.includes('"some-other-plugin"'), 'T3c 别人的插件条目被保留')
  say(/\r\n/.test(after) && !/[^\r]\n/.test(after), 'T3c CRLF 行尾保持一致')
  try {
    const j3 = JSON.parse(after.replace(/^\s*\/\/.*$/gm, ''))
    say(j3.plugins.length === 2 && /whale-autostart$/.test(j3.plugins[1]), 'T3c 两个条目且顺序正确', JSON.stringify(j3.plugins))
  } catch (e) { say(false, 'T3c 去注释后可解析', e.message) }
  say(fs.readdirSync(cfg3).some((n) => n.includes('.bak-')), 'T3c 改配置前留了备份')

  // 3d 幂等 + 撤销（只摘自己的）
  const again3 = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg3 })
  say(/已就绪/.test(again3), 'T3d 幂等：识别为已登记，不重复插入')
  run(['--remove'], { WHALE_OPENCODE_CONFIG_DIR: cfg3 })
  const after3 = readCfg(cfg3)
  say(after3.includes('"some-other-plugin"'), 'T3d 撤销：别人的条目仍在')
  say(!after3.includes('whale-autostart'), 'T3d 撤销：我们的条目已摘掉')
  say(after3.includes('// 用户的注释：不要弄丢我'), 'T3d 撤销：注释仍在')
  try { JSON.parse(after3.replace(/^\s*\/\/.*$/gm, '')); say(true, 'T3d 撤销后仍是合法 JSON') } catch (e) { say(false, 'T3d 撤销后仍是合法 JSON', e.message) }
  fs.rmSync(cfg3, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T4 --remove 也能清掉第②层留下的副本
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'copy' })
  say(fs.existsSync(autoTarget(cfg)), 'T4 前置：副本已创建')
  run(['--remove'], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(!fs.existsSync(autoTarget(cfg)), 'T4 --remove 删掉了副本')
  say((pluginsOf(cfg) || []).length === 0, 'T4 配置里的条目也摘掉了')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T10 清理历史遗留：cli.json 里那条"无效登记"要被清掉（实测它不会被 TUI 加载）
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const want = PLUGIN.split(path.sep).join('/')
  fs.mkdirSync(cfg, { recursive: true })
  fs.writeFileSync(path.join(cfg, 'cli.json'), JSON.stringify({ plugins: [want, 'some-other-plugin'] }, null, 2))
  const out = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  const left = pluginsOf(cfg, 'cli.json') || []
  say(!left.includes(want), 'T10 cli.json 里我们的那条被清掉了', JSON.stringify(left))
  say(left.includes('some-other-plugin'), 'T10 别人的条目保留')
  say(/清理 cli.json 里那条无效登记/.test(out), 'T10 并说明了为什么清理')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T5 安全底线：那个位置是"别人的目录"时，绝不覆盖
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const t = autoTarget(cfg)
  fs.mkdirSync(t, { recursive: true })
  fs.writeFileSync(path.join(t, '我的东西.txt'), '别删我')
  const out = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(fs.existsSync(path.join(t, '我的东西.txt')), 'T5 陌生同名目录：内容没被动过（默认走配置、根本不碰它）')
  say((pluginsOf(cfg) || []).includes(path.join(PLUGIN).split(path.sep).join('/')), 'T5 且登记成功了（走的是①）')

  // 强制走②时也要拦住
  const out2 = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg, WHALE_SETUP_FORCE: 'copy' })
  say(fs.existsSync(path.join(t, '我的东西.txt')), 'T5 强制走②时：仍然没动别人的目录')
  say(/不覆盖它/.test(out2), 'T5 并明确报出"不覆盖它"')
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T6 postinstall 的 --soft：任何失败都必须退出码 0
// ---------------------------------------------------------------------------
{
  const out = run(['--soft'], { WHALE_OPENCODE_CONFIG_DIR: path.join(os.tmpdir(), 'no-such-parent-' + Date.now(), 'deep', 'oc') })
  say(!/✗ /.test(out) || /继续/.test(out), 'T6 --soft 失败也只警告、不报错')
}

// ---------------------------------------------------------------------------
// T7 迁移：旧版留下的 junction 会被清掉，并改走数组（这是本次修的核心 bug）
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const t = autoTarget(cfg)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.symlinkSync(PLUGIN, t, process.platform === 'win32' ? 'junction' : 'dir')
  say(fs.lstatSync(t).isSymbolicLink(), 'T7 前置：自动发现目录里是一个链接（旧版行为）')
  const out = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(!fs.existsSync(t), 'T7 旧链接被清掉了')
  say(/清理旧版留下的目录链接/.test(out), 'T7 并明确报告清理动作')
  say((pluginsOf(cfg) || []).length === 1, 'T7 改用数组登记', JSON.stringify(pluginsOf(cfg)))
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T8 配置文件带 BOM（PowerShell/记事本写的常见）→ 写回时不带 BOM 且仍是合法 JSON
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  const f = path.join(cfg, 'opencode.json')
  fs.writeFileSync(f, '\uFEFF{\r\n  "plugins": [\r\n    "some-other-plugin"\r\n  ]\r\n}\r\n')
  run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  const after = fs.readFileSync(f, 'utf8')
  say(!after.startsWith('\uFEFF'), 'T8 写回后不带 BOM')
  say(after.includes('"some-other-plugin"'), 'T8 别人的条目保留')
  try {
    const j = JSON.parse(after)
    say(j.plugins.length === 2, 'T8 去 BOM 后是严格合法 JSON', JSON.stringify(j.plugins))
  } catch (e) { say(false, 'T8 严格 JSON 解析', e.message) }
  fs.rmSync(cfg, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T9 数组 + 自动发现目录里的旧副本同时存在：默认只提醒，--migrate 才清副本
// ---------------------------------------------------------------------------
{
  const cfg = freshDir()
  fs.mkdirSync(autoTarget(cfg), { recursive: true })
  fs.writeFileSync(path.join(autoTarget(cfg), 'package.json'), JSON.stringify({ name: 'whale-autostart', version: '0.0.0', main: 'index.js' }))
  fs.writeFileSync(path.join(autoTarget(cfg), 'index.js'), '// 旧副本')
  const out = run([], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(fs.existsSync(autoTarget(cfg)), 'T9 默认：不擅自删除那份副本')
  say(/还有一份旧副本/.test(out) && /--migrate/.test(out), 'T9 默认：提醒 + 给出清理命令')
  run(['--migrate'], { WHALE_OPENCODE_CONFIG_DIR: cfg })
  say(!fs.existsSync(autoTarget(cfg)), 'T9 --migrate：冗余副本被清掉')
  say((pluginsOf(cfg) || []).length === 1, 'T9 数组登记仍在', JSON.stringify(pluginsOf(cfg)))
  fs.rmSync(cfg, { recursive: true, force: true })
}

const fails = results.filter((r) => !r).length
console.log('\n===== ' + (results.length - fails) + '/' + results.length + ' 通过 =====')
process.exitCode = fails ? 1 : 0

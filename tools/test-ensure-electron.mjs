// 安装期兜底脚本的自测：node tools/test-ensure-electron.mjs
//
// 用临时目录 + 假 install.js 覆盖各种场景，不碰真实的 node_modules、不联网。
// 重点验证两条铁律：① 该修的时候真能修好 ② 任何情况下都不让 npm install 失败/卡死
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'ensure-electron.mjs')

const results = []
const say = (okFlag, name, detail = '') => {
  results.push(okFlag)
  console.log((okFlag ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''))
}

// ⚠️ 临时目录必须在仓库之外：仓库里 package.json 有 "type":"module"，
//    放仓库内的话假的 install.js 会被当成 ESM，`require` 就不可用了。
function fixture({ withPackage = true, binary = false, installJs = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-ensure-test-'))
  const el = path.join(dir, 'node_modules', 'electron')
  if (withPackage) {
    fs.mkdirSync(el, { recursive: true })
    fs.writeFileSync(path.join(el, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0-fake' }))
  }
  if (binary) {
    const dist = path.join(el, 'dist')
    fs.mkdirSync(dist, { recursive: true })
    fs.writeFileSync(path.join(dist, process.platform === 'win32' ? 'electron.exe' : 'electron'), 'fake')
  }
  if (installJs) fs.writeFileSync(path.join(el, 'install.js'), installJs)
  return dir
}

const FAKE_OK = `
const fs = require('fs'); const path = require('path')
const dist = path.join(__dirname, 'dist')
fs.mkdirSync(dist, { recursive: true })
fs.writeFileSync(path.join(dist, ${JSON.stringify(process.platform === 'win32' ? 'electron.exe' : 'electron')}), 'fake')
fs.writeFileSync(path.join(__dirname, 'install-ran.marker'), 'yes')
console.log('[fake install.js] done')
`
const FAKE_HANG = `console.log('[fake install.js] hanging...'); setInterval(function(){}, 1000)`
const FAKE_FAIL = `console.error('[fake install.js] boom'); process.exit(3)`

function run(dir, env = {}) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, WHALE_DIR: dir, WHALE_SKIP_SETUP: '', CI: '', WHALE_ENSURE_TIMEOUT_MS: '', ...env },
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
const binPath = (dir) => path.join(dir, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const marker = (dir) => path.join(dir, 'node_modules', 'electron', 'install-ran.marker')

// ---------------------------------------------------------------------------
// T1 二进制已在位 → 什么都不做
// ---------------------------------------------------------------------------
{
  const d = fixture({ binary: true, installJs: FAKE_OK })
  const r = run(d)
  say(r.code === 0, 'T1 退出码 0')
  say(/二进制在位/.test(r.out), 'T1 识别为"无需处理"')
  say(!fs.existsSync(marker(d)), 'T1 没有多此一举去跑 install.js')
  fs.rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T2 electron 包都不存在 → 给指引，不报错
// ---------------------------------------------------------------------------
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-ensure-test-'))
  const r = run(d)
  say(r.code === 0, 'T2 退出码 0')
  say(/node_modules\/electron 不存在/.test(r.out), 'T2 提示"npm 没装上"')
  fs.rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T3 缺二进制、有 install.js → 补跑并修好（核心场景）
// ---------------------------------------------------------------------------
{
  const d = fixture({ installJs: FAKE_OK })
  say(!fs.existsSync(binPath(d)), 'T3 前置：确实缺二进制')
  const r = run(d)
  say(r.code === 0, 'T3 退出码 0')
  say(fs.existsSync(marker(d)), 'T3 确实补跑了 install.js')
  say(fs.existsSync(binPath(d)), 'T3 修好了：二进制到位')
  say(/已修复/.test(r.out), 'T3 报告"已修复"')
  fs.rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T4 install.js 卡住 → 到点放弃（不能让 npm install 卡几十分钟）
// ---------------------------------------------------------------------------
{
  const d = fixture({ installJs: FAKE_HANG })
  const t0 = Date.now()
  const r = run(d, { WHALE_ENSURE_TIMEOUT_MS: '1500' })
  const ms = Date.now() - t0
  say(r.code === 0, 'T4 退出码 0（铁律：不阻断安装）')
  say(/已放弃/.test(r.out), 'T4 报告"已放弃"')
  say(/ELECTRON_MIRROR/.test(r.out), 'T4 给出镜像重试指引')
  say(ms < 15000, 'T4 在超时后很快返回', ms + 'ms（上限设的是 1.5 秒）')
  fs.rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T5 install.js 失败 → 只警告，退出码仍是 0
// ---------------------------------------------------------------------------
{
  const d = fixture({ installJs: FAKE_FAIL })
  const r = run(d)
  say(r.code === 0, 'T5 退出码 0（安装流程不受影响）')
  say(/补跑失败/.test(r.out), 'T5 报告失败并给指引')
  say(!fs.existsSync(binPath(d)), 'T5 二进制仍未到位（如实反映）')
  fs.rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// T6 WHALE_SKIP_SETUP=1 / T7 CI=1 → 跳过，且绝不跑 install.js
// ---------------------------------------------------------------------------
for (const [name, env] of [['T6 WHALE_SKIP_SETUP=1', { WHALE_SKIP_SETUP: '1' }], ['T7 CI=1', { CI: '1' }]]) {
  const d = fixture({ installJs: FAKE_OK })
  const r = run(d, env)
  say(r.code === 0, name + ' 退出码 0')
  say(/已跳过/.test(r.out), name + ' 报告"已跳过"')
  say(!fs.existsSync(marker(d)), name + ' 没有跑 install.js')
  fs.rmSync(d, { recursive: true, force: true })
}

const fails = results.filter((r) => !r).length
console.log('\n===== ' + (results.length - fails) + '/' + results.length + ' 通过 =====')
process.exitCode = fails ? 1 : 0

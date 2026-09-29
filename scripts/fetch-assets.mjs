// 取回上游美术素材（本仓库不分发这些文件，原因见 NOTICE.md 第四节）
//
// 用法：
//   node scripts/fetch-assets.mjs            只下载缺失的
//   node scripts/fetch-assets.mjs --force    强制重新下载
//
// 说明：
//   · 只下载【媒体素材】。绝不覆盖 assets/whale-widget.js —— 那是我们打过补丁的代码。
//   · 素材按上游 PROVENANCE 的约定「原样」提供，仅用于运行本插件；权利仍归原作者。
//   · 依次尝试 jsDelivr → unpkg → GitHub raw（tag → main），任一成功即用。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'vendor', 'dsh-whale-widget', 'assets')
const PKG = 'dsh-whale-widget'
const VER = '0.3.16'
const GH = 'MeteorNOX/DeepSeek-Balance-Whale-Widget'
const force = process.argv.includes('--force')

// 文件名 + 上游原始字节数（用于校验，避免半截/坏文件）
const FILES = [
  ['DSniang1.png', 255988],
  ['DSniang02.png', 466452],
  ['DSH2.png', 809921],
  ['rua.gif', 94643],
  ['bubble-petpet.gif', 94643],
  ['bubble-money1.gif', 2704365],
  ['Ya1.mp3', 6370],
  ['Ya2.mp3', 2976],
  ['D1.mp3', 3294],
  ['D2.mp3', 4232],
  ['minecraft-exp-orb.wav', 59488],
  ['task-end-a.wav', 319288],
]

const SOURCES = [
  (f) => `https://cdn.jsdelivr.net/npm/${PKG}@${VER}/assets/${f}`,
  (f) => `https://fastly.jsdelivr.net/npm/${PKG}@${VER}/assets/${f}`,
  (f) => `https://unpkg.com/${PKG}@${VER}/assets/${f}`,
  (f) => `https://cdn.jsdelivr.net/gh/${GH}@v${VER}/assets/${f}`,
  (f) => `https://raw.githubusercontent.com/${GH}/v${VER}/assets/${f}`,
  (f) => `https://raw.githubusercontent.com/${GH}/main/assets/${f}`,
]

// 超时要给足：最大的素材（bubble-money1.gif，2.7MB）在国内网络下实测要 ~36 秒
const TIMEOUT_MS = 90000

async function grab(name) {
  for (const make of SOURCES) {
    const url = make(encodeURIComponent(name).replace(/%2F/g, '/'))
    const t0 = Date.now()
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 64) continue
      return { buf, url, ms: Date.now() - t0 }
    } catch { /* 试下一个源 */ }
  }
  return null
}

fs.mkdirSync(DIR, { recursive: true })
console.log('目标目录: ' + DIR)
console.log('上游基线: ' + PKG + ' v' + VER + '（素材不在 MIT 范围内，仅用于运行本插件）\n')

let ok = 0, skip = 0, fail = 0
for (const [name, expect] of FILES) {
  const dest = path.join(DIR, name)
  if (!force && fs.existsSync(dest)) {
    const size = fs.statSync(dest).size
    console.log(`  · 已存在，跳过  ${name}  (${size} B)`)
    skip++
    continue
  }
  const got = await grab(name)
  if (!got) { console.log(`  ✗ 下载失败        ${name}（所有源都试过了）`); fail++; continue }
  fs.writeFileSync(dest, got.buf)
  const warn = expect && got.buf.length !== expect ? `  ⚠ 大小与上游不一致（期望 ${expect} B）` : ''
  console.log(`  ✓ ${name.padEnd(24)} ${String(got.buf.length).padStart(9)} B  ${(got.ms / 1000).toFixed(1)}s${warn}  ← ${new URL(got.url).host}`)
  ok++
}

console.log('\n完成：下载 ' + ok + ' / 跳过 ' + skip + ' / 失败 ' + fail)
console.log('提示：素材为上游「原样」提供，仅用于运行本插件；如权利人主张会立即移除（见 NOTICE.md）。')
if (fail) process.exitCode = 1

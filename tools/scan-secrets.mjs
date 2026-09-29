// 发布前自查：扫描真实凭据 / 本机路径 / 隐私痕迹
// 用法： node tools/scan-secrets.mjs [项目根目录]
// 输出分三级：A=必须处理  B=需确认  C=可忽略（上游 vendor 代码/文档里的字段名等）
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] || '.')
const SKIP_DIRS = new Set(['node_modules', '.git', '_private', '.cache'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.txt', '.log', '.err', '.yml', '.yaml', '.html', '.cmd', '.ps1', '.css'])

const PATTERNS = [
  { id: 'api-key', re: /sk-[A-Za-z0-9_-]{16,}/g, level: 'A', label: '疑似 API key' },
  { id: 'win-home', re: /C:\\+Users\\+\d+[^\s"'`,)]*/g, level: 'A', label: '本机用户目录路径' },
  { id: 'unix-home', re: /\/Users\/[A-Za-z0-9._-]+/g, level: 'A', label: 'macOS 用户目录路径' },
  // 盘符路径：前面不能是字母/数字/斜杠/点（否则会把 http:// 里的 p: 当成盘符）
  { id: 'drive-path', re: /(?<![A-Za-z0-9:.\/])([A-Za-z]):[\\/]{1,2}[^\s"'`,)]{2,}/g, level: 'A', label: '盘符绝对路径' },
  { id: 'user-name', re: /\b23950\b/g, level: 'A', label: '本机用户名' },
  { id: 'cn-project', re: /大肥鱼插件/g, level: 'A', label: '本机中文目录名' },
  { id: 'secret-word', re: /(password|passwd|secret|api[_-]?key|apikey|bearer\s+[A-Za-z0-9._-]{8,})/gi, level: 'B', label: '凭据相关字样' },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g, level: 'B', label: '邮箱' },
  { id: 'token-jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, level: 'A', label: '疑似 JWT' },
]

const SELF = 'tools/scan-secrets.mjs' // 扫描器自身含模式定义，跳过
// 文档/示例里的通用占位路径不算泄露
const PLACEHOLDER = /(path[\\/]to|your[_-]?path|example\.com|<\S*>|\/code\/|D:\/code)/i

const mask = (s) => (s.length <= 12 ? s.slice(0, 3) + '***' : s.slice(0, 6) + '…' + s.slice(-3) + '（' + s.length + '字符）')

const findings = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue }
    const ext = path.extname(e.name).toLowerCase()
    const isBak = /\.bak[^/\\]*$/i.test(e.name)
    if (!TEXT_EXT.has(ext) && !isBak) continue
    const rel = path.relative(ROOT, p).replace(/\\/g, '/')
    if (rel === SELF) continue
    let txt = ''
    try { txt = fs.readFileSync(p, 'utf8') } catch { continue }
    if (txt.includes('\u0000')) continue
    const inVendor = rel.startsWith('vendor/')
    txt.split(/\r?\n/).forEach((line, i) => {
      for (const pat of PATTERNS) {
        pat.re.lastIndex = 0
        const m = pat.re.exec(line)
        if (m) {
          const hitRaw = m[0]
          if (PLACEHOLDER.test(hitRaw) || PLACEHOLDER.test(line)) continue
          findings.push({ file: rel, line: i + 1, pat: pat.id, level: inVendor ? 'C' : pat.level, label: pat.label, hit: pat.id === 'secret-word' || pat.id === 'api-key' ? mask(hitRaw) : hitRaw.slice(0, 60) })
        }
      }
    })
  }
}
walk(ROOT)

const byLevel = { A: [], B: [], C: [] }
for (const f of findings) byLevel[f.level].push(f)

function report(level, title) {
  const list = byLevel[level]
  console.log('\n=== [' + level + '] ' + title + '：' + list.length + ' 处 ===')
  const byFile = new Map()
  for (const f of list) { if (!byFile.has(f.file)) byFile.set(f.file, []); byFile.get(f.file).push(f) }
  for (const [file, items] of byFile) {
    console.log('\n■ ' + file + '  (' + items.length + ' 处)')
    const shown = new Set()
    for (const it of items.slice(0, 5)) {
      const key = it.pat + it.hit
      if (shown.has(key)) continue
      shown.add(key)
      console.log('   L' + it.line + '  [' + it.label + ']  ' + it.hit)
    }
    if (items.length > shown.size) console.log('   … 其余同类 ' + (items.length - shown.size) + ' 处')
  }
}

console.log('扫描根目录: ' + ROOT + '   命中总数: ' + findings.length)
report('A', '必须处理（真实凭据 / 本机路径）')
report('B', '需确认（可能是隐私或需要解释）')
report('C', '可忽略（上游 vendor 代码与文档，仅提示）')
console.log('\n提示：vendor/ 下游文件属于上游 MIT 代码，出现 API_KEY / Bearer 等字样属正常，不应改动。')
process.exitCode = byLevel.A.length ? 1 : 0

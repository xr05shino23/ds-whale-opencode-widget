// 一键功能体检：接口 → 渲染 → 交互 → 拖拽 → 音效链路
// 用法： npx electron tools/health-check.mjs      （或 npm run health）
// 默认静音、默认隔离 profile：不打扰你，也不动你的真实设置。
import { app } from 'electron'
import { URL, sleep, muteEverything, useIsolatedProfile, openProbe, readWidget, findWhalePoint, clickAt, dragBy, installAudioProbe, readAudioProbe, setMockSeq, resetProbeState } from './probe.mjs'

muteEverything()
useIsolatedProfile('health-check')

const ENDPOINTS = [
  '/', '/dsh-whale/balance.json', '/dsh-whale/size.json', '/dsh-whale/usage-records.json',
  '/dsh-whale/usage-settings.json', '/dsh-whale/api-models.json', '/dsh-whale/wait.json',
  '/dsh-whale/last-turn.json', '/dsh-whale/bubble.json', '/dsh-whale/roles.json', '/dsh-whale/audio.json',
  '/dsh-whale/bubble-imgs.json', '/dsh-whale/widget.js', '/dsh-whale/image.png', '/dsh-whale/rua.gif',
  '/dsh-whale/sound/press.mp3', '/dsh-whale/sound/release.mp3', '/dsh-whale/audio-fragment.wav?id=end_a',
  '/dsh-whale/bubble-img.png?id=bimg_petpet',
]

const results = []
const ok = (name, detail = '') => { results.push({ pass: true, name, detail }); console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
const bad = (name, detail = '') => { results.push({ pass: false, name, detail }); console.log('  ✗ ' + name + '  ' + detail) }

async function checkEndpoints() {
  console.log('\n[1] 接口矩阵（' + ENDPOINTS.length + ' 条）')
  let n = 0, unreachable = 0
  for (const p of ENDPOINTS) {
    try {
      const r = await fetch(URL.replace(/\/$/, '') + p, { signal: AbortSignal.timeout(8000) })
      if (r.ok) n++
      else bad('HTTP ' + r.status + ' ' + p)
    } catch (e) { unreachable++; bad(p, e.message) }
  }
  if (n === ENDPOINTS.length) { ok('全部 ' + n + '/' + ENDPOINTS.length + ' 返回 200'); return true }
  if (unreachable === ENDPOINTS.length) {
    console.log('\n⚠ 全部 ' + ENDPOINTS.length + ' 条都连不上：**挂件服务没在运行**。')
    console.log('  先启动它再跑体检：  npm start        （桌面挂件）')
    console.log('                 或： npm run server   （只跑本地服务，浏览器可访问 ' + URL + '）')
    return false
  }
  return true
}

app.whenReady().then(async () => {
  console.log('=== 小鲸鱼挂件 · 功能体检 ===  ' + new Date().toLocaleString('zh-CN'))
  const reachable = await checkEndpoints()
  if (!reachable) {
    console.log('\n=== 中止：服务不可用（其余检查依赖它）===')
    process.exitCode = 1
    app.quit()
    return
  }

  const win = await openProbe()
  try {
    // 每次体检前把状态清干净：已读 seq 抬高（不弹"首次对齐"的泡）+ 位置回到默认贴角
    // （隔离 profile 会跨次运行保留上次拖拽的位置锚点，不清理会让挂件停在别处）
    await resetProbeState(win)

    // 渲染
    console.log('\n[2] 渲染')
    const s = await readWidget(win)
    if (!s.mounted) { bad('挂件未挂载'); }
    else {
      ok('已挂载  base=' + s.base + '  视口=' + s.viewport.join('x'))
      ;(s.snap.right <= 1 && s.snap.bottom <= 1) ? ok('贴角 离右=' + s.snap.right + ' 离下=' + s.snap.bottom) : bad('未贴角', JSON.stringify(s.snap))
      const role = s.imgs.find((i) => i.src.indexOf('image.png') !== -1)
      role && role.ok ? ok('角色形象图加载成功') : bad('角色形象图未加载', JSON.stringify(s.imgs))
      const ratio = s.fonts.amount && s.base ? (s.fonts.amount / s.base) : 0
      ratio > 0.11 && ratio < 0.14 ? ok('字号比例正常 amount/base=' + ratio.toFixed(4)) : bad('字号比例异常', 'amount=' + s.fonts.amount + ' base=' + s.base)
    }

    // 交互：点鲸鱼 → 开泡；点泡泡 → 推进；菜单
    console.log('\n[3] 交互（真实输入事件）')
    const w = await findWhalePoint(win)
    if (!w.ok) { bad('鲸鱼命中点定位失败', w.why) }
    else {
      await clickAt(win, w.point[0], w.point[1])
      let a = await readWidget(win)
      a.bubble.open ? ok('点鲸鱼 → 泡泡打开（手动序列第 1 屏）', JSON.stringify(a.bubble.rows.length ? a.bubble.rows.map((r) => r.t) : a.bubble.three)) : bad('点鲸鱼没有打开泡泡')

      if (a.bubble.open && a.bubble.rect) {
        const textOf = (s) => (s.bubble.rows.length ? s.bubble.rows.map((r) => r.t).join(' / ') : s.bubble.three.join(' / '))
        const t0 = textOf(a)
        const px = a.bubble.rect.l + Math.round(a.bubble.rect.w / 2)
        const py = a.bubble.rect.t + Math.round(a.bubble.rect.h * 0.55)
        await clickAt(win, px, py)
        const b = await readWidget(win)
        const t1 = textOf(b)
        if (b.bubble.open && t1 && t1 !== t0) ok('点泡泡 → 推进到下一屏', t1)
        else if (!b.bubble.open) bad('点泡泡后泡泡直接关闭（未推进）')
        else bad('点泡泡内容没变化', t1)
        const wrapped = b.bubble.rows.filter((r) => r.wrap).length
        ok('本屏折行行数 = ' + wrapped + '（capPx=' + b.capPx + 'px；内置长句折行属正常）')
      }

      // 菜单按钮
      const btn = await win.webContents.executeJavaScript(`(() => { var b=document.querySelector('.dshwv-menu-btn'); if(!b) return null; var r=b.getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) } })()`)
      if (!btn) bad('未找到菜单按钮')
      else {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: w.point[0], y: w.point[1] })
        await sleep(500)
        await clickAt(win, btn.x, btn.y)
        const c = await readWidget(win)
        const items = await win.webContents.executeJavaScript(`(() => { var m=document.querySelector('.dshwv-menu'); return m ? m.querySelectorAll('button, .dshwv-menu-row').length : 0 })()`)
        c.menu.open ? ok('☰ 菜单打开，可交互元素 ' + items + ' 个') : bad('菜单未打开')
        // 关掉菜单，避免影响后续
        await clickAt(win, btn.x, btn.y)
      }

      // 拖拽（CDP 真实指针）
      console.log('\n[4] 拖拽 + 位置保存')
      const before = await readWidget(win)
      await dragBy(win, w.point, -200, -60)
      const after = await readWidget(win)
      const dx = after.root.l - before.root.l, dy = after.root.t - before.root.t
      ;(Math.abs(dx + 200) <= 6 && Math.abs(dy + 60) <= 6)
        ? ok('拖拽位移正确 Δ=' + dx + '/' + dy)
        : bad('拖拽位移异常 Δ=' + dx + '/' + dy + '（期望 -200/-60）')
      after.pos && after.pos.v === 2 ? ok('位置锚点已保存 ' + JSON.stringify(after.pos)) : bad('位置锚点未保存', JSON.stringify(after.pos))
    }

    // 音效链路（静音下验证"是否起播"）
    console.log('\n[5] 音效链路（静音模式：只验证是否起播，不出声）')
    await resetProbeState(win, { keepPosition: true })
    const hooked = await installAudioProbe(win)
    ok('探针已装（hook=' + hooked + '，窗口静音=' + win.webContents.isAudioMuted() + '）')
    await sleep(1500)
    const pre = await readAudioProbe(win)
    await setMockSeq(win, 101)
    await sleep(3000)
    const post = await readAudioProbe(win)
    ;(post.starts > pre.starts)
      ? ok('模拟"一轮结束" → 音频起播 ' + pre.starts + ' → ' + post.starts + '，请求 ' + JSON.stringify(post.audioReq.slice(-2)))
      : bad('模拟轮结束没有起播音频', JSON.stringify(post))
    const b2 = await readWidget(win)
    b2.bubble.open ? ok('同时弹出金额泡泡', JSON.stringify(b2.bubble.rows.length ? b2.bubble.rows.map((r) => r.t) : b2.bubble.three)) : bad('未弹出金额泡泡')
  } catch (e) {
    bad('体检过程异常', e && e.message)
  }

  const fails = results.filter((r) => !r.pass)
  console.log('\n=== 汇总：' + (results.length - fails.length) + '/' + results.length + ' 通过 ===')
  if (fails.length) fails.forEach((f) => console.log('  ✗ ' + f.name + '  ' + f.detail))
  else console.log('  全部通过 🐋')
  process.exitCode = fails.length ? 1 : 0
  app.quit()
})
app.on('window-all-closed', () => app.quit())

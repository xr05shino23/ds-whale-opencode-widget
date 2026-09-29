// 诊断探针基座（tools/ 专用）
//
// 两条硬约定：
//   ① **默认静音**。诊断脚本绝不能出声打扰用户：窗口创建后立刻 webContents.setAudioMuted(true)；
//      静音只掐掉音频输出，Web Audio 图照跑 —— 所以"有没有起播"依然可以验证（BufferSource.start 计数）。
//      需要真听声音时显式传 { mute: false }。
//   ② **默认隔离 profile**。useIsolatedProfile() 把 userData 指到临时目录，
//      这样探针里的点击/拖拽/改设置都不会污染用户真实的位置、尺寸和已读 seq。
import { app, BrowserWindow, screen } from 'electron'
import os from 'node:os'
import path from 'node:path'

export const URL = process.env.WHALE_URL || 'http://127.0.0.1:38900/'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 在 app ready 之前调用：全局静音兜底（与 setAudioMuted 双保险）
export function muteEverything() {
  try { app.commandLine.appendSwitch('mute-audio') } catch { /* ignore */ }
}

export function useIsolatedProfile(name) {
  app.setPath('userData', path.join(os.tmpdir(), 'whale-probe', name))
}

// 打开一个探针窗口：屏幕内 + 几乎全透明（opacity 0.01）+ 静音
//
// ⚠️ 为什么必须放在**屏幕内**：窗口被放到屏幕外（负坐标）时，Chromium 上报的几何会整体偏移
// （实测 getBoundingClientRect 比 style.left 多出上百像素），于是「贴角测量」和「按坐标注入点击」
// 全部失准 —— 排查这个问题花了很久，别再改回屏幕外了。用 opacity 0.01 实现"看不见"即可。
export async function openProbe({ width = 1100, height = 760, mute = true, invisible = true, waitMs = 3000 } = {}) {
  const wa = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    show: true,
    x: wa.x,
    y: wa.y,
    width,
    height,
    frame: false,
    skipTaskbar: true,
    opacity: invisible ? 0.01 : 1,
    webPreferences: { backgroundThrottling: false },
  })
  win.setIgnoreMouseEvents(false)
  win.focus()
  if (mute) { try { win.webContents.setAudioMuted(true) } catch { /* ignore */ } }
  await win.loadURL(URL)
  await sleep(waitMs)
  return win
}

// ---------------------------------------------------------------------------
// 读取挂件当前状态
// ---------------------------------------------------------------------------
export function readWidget(win) {
  return win.webContents.executeJavaScript(`(() => {
    var root = document.querySelector('.dshwv-root')
    if (!root) return { mounted: false }
    var cs = getComputedStyle(root)
    var r = root.getBoundingClientRect()
    var img = document.querySelector('img.dshwv-img')
    var ir = img ? img.getBoundingClientRect() : null
    var pop = document.querySelector('.dshwv-pop')
    var pr = pop ? pop.getBoundingClientRect() : null
    var menu = document.querySelector('.dshwv-menu')
    var mr = menu ? menu.getBoundingClientRect() : null
    var base = parseFloat(cs.width)
    function fs(sel) { var e = document.querySelector(sel); return e ? Math.round(parseFloat(getComputedStyle(e).fontSize) * 100) / 100 : null }
    function rows() {
      return Array.prototype.slice.call(document.querySelectorAll('.dshwv-text .dshwv-trow')).map(function (e) {
        var c = getComputedStyle(e)
        return { t: (e.textContent || '').trim(), px: Math.round(parseFloat(c.fontSize) * 100) / 100, w: Math.round(e.scrollWidth), wrap: c.whiteSpace === 'normal' }
      })
    }
    function three() { return ['.dshwv-label', '.dshwv-amount', '.dshwv-hint'].map(function (s) { var e = document.querySelector(s); return e && getComputedStyle(e).display !== 'none' ? (e.textContent || '').trim() : '' }).filter(Boolean) }
    var imgs = Array.prototype.slice.call(document.querySelectorAll('img')).map(function (im) { return { cls: im.className || '', src: String(im.getAttribute('src') || '').slice(0, 40), ok: im.complete && im.naturalWidth > 0 } })
    return {
      mounted: true,
      viewport: [window.innerWidth, window.innerHeight],
      base: Math.round(base * 100) / 100,
      capPx: Math.round(560 * base / 1026),
      snap: { right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom) },
      root: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) },
      imgRect: ir ? { l: Math.round(ir.left), t: Math.round(ir.top), w: Math.round(ir.width), h: Math.round(ir.height) } : null,
      bubble: { open: !!(pop && pop.className.indexOf('dshwv-pop-open') !== -1), rows: rows(), three: three(), rect: pr ? { l: Math.round(pr.left), t: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) } : null },
      menu: { open: !!(mr && mr.width > 10 && mr.height > 10) },
      fonts: { label: fs('.dshwv-label'), amount: fs('.dshwv-amount') },
      imgs: imgs,
      pos: (function () { try { return JSON.parse(localStorage.getItem('dshw-pos') || 'null') } catch (e) { return null } })(),
      seqSeen: (function () { try { return localStorage.getItem('dshw-last-seq') } catch (e) { return null } })(),
    }
  })()`)
}

// 用角色图的 alpha 找"确定落在鲸鱼身上"的点（注意：必须按 img 自己的 rect 换算，不是 root）
export function findWhalePoint(win) {
  return win.webContents.executeJavaScript(`(async () => {
    var img = document.querySelector('img.dshwv-img') || document.querySelector('.dshwv-img')
    if (!img) return { ok: false, why: 'no-whale-img' }
    var r = img.getBoundingClientRect()
    if (!r.width) return { ok: false, why: 'zero-rect' }
    var probe = new Image()
    return await new Promise(function (resolve) {
      probe.onload = function () {
        try {
          var c = document.createElement('canvas'); c.width = probe.naturalWidth; c.height = probe.naturalHeight
          var ctx = c.getContext('2d'); ctx.drawImage(probe, 0, 0)
          var d = ctx.getImageData(0, 0, c.width, c.height).data
          var sx = 0, sy = 0, n = 0
          for (var y = 2; y < c.height - 2; y += 3) for (var x = 2; x < c.width - 2; x += 3) {
            var A = function (xx, yy) { return d[(yy * c.width + xx) * 4 + 3] }
            if (A(x, y) > 200 && A(x - 2, y) > 200 && A(x + 2, y) > 200 && A(x, y - 2) > 200 && A(x, y + 2) > 200) { sx += x; sy += y; n++ }
          }
          if (!n) return resolve({ ok: false, why: 'no-solid-pixel' })
          resolve({ ok: true, solid: n,
            point: [Math.round(r.left + (sx / n) / c.width * r.width), Math.round(r.top + (sy / n) / c.height * r.height)],
            imgRect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })
        } catch (e) { resolve({ ok: false, why: 'canvas:' + e.message }) }
      }
      probe.onerror = function () { resolve({ ok: false, why: 'img-load-fail' }) }
      probe.src = img.getAttribute('src')
    })
  })()`)
}

// ---------------------------------------------------------------------------
// 输入注入
// ---------------------------------------------------------------------------
export async function clickAt(win, x, y) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  await sleep(150)
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  await sleep(70)
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await sleep(650)
}

// 拖拽：sendInputEvent 不产生挂件要的 pointer capture 序列，用 CDP 注入真实指针事件
export async function dragBy(win, from, dx, dy) {
  const dbg = win.webContents.debugger
  let attached = false
  try { dbg.attach('1.3'); attached = true } catch { /* 已经附着 */ }
  const send = (type, x, y, extra = {}) => dbg.sendCommand('Input.dispatchMouseEvent', Object.assign({ type, x, y }, extra))
  await send('mouseMoved', from[0], from[1], { button: 'none', buttons: 0 })
  await sleep(150)
  await send('mousePressed', from[0], from[1], { button: 'left', buttons: 1, clickCount: 1 })
  const steps = 10
  for (let k = 1; k <= steps; k++) {
    await send('mouseMoved', Math.round(from[0] + dx * k / steps), Math.round(from[1] + dy * k / steps), { button: 'left', buttons: 1 })
    await sleep(70)
  }
  await send('mouseReleased', Math.round(from[0] + dx), Math.round(from[1] + dy), { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(1200)
  if (attached) { try { dbg.detach() } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// 音频链路观测：装了 hook 之后，playCount 只增不减即代表"有起播"
// ---------------------------------------------------------------------------
export function installAudioProbe(win) {
  return win.webContents.executeJavaScript(`(() => {
    if (window.__probe) return 'already'
    window.__probe = { starts: [], audioReq: [], seq: 100 }
    try {
      var p = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype
      if (p && p.start) { var os = p.start; p.start = function () { try { window.__probe.starts.push(Date.now()) } catch (e) {}; return os.apply(this, arguments) } }
    } catch (e) {}
    var of = window.fetch
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || ''
      if (url.indexOf('audio') !== -1 || url.indexOf('sound/') !== -1) { try { window.__probe.audioReq.push(url.replace(location.origin, '')) } catch (e) {} }
      if (url.indexOf('/dsh-whale/last-turn.json') !== -1) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, seq: window.__probe.seq, turn: window.__probe.seq, amount: 0.42, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0 } }, calls: 3, ts: Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return of.apply(this, arguments)
    }
    return 'ok'
  })()`)
}

export function readAudioProbe(win) {
  return win.webContents.executeJavaScript('window.__probe ? { starts: window.__probe.starts.length, audioReq: window.__probe.audioReq } : null')
}

export function setMockSeq(win, seq) {
  return win.webContents.executeJavaScript(`window.__probe.seq = ${Number(seq)}; 'ok'`)
}

// 让"首次对齐"不弹泡 + 把位置恢复成默认贴角：交互测试前必须调用
// （隔离 profile 会跨次运行保留位置锚点，不清理的话挂件可能停在上一轮拖拽后的位置）
export async function resetProbeState(win, { keepPosition = false } = {}) {
  await win.webContents.executeJavaScript(`(() => {
    try {
      localStorage.setItem('dshw-last-seq', '99999')
      ${keepPosition ? '' : "localStorage.removeItem('dshw-pos'); localStorage.removeItem('dshw-snap')"}
    } catch (e) {}
    return 'ok'
  })()`)
  win.webContents.reload()
  await sleep(3000)
}

// 兼容旧名：仅用于"抑制首次对齐弹泡"
export async function suppressAlignmentPop(win, value = 99999) {
  return resetProbeState(win, { keepPosition: true })
}

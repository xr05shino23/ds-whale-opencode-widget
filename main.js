// Electron 主进程：透明无边框窗口 + 内嵌 whale 后端
import { app, BrowserWindow, screen, Tray, Menu, ipcMain, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, DATA } from './src/shim.mjs'
import { startBridge } from './src/bridge.mjs'
import { TRAY_ICON_DATA_URL } from './src/placeholder.mjs'

// 单实例锁：OpenCode 插件可能多次触发启动，重复实例直接退出
const gotLock = app.requestSingleInstanceLock()
console.log('[main] boot: singleInstanceLock =', gotLock)
if (!gotLock) {
  app.quit()
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.WHALE_PORT || 38900)

let win = null
let server = null
let tray = null
let boundsTimer = null

let serverRetry = null

async function ensureServer() {
  try {
    server = await startServer(PORT)
    console.log('[main] embedded server on', PORT)
    if (serverRetry) { clearInterval(serverRetry); serverRetry = null }
    return true
  } catch (err) {
    // 端口已被占用（例如你手动跑着 npm run server，或另一个实例在跑）→ 先复用它
    console.log('[main] server not started (will reuse existing):', err && err.code, err && err.message)
    return false
  }
}

// 端口被别人占着时我们会跳过启动（想着"复用现成的"），但那个进程如果后来退出了，
// 我们就会变成"有窗口、没服务"的空壳：界面能点，可保存/读取全部 Failed to fetch。
// 所以这里定期重试，一旦端口空出来就自己接管。
function retryServerUntilOwned() {
  if (serverRetry) return
  serverRetry = setInterval(async () => {
    if (server) return
    if (await ensureServer()) {
      console.log('[main] 端口空出来了，已接管本地服务')
      startBridge()
    }
  }, 15000)
  if (serverRetry.unref) serverRetry.unref()
}

function createWindow() {
  // 全屏透明窗口：鲸鱼可拖到任意位置，泡泡有整屏空间
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea

  win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    fullscreenable: false,
    webPreferences: {
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  // 默认整窗鼠标穿透；指针移到鲸鱼/泡泡上时由渲染进程通知临时关闭穿透
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.show())
  win.loadURL(`http://127.0.0.1:${PORT}/`)
  win.on('closed', () => { win = null })
}

ipcMain.on('whale:set-ignore', (_e, ignore) => {
  if (!win) return
  try { win.setIgnoreMouseEvents(!!ignore, { forward: true }) } catch { /* ignore */ }
})

// —— 跟随显示器 / 分辨率变化 ——
// 窗口是按「启动那一刻」的 workArea 建的；运行中改分辨率、改系统缩放、插拔外接屏、
// 主屏切换或任务栏高度变化后，必须重算，否则窗口尺寸/位置会停在旧值，挂件不再贴住真实屏幕角落。
// 挂件前端自己在 resize 时会按锚点重排（贴边状态保持贴边、自由摆放保持离边距离），
// 所以这里只需要把窗口对齐到目标显示器的工作区即可。
function targetWorkArea() {
  if (!win || win.isDestroyed()) return screen.getPrimaryDisplay().workArea
  const d = screen.getDisplayMatching(win.getBounds()) || screen.getPrimaryDisplay()
  return d.workArea
}

function syncWindowBounds() {
  if (!win || win.isDestroyed()) return
  const t = targetWorkArea()
  const c = win.getBounds()
  if (c.x === t.x && c.y === t.y && c.width === t.width && c.height === t.height) return
  try {
    // 非 resizable 窗口在部分平台上会拒绝程序化改尺寸，临时放开再收回
    if ((c.width !== t.width || c.height !== t.height) && !win.isResizable()) {
      win.setResizable(true)
      win.setBounds(t)
      win.setResizable(false)
    } else {
      win.setBounds(t)
    }
    console.log('[main] display changed -> bounds', t.x, t.y, t.width, t.height)
  } catch (err) {
    console.log('[main] bounds sync failed:', err && err.message)
  }
}

function watchDisplays() {
  // 分辨率/缩放切换时事件会连发几次，去抖一下再同步
  const schedule = () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => { boundsTimer = null; syncWindowBounds() }, 250)
  }
  screen.on('display-metrics-changed', schedule)
  screen.on('display-added', schedule)
  screen.on('display-removed', schedule)
}

ipcMain.on('whale:quit', () => app.quit())

function createTray() {
  try {
    // 用鲸鱼图当托盘图标（原插件素材）；发布版不含素材时退回内嵌占位图标
    const ico = path.join(__dirname, 'vendor', 'dsh-whale-widget', 'assets', 'DSniang1.png')
    let image = fs.existsSync(ico) ? nativeImage.createFromPath(ico) : nativeImage.createEmpty()
    if (image.isEmpty()) {
      image = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
      console.log('[main] assets missing -> tray uses built-in placeholder icon')
    }
    tray = new Tray(image)
    const menu = Menu.buildFromTemplate([
      { label: '显示 / 隐藏挂件', click: () => { if (!win) createWindow(); else win.isVisible() ? win.hide() : win.show() } },
      { label: '打开数据目录', click: () => { import('electron').then(({ shell }) => shell.openPath(DATA)) } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
    tray.setToolTip('DeepSeek 小鲸鱼挂件')
    tray.setContextMenu(menu)
  } catch (err) {
    console.log('[main] tray skipped:', err && err.message)
  }
}

app.whenReady().then(async () => {
  console.log('[main] whenReady')
  if (!(await ensureServer())) retryServerUntilOwned()
  if (server) startBridge()
  createWindow()
  createTray()
  watchDisplays()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try { if (server) server.close() } catch { /* ignore */ }
})

// 鼠标穿透桥：渲染进程检测到指针悬在挂件上时，通知主进程临时接收鼠标事件
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__whaleHost', {
  setIgnore: (ignore) => ipcRenderer.send('whale:set-ignore', !!ignore),
  quit: () => ipcRenderer.send('whale:quit'),
})

import { startServer, listRoutes, DATA } from './shim.mjs'
import { startBridge } from './bridge.mjs'

const port = Number(process.env.WHALE_PORT || 38900)

const server = await startServer(port)
startBridge()
console.log('==================================================================')
console.log(' whale-desktop server running:  http://127.0.0.1:' + port)
console.log(' data dir: ' + DATA)
console.log('------------------------------------------------------------------')
console.log(' routes registered by the original plugin (' + listRoutes().length + '):')
for (const r of listRoutes()) console.log('   ' + r)
console.log('==================================================================')

process.on('SIGINT', () => { server.close(() => process.exit(0)) })

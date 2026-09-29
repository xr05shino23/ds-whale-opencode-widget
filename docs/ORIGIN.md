# 项目由来与改造说明（ORIGIN）

> 本文说明：本仓库从**哪个上游版本**改造而来、**改了哪些代码**、**为什么这么改**，
> 以及上游能力在本版的可用性。署名与许可细节另见 [`../NOTICE.md`](../NOTICE.md)。

---

## 一、上游是什么

| 项 | 内容 |
|---|---|
| 名称 | **DSH 小鲸鱼记账挂件**（DeepSeek Balance Whale Widget） |
| 作者 | [MeteorNOX](https://github.com/MeteorNOX) |
| 仓库 | https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget |
| **本仓库基线** | **v0.3.16**（npm 包 `dsh-whale-widget@0.3.16`） |
| 许可 | **MIT**（代码）；`assets/` 美术素材**不在 MIT 内**（见上游 `PROVENANCE.md`） |
| 原版形态 | **DSH（DeepSeek Harness）网页界面**右下角的常驻挂件，通过 `dsh plugin --profile web add dsh-whale-widget` 安装 |

**原版是怎么工作的**（理解这点才知道本版改了什么）：

- 它是一个标准 DSH bundle 插件：`cordis.patch.yml` 声明挂载，`lib/index.js` 注册 **23 个 `/dsh-whale/*` 路由**（余额、账本、泡泡、角色、音效、图库、素材…）
- 前端 `assets/whale-widget.js`（约 17k 行）由 DSH 用 `tapIndex` 注入到网页里，负责画泡泡、点击序列、菜单、记账面板
- **余额**有两条路：① 用 `DEEPSEEK_API_KEY` 查官方余额接口；② 用 DSH 账号登录态查
- **每轮消耗**由 DSH 的会话事件（`turn/end`）驱动，金额按模型真实 usage 换算
- 密钥不落配置：写进 **DSH 官方凭据服务**，配置里只存凭据名
- 少部分能力依赖 DSH 专有服务：`deepseekAccount`（账号余额）、`connection`、`sessionTitle`（对话名）

---

## 二、为什么做这版

原版只活在 DSH 的网页里。本版要解决的：

1. **想让它常驻桌面**（不开 DSH 也能看见那只鱼），于是用 Electron 做了独立窗口
2. **数据源换成 OpenCode**：日常在 OpenCode 里干活，希望「每轮花了多少」来自 OpenCode 的真实消耗
3. **不想重写插件**：上游的账目、泡泡、音效、图库能力很完整，**复用原版代码**、只做壳与适配，是成本最低也最不容易走样的做法

---

## 三、本版结构（哪些是新增的、哪些是上游的）

```
main.js / preload.cjs        ← 新增：Electron 主进程（透明窗口、穿透、托盘、显示器跟随）与穿透桥
src/shim.mjs                 ← 新增：宿主兼容层（把 DSH 的 ctx 能力用普通 Node 实现）
src/bridge.mjs               ← 新增：OpenCode 用量桥（轮结束 → 金额）
src/server.mjs               ← 新增：不开 Electron 的纯服务模式
src/placeholder.mjs          ← 新增：素材缺失时的内置占位形象 / 托盘图标
opencode-plugin/             ← 新增：OpenCode 插件（启动时自动拉起挂件）
scripts/setup-opencode.mjs   ← 新增：把插件登记进 OpenCode（安装时自动跑，三层兜底）
tools/doctor.mjs             ← 新增：环境自检（目录权限/沙箱、二进制、端口、插件登记）
tools/                       ← 新增：自检工具（功能体检 / 探针基座 / 密钥与隐私扫描）
scripts/fetch-assets.mjs     ← 新增：从上游官方源取回美术素材
vendor/dsh-whale-widget/     ← 上游 v0.3.16（只改了 1 个文件，见第五节）
data/                        ← 运行时数据（凭据、账本、你的配置；不入库）
```

### 宿主兼容层（`src/shim.mjs`）实现了什么

| 上游依赖的 DSH 能力 | 本版实现 |
|---|---|
| `ctx.webServer.register(route)` / `tapIndex(fn)` | 本地 HTTP 服务（只监听 `127.0.0.1:38900`），23 个路由原样转发；页面由我们提供并注入前端脚本 |
| `ctx.credentials.resolve/set/remove` | 读写本机 `data/credentials.json`（**明文 JSON，仅本机**） |
| `ctx.on(event)` / `ctx.effect(fn)` | 实现了事件总线与副作用清理的基本语义 |
| `ctx.get('sessionTitle')` | 返回空串 → 挂件回落显示「当前对话」 |
| `ctx.get('deepseekAccount')` / `ctx.get('connection')` | 返回 `null` → 上游代码本身会跳过这两条路（降级） |

### OpenCode 插件是怎么被加载的（v0.1.1 起安装即自动登记）

OpenCode **不会**自动加载"仓库里的"插件目录，必须把它接进配置。官方支持两条路：

| 路线 | 位置 | 特点 |
|---|---|---|
| `plugins` 数组 | `opencode.json(c)` 里列路径 | 要改用户的配置文件（JSONC 带注释，改写容易弄坏格式） |
| **自动发现目录** | `~/.config/opencode/plugins/<插件包目录>/` | **零配置**被加载；只要里层是"带 `package.json` 的插件包目录"即可 |

本版选**自动发现目录**为主：安装时（`postinstall`）把 `opencode-plugin/whale-autostart` **链接**过去（Windows 用 junction，免管理员；mac/Linux 用 symlink）—— 好处是**改代码立即生效**，不需要复制、也不会和仓库不同步。链接不可用时退化为复制；复制也不行才退化为"最小文本插入 `plugins` 数组"（改前自动备份，保留注释与格式）。

实测证据（本机 OpenCode 日志，建链接后**无需重启**即被加载）：

```text
msg="loading plugin"
    id="C:\Users\<你>\.config\opencode\plugins\whale-autostart"
    entrypoint=file:///E:/<仓库>/opencode-plugin/whale-autostart/index.js
```

> 坑：链接存的是**绝对路径**，**仓库搬家后链接会失效**（`doctor` 会报、`npm run setup:opencode` 会自愈）。
> 坑：如果用户之前按旧文档手改过 `plugins` 数组，就会"链接 + 数组"双份登记 → 重复加载（挂件有单实例锁不会双开，但多一次无用启动）→ `--migrate` 清理。

### 用量桥（`src/bridge.mjs`）的几个设计取舍

| 问题 | 做法 |
|---|---|
| 「一轮」怎么判定？ | OpenCode 在**一轮结束时**会写一条 `idle` 消息（带 `outcome`）。桥检测到**新的 idle** 才发布一次 `seq`，前端据此响一声 + 弹一次金额 |
| 金额怎么算？ | 取这一轮里所有 `assistant` 消息的 `cost` 合计（消息级、精确），换算 `× WHALE_USD_CNY`（默认 7.1） |
| 会不会记到别人头上？ | 只认**主会话**：`agent` 必须是字符串（子代理会话的 `agent` 是 `undefined`）；候选按 **running 优先 → `viewed` 最新**排序；上次选中的会话若还在 running 档就继续用（避免来回跳）。⚠️ 判「这是不是用户会话」**不能依赖消息页**——消息接口是分页的（见下方踩坑表第一条） |
| 会不会频繁拉数据？ | 用 `session.time.idle` 做门控 —— **一轮最多拉一次消息列表**；会话无动静时完全不拉 |
| 怎么找 OpenCode 服务地址？ | ① 环境变量 `WHALE_OPENCODE_URL` → ② 上次成功的地址缓存（只发一次 HTTP 探活）→ ③ **直接执行 `opencode.exe`（不经 shell）** 问它并缓存。稳态**零子进程** |
| 为什么不起 shell？ | 上游老做法是 `execFile('opencode', …, {shell:true})`，而 Windows 上 `opencode` 是 npm 的 `.cmd/.ps1` shim，必须经 shell —— 那是最容易被杀软行为引擎盯上的动作。本版改为直接跑真实 `.exe` |

### 桌面化的一些细节

- **整窗鼠标穿透**：窗口默认 `setIgnoreMouseEvents(true, {forward:true})`；渲染进程在 `mousemove` 里用 `elementFromPoint` 判断指针是否落在挂件元素上，落到就临时关闭穿透 —— 于是「点桌面图标」和「点鲸鱼」互不干扰
- **跟随显示器**：监听 `display-metrics-changed / display-added / display-removed`，250ms 去抖后把窗口重新对齐到目标显示器的工作区；挂件前端自己会在 `resize` 时按锚点重排（贴边保持贴边、自由摆放保持离边距离）
- **单实例**：`requestSingleInstanceLock()`，防止 OpenCode 插件重复拉起
- **素材缺失兜底**：上游 `assets/` 素材不随仓库分发，缺失时由 `src/placeholder.mjs` 提供内置占位形象（SVG）与托盘图标（内嵌 PNG），不会出现「空白挂件」

---

## 四、上游能力在本版的可用性

| 能力 | 状态 | 说明 |
|---|---|---|
| 余额（`DEEPSEEK_API_KEY`） | ✅ 可用 | 走官方余额接口 |
| 今日已用 / 账本 | ✅ 可用 | 余额观测式记账（`balance-observed`） |
| 峰谷定价 / 倒计时 | ✅ 可用 | 纯计算 |
| 每轮对话消耗 | ✅ 可用（**数据源不同**） | 从 DSH 会话事件 → OpenCode 会话；金额为估算值 × 汇率 |
| 多厂商余额 / 订阅额度 / 自定义 HTTP | ✅ 可用 | 实测：自定义模型 + 自建网关能查到余额（20 − 3.5 = 16.5 USD）；自定义地址需在本机勾选「允许把凭据发送到自定义地址」 |
| 泡泡自定义 / 角色 / 音效 / 图库 | ✅ 可用 | 上游能力，全在本地 |
| 余额预警 / 今日预算 | ✅ 可用 | 依赖余额轮询 |
| **DSH 账号登录态查余额** | ❌ 不可用 | 没有 DSH 账号服务 |
| **提问 / 授权提示音与提示泡泡** | ❌ 不可用 | 没有 DSH 会话事件（`wait.json` 恒为 `pending: null`） |
| **`{session}` 对话名** | ⚠️ 降级 | 回落显示「当前对话」 |

> **验证口径**：以上均在 **OpenCode TUI（CLI）** 上实测（本机 OpenCode v2.0.18）。
> **Web UI / 桌面 App 不需要额外适配** —— 按[官方文档](https://opencode.ai/v2/docs/cli/web/)，它们与 TUI **由同一个服务提供**（默认 `127.0.0.1:49374`，仅本机），而 `src/bridge.mjs` 读的就是那个服务的 API，与客户端类型无关。
> 若使用**独立服务器**（`opencode serve`）或自定义端口，用 `WHALE_OPENCODE_URL` 指定地址即可（当前发现顺序：环境变量 → 地址缓存 → 直接执行 `opencode.exe` 询问）。

---

## 五、与上游的代码差异（逐条）

**唯一被修改的上游文件：`vendor/dsh-whale-widget/assets/whale-widget.js`**

| # | 改动 | 原因 |
|---|---|---|
| 1 | 默认字号 `size: 22` → `size: 15`，共 **13 处**（4 个默认定义段） | 默认字号下「好模型…↓ / 好女孩…↓ / 哦鲸鲸…」在气泡里会折行 |
| 2 | 随机语句池**新增 10 句** | 按社区梗补了一批台词（权重 `w:3`、加粗） |

其余 7 个上游文件（`lib/index.js`、`lib/accounting.mjs`、`package.json`、`cordis.patch.yml`、`LICENSE`、`PROVENANCE.md`、`README.md`）**逐字节未改**；差异可用以下方式复核：

```bash
npm pack dsh-whale-widget@0.3.16
tar -xzf dsh-whale-widget-0.3.16.tgz
git diff --no-index --ignore-cr-at-eol package/assets/whale-widget.js vendor/dsh-whale-widget/assets/whale-widget.js
```

---

## 六、开发过程中踩到并记下来的坑

这些坑都写进了对应位置的注释或文档，免得后人重踩：

| 坑 | 结论 |
|---|---|
| **消息接口是分页的（只返回最近 50 条）→ 长对话下"每轮消耗"会静默失效** | `/api/session/<id>/message` 实测只返回最近 50 条（响应里带 `cursor.previous/next`）。一轮工具调用多的对话就能产出 50+ 条消息，于是窗口里**看不到 user 消息**、而且常常**只剩 1 条 idle**。旧实现据此把用户正在用的会话判成"不是用户会话"，还把这个错误结论**缓存 10 分钟** → 桥**跳到另一个旧会话**上，那个会话永远不结束轮次 → 表现为「挂件有一段时间不弹消耗提示了」（实测复现：跨会话跳变，日志里能看到 `tracking session` 换了 id）。修法两条：① 页面被截断时**不下"非用户会话"的结论、也不缓存否定**；② 推不出"上一条 idle"时，用**上次观测到的 idle 时刻**当本轮起点，否则金额会把好几轮加在一起（虚高）。顺带把判定逻辑抽成纯函数 `analyzeTurn`，配 `npm run test:bridge`（17 项单测，用合成数据把这个 bug 钉死） |
| OpenCode V2 的 `plugins` 条目**必须是目录** | 指向单个 `.js` 会被静默跳过（日志只有一行 warning）。本版插件用「目录 + package.json」形式 |
| **单实例锁** | 第二个副本会**静默退出**（`singleInstanceLock = false`），容易被误判成"启动失败"。同时跑两份要用 `--user-data-dir` 隔离 |
| Electron 二进制**国内下不动** | `npm install` 可能"成功"但 `node_modules/electron/dist` 不存在 → 用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 重装 |
| **探针窗口放到屏幕外** | Chromium 上报的几何会整体偏移（`getBoundingClientRect` 比 `style.left` 多出上百像素），导致测量与点击注入全部失准 —— 诊断工具必须把窗口放在屏幕内 |
| 插件的**模块级"只启动一次"标志** | 会让"挂件被关掉后重新加载插件"再也拉不起来（ESM 模块缓存）→ 去掉标志，靠 Electron 单实例锁去重 |
| **素材脚本超时太短** | 最大的素材（2.7MB）从 jsDelivr 下载要 ~36–57 秒 → 超时提到 90 秒并增加备用 CDN |
| 诊断脚本**不能出声** | 之前用真实窗口做音效验证时没有静音，导致用户听到"无缘无故的结束音" → `tools/probe.mjs` 现在默认 `setAudioMuted(true)` |
| **沙箱目录的 ACL 会让 Electron"秒崩"** | 目录被 `icacls` 显式 `DENY` 掉 `Synchronize`（或带"低完整性级别"标记）时，Electron 启动要 `MapViewOfFile` 内存映射 `snapshot_blob.bin` 会失败 → V8 直接 `EXCEPTION_BREAKPOINT`（退出码 `0x80000003`），连 `main.js` 第一行都执行不到。**三重排除证据**：换 Electron 33 一样崩、两个二进制 SHA256 一致、空 `main.js` 也崩 → 与版本/代码/二进制无关，就是目录权限。→ `npm run doctor` 会对比"全新普通目录"的 ACL 把它抓出来 |
| **OpenCode 不会加载"仓库里的"插件目录** | 以前只能让用户手工改 `opencode.json`（新用户容易漏、导致不自动拉起）。V2 支持 `~/.config/opencode/plugins/` **自动发现目录** → 改成安装时自动建链接（`scripts/setup-opencode.mjs`），零配置 |
| **自动登记脚本的三个 bug（自测才发现的）** | ① 配置文件不存在时却去备份它 → `ENOENT`；② 第③层没先创建配置目录 → `ENOENT`；③ 最小文本插入时把"上一行内容"当成缩进 → **把数组里已有的插件条目拼坏**。→ 从此 setup 脚本配了正式自测（`npm run test:setup`，34 项，覆盖三层兜底 + 撤销 + 幂等 + "副本升级成链接" + BOM 处理 + "不碰用户自己的同名目录"）——**不测不敢说"能兜底"** |

---

## 七、数据与隐私

- 读：`~/.config/opencode/service.json`（取 `password` 用于访问 OpenCode 本地 API，只读）、OpenCode 本地 API、`vendor/…/assets/`、`data/`
- 写：`data/`（凭据、账本、你的配置、位置与尺寸）
- 网络：只访问你配置的厂商 API（查余额）与 `127.0.0.1` 本地端口；**不向任何第三方上报数据**
- **分享/发布本目录前先删掉 `data/`**（`.gitignore` 已默认忽略）

---

## 八、非官方声明与致谢

- 本项目是**第三方改造版**，**不是**上游项目的一部分，与上游作者、DeepSeek 官方**均无隶属关系**，未获官方背书；"DeepSeek" 是其权利人的商标，此处仅用于指代兼容对象。
- 上游代码 MIT、素材不在 MIT 内；本仓库不分发素材，改用 `scripts/fetch-assets.mjs` 从上游官方源取回（收到权利主张会立即移除，见 `NOTICE.md`）。
- 感谢 [MeteorNOX](https://github.com/MeteorNOX) 与其社区贡献者做出的优秀插件。
- 本改造版的**实现与文档由 AI 助手协作完成**：开发过程在 [OpenCode](https://opencode.ai) 中进行，使用 DeepSeek 系列模型；所有改动均经人工确认与实测（`npm run health` 14/14）。

# ds-whale-opencode-widget

> **非官方**的「小鲸鱼余额挂件」**桌面版（Electron）** + **OpenCode 适配**。
> Unofficial desktop (Electron) + OpenCode port of the [DSH Whale Balance Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget).

> ## ⚠️ 装了卡巴斯基（或同类主防）请先看这条
>
> 本插件会在 **`opencode.exe`** 里**自动拉起一个未签名的 `electron.exe`**。这个行为链**可能被卡巴斯基的行为检测（PDM）误判为木马** `PDM:Trojan.Win32.Generic` —— 本机实测过一次，后果是：项目文件被隔离、`opencode.exe` 被删，**严重时 Windows 登录会报「User Profile Service 服务登录失败，无法加载用户配置文件」** ✗
>
> **请务必先配好排除项，再让 OpenCode 启动挂件**（完整清单见「[已知问题：安全软件误报](#-已知问题安全软件误报请先读这条)」）：
> - 排除文件夹：本仓库目录 · `%APPDATA%\npm\node_modules\@opencode\` · `%USERPROFILE%\.cache\opencode\`
> - 受信任的应用程序：`opencode.exe` · `opencode-service-*.exe` · `<仓库>\node_modules\electron\dist\electron.exe`
> - 受信任程序条目里**务必勾选「不监控应用程序活动」** —— 这是挡住 PDM 的关键，不勾等于没加
>
> **不想承担这个风险？** 设环境变量 **`WHALE_NO_AUTOSTART=1`** → 插件**完全不自动拉起**，挂件改由你自己启动（`npm start`）。这样行为链里就没有"跨进程拉起未签名大二进制"这一步，被 PDM 盯上的概率大幅下降 ✓
>
> 跑 `npm run doctor` 可以检查：它**能检测到卡巴斯基**并把上面这份清单再打印一遍 ✓

<p align="center">
  <img src="docs/images/whale-bubble.png" alt="小鲸鱼挂件运行截图" width="300">
</p>

<p align="center"><i>桌面右下角的小鲸鱼：点它换一屏（余额 / 今日已用 / 峰谷倒计时 / 随机台词 / 图片），右键或悬停右上角打开设置菜单</i></p>

## 🐋 这是什么（项目由来）

**大肥鱼桌宠** —— 社区里那只「蓝色大肥鱼」（DeepSeek 的小鲸鱼形象）被搬到了你的桌面上。

它由 **DSH 网页插件《DSH 小鲸鱼记账挂件 / DeepSeek Balance Whale Widget》v0.3.16** 改造而来：

| 项 | 上游原版 | 本版（ds-whale-opencode-widget） |
|---|---|---|
| 形态 | 挂在 **DeepSeek Harness（DSH）网页界面**右下角的插件 | **独立桌面应用**（Electron 窗口，直接贴在桌面上） |
| 宿主 | DSH（`dsh plugin --profile web add dsh-whale-widget`） | 普通 Node / Electron + **OpenCode** |
| 数据源 | DSH 会话事件 + 凭据服务 + 账号服务 | **OpenCode 本地 API** + 本机凭据文件 |
| 启动方式 | 打开 DSH 网页自动出现 | 手动 `npm start`，或由 **OpenCode 插件自动拉起** |

**这一版主要做了两件事：**

**① 把它放到桌面上。** 用 Electron 全屏透明窗口承载挂件：

- 鼠标**整窗穿透** —— 只有指针移到鲸鱼/泡泡上才接收点击，点桌面图标、拖窗口都不受影响
- **托盘菜单**（显示/隐藏 · 打开数据目录 · 退出）、**始终置顶**、**单实例**
- **跟随分辨率/缩放变化** —— 改分辨率、改系统缩放、插拔外接屏后自动重新贴合屏幕角落
- 气泡与文字全部随挂件尺寸等比缩放，任何分辨率下比例都不会失衡

**② 适配 OpenCode。** 原版依赖 DSH 的宿主能力（会话事件、账号服务、凭据服务）；本版写了一层**宿主兼容层**让上游插件原样跑在普通 Node 里，并新增**用量桥**：

- 直接读 OpenCode 本地 API，在**一轮对话真正结束时**（OpenCode 会写 `idle` 标记）把这一整轮的消耗合计成金额喂给挂件
- 效果：**任务结束响一声 + 弹一次「刚才这轮花了多少」**，干活过程中不打扰
- 附带一个 OpenCode 插件，让你**启动 OpenCode 时自动拉起**这只鱼（支持热重载）；**安装时自动登记好**，不用手工改配置

**账目能力全部保留**：余额、今日已用（余额观测记账）、峰谷定价与倒计时、用量记录，以及「小鲸鱼记账」里的 34 个厂商余额模板与自定义 HTTP 接口。少数依赖 DSH 官方的能力在 OpenCode 环境下不可用 —— 见下方「[已知限制](#-已知限制)」。

> 更详细的由来、改造清单与技术取舍 → **[`docs/ORIGIN.md`](docs/ORIGIN.md)**
> 上游署名与逐条改动 → **[`NOTICE.md`](NOTICE.md)**
> 每个版本修了什么 bug、做了什么调整（现象 / 根因 / 修法 / 验证）→ **[`CHANGELOG.md`](CHANGELOG.md)**

## 🎯 它怎么用，哪些功能依赖 OpenCode

**它可以当独立的桌面挂件用。** 打开就完事，不需要 OpenCode 在旁边跑 —— 你在用别的 agent（Claude Code、Codex、Cursor……随便什么）的时候，它照样能把**余额、今日已用、峰谷倒计时**显示在桌面右下角。

**「适配 OpenCode」指的是与 agent 联动的那部分**，只有 OpenCode 环境才有：

| 功能 | 需要 OpenCode 吗 |
|---|---|
| 余额查询 · 今日已用 · 峰谷定价与倒计时 · 账本 | ❌ 不需要。不装 OpenCode 也能用，换哪个 agent 都不影响 |
| **「每轮对话消耗」提示**（响一声 + 弹金额） | ✅ 需要。数据来自 OpenCode 的会话记录 |
| **随 OpenCode 服务启动自动拉起** | ✅ 需要。靠仓库自带的 OpenCode 插件 |

> **如果你是 DSH 用户、又没有桌面挂件的需求**，直接用上游原版更合适：[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。
> 它在 DSH 网页里的能力比本版完整 —— 账号登录态查余额、提问/授权提示音、`{session}` 对话名这些都在，而本版为了搬到桌面**放弃了这部分**（详见「[已知限制](#-已知限制)」）。

## ✨ 主要特性

把原本挂在 DSH 网页右下角的小鲸鱼，做成了一个**桌面常驻挂件**：

-  **桌面化**：透明无边框窗口、整窗鼠标穿透（悬到鲸鱼上才接收点击）、托盘菜单、始终置顶、单实例、跟随分辨率/缩放变化
-  **余额 / 今日已用 / 峰谷定价**：沿用上游的全部账目能力（按 API key 查余额、余额观测记账、峰谷倒计时）
-  **多厂商余额 / 订阅额度**：内置 **34 个模板** —— OpenAI 兼容中转站（OneAPI / New API）、硅基流动、OpenRouter、火山方舟、Kimi、智谱、MiniMax，以及订阅额度类（智谱 / Kimi / MiniMax Coding Plan、**OpenCode Go 订阅额度**）；也支持「自定义 HTTP」自己填地址与 JSON 字段路径。**自定义地址需在本机面板勾选「允许把凭据发送到自定义地址」**（上游的安全策略，防止密钥被发到未知地址）
-  **每轮对话消耗**：用 **OpenCode** 的会话数据驱动 —— 一轮真正结束时响一次任务结束音 + 弹一次「本轮花了多少」
-  泡泡内容、随机台词、图片、音效**全部可在挂件菜单里自定义**（上游能力）
-  **环境自检**：`npm run doctor` 一键检查目录权限/沙箱、Electron 二进制、端口、OpenCode 插件登记 —— 专治"装完起不来"
-  自带**功能体检**与**密钥/隐私扫描**脚本（`npm run health` / `npm run scan-secrets`）

---

## ⚠️ 非官方声明

- 本项目是**第三方改造版**，**不是**上游项目的一部分，与上游作者、DeepSeek 官方**均无隶属关系**，也未获官方背书。
- 上游：[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（基线 **v0.3.16**，MIT）。改动清单见 [`NOTICE.md`](NOTICE.md)。
- 本仓库**不含**上游的美术素材（图片/动图/音效）—— 原因与获取方式见「[素材](#-美术素材不随仓库分发)」。

---

## 🚀 快速开始

前置：**Node.js 18+**（建议 20+）。想要「每轮消耗」功能还需要本机装有 [OpenCode](https://opencode.ai)。

```bash
git clone https://github.com/xr05shino23/ds-whale-opencode-widget.git
cd ds-whale-opencode-widget

npm install                 # 装 Electron（二进制缺失会自动补跑一次）+ 自动登记 OpenCode 插件

node scripts/fetch-assets.mjs   # 取回美术素材（本仓库不含素材，见下节）

npm start                   # 启动桌面挂件
```

> 🔧 **装完先跑一次 `npm run doctor`**（环境自检）：它会检查目录权限/沙箱、Electron 二进制、端口、OpenCode 插件登记，并把每个问题连同修复命令一起打出来。比 `npm run health` 更适合"还没跑起来就报错"的情况。

> 🖱️ **安装时会自动在桌面生成「deepseek桌宠」快捷方式** —— **双击就能启动挂件**（图标是从素材转出来的鲸鱼 `.ico`，不需要 OpenCode 在场）✓
> 什么时候需要它：**OpenCode 服务已经在跑、你只是重开 TUI** 时不会自动拉起（这是 OpenCode 插件模型决定的，见下文「让 OpenCode 启动时自动拉起挂件」）→ 这时双击快捷方式即可 ✓
> 不想要它？`node scripts/shortcut.mjs --remove`；或安装前设 `WHALE_NO_SHORTCUT=1` ✓ · 想换个名字：`WHALE_SHORTCUT_NAME=<名字>` ✓

启动后：桌面右下角出现小鲸鱼。**鼠标移到鲸鱼上**它会接收点击，**点击鲸鱼**打开泡泡，**点击泡泡**切到下一屏；**右键/悬停右上角的 ☰** 打开设置菜单（角色、大小、音效、泡泡自定义、资源管理…）；托盘图标可显示/隐藏或退出。

不想开 Electron，只想看页面（浏览器访问 `http://127.0.0.1:38900/`）：

```bash
npm run server
```

### 让 OpenCode 启动时自动拉起挂件（安装时已自动完成）

本仓库自带一个 OpenCode V2 插件，**`npm install` 时已经自动登记好了**（postinstall 会跑 `scripts/setup-opencode.mjs`），正常情况下你不需要做任何额外操作。

它是怎么登记的（① 首选写配置，② 兜底复制；v0.1.3 起）：

| 顺序 | 做法 | 特点 |
|---|---|---|
| ①（默认） | 把插件路径**插入 `opencode.json` 的 `plugins` 数组** | OpenCode **后台服务启动时**加载它 → 这时会拉起挂件 ✓（最小文本插入、保留注释与格式、改前备份） |
| ② | 写不了配置时 → **复制**到自动发现目录 `~/.config/opencode/plugins/whale-autostart` | 真实目录能被扫到；代价是副本不随仓库更新，升级后需重跑一次 setup |
| ✗ | ~~目录链接 / junction~~ | **已废弃**：OpenCode 扫目录时按"真实目录"判断，符号链接会被跳过（v0.1.3 修掉的坑） |

> ⚠️ **"启动 TUI 就自动拉起"做不到**（实测）：OpenCode 的 TUI **只自动加载"带 TUI 入口"的插件**，我们这种"只做事、没有 TUI 组件"的插件列进 `cli.json` 也**不会被 TUI 加载**（TUI 启动时日志里没有任何 `loading plugin`）✗。
> **所以想随时见到鱼，用启动器**：**双击桌面「deepseek桌宠」**（安装时自动创建的快捷方式 ✓，图标是鲸鱼 ✓），或在项目根目录双击 `启动大肥鱼.cmd` / `npm start` ✓ —— 这条也是**对卡巴斯基最安全**的路子（用户自己启动程序，没有"宿主进程拉起未签名大二进制"的特征）✓

需要手动处理时（例如**仓库搬家后链接会失效**）：

```bash
npm run setup:opencode                 # 幂等，可反复跑（会自动清掉旧版留下的、会静默失效的目录链接）
npm run setup:opencode -- --dry-run     # 先看它准备做什么
npm run setup:opencode -- --migrate     # 顺手清掉自动发现目录里冗余的旧副本
npm run setup:opencode -- --remove      # 撤销（重启 OpenCode 后不再自动拉起）
```

验证：`npm run doctor` 里的「插件已登记」一项；OpenCode 日志（`~/.local/share/opencode/log/opencode.log`）里能看到 `loading plugin ... whale-autostart` 即生效。

<details>
<summary>进阶：手工登记（一般用不到）</summary>

在 `~/.config/opencode/opencode.json(c)` 里加上：

```jsonc
{
  "plugins": [
    "<克隆路径>/opencode-plugin/whale-autostart"   // 填绝对路径，例：D:/code/ds-whale-opencode-widget/opencode-plugin/whale-autostart
  ]
}
```

> ⚠️ 注意：OpenCode V2 的 `plugins` 条目**必须是目录**（不能直接指向单个 `.js` 文件，否则会被静默跳过）。插件会从自身位置推导项目根，因此 clone 到哪里都行；特殊布局可用环境变量 `WHALE_DIR` 指定。
> 注意：因为第①层是写配置、第②层是复制到自动发现目录，两处**同时存在**会重复加载 —— 用 `--migrate` 清掉冗余那份（默认只提醒、不擅自动你的文件）。

</details>

> 不想让 `npm install` 动你的 OpenCode 配置？设 `WHALE_SKIP_SETUP=1` 跳过；OpenCode 配置目录不在默认位置？设 `WHALE_OPENCODE_CONFIG_DIR=<目录>`。

---

## 🤖 给 AI 助手（或自动化脚本）的安装步骤

> 如果你是把本仓库网址交给 AI 助手让它装好，把下面这段直接给它即可。

```text
1) git clone https://github.com/xr05shino23/ds-whale-opencode-widget.git
   cd ds-whale-opencode-widget

2) npm install                     # 装 Electron（devDependency）；并自动把 OpenCode 插件登记好
   · 不想让它动 OpenCode 配置：设 WHALE_SKIP_SETUP=1
   · OpenCode 配置目录非默认：设 WHALE_OPENCODE_CONFIG_DIR=<目录>
   · 更想自己控制登记：设 WHALE_SKIP_SETUP=1，装完再跑 npm run setup:opencode

3) node scripts/fetch-assets.mjs   # 必需：美术素材不随仓库分发，从上游官方源取回
   （没有素材也能启动，会用内置占位形象；但体验最好先取回）

4) npm start                       # 启动桌面挂件
   · 若本机 38900 已被占用：设置 WHALE_PORT=38901 再启动（会自动复用/改用该端口）
   · 想只跑服务不开界面：npm run server

5) 验证安装成功：
   · npm run doctor                          → 期望 0 失败（环境/权限/二进制/端口/插件登记）
   · curl http://127.0.0.1:38900/            → HTTP 200
   · curl http://127.0.0.1:38900/dsh-whale/image.png → 200（取回素材后是 image/png）
   · npm run health                          → 期望 输出「14/14 通过」（需要挂件在跑）
   · npm run scan-secrets                    → 只应剩 data/ 里的条目（data/ 不入库）

注意：
- 用 Windows PowerShell 的话，`npm` 可能被系统策略拦住（`npm.ps1` 无法执行）→ 改用
  `npm.cmd install` / `npm.cmd run xxx`，或先执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`。
- 不要把 data/ 目录提交或上传（里面有本机凭据与账本）；.gitignore 已默认忽略。
- **不要把项目放在沙箱/受限目录**（安全软件沙箱、Windows「受控文件夹访问」等）：
  那类目录的 ACL 会 DENY 掉 Synchronize，Electron 启动即崩（退出码 0x80000003）。
  表现为秒崩、日志里有 EXCEPTION_BREAKPOINT —— 用 npm run doctor 可确诊。
- 杀软可能把本程序误判为可疑（它会 spawn 子进程、读本机凭据文件、监听本地端口）；
  必要时把项目目录加入信任/排除区。
- 需要 Node.js 18+（建议 20+）。
```

---

上游在 `PROVENANCE.md` 里写明：`assets/` 下的图片 / 动图 / 音效**不在 MIT 覆盖范围内**，按「原样（as-is）」随插件分发、**不授予再许可**。因此本仓库**不含**这些文件，只提供获取脚本：

```bash
node scripts/fetch-assets.mjs          # 从上游官方源取回（npm/jsDelivr）
node scripts/fetch-assets.mjs --force  # 覆盖已存在的素材
```

脚本只会下载**媒体素材**，**不会**覆盖我们打过补丁的 `assets/whale-widget.js`。

没有素材也能跑 —— 挂件会用内置的**占位形象**（一只简笔鲸鱼）和内置兜底图标，只是没那么好看。

素材取回后仍归原作者，**仅用于运行本插件**；如权利人主张，会立即移除（见 [`NOTICE.md`](NOTICE.md) 第四节）。

---

## ⚙️ 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `WHALE_PORT` | `38900` | 本地服务端口（只监听 `127.0.0.1`） |
| `WHALE_USD_CNY` | `7.1` | 「每轮消耗」的美元→人民币换算；设 `0` 则直接显示原始数值 |
| `WHALE_POLL_MS` | `2000` | 轮询 OpenCode 的间隔（毫秒） |
| `WHALE_OPENCODE_URL` | 自动发现 | 直接指定 OpenCode 服务地址（例如 `http://127.0.0.1:49374`），跳过自动发现 |
| `OPENCODE_BIN` | 自动查找 | 指定 `opencode.exe` 路径（仅在自动发现失败时需要） |
| `WHALE_DIR` | 自动推导 | 挂件项目根目录（OpenCode 插件用；默认从插件位置上跳两级） |
| `WHALE_LOG_DIR` | `<项目根>/logs` | 插件拉起挂件时的日志目录（默认写 `logs/widget.log`） |
| `WHALE_DETACH` | 脱离父进程（默认**开**） | 设 `0` 时挂件不脱离父进程。**默认开是有原因的**：OpenCode 会在多个进程里加载插件（服务端 / TUI / 每次 CLI 调用），不脱离父进程的话，**那个进程一退出鱼就被一起带走**，而且不会自动回来（实测踩过）。想换回非 detached 就设 `WHALE_DETACH=0` |
| `WHALE_NO_AUTOSTART` | — | 设 `1` → 插件**完全不自动拉起**（"安全模式"）。装了卡巴斯基等主防、又不想承担误判风险时用：挂件改由你自己启动（**双击桌面「大肥鱼」快捷方式**或 `npm start`），行为链里就没有"跨进程拉起未签名大二进制"这一步了 |
| `WHALE_NO_SHORTCUT` | — | 设 `1` → 安装时**不**创建桌面快捷方式 |
| `WHALE_SHORTCUT_NAME` | `deepseek桌宠.lnk` | 桌面快捷方式的文件名（`--remove` 会用同一个名字去找） |
| `WHALE_OPENCODE_CONFIG_DIR` | `~/.config/opencode` | OpenCode 配置目录（`setup:opencode` 登记与 `doctor` 检查用；配置目录不在默认位置时设它） |
| `WHALE_SKIP_SETUP` | — | 设 `1` 时 `npm install` 不再自动登记 OpenCode 插件、也不补跑 Electron 二进制 |
| `WHALE_ENSURE_TIMEOUT_MS` | `60000` | 安装期补跑 `electron/install.js` 的时间上限（毫秒） |

---

## 🔐 数据与权限说明

本项目会读写以下内容。开源程序理应讲清这一点，避免被当成恶意软件看待：

**读取**

| 路径 | 用途 |
|---|---|
| `~/.config/opencode/service.json` | 取其中的 `password`，用于访问 OpenCode 本地 API（HTTP Basic：`opencode:<password>`）。**只读**，不上传 |
| OpenCode 本地 API（`127.0.0.1`） | 读取会话列表 / 消息 / 费用，用于「每轮消耗」 |
| `vendor/…/assets/`、`data/` | 界面素材与你的设置 |

**写入**

| 路径 | 内容 |
|---|---|
| `data/credentials.json` | 若你配置了 `DEEPSEEK_API_KEY`，会存于此（**明文，仅本机**）；一旦要分享仓库/目录，请先删掉它 |
| `data/.dshw-usage.json` 等 | 记账账本、用量设置、泡泡自定义、位置与尺寸等 |
| `data/opencode-url.json` | OpenCode 服务地址缓存（避免每次去问 CLI） |

**网络**：只访问你配置的 DeepSeek API（查余额）与 `127.0.0.1` 本地端口；不向任何第三方上报数据。

> 如果你要发布/备份这个目录：**先删掉 `data/`**（`.gitignore` 已默认忽略它）。

---

## 🔀 与上游的差异

| 方面 | 上游（DSH Web 插件） | 本仓库 |
|---|---|---|
| 运行形态 | 挂在 DSH 网页右下角 | **Electron 桌面窗口**（透明/穿透/托盘/置顶） |
| 每轮消耗数据源 | DSH 会话事件 + 真实 usage | **OpenCode** 会话（`idle` 标记轮结束，金额取消息级 cost 合计） |
| 金额口径 | 按真实 usage 换算 | OpenCode **估算 cost × 汇率**（仅供体感参考） |
| 提问/授权提示音 | ✅（DSH 事件驱动） | ❌ 不可用（没有 DSH 会话事件） |
| DSH 账号登录态查余额 | ✅ | ❌ 不可用（无 DSH 账号服务） |
| 默认台词字号 | `size: 22`（「好模型…」等会折行） | `size: 15`（不折行） |
| 随机台词池 | 48 句 | **58 句**（+10） |
| 素材 | 随包分发 | **不分发**，用脚本自取 |

---

## 🛡️ 已知问题：安全软件误报（请先读这条）

**一句话**：卡巴斯基的**行为检测（PDM）**会把「`opencode.exe` 加载本插件 → 插件拉起未签名的 `electron.exe`」这条链判定为 **`PDM:Trojan.Win32.Generic`**。这是**误报**：`opencode.exe` 的数字签名是有效的，本项目代码也全部开源可审计 —— 卡的是"启动行为长得像木马"，不是文件有毒。

**症状**（2026-09-30 本机实际发生过）：

- `main.js`、`opencode-plugin/whale-autostart/index.js`、`vendor/dsh-whale-widget/assets/whale-widget.js` **凭空消失**
- 连 `opencode.exe` 一起被隔离（它和 npm 缓存里的副本是**硬链接**，一损俱损）
- 更严重时：Windows 登录报 **「User Profile Service 服务登录失败，无法加载用户配置文件」**（安全软件回滚时重写了用户注册表配置单元）

**怎么自救**：

```bash
npm run doctor              # 直接报出哪个文件不见了（第 [3] 节「关键文件」）
npm run doctor -- --fix     # 自动 git restore 恢复（只动 git 跟踪的文件）
```

`opencode.exe` 被隔离需要手动处理：安全软件 GUI →「隔离区」→ 恢复；或重装 CLI（`npm i -g @opencode/cli`）。

**建议配置的排除项**（本机已配好；换机器 / 换盘符照做）：

| 类型 | 路径 | 说明 |
|---|---|---|
| 排除文件夹 | `<项目目录>\`（例：`E:\大肥鱼插件\`） | 挡项目内文件 |
| 排除文件夹 | `%APPDATA%\npm\node_modules\@opencode\` | 挡 CLI |
| 排除文件夹 | `%USERPROFILE%\.cache\opencode\` | 挡那个文件名里带 PID 的 service 二进制 |
| 受信任程序 | `%APPDATA%\npm\node_modules\@opencode\cli\bin\opencode.exe` | |
| 受信任程序 | `%USERPROFILE%\.cache\opencode\opencode-service-*.exe` | |
| 受信任程序 | `<项目目录>\node_modules\electron\dist\electron.exe` | **真正跑挂件、且未签名的那个进程**，最容易漏 |

> ⚠️ 受信任程序条目里**务必勾选「不监控应用程序活动」**（该选项作用于"主机入侵防御 / 漏洞利用防御 / 行为检测 / 修复引擎"）—— 这是挡住 PDM 的关键，不勾等于没加。

**为降低误报，本项目从 v0.1.2 起做的改动**：插件拉起挂件时**不再隐藏窗口**（去掉 `windowsHide`）、子进程输出**落日志**（`logs/widget.log`）；安全软件禁止的是"隐藏 + 静默 + 脱离父进程"**三者同时出现**，现在只剩 `detached` 一项（而且它是**必须保留**的 —— 见上表 `WHALE_DETACH` 的说明）。详见 [`CHANGELOG.md`](CHANGELOG.md) 与 [`AGENTS.md`](AGENTS.md)。

---

## 🧭 已知限制

- **平台**：目前只在 **Windows** 上实测过（作者环境：Windows 10 22H2 / 2560×1440 / 100% 缩放）。macOS / Linux 未验证 —— 代码里已做跨平台处理（Electron 可执行文件路径、端口、路径推导），欢迎 PR 或反馈。
- **桌面版 / Web 版客户端**：插件加载点与 TUI 不同 —— 官方文档写明 `cli.json` 只作用于**终端客户端**，所以桌面版用户只会在 **OpenCode 服务启动**时被拉起（**不会**在每次打开桌面版时触发；作者本机没装桌面版，未实测）。需要时用 `npm start` 手动起，或 `opencode service restart`。
- **Electron 版本**：实测版本 **44.4.5**（`npm install` 默认装的就是它）。挂件只用到很基础的 Electron API，理论上多数版本都能跑；若最新版在你的机器上有异常，可自行换到仍在[官方支持窗口](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)内的版本，例如 `npm i -D electron@42.11.8`。
- **OpenCode 版本**：作者只在 **OpenCode TUI（CLI）** 上实测过。按[官方文档](https://opencode.ai/v2/docs/cli/web/)，**Web UI / 桌面 App 与 TUI 由同一个服务提供**（默认 `127.0.0.1:49374`，仅监听本机）—— 而本插件的用量桥连的正是**那个服务**，因此三种客户端应当都能直接工作。如果你用的是**独立服务器**（`opencode serve` 或自定义端口），用环境变量 `WHALE_OPENCODE_URL=http://127.0.0.1:<端口>` 指定即可。
- **DSH 专属能力在 OpenCode 环境下不可用**：DSH 账号登录态查余额、提问/授权提示音与提示泡泡、`{session}` 对话名（会回落成「当前对话」）。
- 金额是**估算**，和官方账单可能对不上（价格/缓存计费口径差异）。
- 挂件窗口只铺**主显示器**；暂不支持把鲸鱼放到副屏。
- 托盘图标与形象图依赖素材；缺失时使用占位图。

---

## 🧪 自检

```bash
npm test                # 自测：用量桥判定 17 + 插件自动登记 34 + 二进制兜底 23 = 74 项
npm run doctor          # 环境自检：目录权限/沙箱 · Electron 二进制 · 能否启动 · 端口 · 素材 · OpenCode 插件登记
npm run health          # 一键功能体检：接口矩阵 / 渲染 / 交互 / 拖拽 / 音效链路（默认静音、隔离 profile）
npm run scan-secrets    # 发布前自查：真实凭据 / 本机路径 / 隐私痕迹
```

- `doctor` **不需要挂件在跑**，装完就能用；每一项都会给出修复命令。`health` 需要挂件已在运行。
- 自测全程在临时目录里跑，不会动你真实的 OpenCode 配置。

- 体检脚本**默认静音**且使用**隔离的用户数据目录**，不会动你的真实设置，也不会出声。
- 体检明细与已知行为（点击语义、泡泡自动关闭、长句折行等）见 [`docs/HEALTH-CHECK.md`](docs/HEALTH-CHECK.md)。
- 维护者：更新代码 / 发布新版本 / 凭据与常见报错的完整流程见 [`docs/UPDATING.md`](docs/UPDATING.md)。

---

## ❓ 常见问题

**杀软报毒 / 文件被隔离？**
本程序会 spawn 子进程、读取消库外的凭据文件、并监听本地端口 —— 行为画像容易被启发式引擎误判（例如卡巴斯基的 `PDM:Trojan.Win32.Generic`）。这是**误报**：代码全部开源可审计。把项目目录加入信任/排除区即可。本项目已尽量避免可疑行为（例如不再通过 shell 调用 CLI）。

**在 PowerShell 里敲 `npm` 报「禁止运行脚本」(PSSecurityException / 无法加载文件 npm.ps1)？**
Windows 默认不允许在 PowerShell 里执行脚本，而 `npm` 其实是个 `npm.ps1`。三种解法任选：

```powershell
npm.cmd install                                        # ① 用 .cmd 版本（最省事）
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # ② 只放开当前这个窗口
# ③ 或者干脆用 cmd（命令提示符）来执行 npm 命令
```

`npm run xxx` / `npx xxx` 同理，换成 `npm.cmd run xxx`、`npx.cmd xxx` 即可。这与本挂件无关，是 Node.js 在这台机器上的安装方式 + Windows 默认策略导致的。

**`npm install` 之后 `npm start` 起不来 / 提示找不到 electron / 报 `Electron failed to install correctly`？**
这是 **Electron 的二进制没下成功**（它要单独下载约 100MB，国内直连 GitHub 容易失败；npm 有时只把包解开、却说"装好了"）。三种修法，从简单到彻底：

```bash
# ① 先补跑它的安装脚本（最常见的情况这一步就解决）
node node_modules/electron/install.js

# ② 还不行 → 换国内镜像后重装
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm install
# 或者只对本次生效：
#   Windows:      set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   && npm install
#   macOS/Linux:  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && npm install

# ③ 确认现在到底有没有下载好
node -e "console.log(require('electron'))"        # 应打印 electron 可执行文件路径
# 或看 node_modules/electron/dist/electron.exe 是否存在（macOS/Linux 路径不同）
```

`npm run doctor` 会直接告诉你二进制在不在、能不能启动。

> 安装时其实已经兜底过一次了：`npm install` 结束前会自动检查二进制，缺失就补跑一次 `install.js`（**带 60 秒上限**，即使失败也不会让安装报错）。如果你看到"⚠ 补跑失败/已放弃"的提示，再按上面三步手动来一次即可。

**`npm start` 秒崩、退出码 `0x80000003`，报 `EXCEPTION_BREAKPOINT` / `IsLoadBrowserProcessSpecificV8SnapshotEnabled`？**
这是 **目录权限/沙箱问题，不是挂件的问题**。Electron 启动时要内存映射自己的资源文件（`snapshot_blob.bin`），而某些目录被 ACL 显式 **DENY 掉了 Synchronize 权限**、或带"低完整性级别"标记（典型是安全软件沙箱、自动化工具的受限目录）→ 映射失败 → V8 直接崩溃，连 `main.js` 第一行都执行不到。

特征：**换到普通目录就正常**；换 Electron 版本、换二进制都没用（实测 Electron 33 与 44 表现一致）。

```bash
npm run doctor          # 会报出「目录含显式 DENY 权限 / 强制性完整性标签」并给出结论
```

修法：**把项目移到普通目录**（例如「文档」下新建一个文件夹再 clone），别放在沙箱目录、安全软件的受控目录，或 Windows「受控文件夹访问」保护的目录里。

**装了挂件，但 OpenCode 启动时没有自动拉起？**
先确认插件登记还在（**仓库搬家**、动过配置都会导致失效）：

```bash
npm run doctor          # 看「插件已登记」一项，以及它用的是哪种登记方式
npm run setup:opencode  # 不在 / 方式不对就自动补上（幂等，可反复跑）
```

登记方式是**写进 `opencode.json(c)` 的 `plugins` 数组** —— 这是唯一实测过"**全新启动也能加载**"的方式。

> ⚠️ **如果你用的是 v0.1.1 / v0.1.2**：那两个版本会往 `~/.config/opencode/plugins/` 放一个**目录链接**，而 OpenCode 扫目录时按"真实目录"判断、**会跳过符号链接** → 表现就是"**重启后不拉起**"（平时热重载却好像正常）。**升级到 v0.1.3+，或跑一次 `npm run setup:opencode` 即可修好**。

> ⚠️ **如果你用的版本只登记了 `opencode.json`（v0.1.3 及以前）**：它只在 **OpenCode 后台服务启动**时加载 → **重开 TUI 不会触发拉起** ✗。
> **实测结论（2026-09-30，v0.1.4 更正）**：`cli.json` **救不了这个** ✗ —— TUI 只自动加载"带 TUI 入口"的插件，我们这种"只做事"的插件列进去也不会被加载（日志里没有任何 `loading plugin`）✗。
> **可靠做法**：双击项目根目录的 **`启动大肥鱼.cmd`**，或 `npm start` ✓（想让它更顺手：把该 .cmd 固定到任务栏/开始屏幕 ✓）。

想确认真的被加载：看 `~/.local/share/opencode/log/opencode.log` 里有没有 `loading plugin ... whale-autostart`，以及 `logs/widget.log` 里有没有 `widget launched pid=…`。

> 💡 **两个行为要知道**（都属正常，不是 bug）：
> - **挂件只在"插件被加载"时被拉起** —— 如果你**手动退出过挂件**（托盘 → 退出），它不会自己回来，要等下一次 OpenCode 启动 / 插件重载，或者自己跑 `npm start`。
> - **同时只允许一只**：重复拉起会被 Electron 的单实例锁挡掉（日志里表现为 `singleInstanceLock = false` + `widget exited code=0`），这是防止双开的设计。

**我是 OpenCode 桌面版 / Web 版用户，挂件能连上吗？**
**能，原则上不需要任何适配。** 官方文档写明：Web UI 与 TUI **由同一个服务提供**（桌面 App 通过 `opencode pair` 或填服务器地址连过去的也是它）。而本插件的用量桥读的是**那个服务**的 API，不是某个客户端，所以 TUI / Web / 桌面 App 都通用。

自查一下（3 步）：

1. 看挂件日志有没有这两行：
   `[bridge] OpenCode 服务地址（来自 opencode.exe）: http://127.0.0.1:49374` + `[bridge] tracking session ses_xxx` —— 有就是通了 ✅
2. 想看服务本身：`opencode service status` / `opencode api get /api/info`
3. 如果你跑的是**独立服务器**（`opencode serve --port 4096` 之类）或改了端口：
   ```powershell
   set WHALE_OPENCODE_URL=http://127.0.0.1:4096    # 再启动挂件
   ```
   挂件会直接用这个地址，不再自动发现 ✅

**改设置时报「设置保存失败: Failed to fetch」？**
说明挂件的**本地服务没在监听**（界面能点，但所有读写请求都发不出去）。最常见的原因是启动时端口被另一个实例占用，而那个实例后来退出了。退出挂件重新启动即可；**新版会自动重试接管端口**，不需要手动处理。

**同时开两个副本，第二个没反应 / 闪退？**
本项目有**单实例锁**（防止 OpenCode 插件重复拉起）。第二个实例会**静默退出**，日志里能看到
`[main] boot: singleInstanceLock = false`。要做对比测试时给第二个实例换一套用户数据目录：

```bash
npx electron . --user-data-dir="%TEMP%\whale-test"     # Windows
npx electron . --user-data-dir="$TMPDIR/whale-test"    # macOS / Linux
```

同时记得换端口：`set WHALE_PORT=38901`（Windows）或 `export WHALE_PORT=38901`。

**素材脚本下载失败？**
`scripts/fetch-assets.mjs` 会依次尝试 jsDelivr → unpkg → GitHub raw；都被挡时，可以手动从上游 npm 包取：

```bash
npm pack dsh-whale-widget@0.3.16      # 得到一个 .tgz
tar -xzf dsh-whale-widget-0.3.16.tgz  # 解出 package/assets/*
# 把 package/assets/ 下的媒体文件复制到 vendor/dsh-whale-widget/assets/
```

**鲸鱼是空白 / 没有形象？**
说明素材缺失，跑 `node scripts/fetch-assets.mjs`；或确认 `vendor/dsh-whale-widget/assets/DSniang1.png` 存在。

**听不到「任务结束音」，或觉得声音太频繁？**
- **点鲸鱼**会发出「按压音效」（默认小黄鸭），和「任务结束音」是两套设置 —— 别混淆（两者可以在菜单里改成明显不同的音效）。
- 金额泡泡默认 **5 秒后自动关闭**（`turnCostCloseMs`），没盯着容易错过。
- 「每轮消耗」的开关在：菜单 → 音效与提示 → 全局设置 → 每轮消耗提示。

**点击鲸鱼不切换台词？**
默认是「**点鲸鱼 = 打开/重置，点泡泡 = 推进下一屏**」。想让点鲸鱼也能推进，在「按压泡泡设置」里打开「点按角色推进泡泡队列」开关。

**每轮消耗没弹出来？**
- 先确认 `bubbleOn` 与 `turnCostOn` 都开着（菜单 → 音效与提示 → 全局设置 → 每轮消耗提示）；另外消耗/预警泡泡在场时，点鲸鱼是**不响应**的（要点泡泡）。
- **如果是"长对话跑到后面就再也不弹了"**（尤其是一轮里工具调用很多的时候）—— 那是 **v0.1.0 的已知 bug**：OpenCode 的消息接口只返回**最近 50 条**，长了以后 `user` 消息被挤出窗口，用量桥会误判"这不是用户会话"、跳到别的旧会话上，于是那一轮再也不记账。**v0.1.1 已修复**（`npm run test:bridge` 里有专门的回归用例）。用 `npm start` 在控制台启动挂件，日志里能看到 `[bridge] tracking session <id>`，确认它跟的是**你当前**会话的 id 就说明正常。

---

## 📁 目录结构

```
main.js / preload.cjs        Electron 主进程与穿透桥
src/shim.mjs                 宿主兼容层（让上游插件跑在普通 Node 里）
src/bridge.mjs               OpenCode 用量桥（轮结束驱动）
src/placeholder.mjs          素材缺失时的占位形象/图标
opencode-plugin/             OpenCode 插件（启动时自动拉起挂件）
scripts/setup-opencode.mjs   把插件登记进 OpenCode（npm install 时自动跑）
scripts/ensure-electron.mjs  安装期兜底：Electron 二进制缺失就补跑一次（带时间上限）
scripts/fetch-assets.mjs     取回上游美术素材
tools/doctor.mjs             环境自检（npm run doctor）
tools/                       自检工具（功能体检 / 密钥扫描 / 探针基座 / 登记脚本自测）
vendor/dsh-whale-widget/     上游插件（MIT；其中 assets/ 素材不随仓库分发）
data/                        运行数据（**不入库**）
logs/                        插件拉起挂件时的日志（**不入库**）
_private/                    本地私有备份（**不入库**）
```

---

## 📄 许可与致谢

- 本仓库自己的代码：**MIT**（见 [`LICENSE`](LICENSE)）。
- 上游代码：**MIT**，版权归其作者（见 `vendor/dsh-whale-widget/LICENSE`）；上游 `assets/` 素材不在 MIT 内，本仓库不分发（见 [`NOTICE.md`](NOTICE.md)）。
- 感谢 [MeteorNOX](https://github.com/MeteorNOX) 与其社区贡献者做出的优秀插件。
- **实现与文档由 AI 助手协作完成**：开发过程在 [OpenCode](https://opencode.ai) 中进行，使用 DeepSeek 系列模型；所有改动均经人工确认与实测（`npm run health`）。

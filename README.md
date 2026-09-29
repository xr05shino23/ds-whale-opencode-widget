# ds-whale-opencode-widget

> **非官方**的「小鲸鱼余额挂件」**桌面版（Electron）** + **OpenCode 适配**。
> Unofficial desktop (Electron) + OpenCode port of the [DSH Whale Balance Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget).

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
- 附带一个 OpenCode 插件，让你**启动 OpenCode 时自动拉起**这只鱼（支持热重载）

**账目能力全部保留**：余额、今日已用（余额观测记账）、峰谷定价与倒计时、用量记录，以及「小鲸鱼记账」里的 34 个厂商余额模板与自定义 HTTP 接口。少数依赖 DSH 官方的能力在 OpenCode 环境下不可用 —— 见下方「[已知限制](#-已知限制)」。

> 更详细的由来、改造清单与技术取舍 → **[`docs/ORIGIN.md`](docs/ORIGIN.md)**
> 上游署名与逐条改动 → **[`NOTICE.md`](NOTICE.md)**

## ✨ 主要特性

把原本挂在 DSH 网页右下角的小鲸鱼，做成了一个**桌面常驻挂件**：

- 🐋 **桌面化**：透明无边框窗口、整窗鼠标穿透（悬到鲸鱼上才接收点击）、托盘菜单、始终置顶、单实例、跟随分辨率/缩放变化
- 💰 **余额 / 今日已用 / 峰谷定价**：沿用上游的全部账目能力（按 API key 查余额、余额观测记账、峰谷倒计时）
- 🧾 **多厂商余额 / 订阅额度**：内置 **34 个模板** —— OpenAI 兼容中转站（OneAPI / New API）、硅基流动、OpenRouter、火山方舟、Kimi、智谱、MiniMax，以及订阅额度类（智谱 / Kimi / MiniMax Coding Plan、**OpenCode Go 订阅额度**）；也支持「自定义 HTTP」自己填地址与 JSON 字段路径。**自定义地址需在本机面板勾选「允许把凭据发送到自定义地址」**（上游的安全策略，防止密钥被发到未知地址）
- 💬 **每轮对话消耗**：用 **OpenCode** 的会话数据驱动 —— 一轮真正结束时响一次任务结束音 + 弹一次「本轮花了多少」
- 🎨 泡泡内容、随机台词、图片、音效**全部可在挂件菜单里自定义**（上游能力）
- 🔍 自带**功能体检**与**密钥/隐私扫描**脚本（`npm run health` / `npm run scan-secrets`）

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

npm install                 # 安装 Electron

node scripts/fetch-assets.mjs   # 取回美术素材（本仓库不含素材，见下节）

npm start                   # 启动桌面挂件
```

启动后：桌面右下角出现小鲸鱼。**鼠标移到鲸鱼上**它会接收点击，**点击鲸鱼**打开泡泡，**点击泡泡**切到下一屏；**右键/悬停右上角的 ☰** 打开设置菜单（角色、大小、音效、泡泡自定义、资源管理…）；托盘图标可显示/隐藏或退出。

不想开 Electron，只想看页面（浏览器访问 `http://127.0.0.1:38900/`）：

```bash
npm run server
```

### 让 OpenCode 启动时自动拉起挂件（可选）

本仓库自带一个 OpenCode V2 插件。在 `~/.config/opencode/opencode.json(c)` 里加上：

```jsonc
{
  "plugins": [
    "<克隆路径>/opencode-plugin/whale-autostart"   // 填绝对路径，例：D:/code/ds-whale-opencode-widget/opencode-plugin/whale-autostart
  ]
}
```

> ⚠️ 注意：OpenCode V2 的 `plugins` 条目**必须是目录**（不能直接指向单个 `.js` 文件，否则会被静默跳过）。插件会从自身位置推导项目根，因此 clone 到哪里都行；特殊布局可用环境变量 `WHALE_DIR` 指定。

---

## 🤖 给 AI 助手（或自动化脚本）的安装步骤

> 如果你是把本仓库网址交给 AI 助手让它装好，把下面这段直接给它即可。

```text
1) git clone https://github.com/xr05shino23/ds-whale-opencode-widget.git
   cd ds-whale-opencode-widget

2) npm install                     # 装 Electron（devDependency，默认会装）

3) node scripts/fetch-assets.mjs   # 必需：美术素材不随仓库分发，从上游官方源取回
   （没有素材也能启动，会用内置占位形象；但体验最好先取回）

4) npm start                       # 启动桌面挂件
   · 若本机 38900 已被占用：设置 WHALE_PORT=38901 再启动（会自动复用/改用该端口）
   · 想只跑服务不开界面：npm run server

5) 验证安装成功：
   · curl http://127.0.0.1:38900/            → HTTP 200
   · curl http://127.0.0.1:38900/dsh-whale/image.png → 200（取回素材后是 image/png）
   · npm run health                          → 期望 输出「14/14 通过」
   · npm run scan-secrets                    → 只应剩 data/ 里的条目（data/ 不入库）

注意：
- 不要把 data/ 目录提交或上传（里面有本机凭据与账本）；.gitignore 已默认忽略。
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

## 🧭 已知限制

- **平台**：目前只在 **Windows** 上实测过（作者环境：2560×1440 / 100% 缩放）。macOS / Linux 未验证 —— 代码里已做跨平台处理（Electron 可执行文件路径、端口、路径推导），欢迎 PR 或反馈。
- **DSH 专属能力在 OpenCode 环境下不可用**：DSH 账号登录态查余额、提问/授权提示音与提示泡泡、`{session}` 对话名（会回落成「当前对话」）。
- 金额是**估算**，和官方账单可能对不上（价格/缓存计费口径差异）。
- 挂件窗口只铺**主显示器**；暂不支持把鲸鱼放到副屏。
- 托盘图标与形象图依赖素材；缺失时使用占位图。

---

## 🧪 自检

```bash
npm run health          # 一键功能体检：接口矩阵 / 渲染 / 交互 / 拖拽 / 音效链路（默认静音、隔离 profile）
npm run scan-secrets    # 发布前自查：真实凭据 / 本机路径 / 隐私痕迹
```

- 体检脚本**默认静音**且使用**隔离的用户数据目录**，不会动你的真实设置，也不会出声。
- 体检明细与已知行为（点击语义、泡泡自动关闭、长句折行等）见 [`docs/HEALTH-CHECK.md`](docs/HEALTH-CHECK.md)。

---

## ❓ 常见问题

**杀软报毒 / 文件被隔离？**
本程序会 spawn 子进程、读取消库外的凭据文件、并监听本地端口 —— 行为画像容易被启发式引擎误判（例如卡巴斯基的 `PDM:Trojan.Win32.Generic`）。这是**误报**：代码全部开源可审计。把项目目录加入信任/排除区即可。本项目已尽量避免可疑行为（例如不再通过 shell 调用 CLI）。

**`npm install` 之后 `npm start` 起不来 / 提示找不到 electron？**
多半是 **Electron 的二进制没下下来**（它要单独下载约 100MB，国内直连 GitHub 容易失败，且 npm 有时只报"装好了"）。查一下：

```bash
node -e "console.log(require('electron'))"        # 应打印 electron 可执行文件路径
# 或直接看 node_modules/electron/dist/electron.exe 是否存在
```

没下下来就用国内镜像重装：

```bash
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm install
# 或者只对本次生效：
#   Windows:      set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   && npm install
#   macOS/Linux:  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && npm install
```

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
确认 `bubbleOn` 与 `turnCostOn` 都开着；另外消耗/预警泡泡在场时，点鲸鱼是**不响应**的（要点泡泡）。

---

## 📁 目录结构

```
main.js / preload.cjs        Electron 主进程与穿透桥
src/shim.mjs                 宿主兼容层（让上游插件跑在普通 Node 里）
src/bridge.mjs               OpenCode 用量桥（轮结束驱动）
src/placeholder.mjs          素材缺失时的占位形象/图标
opencode-plugin/             OpenCode 插件（启动时自动拉起挂件）
tools/                       自检工具（体检 / 密钥扫描 / 探针基座）
scripts/fetch-assets.mjs     取回上游美术素材
vendor/dsh-whale-widget/     上游插件（MIT；其中 assets/ 素材不随仓库分发）
data/                        运行数据（**不入库**）
_private/                    本地私有备份（**不入库**）
```

---

## 📄 许可与致谢

- 本仓库自己的代码：**MIT**（见 [`LICENSE`](LICENSE)）。
- 上游代码：**MIT**，版权归其作者（见 `vendor/dsh-whale-widget/LICENSE`）；上游 `assets/` 素材不在 MIT 内，本仓库不分发（见 [`NOTICE.md`](NOTICE.md)）。
- 感谢 [MeteorNOX](https://github.com/MeteorNOX) 与其社区贡献者做出的优秀插件。
- **实现与文档由 AI 助手协作完成**：开发过程在 [OpenCode](https://opencode.ai) 中进行，使用 DeepSeek 系列模型；所有改动均经人工确认与实测（`npm run health`）。

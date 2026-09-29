# 仓库约定（AGENTS.md）

> 给**任何在这个仓库里干活的 AI 助手或维护者**看的硬约定。
>
> 背景：2026-09-30 凌晨，本项目触发过一次卡巴斯基的**行为检测（PDM）**误报
> （`PDM:Trojan.Win32.Generic`）—— 项目内 3 个关键文件被隔离、连 `opencode.exe` 一起被删，
> 回滚时还重写了用户注册表配置单元，导致下次登录报「User Profile Service 服务登录失败」。
> 完整取证、排除项清单与恢复方式见 [`README.md`](README.md) 的「已知问题：安全软件误报」。

## 一、禁止出现的写法（会直接命中行为检测）

- ❌ **写系统自启项**：`HKCU\...\CurrentVersion\Run`、`shell:startup`、计划任务、`schtasks`。
  「whale-**autostart**」只是这个插件的名字，**绝不要**真的去写开机启动。
- ❌ **`windowsHide: true` + `stdio: 'ignore'` + `detached: true` 三者同时出现** ——
  「隐藏 + 静默 + 脱离父进程」正是木马特征组合，**最多只允许其中一个**。
  - `windowsHide` 的**唯一例外**：`src/bridge.mjs` 里 spawn **已签名的** `opencode.exe` 问服务地址那一处 ——
    挂件主进程是 GUI、没有控制台，不隐藏就会在屏幕上闪一下黑窗。除此之外**不要再加**，
    尤其**禁止**用它 spawn 未签名的大二进制（`electron.exe` 之类，那正是误报链里的动作）。
- ❌ **spawn 未签名的大二进制（例如 `electron.exe`）却不落任何日志**（静默失败既是特征、也让人无从排查）。
- ❌ **在源码里硬编码盘符 / 用户目录路径** —— 一律走环境变量 + 相对路径推导。
- ❌ **在插件 `setup` 阶段修改系统状态**（注册表、服务、防火墙、开机项）。
- ❌ **用"目录链接 / junction"做插件登记** —— OpenCode 扫自动发现目录时按**真实目录**判断，符号链接会被跳过：热重载能加载、**全新启动扫不到**（v0.1.1/v0.1.2 踩过，用户表现为"重启后不拉起"）。
- ❌ **只往一个配置文件里登记** —— OpenCode 是"**常驻后台服务 + 客户端**"：`opencode.json` 的插件**只在服务启动时**加载；**每次启动 TUI 都会加载**的是 `cli.json` 里的 CLI/TUI 插件。只登记前者 → 用户"重开 opencode（TUI）"时不会触发（v0.1.3 踩过）。**登记一律同时写这两个文件**。两处同时加载不会双开（Electron 单实例锁）。

## 一·补 · `detached` 的取舍（别再改回 `false`）

挂件的 spawn **默认 `detached: true`**。这不是偷懒：OpenCode 会在**多个进程**里加载插件（服务端、TUI、每次 CLI 调用…），若 `detached: false`，挂件就成了"某个 OpenCode 进程的子进程"，**那个进程一退出（例如重启 TUI）挂件会被一起带走**，而服务端上的插件并不会因此重新加载 → 表现为"鱼不见了，而且没人再拉它"（实测踩过两次）。想换回非 detached 用 `WHALE_DETACH=0`，但请先知道上面这个后果。

## 二、允许且推荐的做法

- ✅ spawn 一个**前台可见**的子进程（不隐藏窗口）
- ✅ **写项目内日志**（默认 `logs/widget.log`，`logs/` 已在 `.gitignore` 里）
- ✅ 读写**项目内**文件
- ✅ 用 `WHALE_*` 环境变量让用户覆盖路径与行为：
  `WHALE_DIR`（项目根）· `WHALE_LOG_DIR`（日志目录）· `WHALE_DETACH`（是否脱离父进程）·
  `WHALE_PORT`（本地端口）· `WHALE_OPENCODE_URL`（OpenCode 服务地址）…

## 三、改完前后请跑这些

```bash
npm test            # 74 项自测：用量桥判定 / 插件登记 / 二进制兜底
npm run doctor      # 环境自检（含「关键文件是否被安全软件删除」与插件登记）
```

- 改过 `opencode-plugin/whale-autostart/index.js` → 触发一次重载，确认 `logs/widget.log` 里仍是
  `widget launched pid=... detached=false exe=...`
- 提交前：`git status --porcelain` 只应剩你有意改动的文件
- **绝对不要**提交 `_private/`（含 API key 与本地备份）、`data/`、`logs/`

## 四、这台机器上的额外注意

- 用户装了卡巴斯基（行为防御很激进）。**在排除项未生效、或没把 `electron.exe` 加进「受信任的应用程序」之前，
  不要跑界面自动化脚本** —— `_private/dbg-*.mjs` 那类"用未签名 Electron 驱动 UI"的脚本，
  曾经出现在误报的行为链里。
- 卡巴斯基的排除项 / 受信任程序配置、以及"务必勾选『不监控应用程序活动』"这条关键设置，见 README 对应小节。

# 更新与发布指南（UPDATING）

> 给自己/维护者的备忘：怎么把本地改动推上 GitHub、发布新版本、以及出错时怎么办。
> 普通使用者不需要看这个文件。

---

## 一、日常更新（90% 的情况）

```powershell
cd E:\大肥鱼插件

git status --short        # ① 看看改了哪些文件（可选，推荐）
git add -A                # ② 暂存全部改动
git commit -m "fix: 修了 XXX"   # ③ 提交（写清改了什么）
git push                  # ④ 推送
```

提交信息常用前缀：`feat:` 新功能 · `fix:` 修 bug · `docs:` 文档 · `chore:` 杂务

**推之前顺手自检**（防手滑把密钥/数据提交进去）：

```powershell
npm run scan-secrets      # 期望：A 级只剩 data/ 里的条目（data/ 已被 .gitignore 忽略）
npm run doctor            # 期望：0 失败（顺手确认环境/插件登记没被自己搞坏）
git status --short        # 确认列表里没有 data/、node_modules/、素材
```

---

## 二、凭据（token）—— 这里有个坑

### 一次性配置（本仓库已配好）

```
# .git/config（本仓库专用，不入库）
[credential]
    helper =                          # 空值：清空系统级 GCM，避免它抢答/卡死
    helper = store --file=C:/Users/<你>/.git-credentials
```

### 更新 token（换新 token 时）

```powershell
$t = Read-Host '把新 token 粘进来，回车'
[System.IO.File]::WriteAllText("$env:USERPROFILE\.git-credentials", "https://<用户名>:$t@gh-proxy.com`n", (New-Object System.Text.UTF8Encoding($false)))
```

> ⚠️ **必须用 `[System.IO.File]::WriteAllText`，不要用 `Set-Content`！**
> `Set-Content` 写的是 **CRLF**，而 `git-credential-store` **不会剥掉 `\r`** →
> 主机名会变成 `gh-proxy.com\r` → 匹配失败 → 报
> `fatal: could not read Username for 'https://gh-proxy.com'`。
> （这个坑实测踩过：文件看着完全正常，就是取不到凭据。）

### 验证凭据可用

```powershell
("protocol=https`nhost=gh-proxy.com`n`n" | git credential-store --file="$env:USERPROFILE/.git-credentials" get)
# 期望输出：username=...   password=...
```

---

## 三、常见错误对照表

| 现象 | 原因 | 解决 |
|---|---|---|
| `could not read Username for 'https://gh-proxy.com'` | 凭据文件读不到 / **CRLF 行尾** / helper 链被 GCM 抢答 | 见第二节；确认 `.git/config` 里的空值重置那一行还在 |
| `Invalid username or token` | **token 失效**（被撤销/过期） | 建新 token（只勾本仓库 + Contents 读写）→ 按第二节写入 |
| `Connection was reset` / 连接超时 | 直连 GitHub 不通 | 确认全局有 gh-proxy 重写：<br>`git config --global --get-regexp 'url\.'`<br>没有就补：<br>`git config --global 'url.https://gh-proxy.com/https://github.com/.insteadOf' 'https://github.com/'` |
| 卡住几分钟没输出、git 进程 IO 为 0 | 凭据管理器在等一个已关闭的弹窗 | `Get-Process git \| Stop-Process -Force` 清掉；确认 helper 链没问题 |
| `no upstream branch` | 新分支没跟踪 | `git push -u origin main` |

---

## 四、发新版本（Release）

**方式 A：网页（推荐）**
仓库页 → **Releases** → **Draft a new release** → 新建 tag（如 `v0.1.1`）→ 写说明 → Publish

**方式 B：命令行**
```powershell
git tag v0.1.1
git push --tags
```
然后到网页补 Release 说明。

> 注意：如果 tag 建在某个提交上、之后又推了新提交，可以在网页上编辑 Release 或重建 tag。

---

## 五、备用方案：代理抽风时用 API 直推

`api.github.com` 通常比 `gh-proxy.com` 稳定且快（实测直连 0.3–0.5 秒）。当 `git push`
反复失败时，可以改走 GitHub Git Data API 建提交：

- 思路：读本地文件 → `POST /git/blobs`（或带内联内容的 tree）→ `POST /git/trees` → `POST /git/commits`（父提交=远程 main）→ `PATCH /git/refs/heads/main`
- token 从本机 `~/.git-credentials` 读取，不落任何日志
- 本项目在历次发布中用过这条路（含空仓库的 409 特例：空仓库不能建 blob，需先用 Contents API 落一个文件）

---

## 六、安装期自动登记（postinstall）与相关脚本

`package.json` 里有三个与 OpenCode 集成有关的入口：

| 命令 | 作用 |
|---|---|
| `postinstall`（= `ensure-electron.mjs` + `setup-opencode.mjs --soft`） | `npm install` 之后：① 检查并补齐 **Electron 二进制**（缺失才补跑 install.js，带 60 秒上限，绝不阻断安装）② **自动把插件登记进 OpenCode** |
| `npm run ensure:electron` | 手动检查/补齐 Electron 二进制（等价于 postinstall 的前半步） |
| `npm run setup:opencode` | 手动/修复插件登记（幂等）。`--dry-run` 预览 · `--migrate` 清理重复的老条目 · `--remove` 撤销 |
| `npm run doctor` | 环境自检（含"插件是否已登记"和"二进制在不在"） |

登记策略（**v0.1.3 起**）：① **写两个配置文件的 `plugins` 数组** —— `opencode.json`（服务端插件，**服务启动时**加载）+ `cli.json`（CLI/TUI 插件，**每次启动 TUI 都加载**），缺哪个补哪个（最小文本插入、保留注释与格式、各自备份成 `<文件名>.bak-<时间戳>`）→ ② 写不了配置时才**复制**到自动发现目录。

> ⚠️ **两条别踩**：
> 1. **绝对不要用"目录链接 / junction"做登记** —— OpenCode 扫自动发现目录时按**真实目录**判断，符号链接会被跳过（热重载能加载、**全新启动扫不到**，v0.1.1/v0.1.2 踩过）。
> 2. **不要只登记一个文件** —— 只写 `opencode.json` 时，用户"**重开 TUI**"不会触发（服务没重启 ✗，v0.1.3 踩过）。两个文件互补，缺一个就少一种触发时机。

维护者注意：

- **仓库搬家后登记会失效**（`opencode.json` 里存的是绝对路径，复制过去的副本也不会跟着走）→ 在新目录重跑 `npm run setup:opencode`；`doctor` 会先报出来
- 自测：`npm run test:setup`（**42 项**：默认走数组 · 幂等 · 强制复制 · 配置三种起点（无文件/空对象/JSONC+CRLF+注释）· 撤销只摘自己的 · **旧 junction 迁移（T7）** · `--migrate` 清冗余副本（T9）· **不覆盖别人的目录** · BOM 处理 · `--soft` 永不报错；全程用临时配置目录，不动你真实的 OpenCode 配置）
- 调试开关：`WHALE_SETUP_FORCE=copy|config` 强制走第②/③层；`WHALE_OPENCODE_CONFIG_DIR=<目录>` 隔离测试 —— **别拿真实配置目录做测试**
- 不想让 `npm install` 动配置：`WHALE_SKIP_SETUP=1`；CI 环境自动跳过

---

## 七、发布前的检查清单

- [ ] `npm run scan-secrets` → A 级没有新增（`data/` 已被忽略）
- [ ] `npm run doctor` → 0 失败（重点看 **[3] 关键文件** 一节：有没有被安全软件删掉的东西）
- [ ] 提交里没有 `data/`、`logs/`、`node_modules/`、美术素材（`*.png/gif/mp3/wav`）
- [ ] **安全软件特征自检**（验收硬指标，见 `AGENTS.md`）：
      `git grep -n windowsHide -- '*.js' '*.mjs' '*.cjs'` → 只应命中 `src/bridge.mjs` 那 1 处（唯一允许的例外）；
      再确认代码里没有 `shell:startup` / `CurrentVersion` / `schtasks` / `reg add`
- [ ] 若改了 `vendor/` 里的上游文件 → **同步更新 `NOTICE.md` 的改动清单**
- [ ] README 里的 clone 地址与仓库名一致
- [ ] `npm run health` 过一遍（需要挂件在运行）
- [ ] **动过 Electron 版本 → 必须重跑 `npm run doctor` + `npm run health`**，并把实测版本同步进 README「已知限制」
- [ ] 改过 `scripts/setup-opencode.mjs` / `opencode-plugin/` → 重跑 `npm run test:setup`；并**直接以模块方式跑一次插件**确认启动路径没坏：
      `node -e "import('file:///.../index.js').then(m=>m.default.setup({}))"` → 应生成 `logs/widget.log`，且里面有
      `widget launched pid=… detached=true exe=…`（默认就是 detached；想测非 detached 加 `WHALE_DETACH=0`）
- [ ] **登记必须两个文件都有**：`opencode.json`（服务端启动时加载）+ `cli.json`（每次启动 TUI 都加载）里都应能看到
      `plugins` 数组里指向本仓库的路径；**不要出现"自动发现目录里的目录链接"**。`npm run doctor` 会直接告诉你缺哪个
- [ ] 改过 `scripts/ensure-electron.mjs` → 重跑 `npm run test:electron`
- [ ] 改过 `src/bridge.mjs` → 重跑 `npm run test:bridge`（并顺手确认长对话下"每轮消耗"还能弹）
- [ ] 干净克隆验证一遍（见第八节）

---

## 八、干净克隆验证（发版前建议跑一次）

```powershell
$t = "$env:TEMP\whale-clone-test"
Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $t | Out-Null
git ls-files -co --exclude-standard | ForEach-Object {
  $dst = Join-Path $t $_; $d = Split-Path $dst -Parent
  if ($d) { New-Item -ItemType Directory -Force $d | Out-Null }
  Copy-Item $_ $dst
}
cd $t

# ⚠️ 关键：用【临时】配置目录，别让临时克隆把自己登记进真实的 OpenCode 配置
$env:WHALE_OPENCODE_CONFIG_DIR = "$env:TEMP\whale-clone-cfg"
Remove-Item -Recurse -Force $env:WHALE_OPENCODE_CONFIG_DIR -ErrorAction SilentlyContinue

npm install                     # postinstall 会往上面那个临时目录登记插件
npm run doctor                  # 期望 0 失败（没素材只算警告）
node scripts/fetch-assets.mjs   # 取素材
```

要点：

- `git ls-files -co --exclude-standard` = 已跟踪 + 未跟踪但**没被忽略**的文件，即"将来会提交的全部内容"
- **一定要设 `WHALE_OPENCODE_CONFIG_DIR`**（或 `WHALE_SKIP_SETUP=1`），否则临时克隆会把自己的路径写进你真实的 `~/.config/opencode/plugins/`，把正式环境指跑偏

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

## 六、发布前的检查清单

- [ ] `npm run scan-secrets` → A 级没有新增（`data/` 已被忽略）
- [ ] 提交里没有 `data/`、`node_modules/`、美术素材（`*.png/gif/mp3/wav`）
- [ ] 若改了 `vendor/` 里的上游文件 → **同步更新 `NOTICE.md` 的改动清单**
- [ ] README 里的 clone 地址与仓库名一致
- [ ] `npm run health` 过一遍（需要挂件在运行）

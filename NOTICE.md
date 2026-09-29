# NOTICE · 来源署名与改动说明

本仓库是**非官方**的第三方改造版，不是上游项目的一部分，与上游作者、DeepSeek 官方均**无隶属关系**。

## 一、上游项目

| 项 | 内容 |
|---|---|
| 名称 | DSH 小鲸鱼记账挂件（DeepSeek Balance Whale Widget） |
| 作者 | [MeteorNOX](https://github.com/MeteorNOX) |
| 仓库 | https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget |
| 本仓库基线 | **v0.3.16** |
| 许可 | **MIT**（版权声明与许可全文原样保留在 `vendor/dsh-whale-widget/LICENSE`） |

上游仓库对 `assets/` 美术素材另有声明（**不在 MIT 覆盖范围内**，按 as-is 随插件分发、不授予再许可），详见 `vendor/dsh-whale-widget/PROVENANCE.md`。

## 二、本仓库对上游文件做了什么

**唯一被修改的上游文件：`vendor/dsh-whale-widget/assets/whale-widget.js`**

| # | 改动 | 说明 |
|---|---|---|
| 1 | 默认字号 `size: 22` → `size: 15`，共 **13 处** | 分布在 4 个默认定义段：`bubbleDefaultRandomLines`、`bubbleDefaultSecondModules`、`BUBBLE_DEFAULT_ITEMS`、`bubbleDefaultQueue`。原因是默认字号下「好模型…↓ / 好女孩…↓ / 哦鲸鲸…」在气泡里会折行 |
| 2 | 随机语句池**新增 10 句** | 位于 `BUBBLE_DEFAULT_ITEMS` 第二个点击步骤的 `lines` 池（权重 `w:3`、加粗） |

其余 7 个上游文件**逐字节未改**：

```
vendor/dsh-whale-widget/lib/index.js
vendor/dsh-whale-widget/lib/accounting.mjs
vendor/dsh-whale-widget/package.json
vendor/dsh-whale-widget/cordis.patch.yml
vendor/dsh-whale-widget/LICENSE
vendor/dsh-whale-widget/PROVENANCE.md
vendor/dsh-whale-widget/README.md
```

> 上游 `assets/` 下的美术素材（图片 / 动图 / 音效）**没有随本仓库分发**，见第四节。

## 三、本仓库新增（非上游）的部分

| 路径 | 说明 |
|---|---|
| `main.js`、`preload.cjs` | Electron 桌面壳：透明无边框窗口、鼠标穿透、托盘、跟随显示器变化 |
| `src/shim.mjs` | 让上游插件在普通 Node 进程里原样运行的宿主兼容层 |
| `src/bridge.mjs` | OpenCode 用量桥：把 OpenCode 的会话消耗喂给挂件「每轮消耗」 |
| `src/server.mjs` | 不开 Electron 的纯服务模式 |
| `src/placeholder.mjs` | 素材缺失时的内置占位（形象图 / 托盘图标） |
| `opencode-plugin/whale-autostart` | OpenCode 插件：启动时自动拉起挂件 |
| `tools/*` | 自检工具：功能体检、密钥与隐私扫描 |
| `scripts/fetch-assets.mjs` | 从上游官方源取回美术素材（本仓库不分发素材） |

**行为差异（由上面的壳/桥接层造成，不是改动前端逻辑）**：

- 「每轮消耗」的结算时机 = **OpenCode 的一轮真正结束**（`idle` 标记）→ 响一次任务结束音 + 弹一次金额泡泡；
  上游原版由 DSH 的 `turn/end` 事件触发，粒度同为「一轮」。
- 金额口径 = OpenCode 上报的**估算 cost（美元）× 汇率**（`WHALE_USD_CNY`，默认 7.1），
  与 DeepSeek 官方账单可能不一致，**仅供体感参考**。

## 四、美术素材（不在本仓库）

上游 `PROVENANCE.md` 明确：`assets/` 下的图片 / 动图 / 音效**不在 MIT 覆盖范围内**，按 as-is 分发、**不授予再许可**。因此本仓库**不包含**这些文件，改为：

```bash
node scripts/fetch-assets.mjs     # 从上游官方源（npm/jsDelivr）取回素材
```

取回后素材仍归上游/原作者，**仅用于运行本插件**。

**权利主张（takedown）**：如果你认为本仓库或本仓库的改造方式侵犯了你的权利，请开一条 issue 说明**文件/内容**与**依据**，我们会在核实后**立即替换或移除**，不附加其它条件。（这与上游 PROVENANCE 第四节的承诺一致。）

## 五、署名与 AI 协作声明

- 本改造版的作者与维护者：**xr05shino23**（GitHub）。
- 本项目的**实现、文档与自检工具由 AI 助手协作完成**：整个开发过程在 [OpenCode](https://opencode.ai) 中进行，模型为 DeepSeek 系列模型。所有改动均经过人工确认与实测验证（见 `docs/HEALTH-CHECK.md`）。
- 上游作者 MeteorNOX 与本项目无隶属关系；本项目也未获得上游的官方认可或背书。

## 六、商标

"DeepSeek" 是其权利人的商标。本仓库名称与说明中使用该词仅为**指代兼容对象**，不表示任何官方关系或背书。

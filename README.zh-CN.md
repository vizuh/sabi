# Sabi

面向 AI agent 的自适应推理调度。

Sabi 位于编码 harness 与模型提供方之间。harness 保持自己原有的 agent 循环；Sabi 决定每一轮推理由哪个模型、哪一级推理强度（reasoning effort）和哪个提供方来服务——贯穿整条轨迹持续决策，而不只在第一次提示时决定。

[English](README.md) · [Português (BR)](README.pt-BR.md) · **中文**

## 双适配器，一个内核

| | A 类 — 进程内 mod | B 类 — 本地代理 |
|---|---|---|
| 运行形态 | Command Code mod（挂在 harness 循环上的 hook） | `127.0.0.1:8787` 上的 OpenAI 兼容端点 |
| 可决定 | 模型**和**推理强度，来自 Command Code 目录 | 仅模型名，来自你自己的上游 |
| 需要密钥 | 不需要 — 路由你已有的订阅 | 需要 — 你的上游凭据（OpenRouter、Ollama……） |
| 失败信号 | harness 自身的 `isError`（事实来源） | 从工具输出文本推断 |
| 适用对象 | Command Code | 任何只接受 `baseURL` 的 harness |

两者共用 `packages/core` 的路由规则，但信号与行为不同。mod 使用显式的工具错误信号并规划后续轮次；代理从文本推断失败，并可调用 Jev。`harness.tiers` 存放 Command Code 目录 id；`models` 存放上游模型 id。请分别比较两个适配器。

`npm run setup` 会交互式地选择合适的一条 — 见 [Quick setup](docs/install.md#quick-setup)。

## 策略

每一轮都根据轨迹状态分类——轮次位置、工具调用及其结果、失败证据、上下文大小——然后路由：

| 轮次 | 规则 | 层级 |
|---|---|---|
| 工具结果失败 | `failure` | strong |
| 新指令 / 第一轮 | `first-turn` | mid |
| 测试 / 构建 / lint 轮次 | `verification` | mid |
| 编辑轮次 | `implementation` | mid |
| 读取 / 搜索 / 杂务 | `exploration` | cheap |
| 其他一切 | `unclassified` | cheap |

代理把已路由的轮次写入 `.sabi/decisions.jsonl`，并用 `npm run report` 汇总。mod 把决策记录为宿主会话条目，该报告不读取它们。**隐私：** 默认遥测只保存白名单内的证据与哈希后的不透明身份；诊断片段需显式开启。日志请保留在本地，并在开启采集前复核 `telemetry` 设置。

**实测上下文与宿主压缩。** 当客户端标识自己的会话（`x-sabi-session`）时，代理用提供方上一轮实际计费的 token 总量作为上下文估计的下限——实测用量，而非字符数——并把回退到不足上次消息数一半的 transcript 视为宿主压缩。越过边界会推进上下文代次（context generation），使缓存的 Jev 判定无法跨越重写，同时重置连续失败计数：重写之后的失败是新的一次失败，而不是宿主已丢弃那次尝试的延续。压缩仍由宿主负责——两个适配器都不重写 transcript。在 mod 路径上，同样的两个信号来自宿主的 `usage` 和 `state.messages` 的收缩。

**提供方与订阅限额。** 速率限制、会话/用量/配额上限或超时属于传输层状况，不是任务失败：该轮在 transport 层级重试，绝不会升级到更强的模型。措辞决定判定：具名的限额（`rate limit`、`session limit`、`too many requests`）优先于同一条结果中看似报错的行，而裸状态码不可以——一个打印出 429 的失败测试仍会升级。

## 媒体与视觉

媒体是路由约束，不是事后决定的偏好。每个层级都可以声明其模型接受的输入模态（代理上的 `capabilities.inputModalities`，`harness.tiers` 上的 `inputModalities`）。携带图片的轮次绝不会发给只声明文本的层级——它由配置顺序中第一个声明该模态的层级服务，决策记录 `rule: capability`。未声明即未知：什么都不声明的层级永远不会被阻止。

| 层级 | 代理（`models`） | mod（`harness.tiers`） |
|---|---|---|
| cheap | `deepseek/deepseek-v4-flash-0731` — 仅文本 | `deepseek/deepseek-v4-flash` — 仅文本 |
| mid | `openai/gpt-5.6-luna` — 文本、图片、文件 | `gpt-5.6-luna` — 文本、图片 |
| strong | `anthropic/claude-sonnet-5` — 文本、图片、文件 | `zai-org/glm-5.3` — 仅文本 |

当没有任何层级能服务该轮时：

- **自适应别名（`sabi-code`）** — 该轮转到能读取它的层级。已实测：一个携带图片、本计划发给仅文本 cheap 层级的研究轮次，由 `openai/gpt-5.6-luna` 服务（`rule: capability`），而不是在上游以 `404 No endpoints found that support image input` 失败。
- **固定别名（`sabi-cheap`）** — 直接拒绝，返回 `400 incompatible route 'cheap': input modality 'image' is not supported`。基线别名是显式的模型选择，不会静默升级。
- **没有任何层级** — 代理拒绝；在 mod 路径上该轮保留在会话模型上，因为宿主会为仅文本模型剥离图片，路由到那里等于盲目作答。

媒体同样计入上下文估计：每张图片按 1500 token 计费（宿主自己的上限，而不是 base64 长度，后者与图片 token 无关），其他媒体按载荷大小计费，因此带截图的轮次不再对上下文压力规则显得微不足道。`contextChars` 仍只统计文本；`state.inputModalities` 与 `state.mediaCounts` 记录在每一次决策上。

声明的模态必须按模型 id 逐一核实，不能由系列推断：在 OpenRouter 上 `deepseek/deepseek-v4-flash-0731` 仅文本，而 `deepseek/deepseek-v4-flash-vision-exp` 接受图片；在 Command Code 目录中 `gpt-5.6-luna` 接受图片，而 `zai-org/GLM-5.3` 不接受。

## 安装 — Command Code mod（推荐）

要求：Node 22.6+、Command Code、git（本仓库是公开的），以及一个覆盖 `harness.tiers` 中模型的套餐（见 [套餐覆盖范围](#套餐覆盖范围)）。

```bash
git clone https://github.com/vizuh/sabi && cd sabi
npm install                                                    # .npmrc forces dev deps on this host
cmd mods add ./packages/adapters/command-code                  # registers the mod (project scope)
cmd mods list                                                  # → sabi · project · from local:/…/packages/adapters/command-code
```

或者不克隆直接安装同一个 mod —— 它以打包好的 npm 包发布，运行时零依赖（仅 mod；下面的代理路径仍需克隆）：

```bash
cmd mods add -g npm:@vizuh/sabi                                # user scope; update later with `cmd mods update`
```

mod 会在该项目里你的下一次会话加载（第一次会话还会要求你信任该 workspace，这是项目级 mod 的前提）。此后 Sabi 会规划每一个后续轮次；第 1 轮始终运行在会话模型上，因为 `prepareNextTurn` 从第二轮起才触发。

要验证它确实在路由，让它做一次文件读取，并观察轮次之间模型的变化：

```bash
cmd -p "Read package.json and reply with only the value of its name field." \
  --mod ./packages/adapters/command-code/mod/sabi.ts -t --output-format json
```

第 1 轮运行在会话模型上；第 2 轮（读取轮次 → `exploration` → cheap）运行在 cheap 层级。无头 `-p` 运行不加载项目级 mod，因此该验证显式传入 `--mod`。

## 安装 — 本地代理（BYOK / 其他 harness）

```bash
npm install
export OPENROUTER_API_KEY=...    # upstream model credentials
export TYPESAFE_API_KEY=...      # Jev judge (optional; set judge.enabled false to skip)
npm start                        # http://127.0.0.1:8787/v1

npm run connect:command-code     # writes/updates the "sabi" provider in ~/.commandcode/providers.json
cmd --list-models | grep sabi    # verify the four models are visible

npm run connect:opencode         # OpenCode: merges the "sabi" provider into ~/.config/opencode/opencode.json
```

之后在 `/model` 里选择 `sabi/sabi-code`（或 `--model sabi/sabi-code`）。用于对照的固定基线别名：`sabi-cheap`、`sabi-mid`、`sabi-strong`。`sabi-local` 指向 Ollama，默认不暴露——其 32k 窗口对 harness 提示来说太小。其他客户端——OpenCode 与 Hermes，以及它们能得到与得不到什么——见 [docs/install.md](docs/install.md#clients-other-than-command-code)。

Sabi 是前台进程，不是服务：如果不运行，harness 内每个 `sabi/*` 请求都会以 `ECONNREFUSED 127.0.0.1:8787` 失败。在这台机器上，两把密钥都来自工作区的 secrets 文件：

```bash
export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' ../../../secrets/.env | cut -d= -f2-)"
export TYPESAFE_API_KEY="$(grep -E '^typesafe=' ../../../secrets/.env | cut -d= -f2-)"
```

## Sabi 在哪里找到配置

`sabi.config.json` 按顺序查找，命中即止：

1. `$SABI_CONFIG` — 显式路径（设置后只读它）
2. `<cwd>/sabi.config.json` — 项目本地
3. `~/.config/sabi/sabi.config.json` — 按用户（遵循 `XDG_CONFIG_HOME`）
4. 已安装包之上最近的 `sabi.config.json` — 克隆就是这样找到随它一起发布的配置

决策写入 `<cwd>/.sabi/decisions.jsonl`；用 `$SABI_LOG` 覆盖。

## 套餐覆盖范围

`cmd --list-models` 打印**整个目录，与你的套餐无关**——列出过的模型不等于可用的模型。路由到你无法使用的模型会直接让该轮失败：

```
Error: 403 MODEL_NOT_IN_PLAN: Claude Sonnet 5 available in Pro and above plans or extra on demand usage
```

因此 `harness.tiers` 里的每个 id 都必须被你的套餐覆盖。随仓库发布的默认值是 **Go 及以上**套餐可用的最强 id，2026-09-18 实测：

| 层级 | 默认（Go 及以上） | Pro 及以上 | Max |
|---|---|---|---|
| cheap | `deepseek/deepseek-v4-flash` | 相同 | 相同 |
| mid | `gpt-5.6-luna` | `claude-sonnet-5` | `claude-sonnet-5` |
| strong | `zai-org/glm-5.3` | `claude-sonnet-5` | `claude-opus-5` |

Go 及以上套餐中 `strong` 的其他候选：`moonshotai/kimi-k3`、`qwen/qwen3.8-max`、`deepseek/deepseek-v4-pro`。请按你的套餐编辑 `harness.tiers`；`minPlan` 只是文档，不是强制检查。

## 配置

`sabi.config.json` 包含：

- `upstreams` — base URL 与密钥（密钥写成 `$ENV_VAR` 引用，或对 Ollama 这类无密钥端点写 `false`）
- `models` — B 类层级：上游模型 id、上下文窗口、价格
- `aliases` — harness 看到的东西（`sabi-code` = `auto`，加上固定基线）
- `policy` — 规则 → 层级；`off` 禁用某条规则
- `judge` — 端点、模型、阈值、缓存 TTL、状态预算
- `harness.tiers` — A 类层级：Command Code 目录 id、推理强度、`minPlan`

模型 id、上下文窗口与价格于 2026-09-18 对照 OpenRouter API 核实；Jev 的价格（输入 $0.042/Mtok，输出免费）同日来自 TypeSafe 文档；Command Code 目录 id 与强度来自 `cmd --list-models` 与随附的参考文档。这些都会变化——在信任成本计算前请重新核对。

## Jev 判定

**只有代理**会在配置的规则上查询 Jev（TypeSafe 的 System One 模型）。Command Code mod 目前不调用 Jev：

- `failure` 轮次 — "这是真问题，还是预期结果？" 真实问题概率偏低会否决升级（例如：用户明确要求失败的命令）。
- `unclassified` 轮次 — "这一步有多难？"（`trivial` / `standard` / `demanding` → cheap / mid / strong），前提是置信度越过阈值。

一次批量 TypeSafe 请求覆盖全部三个问题，使用最后一条指令与最后一个工具结果的摘录加上轮次元数据，而不是整段对话。第三个问题**仅用于影子模式**：它为"最后一个工具结果对下一步是否冗余"打分，答案记录在决策上（`judge.evidenceRedundant`）并由 `npm run report` 统计——不会丢弃或重写任何内容，不改变任何路由，在真实流量上测过之前都视为未验证。当前 6k 字符的状态目标并非所有字段的严格序列化大小保证。判定会被缓存，每次约 $0.00003，并且是 **fail-open**：任何错误或超时都回退到确定性策略。用 `judge.enabled: false` 关闭。

## 验证

```bash
npm test        # core, proxy, adapter-profile and eval tests
npm run typecheck
npm run report  # decisions, tokens, cost, savings vs an all-strong counterfactual, judge stats,
                # a `discover` block (vetoes and the cost they avoided, blind spots, dead rules),
                # and the shadow evidence-redundancy count — measured, never applied
```

## 结构

```
packages/core                    trajectory state, policy, judge application, router, config discovery, decision log
packages/server                  OpenAI-compatible proxy (SSE passthrough + tap), TypeSafe client, /v1/models, report
packages/adapters/command-code   the in-process mod (mod/sabi.ts) + the BYOK provider writer (src/connect.ts)
packages/adapters/opencode       OpenCode config writer (npm run connect:opencode)
packages/adapters/hermes         opt-in metadata bridge and isolated compatibility probe
packages/adapters/prime-agent   private isolated proxy/timing probe; no native adapter
```

`npm run mod` 从 checkout 加载 mod。代理在转发前使用一次共享的有效信封（effective envelope）检查，为合适的上游加上 `stream_options.include_usage`，把响应里的 `model` 字段改写回合成别名，在 SSE 流上采集用量，并按上文所述的隐私限度记录决策。Jev 调用发生在转发之前，并记录在决策上（`judge.status`、概率、是否覆盖、延迟、token 成本）。

Hermes、Prime Agent、OpenCode 与 Kilo 的兼容性说明与隔离探针见 [docs/harnesses.md](docs/harnesses.md)。在证明同轨迹行为之前，原生逐轮 hook 仍然关闭。未来工作包括学习到的模型画像与配额感知。

## 先行工作

[docs/research/github-landscape.md](docs/research/github-landscape.md) — 对最接近项目的经验证调研（2026-09-18）与 Sabi 针对的空白。

## 命名

产品名：**Sabi**。GitHub 上的 `sabi`、`uasabi`、`sabido` 都已被占用，因此仓库位于 Vizuh 命名空间下：https://github.com/vizuh/sabi（公开）。与 Sabido（Vizuh 另一个学习产品）无关。

## 文档

- [Command Code roadmap](docs/research/command-code-roadmap.md) — 提议的上下文/工具路由与验收标准
- [Folder review](docs/research/folder-review.md) — 源码发现与可直接发布的 issue 评论
- [Prime Agent reuse](docs/research/prime-agent-reuse.md) — 已安装证据与值得借鉴的模式
- [RTK learnings](docs/research/rtk-learnings.md) — 一个上下文压缩器教给路由器的东西：声明纪律、discover 视图，以及看穿重写前缀
- [docs/install.md](docs/install.md) — 在别人机器上逐步安装（英文）
- [docs/context.md](docs/context.md) — 背景、约束、风险
- [docs/decisions.md](docs/decisions.md) — 持续记录的决策
- [docs/handoff.md](docs/handoff.md) — 当前状态与下一步
- [log.md](log.md) — 变更历史

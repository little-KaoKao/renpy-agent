# Ren'Py Agent

[![CI](https://github.com/little-KaoKao/renpy-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/little-KaoKao/renpy-agent/actions/workflows/ci.yml)

从一段灵感(文字 / 图)自动产出可玩 galgame 的 agent 流水线。

这里只讲 clone 之后怎么跑起来。

---

## 你会得到什么

- 本仓库 = **agent 系统源码**(Planner + 7 位 POC executer + schema + workflows)
- Ren'Py SDK **不在仓库里**,按 [.renpy-version](.renpy-version) 自动下载 —— Windows 用 [scripts/setup-renpy.ps1](scripts/setup-renpy.ps1),macOS/Linux 用 [scripts/setup-renpy.sh](scripts/setup-renpy.sh)
- 游戏工程是**运行时产物**,生成到 `runtime/games/<story-name>/`,不入 git

---

## Quickstart(Windows)

前置:PowerShell 7+、Node.js 20+、git、~1GB 磁盘。

```powershell
# 1. 克隆
git clone https://github.com/little-KaoKao/renpy-agent.git
cd renpy-agent

# 2. 自动拉 Ren'Py SDK(~500MB,脚本幂等)
pwsh scripts/setup-renpy.ps1

# 3. 装依赖 + 配 key
pnpm install
cp .env.example .env
#    用编辑器打开 .env 填入 AWS Bedrock 三件套
#    (CLAUDE_CODE_USE_BEDROCK=1 / AWS_REGION / AWS_BEARER_TOKEN_BEDROCK)
#    和 RUNNINGHUB_API_KEY(v0.3+ 资产生成用到)
#    或 ANTHROPIC_API_KEY(直连模式)

# 4. 验证环境:跑手工 demo,应当出现 8 镜头占位画面
renpy-sdk/renpy.exe docs/examples/baiying-demo

# 5. 构建 agent 代码
pnpm build

# 6a. v0.7 推荐路径:V5 Planner/Executer(真资产 + prompt cache,成本 ~$2)
node --env-file=.env dist/cli.js v5 --story sakura-night "一个关于樱花树下告白的故事"

# 6b. 老路径:v0.2 minimal pipeline(Planner → Writer → Storyboarder → Coder → QA)
node --env-file=.env dist/cli.js --name sakura-night "一个关于樱花树下告白的故事"

# 7. 玩 agent 产物
renpy-sdk/renpy.exe runtime/games/sakura-night/game
```

### 升 Ren'Py 版本

改 [.renpy-version](.renpy-version) 的版本号 → 重跑 `pwsh scripts/setup-renpy.ps1` → junction 自动指到新 SDK,其他代码不动。

---

## Quickstart(macOS / Linux)

前置:bash、curl 或 wget、tar、Node.js 20+、pnpm、~1GB 磁盘。

```bash
# 1. 克隆
git clone https://github.com/little-KaoKao/renpy-agent.git
cd renpy-agent

# 2. 自动拉 Ren'Py SDK(~500MB,脚本幂等;下载 .tar.bz2 + 解压 + 建 symlink)
bash scripts/setup-renpy.sh

# 3. 装依赖 + 配 key
pnpm install
cp .env.example .env
#    用编辑器打开 .env 填入 AWS Bedrock 三件套(CLAUDE_CODE_USE_BEDROCK=1 /
#    AWS_REGION / AWS_BEARER_TOKEN_BEDROCK)和 RUNNINGHUB_API_KEY

# 4. 验证环境:跑手工 demo,应当出现 8 镜头占位画面
renpy-sdk/renpy.sh docs/examples/baiying-demo

# 5. 构建 agent 代码
pnpm build

# 6. 喂一段灵感,产出在 runtime/games/<story-name>/game/
node --env-file=.env dist/cli.js --name sakura-night "一个关于樱花树下告白的故事"

# 7. 玩 agent 产物
renpy-sdk/renpy.sh runtime/games/sakura-night/game
```

强制重下 SDK:`bash scripts/setup-renpy.sh --force`。升级版本改 `.renpy-version` 后重跑脚本,symlink 自动指到新 SDK。

---

## 修改已有 story

### V5 Planner 驱动修改(v0.7 推荐)

V5 的 modify 链条让 Planner 读当前 workspace 自己决定改哪几份文档。自然语言表达意图,Planner 算最小改动集(例如"改短发"→ 只重跑 character_designer + registry 回落占位,storyboard/script/rpy 不动):

```powershell
# 前提:先跑过一次 v5 生成
node --env-file=.env dist/cli.js v5-modify sakura-night "把白樱改成短发双马尾"
node --env-file=.env dist/cli.js v5-modify sakura-night "第 3 镜第 0 句改成:别这样看着我"
node --env-file=.env dist/cli.js v5-modify sakura-night "加一个咖啡店店长作为配角"

# 给 modify 加预算闸门(默认无上限):
node --env-file=.env dist/cli.js v5-modify sakura-night "..." --budget-cap 2
```

### v0.4 固定指令式修改(硬编码的 3 条路径)

一次 `generate` 之后,workspace JSON(`runtime/games/<story>/workspace/*.json`)里留了 planner / writer / storyboarder 的快照,可以在**不重跑 LLM** 的前提下改 3 类东西。`--rebuild` 附加动作是从 snapshot 直接重新渲染 `script.rpy` + 跑 QA lint:

```powershell
# 把某个角色的外观改成"短发"(AssetRegistry 中该角色立绘自动回落占位)
node --env-file=.env dist/cli.js modify character sakura-night `
    --name 白樱 --visual "short pink hair, twin braids" --rebuild

# 把 Shot 3 的第 0 句改掉
node --env-file=.env dist/cli.js modify dialogue sakura-night `
    --shot 3 --line 0 --text "别这样看着我。" --rebuild

# 重排镜头顺序(参数是原 shotNumber 的全排列)
node --env-file=.env dist/cli.js modify shots sakura-night `
    --order 3,1,2,4,5,6,7,8 --rebuild

# 纯重渲染(不改 snapshot,比如手改了 workspace JSON 后重建)
node --env-file=.env dist/cli.js rebuild sakura-night
```

> v0.8 会迁走 `modify character/dialogue/shots`(见 `src/pipeline/modify.ts` 的 `@deprecated` 注释)。新项目请用 `v5-modify`。

## RunningHub 真 key smoke

一次性体检 8 个 AppKey(MJ v7 / Nanobanana2 ×2 / Seedance ×2 / Qwen3 TTS ×2 / SunoV5),产物落在 `runtime/smoke/<timestamp>/`。必须先 `pnpm build`,脚本从 `dist/` 导入生产代码。

```powershell
pnpm build

# 全跑 8 条(付费;脚本启动前有 3 秒确认窗口,Ctrl-C 可中止)
node --env-file=.env scripts/runninghub-smoke.mjs

# 只跑子集(依赖缺失会直接报错退出,不自动补齐)
node --env-file=.env scripts/runninghub-smoke.mjs CHARACTER_MAIN_IMAGE SCENE_BACKGROUND
```

**依赖关系**:`CHARACTER_EXPRESSION` / `CUTSCENE_IMAGE_TO_VIDEO` 需要 `SCENE_BACKGROUND` 的产物作输入;`CHARACTER_DYNAMIC_SPRITE` 需要 `CHARACTER_MAIN_IMAGE`。退出码:至少一条 OK → 0,全失败 → 1。

---

## 目录速查

| 路径                         | 是什么                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| [src/](src/)                 | 全部 TS 源码;按 schema / pipeline / agents / llm / executers / assets 分层 |
| [src/pipeline/](src/pipeline/) | v0.2 minimal pipeline:Planner → Writer → Storyboarder → Coder → QA |
| [src/llm/](src/llm/)         | LlmClient 抽象 + ClaudeLlmClient                              |
| [src/cli.ts](src/cli.ts)     | `renpy-agent` CLI 入口                                        |
| [resources/](resources/)     | 分镜师 skill 等 agent 侧资源                                  |
| [scripts/](scripts/)         | `setup-renpy.ps1` / `runninghub-smoke.mjs` / `copy-templates.mjs` |
| [docs/](docs/)               | 架构文档 + `examples/baiying-demo` 手工参考                   |
| `renpy-sdk/`(本地生成)     | junction → `renpy-*-sdk/`,统一入口 `renpy-sdk/renpy.exe`     |
| `runtime/`(本地生成)       | agent 运行产物(每游戏独立 workspace + 记忆 + 日志)          |

---

## 资产生成后端

走 [RunningHub](https://www.runninghub.cn/) 一个 API key,同时供图 / 视频 / 音频模型。8 个 AppKey 的 schema 登记在 [src/executers/common/runninghub-schemas.ts](src/executers/common/runninghub-schemas.ts)。

---

## 环境变量速查

| 变量 | 必需? | 说明 |
| --- | --- | --- |
| `CLAUDE_CODE_USE_BEDROCK` | 二选一 | `1` = 走 AWS Bedrock(推荐);空/注释 = 走 Anthropic 直连 |
| `AWS_REGION` | Bedrock 必需 | 默认 `us-east-1` |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock 必需 | Bedrock bearer token |
| `ANTHROPIC_API_KEY` | 直连必需 | 只在 `CLAUDE_CODE_USE_BEDROCK` 未开时用 |
| `CLAUDE_MODEL` | 可选 | 覆盖默认模型,Bedrock 下默认 `us.anthropic.claude-sonnet-4-6`(inference profile) |
| `RUNNINGHUB_API_KEY` | 真资产必需 | v0.3+ 图/视频/音频生成;v0.7 的 `v5` 若无此 key 会 fallback 到 DRY_RUN stub |
| `CLAUDE_BEDROCK_CACHE` | 可选 | `0` 关闭 Bedrock prompt cache(默认开)。v0.7 起 system 段已膨胀 > 4096 chars,cache read share 实测 ~72% |
| `CLAUDE_DISABLE_CACHE` | 可选 | `1` 双模式总开关(直连 + Bedrock)全关 cache |

> v0.7 的 `v5` 子命令默认启用 prompt cache,并在 `runtime/games/<story>/logs/v5-smoke-summary-*.json` 里记录 `budgetCapUsd` / `budgetCappedEarly` / `taskAgentTimeouts`。真 key 验收脚本 `scripts/v5-real-key-smoke.mjs --budget-cap <usd>` 是官方的 release gate,任何 merge 前都应确认它干净跑通。

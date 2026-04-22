# Ren'Py Agent

从一段灵感(文字 / 图)自动产出可玩 galgame 的 agent 流水线。

**设计要点**见 [PLAN.md](PLAN.md)。这里只讲 clone 之后怎么跑起来。

---

## 你会得到什么

- 本仓库 = **agent 系统源码**(Planner + 7 位 POC executer + schema + workflows)
- Ren'Py SDK **不在仓库里**,由 [scripts/setup-renpy.ps1](scripts/setup-renpy.ps1) 按 [.renpy-version](.renpy-version) 自动下载
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
#    用编辑器打开 .env 填入 ANTHROPIC_API_KEY(v0.2 必需)和
#    RUNNINGHUB_API_KEY(v0.3 开始用到)

# 4. 验证环境:跑手工 demo,应当出现 8 镜头占位画面
renpy-sdk/renpy.exe docs/examples/baiying-demo

# 5. 构建 agent 代码
pnpm build

# 6. 喂一段灵感,产出在 runtime/games/<story-name>/game/
node --env-file=.env dist/cli.js --name sakura-night "一个关于樱花树下告白的故事"

# 7. 玩 agent 产物
renpy-sdk/renpy.exe runtime/games/sakura-night/game
```

### 升 Ren'Py 版本

改 [.renpy-version](.renpy-version) 的版本号 → 重跑 `pwsh scripts/setup-renpy.ps1` → junction 自动指到新 SDK,其他代码不动。

---

## 目录速查

| 路径                         | 是什么                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| [PLAN.md](PLAN.md)           | 架构 / 决策 / 路线图(**读这个**)                            |
| [src/](src/)                 | 全部 TS 源码;按 schema / workflows / pipeline / llm / executers / planner 分层 |
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

走 [RunningHub](https://www.runninghub.cn/) 一个 API key,同时供图 / 视频模型。模型与 POC 的绑定见 [PLAN.md §3.5](PLAN.md)。

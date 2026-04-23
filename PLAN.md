# Agentic Galgame 项目计划

> 最后更新:2026-04-23
> 当前阶段:v0.2 minimal pipeline + v0.3a/b/c 骨架全部落地;Coder 支持 AssetRegistry 真资产绑定;角色/场景设计师主干接通 RunningHub(真 webappId 待控制台核对);分镜师视频路径骨架就位(`renpy.movie_cutscene` + 视频 executer 占位);v0.4 修改闭环三个典型场景编程接口就位(story workspace 持久化 + modifyCharacterAppearance / modifyDialogueLine / reorderShots);v0.5 员工扩招骨架落地(音乐总监 / 配音导演 / 音效设计师 / UI 设计师 = 4 位 POC,BgmTrack/VoiceLine/Sfx/UiDesign 4 文档,RunningHub schema 刷新到 api-448183xxx 系列 + 新增 VOICE_LINE/SFX)

---

## 1. 目标

打造一条 **"灵感 → 可玩 galgame"** 的全自动 agent 流水线。用户喂一段故事灵感(一句话、一段大纲、一张图都行),系统自动产出:

- 一份**可跑的 Ren'Py 项目**(`.rpy` + 资产)
- **支持迭代修改**(改角色、改剧情、改演出、改结局都不需要从头重来)
- **长程协作不丢上下文**(多小时、多章节、多路线)

---

## 2. 核心原则(不可撼动)

### 2.1 Placeholder-first 两阶段交付

- **Stage A**:编码师立刻产出**能跑的 `.rpy`**,所有真资产缺失处用 `Solid()` / `Transform(Solid,...)` / `SnowBlossom(占位粒子)` 填占位。这是合法终端状态,不是半成品。
- **Stage B**:真资产异步 ready 后,用 `swap_asset_placeholder` 原地替换,不碰对白/演出。
- **为什么是核心原则**:Ren'Py 对代码/资产解耦非常友好,让 galgame agent 比视频 pipeline 更容易做到"永远可运行",极大降低中途失败的心理成本。可行性已由 [docs/examples/baiying-demo/game/script.rpy](docs/examples/baiying-demo/game/script.rpy) 的 8 镜头占位 demo 验证。

### 2.2 Planner + Executer 拆分(V5 核心)

- **Planner**:读 TS schema + workflow + tool 签名作为 system prompt,产出 `Plan`(可执行伪代码),不直接干活。
- **Executer**:统一 prompt 模板(V5 的 7 条规则),**差异化全部通过 tool-set 实现**,不为每位 POC 写不同 prompt。
- **为什么**:V4 的 hard-coded workflow-hook 在 galgame 场景会炸 —— 多角色 / 多章节 / 多路线 / 条件分支 / 存档点的边界条件无法用代码穷举。让 Planner LLM 读 schema 做规划。

### 2.3 TypeScript-as-prompt

- Workspace 数据模型用 TS interface 定义,字段上带 `dependencies` 声明级联触发关系。
- TS 文件直接塞进 Planner 的 system prompt —— LLM 读 TS 比读自然语言文档更准。

### 2.4 URI 懒加载 + 记忆压缩

- Planner 默认只看到 workspace 的 **URI + title + status**,详情靠 `read_from_uri` 按需拉取。
- 每个 task 完成后 Planner 调 `output_with_finish(taskSummary)`,写入 `planner_memories` 表,后续轮次扔掉原始消息。
- **为什么是刚需**:galgame 项目是**长程**的(多小时、多章节),上下文不压缩立刻爆炸。

---

## 3. 仓库目录层级

**核心视角**:本仓库 = agent 系统源码。游戏项目是 agent 运行产物,SDK 是用户侧依赖,都不入 git。

### 3.1 进 git 的内容(agent 仓源码)

```
<repo-root>/                    # 本仓库根;开发机上就是 E:\RenPy\
├── PLAN.md                     # 本文件
├── README.md                   # 新开发者 quickstart
├── package.json                # pnpm 管理;scripts: build / typecheck
├── tsconfig.json               # strict / ES2022 / Node16
├── pnpm-lock.yaml              # 锁定依赖(共享 store 在 D:\pnpm-store)
├── .renpy-version              # 钉住 SDK 版本号(纯文本:"8.3.4")
├── .gitignore                  # 忽略 renpy-*-sdk/, renpy-sdk, runtime/, .env, dist/
├── .env.example                # API key 占位模板;真 .env 不入 git
│
├── scripts/
│   └── setup-renpy.ps1         # 幂等:无 SDK 则下载解压 + 建 junction
│
├── src/                        # 所有 TS 源码(编译后落在 dist/,不入 git)
│   ├── index.ts                # barrel,re-export 全部公开类型
│   ├── cli.ts                  # `renpy-agent` CLI 入口(v0.2 起)
│   ├── schema/
│   │   └── galgame-workspace.ts    # 15 文档 TS schema
│   ├── workflows/
│   │   └── galgame-workflows.ts    # 7 POC 的 tool-set 类型契约
│   ├── planner/
│   │   └── index.ts                # PlannerTools 类型契约
│   ├── llm/                    # LlmClient 抽象 + ClaudeLlmClient(v0.2)
│   ├── pipeline/               # 单次 POC 串行编排(v0.2):planner/writer/storyboarder/coder/qa/run-pipeline
│   ├── templates/              # 静态 .rpy 模板(gui/screens/options,构建时拷贝到 dist/)
│   └── executers/              # V5 Executer 实现(尚未接线,v0.3+ 用)
│       ├── common/                 # runninghub-client 等跨 POC 共享模块
│       ├── producer/
│       ├── writer/
│       ├── storyboarder/
│       ├── character-designer/
│       ├── scene-designer/
│       ├── coder/
│       └── qa/
├── resources/
│   └── renpy-storyboard/       # 分镜师 skill 的正式家
└── docs/
    ├── superpowers/            # 设计 spec + 实施 plan(与本 PLAN.md 配合)
    └── examples/
        └── baiying-demo/       # 手工占位优先 demo(Stage A 可行性 fixture)
            ├── game/           # Ren'Py 标准结构:script.rpy / gui.rpy / ...
            └── storyboard_baiying_ch1.md
```

### 3.2 不进 git 的内容(本机生成/外部依赖)

```
<repo-root>/
├── renpy-8.3.4-sdk/            # setup-renpy.ps1 下载的 SDK 实体
├── renpy-sdk       ──(junction)──▶ renpy-8.3.4-sdk/   # 稳定入口
├── runtime/                    # 每项目隔离的 workspace / 记忆 / 日志
│   └── games/
│       └── <story-name>/       # agent 产出的 Ren'Py 项目,每项目独立
│           ├── game/           # 可直接 renpy.exe 跑的 Ren'Py 产物
│           ├── workspace.sqlite   # 该项目的 workspace 文档库
│           ├── planner_memories/  # 该项目的 Planner 记忆
│           └── logs/
├── .env                        # API keys(RUNNINGHUB_API_KEY、LLM key);开发者手动填,严禁提交
└── .claude/                    # Claude Code 本地配置(开发者各自管)
    └── skills/
        └── renpy-storyboard  ──(junction)──▶ resources/renpy-storyboard/
```

### 3.3 新开发者 clone 后的流程

1. `git clone <repo>` → 得到上面 3.1 的内容
2. `pwsh scripts/setup-renpy.ps1` → 自动下载 SDK 到 `renpy-8.3.4-sdk/` 并建 junction
3. `pnpm install` 装 TS 依赖、`cp .env.example .env` 后填入 `RUNNINGHUB_API_KEY` 和 LLM key
4. 验证环境:`renpy-sdk/renpy.exe docs/examples/baiying-demo` 应当跑出 8 镜头占位 demo
5. 跑 agent:喂一段灵感,产出落在 `runtime/games/<story-name>/game/`
6. 玩产物:`renpy-sdk/renpy.exe runtime/games/<story-name>/game`

### 3.4 关键决策

| 决策              | 选择                                                                         | 原因                                                                           |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 仓库根            | agent 仓直接作为 repo root(不再套外层目录)                                   | 避免"一个外壳目录装 SDK + agent + 产物"的奇怪结构,clone 后语义直观             |
| SDK 分发          | 脚本按 `.renpy-version` 拉取到 `renpy-*-sdk/`,junction 到 `renpy-sdk/` | 不能 pip(SDK ~500MB + C 扩展 + 自带 Python);不用 submodule / LFS 避免 git 负担 |
| SDK 入口          | 统一走 `renpy-sdk/renpy.exe`                                               | 升版只改 junction 和 `.renpy-version`,agent 代码不变                         |
| storyboard skill  | 放 `resources/`,junction 到 `.claude/skills/`                            | Claude Code 照常发现,agent 系统也能 import                                     |
| 游戏产出路径      | `runtime/games/<name>/`,不入 git                                           | 产物 ≠ 源码;想永久保存就让开发者自己 cp 出去另开仓                            |
| 多项目隔离        | 每游戏独立 `workspace.sqlite` + `planner_memories/` + `logs/`          | Planner 记忆全局共享会让项目 A 污染项目 B;按目录隔离最简单也最不易错           |
| baiying-demo 定位 | `docs/examples/`,作 fixture/回归基准                                       | 它不是 agent 产出,是手工证据;也用来 smoke-test 新开发者的 SDK 安装             |
| Ren'Py launcher   | 不依赖                                                                       | QA 用命令行 `renpy.exe <game>`,自动化更友好                                  |
| 音频              | v1 范围外                                                                    | 生成后端未定,手工导入即可                                                      |

### 3.5 资产生成后端(RunningHub)

**后端统一走 [RunningHub](https://www.runninghub.cn/) 的 API**,一个 key 管所有图/视频生成。`RUNNINGHUB_API_KEY` 放在仓库根 `.env`,绝对不进 git。

所有 POC 的图 / 视频调用都走 [src/executers/common/runninghub-client.ts](src/executers/common/runninghub-client.ts)(目前只是 interface 契约,运行时实现待 v0.3),不各自散写 HTTP。

| POC        | 资产类型                    | 首选模型                                              | 备选 / 特殊用途                                              |
| ---------- | --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| 角色设计师 | 角色立绘主图                | `悠船文生图-niji7`(api-448183249)                   | `全能图片V2-文生图-官方稳定版`(api-448183260)做风格兜底   |
| 角色设计师 | 表情差分                    | `全能图片V2-图生图-官方稳定版`(api-448183224)        | 吃角色立绘主图 + 情绪 hint,产同角色差分                     |
| 角色设计师 | 动态立绘(呼吸/眨眼/发丝)    | `seedance2.0/多模态视频`(api-448183127)              | 吃角色立绘主图 + 动作描述,产短循环视频                      |
| 场景设计师 | 背景 / 道具静态图           | `全能图片V2-文生图-官方稳定版`(api-448183260)        | `悠船文生图-niji7`(api-448183249)做二选一                  |
| 分镜师     | 片头 / 片尾 / 章节过场 CG   | `seedance2.0/图生视频`(api-448183116)                | 吃场景设计师产出的"首帧"图 URI                               |
| 分镜师     | 关键剧情 CG(吻戏/战斗/死亡) | `seedance2.0/多模态视频`(api-448183127)              | 吃角色 + 场景参考图 URI,保证人物一致性                       |
| 音乐总监   | BGM 主题 / 章节 / 路线      | `suno`(文档待接入,API 不走 RunningHub,另封 client) | 按 chapterUri / routeUri / sceneUri 差异化                   |
| 配音导演   | 对白配音                    | `minimax/speech-2.8-hd`(api-448183268)               | 吃 Script.lines + Character.voiceTag,每句一条 VoiceLine     |
| 音效设计师 | 环境音 / 动作音             | `minimax/speech-2.8-hd`(api-448183268,复用)        | 短音效 / 环境音,按 Shot + cue 触发;后续可换独立 TTA         |

**POC 间的参考图流转**:分镜师调视频模型时**不自产首帧/参考图**,而是把场景设计师的 `sceneUri` 和角色设计师的 `characterUri`(主图)作为参数传入。URI 引用保证 Cutscene 文档不拷贝资产,角色或场景变更后通过 Stage B 原地替换即可。

**接入姿态**:

- "占位 → 真资产"两阶段不变:Stage A 同步返任务 ticket + placeholder uri,Stage B 轮询 RunningHub 产物回写。
- 视频产物按 Ren'Py `Movie()` / `show movie` 接入;静态图按 `image` + `Transform`。

### 3.6 Runtime 多项目边界

并发开多个游戏时,每个项目的状态必须隔离,不能串:

- **workspace 文档**:每游戏独立 `runtime/games/<story-name>/workspace.sqlite`
- **Planner 记忆**:每游戏独立 `runtime/games/<story-name>/planner_memories/`
- **日志**:每游戏独立 `runtime/games/<story-name>/logs/`
- **全局共享**(少量):RunningHub 任务池(按 `task_id` 索引,不受项目影响)、SDK 本身

**为什么**:Planner 记忆若全局共享,项目 A 的"白樱是女主"会污染项目 B 的规划。按目录隔离比在表里加 `project_id` 列更粗暴但更不易错。

---

## 4. 架构总览

```
┌──────────────────────────────────────────────┐
│ Planner Agent(读 TS schema,产 Plan)         │
│   tools: output_with_plan                     │
│          output_with_finish(taskSummary)      │
│          read_from_uri                        │
└──────────────────┬───────────────────────────┘
                   │ Plan(TS 伪代码)
                   ▼
┌──────────────────────────────────────────────┐
│ Executer(统一 prompt,7 条规则)              │
│   common tools:                               │
│     active_workflow / handoff_to_agent        │
│     check_workflow_params                     │
│     call_task_agent                           │
│     get_workflow_guide                        │
└──────────────────┬───────────────────────────┘
                   │ handoff_to_agent
                   ▼
┌──────────────────────────────────────────────┐
│ 7 位 POC(身份靠 tool-set 区分)              │
│   制作人 / 编剧 / 分镜师 / 角色设计师         │
│   场景设计师 / Ren'Py 编码师 / QA 测试员     │
└──────────────────────────────────────────────┘
```

### 4.1 Common Tools 术语(沿用 HOGI V5 命名)

| 工具                      | 干什么                                                                 |
| ------------------------- | ---------------------------------------------------------------------- |
| `output_with_plan`      | Planner 产出 Plan(TS 伪代码),主循环转入 Executer                       |
| `output_with_finish`    | 当前 task 收尾,写一句 taskSummary 到 `planner_memories`,丢掉原始消息 |
| `read_from_uri`         | 按 URI 拉取 workspace 文档详情(懒加载)                                 |
| `active_workflow`       | Executer 激活某个 workflow(如"角色创建流程"),拉取对应 tool-set         |
| `handoff_to_agent`      | 切身份:把当前 Executer 切成某位 POC(换 tool-set,不换 prompt)           |
| `check_workflow_params` | 校验当前上下文是否满足 workflow 所需参数                               |
| `call_task_agent`       | 调用一次性 task agent(如"角色生图词扩写助理"、"角色主图生成助理")      |
| `get_workflow_guide`    | 读取 workflow 的 guide 文档(场景切换、异常恢复等提示)                  |

`call_task_agent` 的那些"xx 助理"是 HOGI 既有的 task agent(小模型 + 专用 prompt),通过该 tool 复用,**不在本仓库 7 位 POC 名册里**。

---

## 5. Agent 员工名册(11 位 POC)

| #  | 角色            | 拥有的文档                                                 | 核心职责                                                                                                                                                             |
| -- | --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | 制作人          | Inspiration(用户入口) / Project / Chapter / Route / Ending | 项目定位、章节骨架、路线/结局总表                                                                                                                                    |
| 2  | 编剧            | Script(章节级对白)                                         | Chapter outline → 可朗读的场次剧本                                                                                                                                  |
| 3  | 分镜师          | Storyboard(Shot[]) / Cutscene(视频镜头)                    | Script → 镜头级演出方案;识别需要视频的镜头(过场 CG / 关键剧情 CG),调 RunningHub 视频模型,调用 [resources/renpy-storyboard](resources/renpy-storyboard/SKILL.md) |
| 4  | 角色设计师      | Character(外观 + 立绘 + 差分 + 可选动态立绘)               | 角色立绘主图 + 表情/动作差分,动态立绘(视频循环)可选,支持占位                                                                                                     |
| 5  | 场景/道具设计师 | Scene / Prop                                               | 背景图、道具图,含时段/光照变体                                                                                                                                       |
| 6  | 音乐总监        | BgmTrack                                                   | 章节 / 路线 / 场景级 BGM;走 suno 生成,占位→真音替换与视觉资产同一套 AssetRegistry                                                                                   |
| 7  | 配音导演        | VoiceLine                                                  | 按 Script (sceneNumber,lineIndex) 逐句配音;voiceTag 继承 Character,支持回忆/破防等场合临时覆写;走 RunningHub `minimax/speech-2.8-hd`                             |
| 8  | 音效设计师      | Sfx                                                        | 门响 / 脚步 / 心跳 / 雨声等环境音与动作音,按 Shot + cue(enter/action/exit/ambient) 触发;后端暂复用 `minimax/speech-2.8-hd`,后续换独立 TTA                        |
| 9  | UI 设计师       | UiDesign                                                   | 存档 / 读档 / 对白栏 / 路线分支 / CG 鉴赏 / BGM 鉴赏界面的 `screens.rpy` 补丁与视觉 mood                                                                            |
| 10 | Ren'Py 编码师   | RpyFile / AssetRegistry                                    | Storyboard + Cutscene + Bgm/Voice/Sfx/UI → 能跑的 .rpy;AssetRegistry 跟踪占位 ↔ 真资产映射                                                                          |
| 11 | QA 测试员       | TestRun / BugReport                                        | 跑游戏、抓 bug、定位,产出 BugReport;**不直接改 .rpy**,只 `kick_back_to_coder`                                                                                  |

**关键设计选择**:

- Planner **不是员工**,是所有员工头顶的调度大脑。"游戏策划"被拆成 Planner(大脑) + 制作人(POC)。
- `renpy-storyboard` skill 是**分镜师的工具/参考**,不是独立 agent。
- **QA 不能写 .rpy**,只能 `kick_back_to_coder` —— 真工作室分工,避免单一事实来源碎掉。
- 角色 / 场景设计师都内建**占位优先**:同步返回 Solid 占位 uri,异步排真生成。
- **视频类资产**(片头/片尾/章节过场 CG、关键剧情 CG)由**分镜师**统一 own(Cutscene 文档),参考图从角色/场景设计师的 URI 拉取;动态立绘归**角色设计师**(Character 文档扩展字段)。详见 §3.5。
- **音频资产**(BGM / 对白 / SFX)v0.5 起纳入生成管线,三位 POC 各管一类:BGM 走 suno(独立 client),对白/SFX 走 RunningHub TTS。占位阶段 Ren'Py 端可直接 `play music/voice/sound <占位 ogg>` 或整段省略,Stage B 原地替换。
- **UI 设计师**归属于 v0.5 扩员;v0.2~v0.4 产出的 .rpy 先用 Ren'Py 默认 `screens.rpy`,UI 设计师在后续版本开始生成替换补丁。

---

## 6. 关键数据模型(草拟 19 文档)

| 文档          | 归属 POC         | 关键 `dependencies`                                                              |
| ------------- | ---------------- | -------------------------------------------------------------------------------- |
| Inspiration   | 制作人(用户入口) | —                                                                               |
| Project       | 制作人           | inspirationUri                                                                   |
| Chapter       | 制作人           | projectUri                                                                       |
| Route         | 制作人           | projectUri                                                                       |
| Ending        | 制作人           | routeUri                                                                         |
| Script        | 编剧             | chapterUri, [characterUri.voiceTag]                                              |
| Character     | 角色设计师       | —(动态立绘依赖自身 mainImageUri)                                                |
| Scene         | 场景设计师       | —                                                                               |
| Prop          | 场景设计师       | sceneUri(可选)                                                                   |
| Storyboard    | 分镜师           | scriptUri, [characterUri], [sceneUri]                                            |
| Cutscene      | 分镜师           | storyboardUri, [characterUri], [sceneUri]                                        |
| BgmTrack      | 音乐总监         | projectUri, (chapterUri \| routeUri \| sceneUri)                                 |
| VoiceLine     | 配音导演         | scriptUri, characterUri                                                          |
| Sfx           | 音效设计师       | storyboardUri, sceneUri?                                                         |
| UiDesign      | UI 设计师        | projectUri                                                                       |
| RpyFile       | 编码师           | storyboardUri, [cutsceneUri], assetRegistryUri, [bgmTrackUri/voiceLineUri/sfxUri/uiDesignUri] |
| AssetRegistry | 编码师           | rpyFileUri                                                                       |
| TestRun       | QA               | rpyFileUri                                                                       |
| BugReport     | QA               | testRunUri                                                                       |

**`dependencies` 的要害**:所有跨文档引用用 **URI 引用**,不复制数据。
比如 Storyboard 引用 `characterUri`,不引用 `character.mainImageUri` —— **角色立绘换了,分镜无感,`.rpy` 也无感**。这正是"改短发"场景不需要重跑剧本/分镜/代码的根据。

**AssetRegistry 的角色**:Stage A / Stage B 切换的账本,记录每个 `placeholderId` 当前对应的真资产 URI(或 null = 仍在占位)。Stage B 的 `swap_asset_placeholder` 只改这张表,`.rpy` 不动。

---

## 7. 两阶段交付详解

### Stage A:骨架 demo(目标分钟级可跑)

1. Planner 下发 Plan
2. 制作人 → 编剧 → 分镜师 → 编码师串行产出
3. 角色/场景设计师只产**占位 uri**(同步返回),真资产生成任务排进 RunningHub 队列
4. QA 跑一遍确认语法/资源 ok
5. **交付**:能跑的 `.rpy`,画面是深蓝夜色 + 粉色方块樱花 + 立绘占位(参考 [docs/examples/baiying-demo/](docs/examples/baiying-demo/))

**关于"分钟级"**:4 个 LLM POC 串行 + 编码师生成 .rpy,现实时长以**分钟**为单位(不是秒)。首版建议范围限定在"单章节前 N 镜头",而不是整项目一次到位,以便快速闭环验证。

### Stage B:真资产注入(异步、可多轮)

1. RunningHub 任务完成 → 角色/场景设计师 / 分镜师收事件,回写资产 URI 到对应文档
2. Planner 产出**最小 Plan**:只 call 编码师的 `swap_asset_placeholder`(改 AssetRegistry)
3. Storyboard / Script / Character / Cutscene 文档**不动**(依赖链保证)
4. **交付**:真资产到位的同一份 `.rpy`

---

## 8. V5 对 galgame 的决定性优势(修改场景)

用户说"把女主改成短发":

```typescript
async function plan() {
  await commonTools.handoff_to_agent("角色设计师");
  await characterDesignerTools.create_or_update_role({
    uri: "hogi://role/baiying",
    roleDescription: "...短发...",
    roleMainImageGeneratePrompt: null,  // 依赖链级联重生
    roleMainImageUri: null
  });
  await commonTools.call_task_agent("角色生图词扩写助理", ...);
  await commonTools.call_task_agent("角色主图生成助理", ...);
  // 不碰 storyboard / .rpy,URI 引用保证自动生效
  await commonTools.get_workflow_guide("白樱立绘已重生");
}
```

**说明**:

- `hogi://` 是 HOGI 平台的 URI scheme,本项目沿用。若将来独立部署,可改成 `workspace://`,内部语义不变。
- `"角色生图词扩写助理"`、`"角色主图生成助理"` 是 HOGI 既有的 task agent(见 §4.1),通过 `call_task_agent` 复用,**不是本仓库 7 位 POC 之一**。

这种跨文档推理由 Planner 读 schema 的 `dependencies` 字段直接算出来,**不需要代码 Hook 枚举**。V4 做不到,V5 做到了,所以我们必须用 V5。

---

## 9. 遗留决策 / 待验证项

- [ ] `script.rpy` 的 `show layer master at heart_pulse` 是否需要 `config.gl2 = True`(用户未反馈 demo 运行结果)
- [ ] `renpy.input` 默认值里的中文标点 Ren'Py 8.x 兼容性
- [ ] Planner 选型:沿用 HOGI 的 Gemini 2.5/3.0(依赖 thinking signature),还是切 Claude/GPT?暂定 Gemini。
- [ ] RunningHub 各模型的**实测产出质量/单价/限流**:目前只定"用哪几个",首选/备选的取舍等真跑过再拍板。
- [ ] RunningHub OpenAPI 的真实 `webappId` 与输入节点 ID / fieldName:smoke test 只验到握手层,跑图还需登录 RunningHub 控制台看每个 AI-App 的"API 调用"面板核对。
- [ ] 音频生成(BGM / SFX / 语音):v1 范围外。
- [ ] galgame 标配 UI(存档点、多路线合流、CG 鉴赏、BGM 鉴赏):v2 范围。
- [ ] 本仓库何时 `git init` + 首次 push 到 GitHub(当前还是本地工作区)。

---

## 10. 路线图

### v0.1 架构打底(当前)

- [X] 方案 F 成型(架构文档、员工表)
- [X] 占位优先 demo 验证([docs/examples/baiying-demo/game/script.rpy](docs/examples/baiying-demo/game/script.rpy))
- [X] 目录层级就位(agent 仓即 repo root,SDK/runtime/.claude 不入 git)
- [X] [src/workflows/galgame-workflows.ts](src/workflows/galgame-workflows.ts):7 位 POC 的 tool-set 类型契约
- [X] [src/schema/galgame-workspace.ts](src/schema/galgame-workspace.ts):15 文档的 TS schema + `dependencies`
- [X] [src/executers/common/runninghub-client.ts](src/executers/common/runninghub-client.ts) 接口契约(submit/poll)
- [X] [src/planner/index.ts](src/planner/index.ts) + [src/index.ts](src/index.ts) barrel
- [X] `package.json` / `tsconfig.json` / `pnpm-lock.yaml`,`pnpm typecheck` + `pnpm build` 通过
- [X] `README.md` + `.gitignore` + `.env.example` + `git init` + push 到 GitHub
- [X] RunningHub 最小 smoke test(文生图握手)—— [scripts/runninghub-smoke.mjs](scripts/runninghub-smoke.mjs) 实测通路:真 key → `code=1 webapp not exists`(认证通过,卡参数),假 key → `code=301 user not exist`,认证 + JSON 通路均 OK。真实 `webappId` 仍需登录 RunningHub 控制台核对,留到 v0.3 封 client 时细化

### v0.2 最小闭环(代码已落地,未跑过端到端真实 API)

- [X] [src/llm/claude-client.ts](src/llm/claude-client.ts):LlmClient 抽象 + `ClaudeLlmClient`(`@anthropic-ai/sdk`,model=`claude-sonnet-4-6`)
- [X] [src/pipeline/planner.ts](src/pipeline/planner.ts):吃灵感 → 产 PlannerOutput(system prompt 内嵌 15 文档 schema)
- [X] [src/pipeline/writer.ts](src/pipeline/writer.ts):吃 PlannerOutput → 产分场对白
- [X] [src/pipeline/storyboarder.ts](src/pipeline/storyboarder.ts):吃 Writer → 产 ≤8 shots
- [X] [src/pipeline/coder.ts](src/pipeline/coder.ts):deterministic 模板生成 `script.rpy` + `options/gui/screens.rpy`,Solid/Transform 占位
- [X] [src/pipeline/qa.ts](src/pipeline/qa.ts):`renpy.exe <game> lint` 包装,无 SDK 时 `skipped`
- [X] [src/pipeline/run-pipeline.ts](src/pipeline/run-pipeline.ts) + [src/cli.ts](src/cli.ts):串行编排 + `renpy-agent <inspiration>` CLI
- [X] vitest 单元测试 34 个(Coder / QA / CLI / LLM / run-pipeline e2e 用 scripted LLM)
- [ ] **手动验收**:`node --env-file=.env dist/cli.js "一个樱花树下的告白故事"` 真跑一次 Claude → 产物能被 `renpy.exe` 启动 → 8 镜头占位能看到

### v0.3 资产闭环

**v0.3a(当前)——LLM provider + 资产后端客户端就位**

- [X] LlmClient 支持 AWS Bedrock:`ClaudeLlmClient` 在 `CLAUDE_CODE_USE_BEDROCK=1` 时走 `@anthropic-ai/bedrock-sdk`,否则走 `@anthropic-ai/sdk`;模型默认 `anthropic.claude-sonnet-4-5-20250929-v1:0` / `claude-sonnet-4-6`
- [X] [src/executers/common/runninghub-client.ts](src/executers/common/runninghub-client.ts):`HttpRunningHubClient` 封装 `/task/openapi/ai-app/run` + `/status` + `/outputs`,fetch 可注入便于测试;`AiAppSchema` 把 `apiId`(`api-xxx`)→ `webappId` + promptNode/referenceImageNode
- [X] `.env.example` 更新为 Bedrock-first;`pnpm test` 55 个用例全绿
- [ ] RunningHub AI-App schemas 登记(登录控制台 → "API 调用"面板,把 §3.5 表里 6 个模型的 `webappId`/`promptNodeId`/`referenceImageNodeId` 真实值填进一个 schema registry,例如 [src/executers/common/runninghub-schemas.ts](src/executers/common/runninghub-schemas.ts)

**v0.3b —— 角色 / 场景设计师接入(图像路径)**

- [X] [src/executers/common/runninghub-schemas.ts](src/executers/common/runninghub-schemas.ts):6 个 AI-App 的 schema 注册表(`webappId`/`promptNodeId` 等字段为 `TODO-` 占位,等控制台核对后覆盖);`isSchemaConfigured` 校验
- [X] [src/executers/common/run-image-task.ts](src/executers/common/run-image-task.ts):submit+poll 通用 helper(超时 / onProgress / error 回调,测试友好)
- [X] [src/assets/registry.ts](src/assets/registry.ts) + [src/assets/download.ts](src/assets/download.ts) + [src/assets/swap.ts](src/assets/swap.ts):AssetRegistry JSON 持久化、资产下载到 `<gameDir>/images/...`、`swapAssetPlaceholder` 下载→upsert 一把梭;失败路径用 `markAssetError`
- [X] [src/executers/character-designer/generate-main-image.ts](src/executers/character-designer/generate-main-image.ts):`generateCharacterMainImage`(立绘主图)
- [X] [src/executers/scene-designer/generate-background.ts](src/executers/scene-designer/generate-background.ts):`generateSceneBackground`(背景图)
- [X] Coder 识别 registry:`renderScriptRpy(planner, storyboarder, assetRegistry?)` 有 ready 条目就吐 `image bg_x = "images/..."`,没有就 `Solid(...)` 占位
- [X] 测试:13 文件 91 用例全绿(新增 36:registry/download/swap/image-task/schemas/char-gen/scene-gen/coder-registry)
- [ ] RunningHub AI-App schemas 登记真值(登录控制台 → §3.5 表 6 个 AI-App 的 "API 调用" 面板 → 覆盖 `PLACEHOLDER_APP_SCHEMAS`)—— 真跑图/视频前必须做
- [ ] 表情差分 + 道具图 + 时段/光照变体(用同样的 runImageTask 路径再封 2 个 executer)
- [ ] 典型修改 e2e 冒烟:跑 v0.2 pipeline → 调 `generateCharacterMainImage` / `generateSceneBackground` → 重渲染 script.rpy → `renpy.exe lint` 通过

**v0.3c —— 分镜师接入(视频路径)**

- [X] 分镜师 Cutscene 识别字段([src/pipeline/types.ts](src/pipeline/types.ts) 的 `StoryboarderOutputCutscene` + storyboarder system prompt 描述:`kind: transition | reference`,配合 `referenceSceneName` / `referenceCharacterName`)
- [X] Coder 识别 cutscene:有 ready 视频则吐 `$ renpy.movie_cutscene("videos/cut/shot_N.mp4")`;没有就 `scene bg_black with fade` + caption 占位(黑幕合法 Stage A)
- [X] [src/executers/storyboarder/generate-cutscene.ts](src/executers/storyboarder/generate-cutscene.ts):`generateCutsceneVideo` 复用 `runImageTask`,`transition` 走 `CUTSCENE_IMAGE_TO_VIDEO`,`reference` 走 `CUTSCENE_REFERENCE_VIDEO`,产物落 `videos/cut/shot_N.mp4`
- [X] 测试:coder 加 2 个 cutscene 用例(占位 + 真视频绑定),storyboarder executer 加 3+3 用例(含 reference 缺参校验)
- [ ] RunningHub 视频 AI-App schemas 真值登记(同 v0.3b 图像模型一起,登录 RunningHub 控制台核对 `CUTSCENE_IMAGE_TO_VIDEO` / `CUTSCENE_REFERENCE_VIDEO` 的 `webappId`/`promptNodeId`/`referenceImageNodeId` 后覆盖 `PLACEHOLDER_APP_SCHEMAS`)
- [ ] 角色动态立绘(`seedance2.0/多模态视频`)可选 —— 本版 schema 已占位(`CHARACTER_DYNAMIC_SPRITE`),executer 延后
- [ ] 视频在 Ren'Py 里的性能实测(`renpy.movie_cutscene` 播放、首帧占位、WebM 转码策略)

### v0.4 修改闭环

- [X] Story workspace 持久化:`runPipeline` 结束时把 planner/writer/storyboarder 三份 JSON 落到 `runtime/games/<story>/workspace/`,二次会话可 `loadStoryWorkspace` 拉回(见 [src/pipeline/workspace.ts](src/pipeline/workspace.ts))
- [X] 改角色外观 [modifyCharacterAppearance](src/pipeline/modify.ts):改 planner.characters[i].visualDescription,AssetRegistry 里该角色 ready 条目回落 placeholder(真资产路径留痕,下轮 Coder 自动 Solid 占位)—— 兑现 PLAN §8 "改短发"样例
- [X] 改对白 [modifyDialogueLine](src/pipeline/modify.ts):按 shotNumber + lineIndex 精确改一行,planner/writer 不动
- [X] 重排镜头 [reorderShots](src/pipeline/modify.ts):传 shotNumber 全排列,输出 1-indexed 连续编号,planner/writer 不动
- [X] 测试:workspace round-trip + 三个修改场景(含注册表回落 / 越界 / 非排列校验),共 +13 用例;全部基于 tmpdir,无需 LLM/HTTP
- [ ] 三个修改场景接 CLI 子命令(`renpy-agent modify character …` 之类)—— 当前只有编程接口
- [ ] 记忆压缩 + URI 懒加载实测长程 session(>2 小时)不崩 —— 需要真 Planner 上线后才做得了

### v0.5 员工扩招(音频 + UI 骨架)

- [X] `.env` 补齐 AWS Bedrock 三件套(`CLAUDE_CODE_USE_BEDROCK`/`AWS_REGION`/`AWS_BEARER_TOKEN_BEDROCK`),LLM 链路可以真跑
- [X] RunningHub schema 迁到 `api-448183xxx` 系列(旧 `api-42xxxx` / `api-43xxxx` 全作废);新增 `VOICE_LINE` / `SFX` 两个 AppKey(共用 minimax/speech-2.8-hd 的 apiId);`CHARACTER_DYNAMIC_SPRITE` 与 `CUTSCENE_REFERENCE_VIDEO` 合并共用 seedance2.0 多模态 apiId 条目
- [X] 4 个新文档 schema([src/schema/galgame-workspace.ts](src/schema/galgame-workspace.ts):`BgmTrack` / `VoiceLine` / `Sfx` / `UiDesign`),`DocumentKind` / `WorkspaceDocument` 联合类型同步扩
- [X] 4 位新 POC tool-set 契约([src/workflows/galgame-workflows.ts](src/workflows/galgame-workflows.ts):`MusicDirectorTools` / `VoiceDirectorTools` / `SfxDesignerTools` / `UiDesignerTools`);`PocRole` 扩到 11 人;[src/index.ts](src/index.ts) 同步 barrel
- [X] 运行时 `AssetRegistry.AssetType` 扩:`bgm_track` / `voice_line` / `sfx`
- [ ] RunningHub 控制台抄真 `webappId` / `promptNodeId` / `promptFieldName`(7 个 AppKey,含新 `VOICE_LINE`)—— 这一条过关后,整条"占位 → 真资产"链条才能真跑
- [ ] 配音导演 executer:`generate-voice-line.ts` 走 `runImageTask`(submit+poll 逻辑一致,只改产物扩展名为 `.mp3` / `.ogg`),产物落 `voice/scene_<N>/line_<i>.ogg`,Coder 在对白行前插 `voice "voice/..."`
- [ ] 音效设计师 executer:`generate-sfx.ts`,产物落 `audio/sfx/shot_<N>_<cue>.ogg`,Coder 按 cue 映射到 Shot 头/尾的 `play sound` 语句
- [ ] 音乐总监 executer:`generate-bgm-track.ts` 走 suno(独立 client,不复用 RunningHub),产物落 `audio/bgm/<slug>.ogg`,Coder 在进入 Scene/Chapter/Route 时插 `play music "audio/bgm/..."`
- [ ] UI 设计师 executer:`generate-ui-patch.ts` 走 LLM(不走 RunningHub),按 `screen` 枚举产出 `screens.rpy` 补丁,Coder merge 到最终 .rpy
- [ ] Pipeline 接线:`runPipeline` 在 Coder 前多跑 4 步(按"单章节前 N 句对白 / N 个镜头 / 1 条 BGM / 1 套主菜单 UI"的最小集合)

### v1.0

- [ ] 多章节、多路线、多结局
- [ ] 存档点自动布设

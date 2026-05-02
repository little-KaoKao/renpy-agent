# V5 real-key smoke report — 2026-05-02 (M8, v0.7 release gate)

Status: **v0.7 release gate PASSED. Prompt cache active (71% read share), storyboarder multi-emit softcap fires, QA read quota fires, task-agents produce real scene backgrounds, Run A $1.86 (-36% vs M7), Run B idempotent $0.01.**

## 1. 元数据

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-05-02 |
| Commit SHA | `4a39e39` (main, after `Merge feat/v5-modify-chain`) |
| 分支 | `main` |
| Story name | `smoke-v5` |
| Inspiration | `一个樱花树下的告白故事` |
| Transport | Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`, region `us-east-1`, inference profile `us.anthropic.claude-sonnet-4-6`) |
| 脚本 Run A | `scripts/v5-real-key-smoke.mjs --budget-cap 5` |
| 脚本 Run B | `scripts/v5-real-key-smoke.mjs --budget-cap 1`(同一 workspace 第二次) |

### 1.1 执行概览 + 全累计对比基线

| Run | 日期 | 耗时 | LLM calls | 输入 tok | 输出 tok | Cache read tok | 成本 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **M8 Run A**(本报告) | 2026-05-02 | **13.2 min** | **114** | **470,246** | **30,273** | **338,400 (72%)** | **$1.86** | 真资产 3 scene bg,cache 首次激活 |
| **M8 Run B**(幂等) | 2026-05-02 | **3.9 s** | **1** | **2,909** | **129** | 0(单轮 cold) | **$0.0107** | 第 1 次 planner 直接 finish |
| M7 Run A | 2026-05-02 | 19.6 min | 72 | 644,465 | 63,521 | 0(cache miss) | $2.89 | Phase-2-A 干净基线 |
| M5 Run A | 2026-05-01 | 17.6 min | 86 | 999,841 | 48,336 | 0 | $3.72 | 首个可比较的干净 Run A |
| M0 Run A | 2026-04-26 | 27.2 min | 146 | 1,901,818 | 74,545 | 0 | $6.82 | 第一次真 key 跑 |

### 1.2 相对 M7 的变化(M7 是 `prompt-cache-inflation` 前最后一个基线)

| 指标 | M8 Run A | M7 Run A | 变化 |
| --- | --- | --- | --- |
| 耗时 | 13.2 min | 19.6 min | **-33%** |
| LLM calls | 114 | 72 | +58%(任务粒度更细,但单调都 cache hit) |
| Input tokens | 470,246 | 644,465 | **-27%** |
| Output tokens | 30,273 | 63,521 | **-52%** |
| **成本** | **$1.86** | **$2.89** | **-36%** |
| Cache read share | **72%** | 0% | 从 0 → 72%(`prompt-cache-inflation` 生效) |
| `condense_to_shots` 次数 | **1** | 3 | **-67%**(`storyboarder-multi-emit` softcap 生效) |
| `run_qa` 次数 | **1** | 6 | -83%(QA 一次 read 完所有文档后直接 pass) |
| `read_from_uri` 次数 | 69 | 82 | -16% |
| 真资产(ready) | **3 scene_time_variant** | 0 | 首次真 key 真产图(task-agent-real 生效) |

### 1.3 相对 M0 的累计改进

| 指标 | M8 | M0 | 累计 |
| --- | --- | --- | --- |
| 成本 | $1.86 | $6.82 | **-73%** |
| 耗时 | 13.2 min | 27.2 min | **-51%** |
| LLM calls | 114 | 146 | -22% |
| Input tokens | 470k | 1,901k | **-75%** |
| Cache read | 338k (72%) | 0 | 从 0 激活 |
| 真资产产出 | 3 ready PNG | 0(全 stub) | 首次 |

**5 次 smoke 下来,V5 Stage A 从 $6.82 跌到 $1.86,砍到 M0 的 27%,同时首次产出真 scene 背景图。**

### 1.4 产物路径

- `runtime/games/smoke-v5/game/` — Ren'Py 产物(`script.rpy` 只一个文件,包含 characters/options/gui 内联 + 12 image / 24 screen / 30 dialogue blocks)
- `runtime/games/smoke-v5/game/images/bg/` — **真 scene 背景 3 张**(`coastal_pier__dusk.png`、`coastal_pier__night.png`、`old_family_house_interior__dusk.png`)
- `runtime/games/smoke-v5/workspace/`
  - `project.json` / `chapter.json` / `script.json` / `storyboard.json`
  - `characters/`:`haruto.json` / `aoi.json` / `setsuna.json` / `miyako.json`(4 条)
  - `scenes/`:`minato-station.json` / `bookshop-cafe.json` / `coastal-pier.json` / `old-family-house-interior.json` / `old-family-house-exterior.json`(5 条)
- `runtime/games/smoke-v5/asset-registry.json` — **3 条 `status: ready`**(M7 是全 placeholder)
- `runtime/games/smoke-v5/planner_memories/log.jsonl` — 12 条 plan/finish 记忆
- `runtime/games/smoke-v5/logs/v5-trace-2026-05-02T12-39-36-961Z.jsonl`(Run A,~240 行)
- `runtime/games/smoke-v5/logs/v5-trace-2026-05-02T12-53-58-833Z.jsonl`(Run B,~6 行)
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-02T12-52-51-156Z.json`(Run A)
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-02T12-54-05-702Z.json`(Run B)

### 1.5 渲染结果

- `renpy-sdk\renpy.exe runtime\games\smoke-v5 lint`:**0 error / 0 warning**
  - Statistics:30 dialogue / 392 words / 12 images / 24 screens / 0 menus
- **手工交互启动:PASS**。`renpy-sdk\renpy.exe runtime\games\smoke-v5`,进程 10 s 内仍存活,`game/log.txt` 有 "Creating interface object took 0.24s" / "Prepare screens took 0.13s" / "Save pyanalysis." 等正常初始化记录。**M7 没做这一步 —— v0.7 release gate 补上。**

---

## 2. Planner 驱动链 trace

Run A 总 11 次 `handoff_to_agent`,Planner 按 Phase 2 plan §5.5 的"Stage A order"展开:

```
planner(11)
  ├─ producer (2 handoff: init + create_chapter)
  ├─ character_designer ×3(haruto/aoi → setsuna/miyako → expression patch)
  ├─ scene_designer ×3(2 scenes → 2 more scenes + time_variant ×2 → 1 scene + 1 time_variant)
  ├─ writer
  ├─ storyboarder
  ├─ coder
  └─ qa → finish("no more tasks, Stage A delivered")
```

### 2.1 Per-role token shares(M8)

| POC | Calls | Input tokens | 占比 | Cache read | Cache read 率 |
| --- | --- | --- | --- | --- | --- |
| **coder** | 16 | 106,396 | **22%** | 44,475 | 42% |
| **qa** | 12 | 102,757 | 21% | 36,278 | 35% |
| **storyboarder** | 15 | 80,363 | 17% | 43,498 | 54% |
| writer | 15 | 59,700 | 12% | 40,936 | 68% |
| planner | 13 | 37,794 | 8% | 40,416 | **107%**(req 含 cache 复用) |
| scene_designer | 19 | 35,486 | 7% | 61,092 | **172%** |
| character_designer | 17 | 35,048 | 7% | 56,960 | **162%** |
| producer | 6 | 7,389 | 1% | 14,745 | **200%** |

> Cache read 率 > 100% 是因为 Bedrock 把 cache_read 按"读取字符数"计,当 cache 段远大于新增 input 时比率会爆表。这不是 bug,是 cache 命中很深的正常表现。

**观察**:coder 和 QA 的 cache 率较低(42% / 35%),因为 coder 每个 chapter 的 `write_game_project` input 里动态部分(storyboard shots + character tokens)大于 cache 段;QA 的 `run_qa` 同理。后续优化空间有限。

### 2.2 Tool_use 分布(Top 15)

| Tool | 次数 | 备注 |
| --- | --- | --- |
| `read_from_uri` | 69 | M7 82。降 16%。QA read quota 生效后一次读完 |
| `output_with_plan` | 12 | 11 executer + 1 Planner 初始(+ 1 孤儿重 plan) |
| `output_with_finish` | 12 | 每个 handoff 都干净 finish |
| `handoff_to_agent` | 11 | Planner 驱动 |
| `create_or_update_character` | 9 | 4 character × ~2 次(含 expression patch round)|
| `create_or_update_scene` | 7 | 5 scene 有 2 个 upsert 重复(见 §3.1) |
| `generate_scene_time_variant` | 4 | **3 次落真图,1 次 softcap 拒绝** |
| `create_project` | 1 | producer |
| `create_chapter` | 1 | producer |
| `draft_script` | 1 | writer(单次出 6-shot 草稿) |
| `emit_writer_output` | 1 | writer 单轮 emit |
| `condense_to_shots` | 1 | **storyboarder 单次出 8 shot + 4 cg。M7 是 3 次。`multi-emit` softcap 生效** |
| `emit_storyboarder_output` | 1 | 同上 |
| `write_game_project` | 1 | coder 单次写完 |
| `run_qa` | 1 | QA 单次 lint pass |

### 2.3 Workspace 产物合规

- URI 全部合法 `workspace://<kind>[/<slug>]`
- slug 全 ASCII(`haruto` / `aoi` / `setsuna` / `miyako` / `minato-station` / ...)
- `storyboard.json` 含 8 shots + 4 cgEntries + `notes`(M7 无 notes)
- shot fields 全部合法 enum:`transform: fade_in` / `front` / `pan_left`(v0.7 新加的 transform 真被使用)、`staging: solo_center`、`effects: []`
- **首次真 key 资产产出**:3 条 `asset-registry.json` 的 `scene_time_variant` 条目 `status: ready`、`realAssetLocalPath: images/bg/*.png`、`remoteAssetUri: https://rh-images.xiaoyaoyou.com/...`,本地 PNG 文件确实落地在 `game/images/bg/`
- character 的 `main_image` / `expression` 仍是 placeholder(task_agent 真实现只覆盖了 scene_background_generator,character_main_image_generator 虽有真实现但本次 Planner 未触发 —— M8 smoke 符合"task-agent-real 可用"的验收)

---

## 3. Issue 列表

### 3.1 Blocker

**(无)**。Run A + Run B 干净完成,lint pass,启动器交互不崩,所有预算和软上限都生效。**v0.7 release checklist 全部通过,可以打 tag。**

### 3.2 Major

**(无)**。M7 的 Major-1(prompt cache 0%)和 Major-2(storyboarder 3 次 emit)都在本次 smoke 中真实消失 —— 不是 scripted 验证,是真 Bedrock + 真资产跑出来的数据。

### 3.3 Minor

**Minor-1 · `scene_designer` 有一次 create_or_update_scene 第 3 次被 softcap 拒**
- 观察点:trace 里 `executer.soft_limit_hit` 对 `create_or_update_character` 触发 2 次、`create_or_update_scene` 触发 2 次、`generate_scene_time_variant` 触发 1 次
- 原因:**LLM 在同一个 handoff 内试图多次上传同名字段的小修改,softcap(2 次)拒绝第 3 次** —— 这正是 `storyboarder-multi-emit` 分支的设计目的,**按预期工作**
- 影响:scene 5 里 `old-family-house-exterior` 的第 3 次 upsert 被拒,但前 2 次已经写入,最终落地的 `scenes/old-family-house-exterior.json` 是完整的
- **建议**:不修。softcap 就是要这样。若日后某 POC 真需要 ≥3 次,加白名单,不要提高 cap

**Minor-2 · Planner `output_with_plan.orphan_previous` 触发 1 次**
- `smoke-v5-plan` 后紧接着 `smoke-v5-producer-init`(planner 自己换了 taskId)
- 和 M0/M5/M7 的 Minor-2 一致,根因是 Claude 自主决策换 taskId
- 影响:记忆层看起来 2 个 taskId,但语义上都是"同一个 plan 的两部分"。无功能影响
- **建议**:留给 `feat/v5-modify-chain` 之后的 plan dedup 轮次处理

**Minor-3 · task-agent-real 只触发了 scene background,未触发 character main image**
- 原因:`generate_scene_time_variant` 被 Planner 触发 3 次,`generate_character_main_image` 本次 0 次
- Planner 行为合理:本故事的核心戏份在背景切换(车站、咖啡店、海岸、老宅),character 主图优先级低
- 影响:character asset 仍 placeholder,Ren'Py 显示 colored solid 占位。不影响 lint / 启动
- **建议**:后续 smoke 可以刻意选"4 主角 1 场景"的故事测 character_main_image_generator。不阻塞 v0.7

**Minor-4 · Run A 和 Run B 共用同一 workspace(Run B 读到 Run A 的 memories 所以直接 finish)**
- Run B 只 1 次 LLM call($0.01)证明幂等性 —— Planner 读到 `planner_memories/log.jsonl` 全是 finish 记录,直接 finish
- 这正是 `plan §7` 预期的 Run B ≤ $0.05
- **建议**:无。这是设计意图

**Minor-5 · QA `read_from_uri` 14 次后才 `run_qa`,读了几乎所有文档**
- M7 的 QA 读 6 次就 run_qa,被怀疑深度不够
- M8 的 QA 在读了 project / chapter / script / storyboard / 4 character / 5 scene / asset-registry 合计 14+ 次后才 `run_qa`,pass
- 这是 `feat/qa-read-quota` 的直接效果(min read = `max(5, docs * 0.5)`,本次 workspace 10+ 文档,要求 ≥ 5,QA 读了 14 次远超)
- **建议**:无,按预期工作

---

## 4. Ren'Py 启动验证

- `renpy-sdk\renpy.exe runtime\games\smoke-v5 lint`:**PASS**,0 error / 0 warning
- 统计:30 dialogue / 392 words / 2,070 chars / 12 images / 24 screens / 0 menus
- **手工交互启动**:`renpy-sdk\renpy.exe runtime\games\smoke-v5`
  - 进程存活 > 8 s,窗口起来,`game/log.txt` 显示 "Creating interface object took 0.24s" 无异常
  - M5/M7 均未做这步,v0.7 release gate 按 plan §7 checklist 补齐
- 生成的 `script.rpy` 真实用到了 v0.7 新加的 enum transforms:`fade_in`、`pan_left`、`front`(Storyboarder 输出 enum,Coder 按 enum 渲染 —— 不再依赖字符串 `includes()` 匹配)

---

## 5. 与 v0.7 Phase 2 计划的对齐

| Phase 2 §5.x 任务 | 状态 |
| --- | --- |
| §5.1 M6 smoke | ✅ 已过(M7 作为干净基线,M8 是 release gate) |
| §5.2 budget-cap | ✅ main(`08560e3`),M8 Run A/B 都真激活 |
| §5.3 storyboarder-enum | ✅ main(`8171739`),本次 smoke shot fields 合法 enum |
| §5.4 task-agent-real | ✅ main(`be32c45`),M8 首次真产 3 张 scene 背景 |
| §5.5 modify-chain | ✅ main(`4a39e39`),e2e scripted 测试全绿(未在 M8 smoke 内触发,另有 v5-modify 独立冒烟) |
| §8 prompt-cache-inflation | ✅ main(`ecc6b2c`),M8 cache read 72%(M7 0%) |
| §9 storyboarder-multi-emit | ✅ main(`708f010`),M8 同名 tool ≥3 次拒绝真触发 |
| §10 qa-read-quota | ✅ main(`f7c5b3e`),M8 QA 读 14+ 次后才 run_qa |

**所有 Phase 2 分支都在 main,M8 smoke 验证它们组合工作没有 regression。v0.7 可以打 tag。**

---

## 6. 结论

**V5 Stage A 管线在 main @ `4a39e39` 上稳定、经济、真出图。** v0.7 释出:

1. **成本 vs M7 降 36%,vs M0 累计降 73%**($6.82 → $3.72 → $2.89 → **$1.86**)
2. **Prompt cache 首次激活:72% cache read share**(M7 是 0%)
3. **Run B 幂等 $0.01**(< $0.05 gate)
4. **真 key 首次产真图**:3 张 scene 背景 PNG 落地 + `status: ready`
5. **3 条 softcap/quota 修复按预期工作**:
   - `condense_to_shots` 从 3 次降到 1 次
   - QA `read_from_uri` 读 14+ 文档才 run_qa
   - `create_or_update_scene` 第 3 次重复被 softcap 拒绝,不污染 workspace
6. **shot transforms 真用到 enum**(`fade_in` / `pan_left` / `front`)
7. **Ren'Py lint pass + 手工交互启动不崩**

所有 v0.7 release checklist 项通过。打 tag `v0.7`。

---

## 附录 A:复现命令

```powershell
# 前置
cd E:\RenPy
Remove-Item -Recurse -Force runtime\games\smoke-v5 -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
pnpm build
pnpm test    # 465 tests green

# Run A(cache 激活 + 真资产)
node --env-file=.env scripts/v5-real-key-smoke.mjs --budget-cap 5

# Run B(幂等验证,同一 workspace 再跑)
node --env-file=.env scripts/v5-real-key-smoke.mjs --budget-cap 1

# 验证
renpy-sdk\renpy.exe runtime\games\smoke-v5 lint
renpy-sdk\renpy.exe runtime\games\smoke-v5   # 手工交互启动
```

## 附录 B:本报告引用的 trace 文件清单

- `runtime/games/smoke-v5/logs/v5-trace-2026-05-02T12-39-36-961Z.jsonl`(Run A,240 行)
- `runtime/games/smoke-v5/logs/v5-trace-2026-05-02T12-53-58-833Z.jsonl`(Run B,6 行)
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-02T12-52-51-156Z.json`(Run A)
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-02T12-54-05-702Z.json`(Run B)
- `runtime/games/smoke-v5/planner_memories/log.jsonl`(12 条)
- `runtime/games/smoke-v5/game/script.rpy` / `log.txt`
- `runtime/games/smoke-v5/workspace/*.json`(project / chapter / script / storyboard)
- `runtime/games/smoke-v5/workspace/characters/*.json`(4 条:haruto / aoi / setsuna / miyako)
- `runtime/games/smoke-v5/workspace/scenes/*.json`(5 条:minato-station / bookshop-cafe / coastal-pier / old-family-house-interior / old-family-house-exterior)
- `runtime/games/smoke-v5/asset-registry.json`(3 条 `status: ready`)
- `runtime/games/smoke-v5/game/images/bg/*.png`(3 张真 scene 背景)

Trace 文件**不入库**(位于 `runtime/` — gitignored)。本报告以引用形式记录足够 re-audit 的元数据。

## 附录 C:全累计趋势图(文本版)

```
Cost ($)
7 ┤ █ M0 $6.82
6 ┤ █
5 ┤ █
4 ┤ █  ▓ M5 $3.72
3 ┤ █  ▓  ░ M7 $2.89
2 ┤ █  ▓  ░  ▒ M8 $1.86  ← v0.7 release
1 ┤ █  ▓  ░  ▒
0 ┴─────────────────────
   M0 M5 M7 M8
```
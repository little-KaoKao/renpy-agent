# V5 real-key smoke report — 2026-04-26 (M0, first run)

Status: **V5 can proceed to v0.7 implementation without structural refactor.**

## 1. 元数据

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-04-26 |
| Commit SHA | `66da81ffe5fe96a70a69d58228eaeba55b08697d` |
| 分支 | `chore/v5-real-key-smoke` |
| Story name | `smoke-v5` |
| Inspiration | `一个樱花树下的告白故事` |
| Transport | Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`, region `us-east-1`) |
| 脚本 | `scripts/v5-real-key-smoke.mjs` |

### 1.1 两次执行

| Run | 起始(UTC) | 耗时 | LLM calls | 输入 tok | 输出 tok | 成本估算 | Planner tasks | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A(干净 workspace) | 2026-04-26T06:17:35Z | 27 分 14 秒 | 146 | 1,901,818 | 74,545 | **$6.82** | 1 + 子 POC 11 轮 | 从空 workspace 跑出完整 Stage A |
| B(已存在 workspace) | 2026-04-26T14:55:44Z | 16.6 秒 | 4 | 29,356 | 618 | **$0.10** | 1(空操作) | Planner 读 workspace 后 `output_with_finish` |

Run A 超出 plan §0.4 的 "≤ $2/次" 预算($6.82);原因是 QA 两轮 kick-back + coder remediation 叠加,Planner 在多 POC 间反复 `read_from_uri`(共 408 次 read、合计 1.9M 输入 token)。详见 §3.4 Major-1。

Run B 验证了 V5 的**幂等性**:已交付的 Stage A 重入时 Planner 直接识别已完成,没有重复工作。

### 1.2 产物路径

- `runtime/games/smoke-v5/game/` — Ren'Py 产物(script.rpy / screens.rpy / gui.rpy / options.rpy 4 个文件 + .rpyc)
- `runtime/games/smoke-v5/workspace/` — per-URI 文档
  - `project.json`、`chapter.json`、`script.json`、`storyboard.json`、`inspiration.txt`
  - `characters/`:`asahi-kurose.json`、`seri-amane.json`、`touma-wakagi.json`、`nao-ishida.json`
  - `scenes/`:`riverside-promenade.json`、`chouryuu-diner.json`、`school-rooftop.json`
- `runtime/games/smoke-v5/planner_memories/log.jsonl` — 23 条 plan/finish 记忆
- `runtime/games/smoke-v5/logs/v5-trace-2026-04-26T06-17-32-435Z.jsonl` — 336 行,含 Run A 完整 trace
- `runtime/games/smoke-v5/logs/v5-trace-2026-04-26T14-55-40-946Z.jsonl` — 11 行,Run B

### 1.3 渲染结果

- `renpy-sdk/renpy.exe runtime/games/smoke-v5 lint`:**0 error / 0 warning**
  - 统计:42 dialogue blocks、83 words、10 images、24 screens、0 menus
- `renpy-sdk/renpy.exe runtime/games/smoke-v5 compile`:静默退出,无报错,`script.rpyc` 生成
- 未做交互式启动测试(不阻塞本报告;首次 lint + compile 全绿已足以判定"能跑")

---

## 2. Planner 驱动链 trace(Run A)

一共 11 个有效 taskId,按时序合并 plan/finish 两条:

| # | taskId | handoff POC | 耗时 | 成果 |
| --- | --- | --- | --- | --- |
| 1 | `smoke-v5-plan` | Planner 自身 | 5s | 制定 Stage A 7 步流水线 |
| 2 | `producer-smoke-v5-init` | producer | 64s | `workspace://project` + `workspace://chapter` 建立 |
| 3 | `char-design-stage-a` | character_designer | 91s | 4 个 character 文档,main image 全部 stub-error(预期),status=placeholder |
| 4 | `scene_designer_smoke_v5_ch1` | scene_designer | 264s | 3 个 scene 文档,含 14 个时段/天气变体 |
| 5 | `writer-chapter01` | writer | 62s | `workspace://script`,7 scene / 42 dialogue blocks |
| 6 | `storyboard-chapter-01` | storyboarder | 72s(两轮 plan) | `condense_to_shots` 产出 7 shots;**Minor-1**: storyboarder 的 enrichment 只写在 text,没有 write tool 可用 |
| 7 | `smoke-v5-coder` / `smoke-v5-chapter1-code` / `smoke-v5-coder-ch1` | coder | 总 347s(连续 3 个 taskId) | `write_game_project` 产出 .rpy;**Minor-2**: coder 首轮 plan 被 Planner 用不同 taskId 重发了两次 |
| 8 | `qa-smoke-v5-stage-a` | qa | 214s | `run_qa` 通过 lint,但 cross-ref 找出 3 BLOCKING + 5 HIGH + 6 MED/LOW = 14 issue;kick_back |
| 9 | `smoke-v5-qa-remediation` | coder(remediation) | 212s | 全部 8 BLOCKING/HIGH 修复,重新 `write_game_project` |
| 10 | `smoke-v5-final-qa` | qa | 65s | `run_qa` 再次通过;4/6 MED/LOW 解决,2 low 挂 Stage B;GO for sign-off |
| 11 | `smoke-v5-plan` / `smoke-v5-stage-a-check` | Planner | 8s + 16s(Run B) | `finish("no more tasks, Stage A delivered")` |

### 2.1 Handoff 次数

- 共 22 次 `handoff_to_agent`(每个 POC 至少 2 次,因为 tier2 占位 retry 导致 char/scene 各 2 次,coder 3 次,qa 2 次)
- pocRole 分布:coder × 8 / qa × 4 / writer × 2 / storyboarder × 2 / scene_designer × 2 / producer × 2 / character_designer × 2

### 2.2 Tool_use 分布(总 561 次)

| Tool | 次数 | 备注 |
| --- | --- | --- |
| `read_from_uri` | 408 | 极高,占 73%。每个 POC 初始 plan 都会并行 read 多个文档,合成时又重复 read |
| `output_with_plan` | 26 | 11 taskId × 平均 2 轮 plan |
| `handoff_to_agent` | 22 | |
| `swap_asset_placeholder` | 18 | coder 做占位替换 |
| `write_game_project` | 14 | coder 每次都重新 write 一整套 |
| `call_task_agent` | 12 | 8 次 `character_main_image_generator` + 4 次 `character_prompt_expander` — **全部返回 stub-error(v0.6 预期)** |
| `output_with_finish` | 9 | |
| `create_or_update_scene` | 10 | 3 scene × 3 轮 |
| `create_or_update_character` | 8 | 4 character × 2 轮 |
| `run_qa` | 4 | qa 两次,每次内含 2 次 |
| `kick_back_to_coder` | 4 | qa 两次反弹(都集中在第一轮) |
| `draft_script` / `condense_to_shots` / `create_project` / `create_chapter` | 各 2 | |

### 2.3 Workspace URI 合规性

- URI 格式全部符合 `workspace://<kind>[/<slug>]`
- slug 全部是合法 ASCII(`asahi-kurose` / `seri-amane` / `touma-wakagi` / `nao-ishida` / `riverside-promenade` / `chouryuu-diner` / `school-rooftop`)
- 本次 LLM 自动生成了英文化角色名(`Asahi Kurose`、`Seri Amane` 等),没有触发 CJK slug(`白樱`/`樱白`)撞 slug 的场景 — **feat/workspace-unification 分支的 slug 健壮化需要独立测试构造 CJK 角色名来验证**

### 2.4 Stub tool 被调用数据(给 feat/v5-tier2-tools 分支排优先级)

Run A 中被 Planner 调用但返回 error 的底层 task_agent:

| Task agent | 被调次数 | Planner 重试次数 | 优先级建议 |
| --- | --- | --- | --- |
| `character_main_image_generator` | 8(4 character × 2 轮) | Planner 没有重试,直接标 status=placeholder 前进 | **High** — 每个 character 都会调,几乎必走 |
| `character_prompt_expander` | 4 | 同上 | **Medium** — char_designer 内部辅助 |

**未被调用但 Tier 2 定义了的 tool**(`generate_bgm_track` / `generate_voice_line` / `generate_sfx` / `generate_ui_patch` / `generate_cutscene` / `generate_prop` / `generate_scene_time_variant` / `kick_back_to_coder` / `generate_character_expression` / `generate_character_dynamic_sprite`):Planner 在 v0.6 的 poc-registry 描述里看到这些 tool 标记 "(v0.6 stub)",全部跳过了。即 tier2 分支要在 `poc-registry.ts` 去掉 stub 标记后,Planner 才会开始调。**该次 smoke 不能给 tier2 分支提供"哪些被 LLM 真正偏爱"的优先级数据**,因为 Planner 看到 stub 标记就绕开了。

---

## 3. Issue 列表

### 3.1 Blocker(阻塞 V5 流水线)

**(无)** — Run A 完整跑通 Stage A,没有死循环、没有参数校验崩溃、没有 `is_error: true` 的 tool_use result。

### 3.2 Major(能跑但产出/成本不可接受)

**Major-1 · 成本严重超 §0.4 预算($6.82 vs $2/次上限,3.4x)**
- 证据:Run A usage = 1.9M input + 75k output,按 Sonnet 4.6 list price $3/Mtok input + $15/Mtok output = $5.70 + $1.12 = $6.82
- 根因:
  1. `read_from_uri` 408 次,每次 Planner/Executer 新任务都并行 re-read 全部依赖文档,没有 context 缓存
  2. Planner system prompt 未打 `cache_control`(100% cache miss,`cacheCreationInputTokens=0`,`cacheReadInputTokens=0` 全程为零)
  3. QA 第一轮找到 14 issue,coder remediation 等于把整个 script.rpy 从 workspace 重写一次
- 影响:PLAN §0.4 的"每次 ≤ $2" 约束在真跑 V5 时不成立
- **建议**:**`perf/prompt-cache` 分支第一优先**。按 §5.1 估算可省 60% input,单 run 应能回到 ~$2.5 水位

**Major-2 · coder phase 出现 3 个并列 taskId(`smoke-v5-coder` / `smoke-v5-chapter1-code` / `smoke-v5-coder-ch1`)**
- 证据:planner_memories/log.jsonl 第 12-14 行,前两个 taskId 只有 plan,没有 finish
- 根因:Planner 或 Executer 在 coder phase 的 plan 被 "重新初始化"(可能因为第一次 plan 输出太长被截断,Planner 重建 taskId);无任何错误日志说明原因
- 影响:planner_memories 状态不干净,后续 modify / resume 读 memories 时可能读到幽灵 plan;未来 `chore/ops-polish` 加的 logger 需要捕获这种 re-plan 动作
- **建议**:**`feat/v5-tier2-tools` 或新分支**加 assertion:同一 taskId 没有 finish 时,Planner 不得换新 taskId 开始同类工作。或在 `chore/ops-polish` 的 logger 里把 re-plan 事件记下来

### 3.3 Minor(可用但有优化空间)

**Minor-1 · storyboarder 第二轮 plan 内嵌"没有 write tool"的抱怨**
- 证据:log.jsonl 第 11 行,storyboarder plan 段自述 "I cannot directly 'write' to workspace URIs via a save tool … produce the document in full via the finish summary chain"
- 根因:Planner 给 storyboarder 的 tool set 没有通用 `write_workspace_doc`(可能是故意的 — 只暴露 `condense_to_shots`),storyboarder 想写 `workspace://storyboard/chapter-01` 和 `workspace://storyboard/cg-list` 但这些是增强型 URI,tool schema 里没有
- 影响:最终 storyboard 文档只落在 `workspace://storyboard`(单例),细化的 cg-list 丢失
- **建议**:**`feat/v5-tier2-tools` 分支**确定 storyboarder 需不需要更细的 write tool,或者调整 condense_to_shots 的 input schema 支持 cg-list 字段

**Minor-2 · `call_task_agent` 的 error 消息对 Planner 不够友好**
- 证据:return `{"error":"task agent \"character_main_image_generator\" not implemented in v0.6"}`
- Planner 行为:看到 error 后直接把 character status 标 `placeholder` 继续 — 这是正确行为,但没有 "guidance" 告诉 Planner "跳过 main-image 这一步"
- 影响:若未来新增了 task_agent 但返回 error,Planner 可能死循环 retry。现在没死循环是因为 Planner 显示聪明地识别了 "not implemented in v0.6" 字样
- **建议**:**`feat/v5-tier2-tools` 分支**统一 task_agent error 返回 schema,加 `{"error": ..., "retry": false, "guidance": "..."}` 字段

**Minor-3 · QA 第一轮暴露了 coder 的 3 个 BLOCKING bug(都是真 bug,被修掉了)**
- 证据:log.jsonl 第 17 行 `qa-smoke-v5-stage-a.finish`
  - Shot 3 narrator line 4 丢失(`「俺も座った。何も言わなかった。…」`)
  - Shot 6 BG 错用 `diner_interior_evening` 而非 `diner_exterior_rain`
  - Shot 7 缺 `stage_a_branch_point:` label(fall-through 导致游戏过早结束)
- 根因:coder 从 workspace 到 .rpy 的翻译存在跨 shot 状态追踪缺陷,要靠 QA-coder 往返纠正
- 影响:每次 Stage A 都需要 2+ 轮 coder(第一次 + remediation),成本翻倍
- **建议**:`feat/v5-modify-chain` 分支把 coder 的 `write_game_project` schema 提升为显式的 per-shot fields(而非 freeform 合成),让 "scene 指令" 等字段有严格校验

**Minor-4 · Run A 实测总耗时 27 分,`maxPlannerTasks` 虽默认 20 但 taskId 真实用了 11 个(含 Planner 自己 2 个)**
- Plan §7.6 step 4 已经计划把 `maxPlannerTasks` 调到 40,这次 smoke 不触顶但接近

**Minor-5 · Run B(已交付 workspace 重入)验证幂等**
- Planner 读 project → storyboard + script → chapter → `output_with_finish`,4 轮 LLM 就结束。这是**好行为**,但说明 Planner system prompt 没有"如果已 delivered,立刻 finish"快速路径 — 4 次 LLM 调用 + 29k token 才做出这个判断,稍微浪费
- **建议**:`perf/prompt-cache` / `feat/v5-modify-chain` 分支之一,在 Planner prompt 里加短路 hint

**Minor-6 · RunningHub 完全未被调用**
- 证据:trace 里没有 `runninghub` 字样;stub task_agent 层直接返回 error,底层 HTTP 没发出去
- 影响:本次 smoke **没有验证 RUNNINGHUB_API_KEY 实际可用**。Plan §2.6 step 1 的 4 件套 env 校验只做到了"有这个 env",没做到"有且能握手"
- **建议**:`feat/v5-tier2-tools` 分支第一次让 tool wrapper 真走 RunningHub 时,需要一次**独立** smoke 去验 RunningHub 连通性

---

## 4. Renpy 启动验证

- 命令:`E:\RenPy\renpy-sdk\renpy.exe E:\RenPy\runtime\games\smoke-v5 lint`
- 结果:**lint PASSED**,0 error,0 warning
- Statistics:42 dialogue blocks / 83 words / 10 images / 24 screens / 0 menus
- 补充:`renpy.exe ... compile` 静默完成,`script.rpyc` 生成
- 截图:未做交互启动(workspace 已"稳定态",需要 UI 人工点击;不在本 smoke scope)
- `game/log.txt` 最后一段显示 Ren'Py 8.3.4.24120703 的 lint report(2026-04-26 14:44),确认 coder remediation 后 Ren'Py 本身**顺利消化**了修复后的 .rpy

---

## 5. 结论

**V5 can go to the next milestone (v0.7 feature branches) without any structural refactor.** Run A proved the full Planner → 6 POC → coder → QA remediation loop works end-to-end on real Bedrock, produced Ren'Py that lints clean, and exhibited the correct "error → status=placeholder → move on" fallback for v0.6 stub task_agents. Run B proved the workspace is idempotent on re-entry.

However, **cost is 3.4x over budget**(Major-1),优先做 `perf/prompt-cache` 能消除绝大部分超支。下一步:
1. 先 merge `feat/workspace-unification`(关键路径)
2. **尽早** merge `perf/prompt-cache`(本 smoke 第二次跑前就要 merge,否则 M5 smoke 还会烧 $7)
3. `feat/v5-tier2-tools` 落地后,M5 smoke 会第一次真正测 RunningHub + character_main_image 整条链路 — 届时本报告 Minor-6 才能关闭

关注但不阻塞发 v0.7:Major-2(coder 多 taskId)、Minor-1/2/3。Minor-4/5/6 随 tier2 + prompt-cache 分支自然消化。

---

## 附录 A:复现命令

```bash
# 前置
cp .env.example .env
# 填入 CLAUDE_CODE_USE_BEDROCK=1 / AWS_REGION / AWS_BEARER_TOKEN_BEDROCK / RUNNINGHUB_API_KEY
pnpm install
pnpm build

# 跑 smoke(注意:会烧真 key)
node --env-file=.env scripts/v5-real-key-smoke.mjs

# 验证产物
"E:\RenPy\renpy-sdk\renpy.exe" "E:\RenPy\runtime\games\smoke-v5" lint
"E:\RenPy\renpy-sdk\renpy.exe" "E:\RenPy\runtime\games\smoke-v5" compile
```

## 附录 B:本报告引用的 trace 文件清单

- `runtime/games/smoke-v5/logs/v5-trace-2026-04-26T06-17-32-435Z.jsonl`(336 行)
- `runtime/games/smoke-v5/logs/v5-trace-2026-04-26T14-55-40-946Z.jsonl`(11 行)
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-04-26T06-44-49-468Z.json`
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-04-26T14-56-00-598Z.json`
- `runtime/games/smoke-v5/planner_memories/log.jsonl`(23 条)
- `runtime/games/smoke-v5/game/script.rpy` / `log.txt`
- `runtime/games/smoke-v5/workspace/project.json` / `chapter.json` / `script.json` / `storyboard.json`
- `runtime/games/smoke-v5/workspace/characters/{asahi-kurose,seri-amane,touma-wakagi,nao-ishida}.json`
- `runtime/games/smoke-v5/workspace/scenes/{riverside-promenade,chouryuu-diner,school-rooftop}.json`

Trace 文件**不入库**(位于 `runtime/` — gitignored)。本报告以引用形式记录足够 re-audit 的元数据。

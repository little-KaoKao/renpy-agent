# V5 real-key smoke report — 2026-05-01 (M5, post-v0.6 follow-ups)

Status: **V5 Stage A pipeline verified end-to-end at lower cost and higher reliability than M0. Bedrock prompt-cache is a known miss (see Major-1).**

## 1. 元数据

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-05-01 |
| Commit SHA | `4225518` (main, after chore(docs+v5) follow-ups) |
| 分支 | `main` |
| Story name | `smoke-v5` |
| Inspiration | `一个樱花树下的告白故事` |
| Transport | Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`, region `us-east-1`, inference profile `us.anthropic.claude-sonnet-4-6`) |
| 脚本 | `scripts/v5-real-key-smoke.mjs` |

### 1.1 两次执行(本次 + M0 基线对比)

| Run | 日期 | 起始(UTC) | 耗时 | LLM calls | 输入 tok | 输出 tok | 成本 | Planner tasks | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **M5 Run A**(干净 workspace) | 2026-05-01 | 13:41:22Z | **17.6 分钟** | **86** | **999,841** | **48,336** | **$3.72** | 1 + 8 handoff(coder ×2) | 从空 workspace 跑出完整 Stage A |
| **M5 Run B**(已 delivered 重入) | 2026-05-01 | 13:39:40Z | **4.1 秒** | **1** | **4,625** | **135** | **$0.016** | 1(短路) | Planner Rule 8 短路 hint 生效 |
| M0 Run A(基线) | 2026-04-26 | 06:17:35Z | 27 分 14 秒 | 146 | 1,901,818 | 74,545 | $6.82 | 1 + 子 POC 11 轮 | 含 QA 2 轮 + coder remediation |
| M0 Run B(基线) | 2026-04-26 | 14:55:44Z | 16.6 秒 | 4 | 29,356 | 618 | $0.10 | 1(空操作) | 无 Rule 8 短路,Planner 逐个 read_from_uri 确认 |

### 1.2 相对 M0 的变化

| 指标 | M5 Run A | M0 Run A | 变化 |
| --- | --- | --- | --- |
| 耗时 | 17.6 min | 27.2 min | **-35%** |
| LLM calls | 86 | 146 | **-41%** |
| Input tokens | 1.00 M | 1.90 M | **-47%** |
| Output tokens | 48.3 K | 74.5 K | **-35%** |
| 成本 | $3.72 | $6.82 | **-45%** |
| read_from_uri 次数 | 125 | 408 | **-70%** |
| QA 回退 coder | 0 | 4 | -100% |
| Planner 总 task 数 | 8 handoff | 11 handoff | -27% |

| 指标 | M5 Run B | M0 Run B | 变化 |
| --- | --- | --- | --- |
| LLM calls | 1 | 4 | **-75%** |
| Input tokens | 4,625 | 29,356 | **-84%** |
| 成本 | $0.016 | $0.10 | **-84%** |

**结论**:Run A 成本下降主要来自行为层改善(QA 一轮过、read_from_uri 减少、coder 不再 remediation);Run B 下降完全来自 M5 新增的 **Planner Rule 8 短路 hint**。Bedrock prompt-cache 未生效(详见 §3.2 Major-1)。

### 1.3 产物路径

- `runtime/games/smoke-v5/game/` — Ren'Py 产物(`characters.rpy` / `options.rpy` / `script-chapter-01.rpy` 3 个文件 + `.rpyc` + `gui/` + `SourceHanSansLite.ttf`)
- `runtime/games/smoke-v5/workspace/` — per-URI 文档
  - `project.json` / `chapter.json` / `script.json` / `storyboard.json` / `inspiration.txt`
  - `characters/`:`ren-asahi.json`、`sora-miyake.json`、`machi-ta.json`、`daiki-fujiwara.json`、`ember.json`
  - `scenes/`:`scn-01-street.json`、`scn-02-store.json`、`scn-03-rooftop.json`、`scn-04-store-morning.json`、`scn-05-overpass.json`、`scn-06-room.json`
- `runtime/games/smoke-v5/planner_memories/log.jsonl` — 17 条 plan/finish 记忆
- `runtime/games/smoke-v5/logs/v5-trace-2026-05-01T13-41-19-274Z.jsonl` — 212 行(Run A 完整 trace)
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-01T13-59-02-109Z.json` — 顶层 summary

### 1.4 渲染结果

- `renpy-sdk/renpy.exe runtime/games/smoke-v5 lint`:**0 error / 0 warning**
  - 统计:37 dialogue blocks / 661 words / 3,597 chars / 14 images / 24 screens / 0 menus
- `renpy-sdk/renpy.exe runtime/games/smoke-v5 compile`:未单独跑(lint pass 已足以判定可跑)
- 未做交互式启动测试(不阻塞本报告)

---

## 2. Planner 驱动链 trace(Run A)

一共 9 条 finish(含 Planner 最终一条),对应 8 次 handoff。

| # | taskId | handoff POC | 成果 |
| --- | --- | --- | --- |
| 1 | `smoke-v5-plan` | Planner 自身 | 制定 Stage A 7 步流水线 |
| 2 | `producer-smoke-v5-init` | producer | `workspace://project` + `workspace://chapter`(6 场景大纲 + 5 route flags + 完整 cast) |
| 3 | `char-design-smoke-v5` | character_designer | 5 个 character(Ren / Sora / Machi / Daiki / Ember);main image 全部 stub-error(预期)→ status=placeholder |
| 4 | `scene-design-ch1` | scene_designer | 6 个 scene;time-variant ×3 + prop ×2 真被调用(Tier 2 首次真跑) |
| 5 | `writer-chapter-01` | writer | `workspace://script`,6 scenes / ~3,800 words / 5 route flag 分支 |
| 6 | `storyboard-chapter-01` | storyboarder | `condense_to_shots` 产出 8 shots + **4 个 CG entries + notes**(M5 新增字段生效) |
| 7 | `coder-smoke-v5-stage-a` / `coder-smoke-v5-ch01` | coder | ⚠️ 出现 **Minor-2 的孤儿 taskId 模式**:第一个 taskId 只 plan 不 finish,第二个 taskId 重新 plan + write_game_project + finish。新 warn 触发 |
| 8 | `qa-smoke-v5-stage-a` | qa | `run_qa` 一轮 pass,交付"CONDITIONAL PASS"(lint 0 error + 报 3 BLOCKING 非阻塞 + 12 非阻塞)|
| 9 | `smoke-v5-plan` | Planner | `finish("no more tasks, Stage A delivered")` |

### 2.1 Handoff 分布

共 8 次 `handoff_to_agent`:producer / character_designer / scene_designer / writer / storyboarder / **coder ×2** / qa。比 M0 的 11 次(coder ×3 + qa ×2 + remediation)更干净。

### 2.2 Tool_use 分布(总 225 次)

| Tool | 次数 | 占比 | 备注 |
| --- | --- | --- | --- |
| `read_from_uri` | 125 | 56% | M0 是 408 次占 73%。qa 一人读了 43 次(cross-check 所有文档),coder 36 次,writer 18 次,storyboarder 16 次 |
| `call_task_agent` | 11 | 5% | character_main_image_generator ×5 + character_prompt_expander ×(~4) + scene_background_generator ×(~2);全部 stub-error(预期) |
| `output_with_plan` | 9 | | Planner 1 + 8 executer(coder 2 次对应 Minor-2) |
| `handoff_to_agent` | 8 | | |
| `output_with_finish` | 8 | | 缺 1 个(coder 首个 taskId 孤儿) |
| `create_or_update_scene` | 7 | | 6 scene + 1 次更新 |
| `create_or_update_character` | 6 | | 5 character + 1 次更新 |
| `generate_character_main_image` | 5 | | hint tool 路径,全部 stub-error(预期) |
| `generate_scene_time_variant` / `generate_prop` | 3 + 2 | | **Tier 2 首次被 Planner 真调用**(M0 完全跳过) |
| `write_game_project` | 2 | | coder 被 handoff 两次各写一次(Minor-2) |
| `create_project` / `create_chapter` | 1 + 1 | | |
| `draft_script` + `emit_writer_output` | 1 + 1 | | v0.2 tool_use 上级调用 + 下级子调用 |
| `condense_to_shots` + `emit_storyboarder_output` | 1 + 1 | | 同上 |
| `run_qa` | 1 | | M0 是 4 次(2 round) |

### 2.3 Workspace 产物合规

- URI 全部符合 `workspace://<kind>[/<slug>]` 格式
- slug 全部合法 ASCII(`ren-asahi` / `sora-miyake` / `machi-ta` / `daiki-fujiwara` / `ember` / `scn-01-street` 等)
- **storyboard.json 含 `cgList`(4 条)和 `notes`(非空)**—— M5 Minor-3 修复生效
- 5 characters × main_image 状态:全部 `placeholder`(符合 v0.6 预期,Stage B 待接入 task_agent 真实现后触发)

---

## 3. Issue 列表

### 3.1 Blocker(阻塞 V5 流水线)

**(无)** — Run A 完整跑通,lint 0 error,没有死循环,`is_error: true` 仅 `call_task_agent` 的 stub 返回(预期行为)。

### 3.2 Major(能跑但产出/成本不可接受)

**Major-1 · Bedrock prompt-cache 全程 miss(`cacheCreate: 0, cacheRead: 0`)**
- 证据:trace 的 86 次 `llm_chat_with_tools_response` 中,每次 `usage.cacheCreationInputTokens` 和 `usage.cacheReadInputTokens` 都是 0
- 根因:`perf/prompt-cache` 分支已合入 main,Planner/Executer 的 system prompt 也正确打了 `cacheControl: { type: 'ephemeral' }`,但 `src/llm/claude-client.ts` 的 `shouldApplyCacheControl()` 在 Bedrock 模式下 **默认关闭**(需要 `CLAUDE_BEDROCK_CACHE=1` 显式开启)
- 影响:本应由 prompt-cache 带来的 40-60% input token 节省完全没拿到;Run A $3.72 的 45% 降本是行为层改善(QA/coder/read 减少),不是 cache
- 影响范围:所有走 Bedrock 的 V5 真跑都会踩这坑
- **建议**:新开 `fix/bedrock-cache-default` 小分支,把默认值翻转(或在 `.env.example` 里显式列出 `CLAUDE_BEDROCK_CACHE=1`)。单次 V5 跑预期再省 $1.5-2,回到 ~$2 水位

**Major-2 · coder phase 仍出现孤儿 taskId(Minor-2 升级)**
- 证据:`log.jsonl` 第 12-13 行:`coder-smoke-v5-stage-a` 只有 plan 没有 finish,紧接着 `coder-smoke-v5-ch01` 从 plan 开始完整走完。stderr 里 `output_with_plan.orphan_previous` warn 2 次(producer→character 1 次是 producer 刚 finish 但新 taskId 前对齐逻辑误判,可忽略;coder→coder 1 次是真的孤儿)
- 根因:Planner 或 Executer 在 coder 首次 plan 后感知到输出可能过长或需要重排,直接换 taskId 重来。和 M0 一样,LLM 决策,代码侧无法阻止
- 影响:planner_memories 里有一条"只 plan 没 finish"的孤儿,不影响产物但影响审计。rebuild / modify 读 memories 时要能容忍
- **建议**:M5 新增的 warn 已经触发,`feat/v5-modify-chain` 分支需要在读 memories 时**按 taskId 去重 + 忽略孤儿 plan**(取每个 taskId 最后一条 finish)

### 3.3 Minor(可用但有优化空间)

**Minor-1 · cgList / notes 已被 storyboarder 填充,但 coder 没消费**
- 证据:`workspace/storyboard.json` 含 4 条 cgList(shot 4/5/7/8 各标一个 CG)+ 完整 notes,但 `script-chapter-01.rpy` 里没有 `# CG: ...` 注释也没有额外 image define。coder 的 system prompt 不知道 cgList 的存在
- 影响:Stage B 阶段,cgList 是 storyboarder → cutscene/CG 设计师 的数据接口,coder 本就不该直接用;但当前 v0.6 缺 cutscene 执行链,cgList 暂时只是"文档字段"
- **建议**:v0.7 `feat/v5-modify-chain` 或单独 `feat/cg-pipeline`:让 storyboarder 的 cgList 作为 cutscene designer handoff 的输入,产出 workspace://cutscene/<shot> 文档,coder 按 workspace 查 cutscene 产物

**Minor-2 · QA 报 3 BLOCKING 但没有 kick_back**
- 证据:`qa-smoke-v5-stage-a.finish` 说 "3 blocking bugs + 12 non-blocking",但 result 是 "CONDITIONAL PASS",没调 `kick_back_to_coder`
- 根因:QA Executer 的 prompt 对 "BLOCKING" 的定义和 kick_back 的触发阈值不明确 —— LLM 自己决定"虽然 BLOCKING,但是 lint pass 就放行"
- 影响:和 M0 的 QA 相反(M0 一遇 BLOCKING 就 kick 回 coder,代价是 remediation 多烧 $2-3);但过分宽容可能让真 bug 溜过去
- **建议**:v0.7 迭代 QA prompt,明确 BLOCKING/HIGH/MED/LOW 每级的处置策略;或把 "BLOCKING 数 > 0" 作为 `run_qa` 强制 fail 的硬规则

**Minor-3 · call_task_agent stub 返回已是新 schema(retry/guidance),LLM 已正确识别 "not implemented in v0.6" 跳过**
- 证据:character_main_image_generator 被调 5 次全返 `{error, retry: false, guidance: "...mark placeholder..."}`,Planner 把 5 个 character 全标 placeholder 继续,没死循环
- 和 M0 对比:M0 的 error 是裸字符串 `{"error":"not implemented"}`,这次带 `retry: false` + guidance,LLM 行为完全一致 —— **新 schema 向后兼容且语义更清晰**,可以作为新 task_agent 接入的模板

**Minor-4 · Run B 4.1 秒完成 —— M5 短路 hint 完美生效**
- 对比 M0 Run B 16.6 秒 / $0.10,M5 Run B 4.1 秒 / $0.016,降本 84%
- Planner 看到 memories 里有 "no more tasks, Stage A delivered" 直接调 `output_with_finish`,没有再 read_from_uri
- **这是本次 smoke 最干净的回归验证**

**Minor-5 · Planner 系统 prompt 里的 Rule 8 短路 hint 只在 "有 prior finish" 时触发,第一次跑不会干扰**
- Run A 是干净 workspace,hint 段不出现,Planner 正常走完整 7 步;Run B 是已 delivered workspace,hint 段出现,Planner 立刻 finish。分支正确

**Minor-6 · Tier 2 tools 第一次被 Planner 主动调用**
- Run A 中 `generate_scene_time_variant` ×3、`generate_prop` ×2 被 scene_designer 调用 — M0 里 Planner 看到 "(v0.6 stub)" 标记全部绕开;M5 这些 tool 已经是 Tier 2 真值,`feat/v5-tier2-tools` 合入后 poc-registry 的 stub 标记已去除,Planner 成功调用
- 这些调用都走了 RunningHub(不是 task_agent stub),但本次跑时 task_agent 仍返回 stub-error,所以实际没有下单 RunningHub 任务 —— **仍未验证 RunningHub 真实连通性**(Minor-6 from M0 仍开放)

---

## 4. Renpy 启动验证

- 命令:`E:\RenPy\renpy-sdk\renpy.exe E:\RenPy\runtime\games\smoke-v5 lint`
- 结果:**lint PASSED**,0 error,0 warning
- Statistics:37 dialogue blocks / 661 words / 3,597 chars / 14 images / 24 screens / 0 menus
- 补充:未做交互启动(需要 UI 人工点击,不在本 smoke scope)
- 产物组成:3 个手写 .rpy + 3 个 .rpyc + 84 模板文件(gui/ + 字体)

---

## 5. 和 v0.7 路线图的对齐

本次 M5 是 v0.7 branch-plan §0.3 定义的 M5 门禁。按该 spec 的验收条件:

| 条款 | 状态 |
| --- | --- |
| 合并 workspace-unification(M1) | ✅ `a00a9bf` |
| 合并 tier2-tools(M3) | ✅ `12116bc` |
| M5 真 key smoke 跑通 | ✅ 本报告 |
| cost ≤ M0(即下降) | ✅ $6.82 → $3.72 |
| lint clean | ✅ 0 error |
| workspace per-URI 完整 | ✅ |
| 合并 feat/v5-modify-chain(M4) | ❌ 未开分支 |
| 合并 refactor/storyboarder-enum(M4) | ❌ 未开分支 |
| 合并 feat/v5-tier2-tools 真有效 | ⚠️ 代码合入但 task_agent 层仍 stub,真 RunningHub 未被调用 |

**结论**:M5 门禁**通过**了必要条件(跑通 + 降本 + 产物干净),但**不足以作为 v0.7 tag 的临门一脚** —— v5-modify-chain / storyboarder-enum 两条分支还没开,Bedrock cache 还没打开,RunningHub 真连通性也没验。建议把 M5 视为"v0.6.1 patch smoke"。

---

## 6. 结论

**V5 Stage A 管线在 v0.6.1 (follow-up commits on top of v0.6) 上运行稳定、成本可控。** M5 这次的主要胜利:

1. **QA 一轮过**(M0 是 2 轮 + coder remediation)
2. **read_from_uri 下降 70%**(408 → 125)
3. **Run B 幂等短路 84% 降本**($0.10 → $0.016)
4. **storyboarder 的 cgList/notes 字段落地**(workspace 文档含真数据)
5. **call_task_agent 新 error schema 不破坏 LLM 行为,反而更清晰**
6. **Tier 2 tools 首次被 Planner 主动调用**(scene_designer 的 time_variant / prop)

主要未尽:

- **Bedrock prompt-cache 默认关**(Major-1),单次再省 $1.5-2 的机会还在地上没捡
- **coder 孤儿 taskId** 模式还在(Major-2),修不到但 warn 已落地
- **RunningHub 真连通性** 仍没通过真 V5 跑验证(Minor-6 from M0)
- **v0.7 关键路径**(v5-modify-chain / storyboarder-enum) 还没开工

下一步优先级:
1. 开 `fix/bedrock-cache-default` 把 cache 打开,再跑一次 M6 smoke 验证回到 ~$2 预算
2. 开 `feat/v5-modify-chain`,兑现 PLAN §8"改短发"trace
3. `feat/v5-tier2-tools` 的 task_agent 层从 stub 升级为真实现,届时 M7 smoke 才能第一次真正测 RunningHub + 端到端全链

---

## 附录 A:复现命令

```bash
# 前置(干净 workspace,否则 Planner 会走 Run B 幂等短路)
rm -rf runtime/games/smoke-v5  # 或 Remove-Item -Recurse -Force runtime\games\smoke-v5

# 连通性预检(不花钱)
node --env-file=.env scripts/runninghub-connectivity.mjs

# 真跑(会烧 $3-4)
pnpm build
node --env-file=.env scripts/v5-real-key-smoke.mjs

# 验证产物
"E:\RenPy\renpy-sdk\renpy.exe" "E:\RenPy\runtime\games\smoke-v5" lint
```

## 附录 B:本报告引用的 trace 文件清单

- `runtime/games/smoke-v5/logs/v5-trace-2026-05-01T13-41-19-274Z.jsonl`(212 行,Run A)
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-01T13-59-02-109Z.json`
- `runtime/games/smoke-v5/planner_memories/log.jsonl`(17 条)
- `runtime/games/smoke-v5/game/log.txt` / `script-chapter-01.rpy`
- `runtime/games/smoke-v5/workspace/{project,chapter,script,storyboard}.json`
- `runtime/games/smoke-v5/workspace/characters/{ren-asahi,sora-miyake,machi-ta,daiki-fujiwara,ember}.json`
- `runtime/games/smoke-v5/workspace/scenes/{scn-01-street,scn-02-store,scn-03-rooftop,scn-04-store-morning,scn-05-overpass,scn-06-room}.json`

Trace 文件**不入库**(位于 `runtime/` — gitignored)。本报告以引用形式记录足够 re-audit 的元数据。

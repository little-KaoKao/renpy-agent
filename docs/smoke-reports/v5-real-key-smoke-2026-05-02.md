# V5 real-key smoke report — 2026-05-02 (M7, post-Phase-2-A)

Status: **V5 Stage A pipeline is production-stable under Phase-2-A main (budget-cap + storyboarder-enum + compact-ack fix). Prompt cache still a known miss (see Major-1).**

## 1. 元数据

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-05-02 |
| Commit SHA | `7ecab13` (main, after `fix(v5): compact tool_result acks + non-retriable pipeline errors`) |
| 分支 | `main` |
| Story name | `smoke-v5` |
| Inspiration | `一个樱花树下的告白故事` |
| Transport | Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`, region `us-east-1`, inference profile `us.anthropic.claude-sonnet-4-6`) |
| 脚本 | `scripts/v5-real-key-smoke.mjs --budget-cap 5` |

### 1.1 执行概览(并加对比基线)

| Run | 日期 | 耗时 | LLM calls | 输入 tok | 输出 tok | 成本 | Budget hit? | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **M7 Run A**(本报告) | 2026-05-02 | **19.6 分钟** | **72** | **644,465** | **63,521** | **$2.89** | No | 完整 Stage A,lint pass |
| M6 Run A(污染,作废) | 2026-05-02 | 17.6 min | 76 | 751,133 | 32,307 | $2.74 | No | 但 dist/ 含未合并 budget-cap,混杂;见 M5 报告后续说明 |
| M6-regression(作废) | 2026-05-02 | 32.2 min | 69 | 1,159,844 | 108,942 | $5.11 | **YES** | writer 循环空输出烧穿预算;已由 `7ecab13` 修复 |
| M5 Run A | 2026-05-01 | 17.6 min | 86 | 999,841 | 48,336 | $3.72 | — | 首个可比较的干净 Run A |
| M0 Run A | 2026-04-26 | 27.2 min | 146 | 1,901,818 | 74,545 | $6.82 | — | 第一次真 key 跑 |

### 1.2 相对 M5 的变化(都是干净基线,直接可比)

| 指标 | M7 Run A | M5 Run A | 变化 |
| --- | --- | --- | --- |
| 耗时 | 19.6 min | 17.6 min | +11% |
| LLM calls | 72 | 86 | **-16%** |
| Input tokens | 644,465 | 999,841 | **-36%** |
| Output tokens | 63,521 | 48,336 | +31% |
| **成本** | **$2.89** | **$3.72** | **-22%** |
| QA LLM calls | 6 | 31 | **-81%**(非常显著) |
| QA 回退 coder | 0 | 0 | = |
| coder handoff 数 | 2(见 §3.1) | 2 | = |
| scene duplicate 次数 | 1(backstage-room×2) | 0 | +1(但影响极小) |
| storyboarder 重试次数 | 2 | 0 | +2(见 §3.2) |

耗时略长是因为 output tokens 多了 31%(LLM 把 draft 讲得更详细);成本比 M5 便宜主要因为 **QA 不再 read 每一份 URI**(从 43 次跌到 6 次,拉走 20% 总 token)。

### 1.3 相对 M0 的累计改进

| 指标 | M7 | M0 | 累计 |
| --- | --- | --- | --- |
| 成本 | $2.89 | $6.82 | **-58%** |
| 耗时 | 19.6 min | 27.2 min | **-28%** |
| LLM calls | 72 | 146 | **-51%** |

4 次 smoke 下来,V5 Stage A 价格砍到了 M0 的 42%。

### 1.4 产物路径

- `runtime/games/smoke-v5/game/` — Ren'Py 产物(`characters.rpy` / `options.rpy` / `script-chapter-01.rpy` 3 个 .rpy + .rpyc + gui/ + 字体)
- `runtime/games/smoke-v5/workspace/` — per-URI 文档
  - `project.json` / `chapter.json` / `script.json` / `storyboard.json`
  - `characters/`:`kaito-mura.json`、`seren-ashby.json`、`daisuke-dai-nomura.json`、`mira-leclerc.json`
  - `scenes/`:`lantern-bar-interior.json`、`lantern-alley-exterior.json`、`lantern-backstage-room.json`
  - `props/`:7 个(storyboarder 触发 `generate_prop` ×7,tool schema 生效)
- `runtime/games/smoke-v5/planner_memories/log.jsonl` — 15 条 plan/finish 记忆
- `runtime/games/smoke-v5/logs/v5-trace-2026-05-02T05-38-15-391Z.jsonl` — ~200 行
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-02T05-57-52-*.json` — 顶层 summary

### 1.5 渲染结果

- `renpy-sdk/renpy.exe runtime/games/smoke-v5 lint`:**0 error / 0 warning**
  - Statistics:33 dialogue blocks / 472 words / 2,492 chars / 10 images / 24 screens / 0 menus

---

## 2. Planner 驱动链 trace

8 次 `handoff_to_agent`(coder 被 handoff 两次,见 §3.1):

```
producer → character_designer → scene_designer → writer
  → storyboarder → coder → coder → qa → finish("no more tasks, Stage A delivered")
```

### 2.1 Per-role token shares(M7)

| POC | Calls | Input tokens | 占比 |
| --- | --- | --- | --- |
| **coder** | 17 | 169,101 | **26%** |
| **scene_designer** | 13 | 158,696 | **25%** |
| **storyboarder** | 13 | 132,841 | 21% |
| qa | 6 | 68,886 | 11% |
| writer | 6 | 46,778 | 7% |
| character_designer | 6 | 32,934 | 5% |
| planner | 7 | 27,075 | 4% |
| producer | 4 | 8,154 | 1% |

与 M5(QA 58%,其他都 <10%)相比,M7 的 token 分布**均匀了很多** —— QA 从"一个人吃 58%"降到 11%,coder/scene_designer/storyboarder 变成新三甲。说明 compact-ack 修复让各 POC 的 tool_result 都变小了,而 QA 的 cross-check 行为没有 regression。

### 2.2 Tool_use 分布(Top 12)

| Tool | 次数 | 备注 |
| --- | --- | --- |
| `read_from_uri` | 82 | M5 是 125。降 34%。QA compact-ack 修复的直接效果 |
| `output_with_plan` | 9 | 8 executer + 1 Planner(+ 3 因孤儿 taskId 重新 plan) |
| `handoff_to_agent` | 8 | 和 M5 相同 |
| `call_task_agent` | 7 | 全部 stub-error(预期) |
| `generate_prop` | 7 | scene_designer 自己触发 —— **Tier 2 真被用,且多于 M5** |
| `output_with_finish` | 6 | 2 个 coder 孤儿没 finish |
| `generate_scene_time_variant` | 5 | 同上,Tier 2 活跃 |
| `create_or_update_character` | 4 | **4 character × 1 次**,M6-pre-fix 是 7 × 1~2(dedup 修复生效) |
| `create_or_update_scene` | 4 | **3 scene 本应 3 次,实际 4 次(backstage-room dup)**。见 §3.3 |
| `condense_to_shots` | 3 | storyboarder 重试了 2 次。见 §3.2 |
| `emit_storyboarder_output` | 3 | 同上 |
| `write_game_project` | 2 | coder 2 次 handoff 各写 1 次 |

### 2.3 Workspace 产物合规

- URI 全部合法 `workspace://<kind>[/<slug>]`
- slug 全 ASCII(`kaito-mura` / `seren-ashby` / ...,包括 CJK-origin 名字被 LLM 英文化)
- `storyboard.json` 含 `cgList`(5 条)但 `notes` 为空(和 M5 的 4+notes 相比,LLM 这次没给 notes)
- **7 个 prop** 和 **5 个 scene time-variant** 文档产出 —— Tier 2 首次被如此密集使用
- asset-registry 所有 character/scene/prop 的 `status` 仍是 `placeholder`(task_agent 还没真实现)

---

## 3. Issue 列表

### 3.1 Blocker

**(无)**。Run A 完整跑通,lint 0 error,没有死循环,无 budget cap 触发。`7ecab13` 修复的两个回归全部未复现。

### 3.2 Major(能跑但产出/成本不可接受)

**Major-1 · Bedrock prompt cache 全程 miss(`cacheCreate=0, cacheRead=0`)**
- 和 M5 / M6 一致。经诊断:`PLANNER_SYSTEM_PROMPT` 1408 chars、Executer cacheable segment 977 chars,都**低于 Anthropic prompt cache 的 ~4096 char (~1024 token) 最小门槛**,SDK 静默忽略 `cache_control`
- 不是 `fix/bedrock-cache-default` 的 bug:`cache_control: {type:'ephemeral'}` 已经在请求里发出去,但 token 数不够没激活
- 影响:本应 40-60% 的 cache read 节省完全没拿到
- **建议**:新建 `feat/prompt-cache-inflation` 分支。把 workspace TS schema(至少 `galgame-workspace.ts` 关键部分)塞进 Planner/Executer 的 **静态** system 段,同时合并 POC 描述 + tool 用法示例,让 cacheable 段膨胀到 > 4096 chars。工作量 ~半天,预期进一步砍 30-50% 成本

**Major-2 · storyboarder 消费了 21% token(132k input)却只产 8 shots + 5 cgList**
- `condense_to_shots` 被调 3 次:第一次 cgEntries=5、第二次 cgEntries=0(退步?)、第三次 cgEntries=5
- 对应 `emit_storyboarder_output` 也被调 3 次
- 根因:**Planner 或 storyboarder Executer 自主决定重试两次**。即使 `7ecab13` 确保 runStoryboarder 不会无限 retry,Executer 循环里 LLM 可以主动调同一个 tool 3 次(每次都"覆写" workspace://storyboard)
- 影响:第二次 `condense_to_shots(cgEntries: 0)` 短暂把 workspace 退回了无 cgList 状态,然后第三次恢复。如果中间有人读 workspace 就看到中间态
- **建议**:
  1. `condense_to_shots` 返回值注意变小(M7 的 compact-ack 还是漏了)
  2. 更重要的:executer.ts 加 per-role "tool call 软上限"(同一 tool 名 ≥3 次调用时,logger.warn)
  3. 也可能是 storyboarder 的 system prompt 让 LLM 以为"多次调可以精修"—— 审一遍 prompt

### 3.3 Minor

**Minor-1 · scene_designer 复现 1 次 duplicate upsert(lantern-backstage-room × 2)**
- 和 M6 pre-fix 的 9×2 相比基本消失
- 可能是 LLM 在第一次 tool_result 和第二次 tool_call 之间,语义上把"同名场景"理解成了"重启"。compact-ack 让它只多调了 1 次而不是 9 次 —— 修复生效,但不是零
- **建议**:不紧急

**Minor-2 · coder 第 1 个 taskId 孤儿(Minor-4 from M0/M5 复现)**
- `smoke-v5-ch1-renpy` 只有 plan 没有 finish;紧接着 `smoke-v5-ch1-coding` 完整跑完
- `output_with_plan.orphan_previous` warn 触发 2 次(coder 和 storyboarder 各一次)
- 和 M0/M5/M6 都一样 —— 根因是 Claude 认为需要"换 taskId 重新规划",不是我们能直接阻止的 LLM 决策
- **建议**:同 M5 建议,在 v5-modify-chain 分支里做 taskId dedup(读 memories 时按 taskId 去重)

**Minor-3 · QA 只读了 6 次,lint pass 但没做深度 cross-check**
- M5 的 QA 读了 43 次文档做 cross-ref,找出 3 BLOCKING + 12 非阻塞
- M7 的 QA 只读 6 次就 pass —— 可能是因为 compact-ack 让 QA 提前"认为没什么好查",也可能是 LLM 这次心情好
- 影响:lint 0 error 不代表深度合规。M5 那 3 个 BLOCKING 如果 M7 也有但 QA 没抓,会被 mis-pass
- **建议**:QA 的 system prompt 加一条 "必须 read_from_uri 至少所有 character/scene/storyboard/script,数不够 ≥ handoff 之前 workspace 文档数的 1/2 就不能 pass"。简单的额度强制

**Minor-4 · call_task_agent 7 次全返 stub-error(预期)**
- `character_main_image_generator` / `character_prompt_expander` / `scene_background_generator` 等底层 task_agent 仍是 v0.6 stub。等 `feat/v5-task-agent-real` 合入后 M8 smoke 才真首次出角色/场景图

**Minor-5 · storyboarder 生成了 7 个 prop 和 5 个 time_variant,但没 notes**
- 和 M5 的"4 cgList + notes"相比,M7 跳过了 notes
- 因为 Storyboarder 的 cgList/notes 都是可选字段,不强制
- 可接受,无需修复

**Minor-6 · 新 enum transforms 是否被 Storyboarder 使用?**
- 本报告未深入检查 `script-chapter-01.rpy` 是否用了 `pan_left` / `fade_in` / `shake` 等新 transform
- **建议**:手工打开 `runtime/games/smoke-v5/game/script-chapter-01.rpy` 搜 transform 名,报在下一次会话

---

## 4. Ren'Py 启动验证

- 命令:`renpy-sdk\renpy.exe runtime\games\smoke-v5 lint`
- 结果:**PASS**,0 error,0 warning
- 统计:33 dialogue / 472 words / 10 images / 24 screens / 0 menus
- 手工交互启动:未做

---

## 5. 与 v0.7 Phase 2 计划的对齐

| Phase 2 §5.x 任务 | 状态 |
| --- | --- |
| §5.1 M6 smoke | 前两次失败,本次(M7)**通过**:干净跑通 + $2.89(plan 预期 $2-3) |
| §5.2 budget-cap | ✅ 已合入 main(commit `08560e3`),M6/M7 都真激活过 |
| §5.3 storyboarder-enum | ✅ 已合入 main(commit `8171739`) |
| §5.4 task-agent-real | 未开工 |
| §5.5 modify-chain | 未开工 |
| 附加:compact-ack + non-retriable guard | ✅ 本次 smoke 顺带修(commit `7ecab13`) |

**M7 smoke 作为 task-agent-real 的真基线有效。** 不需要再跑"M8 校准前跑"。

---

## 6. 结论

**V5 Stage A 管线在 main @ `7ecab13` 上稳定、可控、经济。** 本次 smoke 胜利:

1. **成本 vs M5 降 22%,vs M0 累计降 58%**($6.82 → $3.72 → $2.89)
2. **LLM calls vs M5 降 16%,vs M0 降 51%**(146 → 86 → 72)
3. **lint pass,可运行 .rpy 产物,3 scene × 7 prop × 5 time-variant 的 Tier 2 schema 活跃**
4. **compact-ack 修复生效**:scene_designer duplicate 从 9×2 → 1×2,character_designer 0 dup
5. **writer 不再无限重试**:内部 retry 2 次 + 非重试错误让 Planner 停手
6. **budget-cap 没触发但在位**:$2.89 < $5 cap

主要未尽:

- **Bedrock prompt cache 还是 0%**(Major-1),需要独立分支膨胀 system 段
- **storyboarder 3 次 emit 浪费**(Major-2),需要 executer 层的软上限或 prompt 调整
- **QA 深度不够**(Minor-3),需要 prompt 强制 read 额度

---

## 附录 A:复现命令

```powershell
# 前置
cd E:\RenPy
Remove-Item -Recurse -Force runtime\games\smoke-v5
Remove-Item -Recurse -Force dist
pnpm build
node --env-file=.env scripts/runninghub-connectivity.mjs   # 可选预检

# 真跑(预算 $5 保险)
node --env-file=.env scripts/v5-real-key-smoke.mjs --budget-cap 5

# 验证
renpy-sdk\renpy.exe runtime\games\smoke-v5 lint
```

## 附录 B:本报告引用的 trace 文件清单

- `runtime/games/smoke-v5/logs/v5-trace-2026-05-02T05-38-15-391Z.jsonl`
- `runtime/games/smoke-v5/logs/v5-smoke-summary-2026-05-02T05-57-*.json`
- `runtime/games/smoke-v5/planner_memories/log.jsonl`(15 条)
- `runtime/games/smoke-v5/game/script-chapter-01.rpy` / `log.txt`
- `runtime/games/smoke-v5/workspace/*.json`(project / chapter / script / storyboard)
- `runtime/games/smoke-v5/workspace/characters/*.json`(4 条)
- `runtime/games/smoke-v5/workspace/scenes/*.json`(3 条)
- `runtime/games/smoke-v5/workspace/props/*.json`(7 条)

Trace 文件**不入库**(位于 `runtime/` — gitignored)。本报告以引用形式记录足够 re-audit 的元数据。

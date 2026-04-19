---
name: renpy-storyboard
description: Use this skill whenever the user wants to turn a galgame / visual novel script, outline, or story draft into a structured storyboard for Ren'Py. Trigger on any request involving "剧本转故事板", "script to storyboard", "visual novel planning", "分镜", "拆镜头", "写 galgame 分镜", or any task where narrative prose needs to be converted into shot-by-shot plans with visuals, dialogue, effects, audio, and player interactions. Also use when the user has a Ren'Py project and says things like "帮我规划这段剧情怎么演出" or "把这段剧本改成可以写代码的格式". The output is a structured storyboard that downstream coding agents can directly translate into .rpy files.
---

# Ren'Py Galgame Storyboard

## What this skill does

Transforms raw narrative material (scripts, outlines, prose, bullet points, even vague ideas) into a **shot-by-shot storyboard** formatted specifically for Ren'Py visual novel implementation. Each shot contains everything a coding agent needs to write `.rpy` code — scene state, character state, dialogue, visual effects, audio, and player interactions — with no invention or guessing required.

The storyboard is the **intermediate artifact** between "I have a story" and "here is the working game". Think of it as the bridge between a screenwriter and a programmer.

## Why this skill exists

Writing Ren'Py code directly from a rough story idea produces bad results: the coding agent has to guess at visuals, invent effects that don't fit the mood, and miss opportunities for emotional beats. A storyboard forces the key creative decisions to happen once, explicitly, so code generation becomes mechanical and reliable.

Equally important: a storyboard is **reviewable by a human**. Before burning time on code, the writer/director can read the storyboard in minutes and catch pacing problems, missing emotional beats, or over-the-top effects.

## When to use

Trigger this skill when you see requests like:
- "把这段剧本改成故事板"
- "帮我规划 galgame 的这一章怎么演出"
- "我写了一段剧情，帮我拆成 Ren'Py 能实现的分镜"
- "给这段对话加上演出效果"
- "这段故事要用什么特效？按镜头列出来"
- Any time the user provides narrative prose + wants it ready for Ren'Py implementation

**Do NOT use** for:
- Direct `.rpy` code writing (that's the next step, done from a storyboard)
- Pure writing help (story ideation, dialogue polish) — only trigger when Ren'Py implementation is the goal
- Non-galgame projects (Unity, RPG Maker, etc.)

## Workflow

Follow this sequence. Each step has a purpose; skipping them leads to storyboards that look polished but don't actually help the code agent.

### 1. Read and understand the source material

Before designing anything, read the user's input end-to-end. Identify:
- **Characters** present (name, rough personality if given)
- **Locations** (each distinct background)
- **Emotional arc** (what does the reader feel at start vs. end?)
- **Key beats** (turning points, reveals, confessions, fights — these deserve the best effects)
- **Explicit player choices** the user mentioned (if any)

If the source is too vague to storyboard (e.g., one sentence), ask one clarifying question before proceeding. Do not invent major plot points.

### 2. Decide the shot breakdown

A "shot" in this storyboard = a unit where the visual/audio state is roughly stable. Trigger a new shot when ANY of these change:
- Background (scene)
- A character enters or leaves
- A character's expression/pose/emotion meaningfully changes
- Camera focus changes (close-up, wide shot)
- Mood/lighting shifts (day → night, calm → tense)
- A player choice appears
- A major effect fires (flashback start, screen shake, CG reveal)

**Keep shots meaningful, not granular.** A 10-line dialogue with one character in one expression = ONE shot, not ten. Over-splitting makes the storyboard unreadable.

Typical density: 3-8 shots per minute of reading time.

### 3. Assign effects and interactions to each shot

For each shot, decide what visual/audio techniques and player interactions serve the story. Use the two reference files together:

- **[references/full-inventory.md](references/full-inventory.md)** — 工具箱全量清单。先扫一眼这里，确认你知道手上有哪些工具可用（视觉 A1–A12 + 交互 B）。不要凭记忆，Ren'Py 的能力范围比直觉宽。
- **[references/effects-catalog.md](references/effects-catalog.md)** — 按情绪/场景索引的推荐。确定镜头情绪后查这里，看哪些工具契合。

**两条防滥用规则：**
1. **每镜头 1-2 个主要效果。** "樱花 + 模糊 + 色调 + 震动 + 推镜"的镜头几乎总是比"樱花 + Ken Burns"更差。
2. **效果必须服务情绪而非装饰。** 如果答不出"这个效果让玩家感觉到什么？"，就删掉。

**玩家交互同样要刻意选择：** 不要默认所有选择点都写成最朴素的 `menu`。查一下 full-inventory 的 B 节——也许这个场景更适合条件选项、限时选择、imagemap 探索,或者干脆不需要交互。

### 4. Write the storyboard in the required format

Use the exact structure below (details in [Storyboard format](#storyboard-format)). The format is designed so a coding agent can parse each field mechanically and produce `.rpy` code without guessing.

### 5. Hand off with an implementation hint

End the storyboard with a short **"Implementation notes"** section pointing out:
- Assets the user needs to prepare (list of image/audio filenames referenced)
- Any effect that requires custom shaders or Live2D setup
- Suggested `.rpy` file structure if the chapter is long

This saves the coding agent (and the user) from hunting through the storyboard to figure out what's missing.

## Storyboard format

Use this exact template. Machine-parseable, human-readable. See [assets/storyboard-template.md](assets/storyboard-template.md) for a blank copy you can fill in.

```markdown
# 故事板：[章节/场景名]

## 总览
- **基调**：[一句话描述整段的情绪基调，如"夏日黄昏的告白，紧张转释然"]
- **角色**：[出场角色列表，含简短标签如"艾琳（女主，元气）"]
- **场景**：[所有用到的背景列表]
- **核心演出点**：[1-3 个你认为最需要重点演出的时刻]

## 镜头 1：[镜头标题，如"教室的午后"]

- **剧情**：[1-2 句话描述这个镜头在故事里做什么]
- **场景**：bg_classroom_afternoon
- **角色状态**：
  - eileen：center，happy 表情，校服
  - （无其他角色）
- **对话 / 旁白**：
  > 旁白："窗外知了叫个不停。"
  > eileen（笑）："终于放学啦！"
- **视觉效果**：
  - 主要：光斑粒子（Sprites），营造午后阳光
  - 次要：立绘呼吸动画（ATL 循环）
- **音效 / 音乐**：
  - BGM：bgm_schoolday.ogg（轻快）
  - SFX：sfx_cicada.ogg（循环）
- **转场进入**：dissolve（从上一镜头）
- **玩家交互**：无（自动推进）
- **预估时长**：~15 秒阅读

## 镜头 2：[...]

（同样结构）

## 镜头 N：[选择点示例]

- **剧情**：主角需要决定是否告白
- **场景**：bg_park_sunset
- **角色状态**：
  - eileen：right，nervous 表情，脸红
  - player（隐身，使用 Side Image）
- **对话 / 旁白**：
  > eileen（低头）："那个……我……"
- **视觉效果**：
  - 主要：轻微画面震动（ATL 抖动，模拟心跳）
  - 次要：背景轻度模糊（Blur Shader）突出立绘
- **音效 / 音乐**：
  - BGM：bgm_confession.ogg（减弱至 50% 音量）
  - SFX：sfx_heartbeat.ogg（低音循环）
- **转场进入**：None（保持前一镜头画面）
- **玩家交互**：
  - 类型：menu（分支选择）
  - 选项：
    - "告白" → 跳转到 label route_confession
    - "说点别的" → 跳转到 label route_friend
- **预估时长**：等待玩家

## 实施备注（Implementation notes）

- **需准备的资源**：
  - 图像：bg_classroom_afternoon, bg_park_sunset, eileen (happy/nervous/blush)
  - 音频：bgm_schoolday.ogg, bgm_confession.ogg, sfx_cicada.ogg, sfx_heartbeat.ogg
- **需配置的特效**：
  - 光斑粒子：使用 renpy.display.particle 自定义 sprite，参考 references/effects-catalog.md 的"光斑"章节
  - Blur Shader：需启用 model-based rendering
- **建议 .rpy 结构**：
  - 主对话写入 chapter1.rpy
  - 两条分支 route_confession/route_friend 放在 chapter1_routes.rpy
- **Ren'Py 映射提示**：参考 references/renpy-mapping.md 获取每个效果对应的 Ren'Py 代码片段
```

## Field conventions (important)

These conventions make the storyboard parseable. Follow them strictly.

- **场景 / 角色名** use lowercase snake_case identifiers (e.g., `bg_classroom_afternoon`, `eileen_happy`). This is how they'll appear as Ren'Py image names.
- **对话** use `>` blockquote with speaker name, parenthetical for tone/action. Narration uses `旁白` as the speaker.
- **视觉效果** always split into **主要 / 次要** (primary / secondary) — forces the cap of 1-2 effects.
- **转场进入** use Ren'Py's built-in transition names when possible: `fade`, `dissolve`, `pixellate`, `hpunch`, `vpunch`, `None` (no transition). Custom transitions get a bracketed note.
- **玩家交互** 常用类型：`none`(自动) / `click`(等点击) / `menu`(分支) / `menu + 条件` / `menu + 限时` / `input`(文本输入) / `imagemap`(图片热区) / `drag`(拖拽) / `yesno_prompt`(是否确认) / `custom_screen`(自定义界面) / `pause`(定时/静默)。完整清单和各类型的故事板写法见 [full-inventory.md](references/full-inventory.md) 的 B 节。
- **预估时长** helps with pacing review; rough guesses are fine.

## How to use the references

This skill has three reference files. Read them when relevant — don't dump them into the storyboard.

- **[references/full-inventory.md](references/full-inventory.md)** — **工具箱全量清单**：按类别（转场/ATL/粒子/滤镜/Shader/LayeredImage/Live2D/Movie/3D/文字/镜头/音频 + 玩家交互）列出全部 Ren'Py 可用工具，每条带难度星级和一句话用途。设计每个镜头前都应该扫一眼，避免因"没想到还能这么做"而漏掉合适的工具。这是你在工作流步骤 3 的主要参考。

- **[references/effects-catalog.md](references/effects-catalog.md)** — **情绪索引的效果推荐**：按故事场景类型（"角色登场"、"回忆"、"告白"、"战斗"等）推荐契合的效果。先在 full-inventory 确认能做什么,再来这里挑情绪契合的那一两个。

- **[references/renpy-mapping.md](references/renpy-mapping.md)** — **效果 → Ren'Py 代码片段对照**：规划某个效果时想确认"这真的能在 Ren'Py 8.x 实现吗？",查这里。不要把代码粘进故事板——只用来验证可行性,给下游 coding agent 留锚点。

## Common pitfalls

- **Don't write code.** A storyboard is not `.rpy`. Effects are named in plain language (e.g., "光斑粒子"), not as Python statements. Code generation is the next agent's job.
- **Don't over-detail.** If a shot has 15 lines of dialogue with no state change, it's ONE shot. Resist the urge to break every line into its own shot.
- **Don't invent plot.** If the user's source is sparse, note gaps in the storyboard with `[TBD: ...]` rather than filling them in.
- **Don't skip Implementation notes.** Even a one-line "all assets already exist" is better than nothing — the next agent needs this.
- **Don't recommend effects that need assets the user doesn't have.** If they have only static立绘, don't plan Live2D shots. Check for realism.

## Example transformations

**Example 1 — Minimal input:**

Input:
> 早上艾琳在教室里和我打招呼，然后问我今天放学要不要一起回家。我同意了。

Output (abridged):
```markdown
# 故事板：早晨的邀约

## 总览
- 基调：清新日常，轻微心动
- 角色：eileen（女主，元气），player
- 场景：bg_classroom_morning
- 核心演出点：eileen 的邀约瞬间

## 镜头 1：教室早晨
- 剧情：主角到教室，艾琳主动打招呼
- 场景：bg_classroom_morning
- 角色状态：
  - eileen：left，happy，校服
- 对话：
  > eileen："早啊！"
- 视觉效果：
  - 主要：晨光光斑粒子
  - 次要：立绘呼吸
- 音效：BGM bgm_morning.ogg
- 转场进入：fade
- 玩家交互：none
- 预估时长：~8 秒

## 镜头 2：邀约
- 剧情：艾琳鼓起勇气邀约
- 场景：bg_classroom_morning（不变）
- 角色状态：
  - eileen：center（移动靠近），shy，脸微红
- 对话：
  > eileen（小声）："那个……放学要一起回家吗？"
- 视觉效果：
  - 主要：立绘移动（MoveTransition ease）
  - 次要：背景轻度失焦突出 eileen
- 音效：BGM 不变，SFX sfx_heartbeat.ogg 轻入
- 转场进入：None
- 玩家交互：
  - 类型：menu
  - 选项：
    - "好啊" → label route_together
    - "今天有事" → label route_alone
- 预估时长：等待玩家

## 实施备注
- 需准备：bg_classroom_morning, eileen (happy/shy), bgm_morning.ogg, sfx_heartbeat.ogg
- 无需自定义 shader
```

Note how the minimal input expanded into 2 shots — not 5, not 1. One for establishing, one for the choice beat.

**Example 2 — Richer input:**

Input: A paragraph describing a breakup scene in the rain at night.

Key decisions:
- Multiple shots to show escalation (argument starts → peak → character leaves)
- Rain particles throughout, but intensity varies (heavier at emotional peak)
- Cool blue color grading for the whole sequence
- `hpunch` shake on the breakup line
- `vpunch` or camera pull-back when the character walks away

You'd structure 4-5 shots, reuse one background (rainy street), vary character positions and expressions, escalate then release the tension via effects.

## Output quality checklist

Before delivering a storyboard, verify:
- [ ] Every shot has all required fields filled (or explicitly `none`)
- [ ] Each effect ties to an emotional reason (ask yourself "why this effect here?")
- [ ] Character and scene names are consistent across shots (snake_case identifiers)
- [ ] Player interactions are explicit (even "none" is stated)
- [ ] Implementation notes list every asset referenced
- [ ] No effect requires tech the user doesn't have (Live2D, custom shaders) without flagging it
- [ ] Total shot count feels right: neither every sentence (too granular) nor one big blob (too coarse)

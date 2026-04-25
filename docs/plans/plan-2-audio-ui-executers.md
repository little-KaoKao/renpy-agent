# Plan 2 — v0.5 四位新 POC executer 实装(BGM / Voice / SFX / UI)

> 前置:Plan 1 必须先落。本 plan 假设 `runninghub-schemas.ts` / `runninghub-client.ts` 已完成以下改造:
> 1. `AiAppSchema` 升级为 `fields: AiAppNodeFieldSchema[]`,支持任意 nodeId × fieldName。
> 2. `submitTask` 吃 `(appKey, inputs[])`,inputs 是 `(role, value)` 数组。
> 3. `BGM_TRACK` / `VOICE_LINE` / `SFX` / `CHARACTER_MAIN_IMAGE` 等全部登记真值 webappId。
> 4. `BGM_TRACK` 走 RunningHub SunoV5(**不再另封 suno client**,PLAN.md §3.5 也要跟改)。
>
> 本 plan 目标:四个 `generate-*.ts` executer 从无到有,`Pipeline` 串上四步,Coder 在 .rpy 里插 `play music / voice / play sound`,UI 补丁 merge 进 `screens.rpy`。不做 modify 场景、不做 Ren'Py screens.rpy 补丁预览。

## 0. 范围边界

**做**:
- `src/executers/music-director/generate-bgm-track.ts`(RunningHub SunoV5)
- `src/executers/voice-director/generate-voice-line.ts`(Qwen3 TTS)
- `src/executers/sfx-designer/generate-sfx.ts`(Qwen3 TTS 复用)
- `src/executers/ui-designer/generate-ui-patch.ts`(LLM,不走 RunningHub)
- 单测(mock client / mock LlmClient)
- Coder 扩展:在 .rpy 里插 `play music` / `voice` / `play sound`,merge UI 补丁到 `screens.rpy`
- Pipeline 串线:v0.5 版 `runPipeline` 在 Coder 前多跑 4 步(最小集:前 N 句对白、N 个镜头的 SFX、1 条 BGM、1 套 main_menu UI)
- 按 schema 扩 `AssetType`:新增 `ui_patch`(BGM/Voice/SFX 的 `bgm_track`/`voice_line`/`sfx` 已存在)

**不做**:
- modify 场景 CLI(单独 plan)
- UI 按钮图 / BGM 鉴赏页资产生成链(复用 Scene/Prop 生成,后续迭代)
- 音频占位的"静音 ogg"资源文件(占位用空字符串 path + `# TODO audio placeholder`,Ren'Py 端语法不报错就行)

## 1. 架构共识

四位 executer 遵循已有两条路线中的一条:

| 路线 | 代表 | 流程 |
| --- | --- | --- |
| **RunningHub 生成型** | character-designer / scene-designer / storyboarder | prompt → `runImageTask` → `swapAssetPlaceholder`(下载 + registry upsert) |
| **LLM 生成型** | planner / writer / storyboarder(文本部分) | LlmClient.chat → 解析 JSON / 补丁 → 写 workspace |

映射:
- BGM(SunoV5)、Voice(Qwen3 TTS)、SFX(Qwen3 TTS 复用)—— 全部走 **RunningHub 生成型**
- UI Designer —— 走 **LLM 生成型**,产物是 `screens.rpy` 补丁字符串

四位都必须:
1. 拒绝静默失败:RunningHub 错误经 `RunImageTaskError` 抛出;LLM 返回不合法 JSON 直接 throw,由 Pipeline 处理兜底。
2. 幂等:重试相同 `logicalKey` 时覆盖 registry 条目(`swapAssetPlaceholder` 已幂等)。
3. 用 `getAppApiId(appKey)` 拿真值,不写裸字符串。

## 2. 音频资产 logicalKey / 落地路径约定

Ren'Py 端要求资产路径相对 `game/` 用 POSIX 斜杠。新增约定:

| assetType | logicalKey 模板 | 目标路径 | 扩展名 |
| --- | --- | --- | --- |
| `bgm_track` | `bgm:<slug>` | `audio/bgm/<slug><ext>` | `inferExtensionFromUrl`(Suno 一般返回 `.mp3`) |
| `voice_line` | `voice:scene_<N>:line_<i>` | `audio/voice/scene_<N>/line_<i><ext>` | `.mp3` / `.ogg` |
| `sfx` | `sfx:shot_<N>:<cue>` | `audio/sfx/shot_<N>_<cue><ext>` | `.mp3` / `.ogg` |
| `ui_patch`(新) | `ui:<screen>` | **无** —— 补丁直接 merge 进 `screens.rpy`,不进 registry | — |

`slug` 统一走 [src/assets/download.ts:L61-L67](src/assets/download.ts#L61-L67) 的 `slugForFilename`。

**`download.ts` 已允许 `.mp3` / `.ogg` 扩展名**([src/assets/download.ts:L56](src/assets/download.ts#L56)),不用改。

**`AssetType` 扩**:[src/assets/registry.ts:L18-L28](src/assets/registry.ts#L18-L28) 已有 `bgm_track` / `voice_line` / `sfx`,够用。UI 补丁不进 registry(没有二进制产物),不扩。

## 3. 文件级清单

### 3.1 Music Director —— `src/executers/music-director/`

**新建 `generate-bgm-track.ts`**:

```ts
export interface GenerateBgmTrackParams {
  readonly trackName: string;          // 人类可读,用来做 slug 和 Suno 的 title
  readonly styleDescription: string;   // 对应 SunoV5 nodeId=14 / fieldName=text
  readonly version?: string;           // SunoV5 version 下拉,默认 'v4.5'
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateBgmTrackResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

export async function generateBgmTrack(
  params: GenerateBgmTrackParams,
): Promise<GenerateBgmTrackResult>
```

**实现要点**:
- `logicalKey = 'bgm:' + slugForFilename(trackName)`
- `inputs = [{role:'title', value:trackName}, {role:'prompt', value:styleDescription}, {role:'version', value:version ?? 'v4.5'}]`
- `timeoutMs` 默认 10 分钟(Suno 慢)—— 高于图像 5 分钟默认。
- 产物 URL 可能是 `.mp3`,`swapAssetPlaceholder` 吃 `targetRelativePath = 'audio/bgm/<slug>.mp3'`(用 `inferExtensionFromUrl`)。
- 失败调 `markAssetError`,和 character-designer 一致。

**新建 `index.ts`**:re-export `generateBgmTrack` + types。

**新建 `generate-bgm-track.test.ts`**:覆盖 3 条 —— 成功路径、submit 抛错走 markAssetError、timeout 走 markAssetError。用 `FakeRunningHubClient`(照抄 [src/executers/character-designer/generate-main-image.test.ts](src/executers/character-designer/generate-main-image.test.ts) 的样例)。

### 3.2 Voice Director —— `src/executers/voice-director/`

**新建 `generate-voice-line.ts`**:

```ts
export interface GenerateVoiceLineParams {
  readonly sceneNumber: number;
  readonly lineIndex: number;
  readonly text: string;              // Qwen3 nodeId=1 / line_text
  readonly voiceTag: string;          // Qwen3 nodeId=2 / voice_text
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}
```

**实现要点**:
- `logicalKey = \`voice:scene_${sceneNumber}:line_${lineIndex}\``
- `inputs`:按 Qwen3 curl 的 4 条 fixed options(`nodeId=7 select=1`、`nodeId=6 select=1`)+ 两个 text。客户端内部根据 schema 的 `fields.role` 映射,所以上层只传 `voice_text` / `line_text` 两个 role 就够。
- `targetRelativePath = \`audio/voice/scene_${sceneNumber}/line_${lineIndex}${ext}\``
- `assetType = 'voice_line'`。
- 默认 `timeoutMs = 3 分钟`(TTS 快)。

**新建 `index.ts` + `generate-voice-line.test.ts`**(同 BGM 结构)。

### 3.3 SFX Designer —— `src/executers/sfx-designer/`

**新建 `generate-sfx.ts`**:

```ts
export interface GenerateSfxParams {
  readonly shotNumber: number;
  readonly cue: 'enter' | 'action' | 'exit' | 'ambient';
  readonly description: string;       // 塞进 Qwen3 的 line_text
  readonly voiceHint?: string;        // 塞进 voice_text,默认 'ambient sound field, no voice, pure environmental audio'
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  // ... (其余同 voice)
}
```

**实现要点**:
- `logicalKey = \`sfx:shot_${shotNumber}:${cue}\``
- `targetRelativePath = \`audio/sfx/shot_${shotNumber}_${cue}${ext}\``
- `assetType = 'sfx'`
- 文件头注释写清 "TTS 复用是临时方案,音质差,后续换独立 TTA"(对应 Plan 1 §6 的 TODO)。

**新建 `index.ts` + `generate-sfx.test.ts`**。

### 3.4 UI Designer —— `src/executers/ui-designer/`

**新建 `generate-ui-patch.ts`**:

```ts
import type { LlmClient } from '../../llm/types.js';
import type { UiDesign } from '../../schema/galgame-workspace.js';

export interface GenerateUiPatchParams {
  readonly screen: UiDesign['screen'];
  readonly moodTag: string;           // 如 'pastel romance', 'noir thriller'
  readonly projectTitle: string;      // 给 LLM 提供上下文
  readonly llmClient: LlmClient;
  readonly model?: string;            // 默认从 LlmClient 拿
}

export interface GenerateUiPatchResult {
  readonly screen: UiDesign['screen'];
  readonly rpyScreenPatch: string;     // 合法 Ren'Py screen block
}

export async function generateUiPatch(
  params: GenerateUiPatchParams,
): Promise<GenerateUiPatchResult>
```

**实现要点**:
- **不走 RunningHub**,不进 AssetRegistry。
- LLM system prompt 模板放在同目录 `prompts/ui-patch.system.md`(或直接字符串常量),要点:
  1. 只产出合法 Ren'Py screen block,不包 markdown fence。
  2. 第一行写 `# --- ui-patch: <screen> (mood: <moodTag>) ---` 方便 merge 时定位。
  3. 禁用 Python 块、禁用外部 image 引用(v0.5 范围内 UI 资源走默认 gui.rpy)。
  4. Screen 名用 `screen <screen>()` 固定,便于覆盖 Ren'Py 内置同名 screen。
- 返回字符串不做 Ren'Py 语法校验(那是 QA 的事),但做两条轻校验:
  - 必须以 `screen ` 开头(允许空行和注释开头)。
  - 不允许包含 `import ` / `init python`(防注入)—— 命中就 throw,由 caller 兜底走默认 screens。
- 失败模式:LLM 返回空串 / 不通过轻校验 → throw。

**新建 `index.ts` + `generate-ui-patch.test.ts`**:mock `LlmClient.chat`,覆盖成功 / 轻校验拒绝两条。

## 4. Coder 扩展

[src/pipeline/coder.ts](src/pipeline/coder.ts) 现在只在 `renderScriptRpy` 里查 `character_main` / `scene_background` / `cutscene`([src/pipeline/coder.ts:L355-L364](src/pipeline/coder.ts#L355-L364))。v0.5 需要扩三处:

### 4.1 BGM 插入点

每个 `scene`(`activeScene` 切换)时查 `bgm:<sceneSlug>`,命中就在 `scene bg_...` 后插 `play music "<path>" fadeout 1.0`。
- 没命中 BGM registry 时,不插 `play music`(保持 Stage A 的静默可跑)。
- 简化:v0.5 以 sceneName 为 slug 查找(和 scene 用同 slug)。

### 4.2 Voice 插入点

`renderDialogueLine` 改签名,吃 `(speaker, text, lineIndex, sceneNumber, charIdents, assetRegistry)`;在 `<ident> "<text>"` 之前插 `voice "audio/voice/scene_<N>/line_<i>.<ext>"`(若 registry 命中)。

Ren'Py 语义:`voice` 必须紧挨下一行 say 之前,Ren'Py 会在这句说完自动停 voice。

### 4.3 SFX 插入点

每个 Shot 头,按 `cue=enter` 查 `sfx:shot_<N>:enter`,命中就插 `play sound "..."`;`cue=exit` 在本 Shot dialogueLines 之后插 `play sound "..."`。`ambient` / `action` 先不处理(v0.6 再说),把 TODO 挂在代码里。

### 4.4 UI 补丁 merge

新建 [src/pipeline/ui-merge.ts](src/pipeline/ui-merge.ts):

```ts
export function mergeUiPatches(
  baseScreensRpy: string,
  patches: ReadonlyArray<{ screen: string; patch: string }>,
): string
```

策略:把每段补丁追加到 `screens.rpy` 末尾,并用 `# === renpy-agent UI patch: <screen> ===` 分隔。**重复同名 screen**:Ren'Py 后定义覆盖先定义,所以追加等价于"覆盖默认"。简化,不做 AST 解析。

Coder 在 `generateGameProject` 里多收一个 `uiPatches` 参数,末尾调 `mergeUiPatches(screensTpl, uiPatches)` 再写盘。

**Coder 签名改动**:
- `GenerateGameParams` 加可选 `uiPatches?: ReadonlyArray<{screen: string; patch: string}>`
- `renderScriptRpy` 吃完整 `assetRegistry`,内部 BGM/Voice/SFX 查询。
- 现有单测对"不传 UI 补丁 / 不传 audio registry"保持行为一致(向后兼容)。

## 5. Pipeline 串线

[src/pipeline/run-pipeline.ts](src/pipeline/run-pipeline.ts) 当前顺序:Planner → Writer → Storyboarder → Coder → QA。v0.5 扩成:

```
Planner
  → Writer
  → Storyboarder
  → (parallel) MusicDirector × N  |  VoiceDirector × M  |  SfxDesigner × K  |  UiDesigner × L
  → Coder(读 AssetRegistry + UI 补丁)
  → QA
```

**最小集合默认策略**(v0.5 为了证明闭环,不做全量):
- BGM:**每个 scene 各一条**,mood 取 scene.description 的 LLM 摘要或固定 `'ambient visual novel BGM'`。
- Voice:**第一场景前 5 句对白**(跳过 narrator)。
- SFX:**每个 shot 的 enter cue**(若 shot.effects 字段提到 "door" / "footsteps" / "wind" 等关键词才生成;否则跳过)—— 防止过度生成。
- UI:只生成 `main_menu` 一个 screen,moodTag 取 project 题材的 LLM 一句话描述或固定字符串。

并发:四组任务互相独立,用 `Promise.all([musicBatch, voiceBatch, sfxBatch, uiBatch])`。每组内部串行(避免 RunningHub 速率限制;后续可加 `p-limit`)。

**失败策略**:单条资产失败不整体失败 —— executer 已调 `markAssetError`,Coder 查 registry 时 `status=error` 视同未命中,走占位。Pipeline 记录 `{ bgm: {ok, err}, voice: {ok, err}, ... }` 统计,console 打印。

**Pipeline 接口扩展**(保守):
- `runPipeline` 新增可选 flag `enableAudioUi?: boolean`(默认 `false`,保持 v0.4 行为);
- 开 flag 时自动执行最小集合;
- CLI 加 `--audio-ui` 或 env `RENPY_AGENT_AUDIO_UI=1`(二选一,优先 CLI)。

## 6. workspace snapshot 扩展

[src/pipeline/workspace.ts](src/pipeline/workspace.ts) 现已存 `planner.json` / `writer.json` / `storyboarder.json`(见 v0.4)。v0.5 追加:

- `bgm.json` —— `{ tracks: [{sceneName, trackName, styleDescription}] }`
- `voice.json` —— `{ lines: [{sceneNumber, lineIndex, speaker, text, voiceTag}] }`
- `sfx.json` —— `{ cues: [{shotNumber, cue, description}] }`
- `ui.json` —— `{ patches: [{screen, moodTag, rpyScreenPatch}] }`

纯 I/O snapshot,失败跑二次时可读回作缓存(避免重新生成已有资产)。和现有 writer/storyboarder snapshot 对称,用 `writeJsonSnapshot` / `readJsonSnapshot` helper 同一套。

## 7. 测试覆盖

| 文件 | 测试项 |
| --- | --- |
| `generate-bgm-track.test.ts` | ✓ 成功:submit→poll→swap,entry.assetType='bgm_track', realAssetLocalPath 以 `audio/bgm/` 开头<br>✓ 失败:submit 抛错,registry 里 status='error' |
| `generate-voice-line.test.ts` | ✓ 成功;✓ `inputs` 含 `voice_text`+`line_text` 两个 role;✓ logicalKey 含 sceneNumber/lineIndex |
| `generate-sfx.test.ts` | ✓ 成功;✓ targetRelativePath 含 shotNumber + cue |
| `generate-ui-patch.test.ts` | ✓ 成功:patch 以 `screen ` 开头;✓ 拒绝 `init python` 注入;✓ 拒绝空串 |
| `coder.test.ts`(扩) | ✓ BGM 命中 registry 时插 `play music`;✓ voice 命中时插 `voice "..."`;✓ sfx enter cue 命中时插 `play sound`;✓ ui patch 非空时 screens.rpy 含 `# === renpy-agent UI patch:` |
| `ui-merge.test.ts`(新) | ✓ 空 patches 不修改 base;✓ 多个 patch 顺序追加,分隔注释正确 |
| `run-pipeline.test.ts`(扩) | ✓ `enableAudioUi=false` 不跑四位 POC;✓ `enableAudioUi=true` 时并发调四条 mock,单条失败不中断 |

不加 e2e(RunningHub 真跑),放 Plan 3(smoke-test 脚本)。

## 8. 提交切分

分三个 commit,便于 review:

1. `feat(v0.5): executers for music/voice/sfx/ui` —— 只新增四个目录 + 测试,不改 Coder / Pipeline。所有 executer 已能单独单测通。
2. `feat(v0.5): coder inserts audio + merges ui patch` —— Coder 签名扩,coder.test.ts 扩;不改 Pipeline 串线。
3. `feat(v0.5): pipeline audio-ui stage + workspace snapshot` —— Pipeline 串线,CLI flag,workspace 扩。

**全部三个 commit 后,v0.5 员工扩招闭环**。

## 9. 验收

- [ ] `pnpm build` 通过
- [ ] `pnpm vitest run` 全绿,四个新 executer 各至少 2 个测试
- [ ] 关开 `enableAudioUi=false` 时 `run-pipeline.test.ts` 的输出与 v0.4 字节一致(向后兼容)
- [ ] 开 `enableAudioUi=true` 跑一次真 key smoke(本地手工,不进 CI):
      `runtime/games/smoke/game/audio/bgm/` 下有 .mp3、`script.rpy` 包含 `play music` / `voice` / `play sound` 三种语句、`screens.rpy` 末尾含 `# === renpy-agent UI patch: main_menu ===`
- [ ] `renpy-sdk/renpy.exe runtime/games/smoke/game` 不报错启动,主菜单显示 UI 补丁
- [ ] PLAN.md §v0.5 员工扩招那 5 条 checklist 从 `[ ]` 变 `[X]`

## 10. 风险 / 后续

- **Suno 响应时长波动**:同一 `trackName`、不同 prompt 可能产 15 秒~2 分钟不等;`loopable` 字段在 schema 存在([src/schema/galgame-workspace.ts:L228](src/schema/galgame-workspace.ts#L228))但 Suno 本身不保证 loop-friendly。Ren'Py `play music` 默认 loop,短 Track 会明显接缝。v0.6 再考虑拆"风格词+loop 提示"或二次剪辑。
- **Voice 轮数**:一个章节动辄几百句对白,串行 TTS 会慢。v0.5 只做"前 5 句",到 v0.6 加 `p-limit(3)` 并发 + 分章并行。
- **UI 补丁冲突**:Ren'Py 同名 screen 后覆盖先,追加安全;但如果 LLM 生成了 `screen main_menu()` 又顺手改了 `style mm_button` 之类全局 style,会污染其他 screen。轻校验里要加一条 "禁 `style ` / `init` / `default`"。
- **BGM ≠ RunningHub 的底层共识**:PLAN.md §3.5 原文说"另封 suno client"。Plan 1 已把 BGM 改接 RunningHub SunoV5,Plan 2 实装时必须跟这个决策 —— 如果 Plan 1 没改 PLAN.md,这里要一起改。
- **音频占位**:v0.5 暂不生成静音 ogg 文件。若未来 Ren'Py 对缺失音频文件报错(而非 warning),要加 silence 兜底。

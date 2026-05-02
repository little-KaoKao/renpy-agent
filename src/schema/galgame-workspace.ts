// ---------------------------------------------------------------------------
// URI branded type system
// ---------------------------------------------------------------------------

export type DocumentKind =
  | 'inspiration' | 'project' | 'chapter' | 'route' | 'ending'
  | 'script' | 'character' | 'scene' | 'prop'
  | 'storyboard' | 'cutscene'
  | 'bgmTrack' | 'voiceLine' | 'sfx' | 'uiDesign'
  | 'rpyFile' | 'assetRegistry' | 'testRun' | 'bugReport';

export type WorkspaceUri<T extends DocumentKind> = string & { readonly __kind: T };

// ---------------------------------------------------------------------------
// Document status
// ---------------------------------------------------------------------------

export type DocumentStatus = 'draft' | 'ready' | 'error';

// ---------------------------------------------------------------------------
// Base document — all 15 documents extend this
// ---------------------------------------------------------------------------

export interface BaseDocument<T extends DocumentKind> {
  readonly uri: WorkspaceUri<T>;
  readonly title: string;
  readonly status: DocumentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Placeholder tracking (Stage A / Stage B)
// ---------------------------------------------------------------------------

export type PlaceholderStatus = 'placeholder' | 'generating' | 'ready' | 'error';

export interface PlaceholderInfo {
  readonly placeholderId: string;
  readonly placeholderUri: string;
  readonly realAssetUri?: string;
  readonly status: PlaceholderStatus;
}

// ---------------------------------------------------------------------------
// Sub-types used by document interfaces
// ---------------------------------------------------------------------------

export interface SceneDialogueBlock {
  readonly sceneNumber: number;
  readonly location: string;
  readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
  readonly lines: ReadonlyArray<DialogueLine>;
}

export interface DialogueLine {
  readonly speaker: string;
  readonly text: string;
  readonly emotion?: string;
  readonly direction?: string;
}

export interface ExpressionVariant {
  readonly expressionName: string;
  readonly imageUri?: string;
  readonly placeholder?: PlaceholderInfo;
}

export interface TimeVariant {
  readonly timeOfDay: string;
  readonly lightingDescription: string;
  readonly imageUri?: string;
  readonly placeholder?: PlaceholderInfo;
}

export interface Shot {
  readonly shotNumber: number;
  readonly description: string;
  readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
  readonly sceneUri?: WorkspaceUri<'scene'>;
  readonly staging: string;
  readonly transforms: string;
  readonly dialogueRef?: string;
  readonly transition?: string;
  readonly effects?: string;
}

export interface AssetRegistryEntry {
  readonly placeholderId: string;
  readonly assetType:
    | 'character'
    | 'scene'
    | 'prop'
    | 'cutscene'
    | 'expression'
    | 'timeVariant'
    | 'dynamicSprite'
    | 'bgmTrack'
    | 'voiceLine'
    | 'sfx';
  readonly placeholder: PlaceholderInfo;
}

// ---------------------------------------------------------------------------
// 15 Document interfaces
// ---------------------------------------------------------------------------

// --- 制作人 (Producer) ---

/** dependencies: — */
export interface Inspiration extends BaseDocument<'inspiration'> {
  readonly rawText: string;
  readonly rawImageUri?: string;
  readonly sourceType: 'text' | 'image' | 'outline';
}

/** dependencies: inspirationUri */
export interface Project extends BaseDocument<'project'> {
  readonly inspirationUri: WorkspaceUri<'inspiration'>;
  readonly genre: string;
  readonly tone: string;
  readonly targetAudience: string;
  readonly chapterCount: number;
}

/** dependencies: projectUri */
export interface Chapter extends BaseDocument<'chapter'> {
  readonly projectUri: WorkspaceUri<'project'>;
  readonly chapterNumber: number;
  readonly outline: string;
  readonly previousChapterUri?: WorkspaceUri<'chapter'>;
}

/** dependencies: projectUri */
export interface Route extends BaseDocument<'route'> {
  readonly projectUri: WorkspaceUri<'project'>;
  readonly routeName: string;
  readonly description: string;
  readonly branchCondition: string;
}

/** dependencies: routeUri */
export interface Ending extends BaseDocument<'ending'> {
  readonly routeUri: WorkspaceUri<'route'>;
  readonly endingType: 'normal' | 'true' | 'bad';
  readonly description: string;
}

// --- 编剧 (Writer) ---

/** dependencies: chapterUri, characterUri[] */
export interface Script extends BaseDocument<'script'> {
  readonly chapterUri: WorkspaceUri<'chapter'>;
  readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
  readonly scenes: ReadonlyArray<SceneDialogueBlock>;
}

// --- 角色设计师 (Character Designer) ---

/** dependencies: — (dynamicSpriteUri depends on own mainImageUri) */
export interface Character extends BaseDocument<'character'> {
  readonly name: string;
  readonly description: string;
  readonly visualDescription: string;
  readonly mainImageUri?: string;
  readonly mainImagePlaceholder?: PlaceholderInfo;
  readonly expressions: ReadonlyArray<ExpressionVariant>;
  readonly dynamicSpriteUri?: string;
  readonly voiceTag?: string;
}

// --- 场景/道具设计师 (Scene/Prop Designer) ---

/** dependencies: — */
export interface Scene extends BaseDocument<'scene'> {
  readonly name: string;
  readonly description: string;
  readonly backgroundUri?: string;
  readonly backgroundPlaceholder?: PlaceholderInfo;
  readonly timeVariants?: ReadonlyArray<TimeVariant>;
}

/** dependencies: sceneUri? */
export interface Prop extends BaseDocument<'prop'> {
  readonly name: string;
  readonly description: string;
  readonly imageUri?: string;
  readonly imagePlaceholder?: PlaceholderInfo;
  readonly sceneUri?: WorkspaceUri<'scene'>;
}

// --- 分镜师 (Storyboarder) ---

/** dependencies: scriptUri, characterUri[], sceneUri[] */
export interface Storyboard extends BaseDocument<'storyboard'> {
  readonly scriptUri: WorkspaceUri<'script'>;
  readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
  readonly sceneUris: ReadonlyArray<WorkspaceUri<'scene'>>;
  readonly shots: ReadonlyArray<Shot>;
}

/** dependencies: storyboardUri, characterUri[], sceneUri[] */
export interface Cutscene extends BaseDocument<'cutscene'> {
  readonly storyboardUri: WorkspaceUri<'storyboard'>;
  readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
  readonly sceneUris: ReadonlyArray<WorkspaceUri<'scene'>>;
  readonly videoType: 'opening' | 'ending' | 'transition' | 'key_scene';
  readonly videoUri?: string;
  readonly videoPlaceholder?: PlaceholderInfo;
  readonly referenceImageUri?: string;
}

// --- 音乐总监 (Music Director) ---

/**
 * BGM 轨道。一般归属到 chapter/route,也可以挂到某 scene 做专属场景音乐。
 * 依赖:projectUri 必须;chapterUri/routeUri/sceneUri 可选,用于描述"这段音乐服务于谁"。
 * 资产生成后端:suno(不走 RunningHub,后续单独封 client)。
 * dependencies: projectUri, (chapterUri | routeUri | sceneUri)
 */
export interface BgmTrack extends BaseDocument<'bgmTrack'> {
  readonly projectUri: WorkspaceUri<'project'>;
  readonly chapterUri?: WorkspaceUri<'chapter'>;
  readonly routeUri?: WorkspaceUri<'route'>;
  readonly sceneUri?: WorkspaceUri<'scene'>;
  readonly moodTag: string;
  readonly styleDescription: string;
  readonly loopable: boolean;
  readonly audioUri?: string;
  readonly audioPlaceholder?: PlaceholderInfo;
}

// --- 配音导演 (Voice Director) ---

/**
 * 单句对白配音。一行一条,定位到 Script 的 (sceneNumber, lineIndex),
 * 同时挂 characterUri(决定音色 voiceTag + 语言)。
 * 资产后端:RunningHub `minimax/speech-2.8-hd`(VOICE_LINE schema)。
 * dependencies: scriptUri, characterUri
 */
export interface VoiceLine extends BaseDocument<'voiceLine'> {
  readonly scriptUri: WorkspaceUri<'script'>;
  readonly characterUri: WorkspaceUri<'character'>;
  readonly sceneNumber: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly voiceTag: string;
  readonly emotion?: string;
  readonly audioUri?: string;
  readonly audioPlaceholder?: PlaceholderInfo;
}

// --- 音效设计师 (SFX Designer) ---

/**
 * 单个环境 / 动作音效(门响、脚步、雨、心跳…)。
 * 触发点落到某个 Shot(shotNumber + 可选 cue),这样分镜师改镜头时音效一起生效。
 * 资产后端:RunningHub text-to-audio(复用 VOICE_LINE apiId),后续可换独立 TTA。
 * dependencies: storyboardUri, sceneUri?
 */
export interface Sfx extends BaseDocument<'sfx'> {
  readonly storyboardUri: WorkspaceUri<'storyboard'>;
  readonly sceneUri?: WorkspaceUri<'scene'>;
  readonly shotNumber: number;
  readonly cue: 'enter' | 'action' | 'exit' | 'ambient';
  readonly description: string;
  readonly durationMs?: number;
  readonly audioUri?: string;
  readonly audioPlaceholder?: PlaceholderInfo;
}

// --- UI 设计师 (UI Designer) ---

/**
 * galgame 标配界面草案:存档/读档、对白栏、主菜单、路线选择、CG 鉴赏、BGM 鉴赏。
 * 本期仅承载 "Ren'Py screens.rpy 补丁" + 视觉 mood,资产(按钮图/背景图)复用 Scene/Prop 生成链。
 * dependencies: projectUri
 */
export interface UiDesign extends BaseDocument<'uiDesign'> {
  readonly projectUri: WorkspaceUri<'project'>;
  readonly screen:
    | 'main_menu'
    | 'save_load'
    | 'dialogue'
    | 'route_branch'
    | 'cg_gallery'
    | 'bgm_gallery'
    | 'preferences';
  readonly moodTag: string;
  readonly rpyScreenPatch?: string;
  readonly previewImageUri?: string;
}

// --- Ren'Py 编码师 (Coder) ---

/** dependencies: storyboardUri, cutsceneUri[], assetRegistryUri, bgmTrackUri[], voiceLineUri[], sfxUri[], uiDesignUri[] */
export interface RpyFile extends BaseDocument<'rpyFile'> {
  readonly storyboardUri: WorkspaceUri<'storyboard'>;
  readonly cutsceneUris: ReadonlyArray<WorkspaceUri<'cutscene'>>;
  readonly assetRegistryUri: WorkspaceUri<'assetRegistry'>;
  readonly bgmTrackUris?: ReadonlyArray<WorkspaceUri<'bgmTrack'>>;
  readonly voiceLineUris?: ReadonlyArray<WorkspaceUri<'voiceLine'>>;
  readonly sfxUris?: ReadonlyArray<WorkspaceUri<'sfx'>>;
  readonly uiDesignUris?: ReadonlyArray<WorkspaceUri<'uiDesign'>>;
  readonly fileName: string;
  readonly rpyContent: string;
}

/** dependencies: rpyFileUri */
export interface AssetRegistry extends BaseDocument<'assetRegistry'> {
  readonly rpyFileUri: WorkspaceUri<'rpyFile'>;
  readonly entries: ReadonlyArray<AssetRegistryEntry>;
}

// --- QA 测试员 ---

/** dependencies: rpyFileUri */
export interface TestRun extends BaseDocument<'testRun'> {
  readonly rpyFileUri: WorkspaceUri<'rpyFile'>;
  readonly renpyVersion: string;
  readonly result: 'pass' | 'fail';
  readonly syntaxErrors: ReadonlyArray<string>;
  readonly runtimeErrors: ReadonlyArray<string>;
}

/** dependencies: testRunUri */
export interface BugReport extends BaseDocument<'bugReport'> {
  readonly testRunUri: WorkspaceUri<'testRun'>;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly description: string;
  readonly stepsToReproduce: ReadonlyArray<string>;
  readonly assignedTo?: string;
}

// ---------------------------------------------------------------------------
// Union type for all workspace documents
// ---------------------------------------------------------------------------

export type WorkspaceDocument =
  | Inspiration | Project | Chapter | Route | Ending
  | Script | Character | Scene | Prop
  | Storyboard | Cutscene
  | BgmTrack | VoiceLine | Sfx | UiDesign
  | RpyFile | AssetRegistry | TestRun | BugReport;

// ---------------------------------------------------------------------------
// SCHEMA_DIGEST — human-readable summary of the workspace schema.
//
// Consumed by Planner / Executer as a static, prompt-cacheable block. It must
// stay identical across runs (no timestamps, no slugs, no project-specific
// data) so that the Anthropic prompt cache can reuse the same cache segment
// across Planner/Executer LLM calls and across smoke runs.
//
// Intentionally hand-written (NOT derived from the TypeScript source above):
// the source carries JSDoc/implementation notes irrelevant to the Planner, and
// a compiled-from-source digest would drift whenever comments change — breaking
// cache hits and burning tokens. If you add a new DocumentKind or change a
// reference relationship, update the digest by hand and the matching fields
// above in the same commit.
// ---------------------------------------------------------------------------

export const SCHEMA_DIGEST = `Workspace schema digest — 19 DocumentKinds, grouped by owning POC role.

URI grammar:
  workspace://<kind>                     (singleton — at most one per project)
  workspace://<kind>/<slug>              (collection — many per project, slug is
                                          lowercase a-z0-9 with dashes, unique within kind)

Singletons: project, chapter, script, storyboard, assetRegistry, testRun.
Collections: character, scene, prop, route, ending, cutscene, bgmTrack, voiceLine,
  sfx, uiDesign, rpyFile, bugReport, inspiration.
  (inspiration is technically a collection but usually has exactly one entry.)

-----
Owner → DocumentKind mapping (who is allowed to mutate what):

producer          → inspiration, project, chapter, route, ending
writer            → script
character_designer→ character (plus placeholder entries in assetRegistry)
scene_designer    → scene, prop (plus placeholder entries in assetRegistry)
storyboarder      → storyboard, cutscene
music_director    → bgmTrack
voice_director    → voiceLine
sfx_designer      → sfx
ui_designer       → uiDesign
coder             → rpyFile, assetRegistry
qa                → testRun, bugReport

A POC reads any URI via read_from_uri but writes only to its own kinds. Planner
owns none — it routes via handoff_to_agent and observes via read_from_uri.

-----
Reference edges (who points at whom, without copying data):

project.inspirationUri          → inspiration
chapter.projectUri              → project
chapter.previousChapterUri?     → chapter  (for multi-chapter sequencing)
route.projectUri                → project
ending.routeUri                 → route
script.chapterUri               → chapter
script.characterUris[]          → character   (cast list for this chapter)
storyboard.scriptUri            → script
storyboard.characterUris[]      → character
storyboard.sceneUris[]          → scene
storyboard.shots[i].characterUris[] → character  (per-shot cast, subset of above)
storyboard.shots[i].sceneUri?   → scene
cutscene.storyboardUri          → storyboard
rpyFile.storyboardUri           → storyboard
rpyFile.assetRegistryUri        → assetRegistry
rpyFile.cutsceneUris[]          → cutscene
rpyFile.bgmTrackUris[]?         → bgmTrack
rpyFile.voiceLineUris[]?        → voiceLine
rpyFile.sfxUris[]?              → sfx
rpyFile.uiDesignUris[]?         → uiDesign
assetRegistry.rpyFileUri        → rpyFile
testRun.rpyFileUri              → rpyFile
bugReport.testRunUri            → testRun
bgmTrack.projectUri / chapterUri? / routeUri? / sceneUri?
voiceLine.scriptUri / characterUri
sfx.storyboardUri / sceneUri?
uiDesign.projectUri
prop.sceneUri?

Notable non-edge: script.scenes[i].characters is a name array, NOT a URI list;
the characterUris edge is at the document level. Do not treat dialogue-line
speaker strings as URIs.

-----
Placeholder / dirty-state model (Stage A vs Stage B):

Every asset-bearing field pairs an optional *Uri with a PlaceholderInfo whose
status is one of: placeholder | generating | ready | error.

  Character.mainImageUri       + mainImagePlaceholder
  Character.expressions[i].imageUri + .placeholder
  Character.dynamicSpriteUri
  Scene.backgroundUri          + backgroundPlaceholder
  Scene.timeVariants[i].imageUri + .placeholder
  Prop.imageUri                + imagePlaceholder
  BgmTrack.audioUri            + audioPlaceholder
  VoiceLine.audioUri           + audioPlaceholder
  Sfx.audioUri                 + audioPlaceholder
  Cutscene.videoUri            + videoPlaceholder

Stage A ships with status="placeholder" everywhere (rendered as a grey square /
silence); Stage B replaces each entry via swap_asset_placeholder (coder-owned
tool). Modify-mode: when character_designer mutates visualDescription, the
corresponding main_image / expression / dynamic_sprite registry entries drop
back to status="placeholder" automatically. Do NOT re-handoff storyboarder/
writer just because a character visual changed — the reference edges stay
valid and Stage B regen handles the asset.

-----
Typical Stage A handoff order (use this as a default, not a rigid sequence):

  producer (create_project, create_chapter)
    → character_designer (per protagonist/supporting cast)
    → scene_designer (per location the writer/storyboarder will need)
    → writer (draft_script — reads chapter + characters + scenes)
    → storyboarder (condense_to_shots — reads script, emits shot list)
    → coder (write_game_project — assembles .rpy + registry)
    → qa (run_qa — lint + cross-doc read; may kick_back_to_coder once)
    → finish with taskSummary="no more tasks, Stage A delivered"

Tier-2 POCs (music_director / voice_director / sfx_designer / ui_designer) are
optional for Stage A; skip unless the brief explicitly asks for audio or UI
polish.
`;


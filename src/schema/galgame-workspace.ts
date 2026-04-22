// ---------------------------------------------------------------------------
// URI branded type system
// ---------------------------------------------------------------------------

export type DocumentKind =
  | 'inspiration' | 'project' | 'chapter' | 'route' | 'ending'
  | 'script' | 'character' | 'scene' | 'prop'
  | 'storyboard' | 'cutscene'
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
  readonly assetType: 'character' | 'scene' | 'prop' | 'cutscene' | 'expression' | 'timeVariant' | 'dynamicSprite';
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

// --- Ren'Py 编码师 (Coder) ---

/** dependencies: storyboardUri, cutsceneUri[], assetRegistryUri */
export interface RpyFile extends BaseDocument<'rpyFile'> {
  readonly storyboardUri: WorkspaceUri<'storyboard'>;
  readonly cutsceneUris: ReadonlyArray<WorkspaceUri<'cutscene'>>;
  readonly assetRegistryUri: WorkspaceUri<'assetRegistry'>;
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
  | RpyFile | AssetRegistry | TestRun | BugReport;

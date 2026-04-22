import type {
  WorkspaceUri,
  WorkspaceDocument,
  Project,
  Chapter,
  Route,
  Ending,
  Script,
  Storyboard,
  Cutscene,
  Character,
  Scene,
  Prop,
  RpyFile,
  AssetRegistry,
  TestRun,
  BugReport,
  ExpressionVariant,
  TimeVariant,
  PlaceholderInfo,
} from '../schema/galgame-workspace.js';

// ---------------------------------------------------------------------------
// POC roles
// ---------------------------------------------------------------------------

export type PocRole =
  | 'producer'
  | 'writer'
  | 'storyboarder'
  | 'character-designer'
  | 'scene-designer'
  | 'coder'
  | 'qa';

// ---------------------------------------------------------------------------
// Common result types
// ---------------------------------------------------------------------------

export interface WorkflowContext {
  readonly workflowId: string;
  readonly activePoc: PocRole;
  readonly availableTools: ReadonlyArray<string>;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly missingParams: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
}

export interface TaskResult {
  readonly taskAgentName: string;
  readonly success: boolean;
  readonly output: unknown;
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Common tools — available to every executer
// ---------------------------------------------------------------------------

export interface CommonTools {
  active_workflow(workflowId: string): Promise<WorkflowContext>;
  handoff_to_agent(pocRole: PocRole): Promise<void>;
  check_workflow_params(params: Record<string, unknown>): Promise<ValidationResult>;
  call_task_agent(agentName: string, params: Record<string, unknown>): Promise<TaskResult>;
  get_workflow_guide(topic: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// 1. 制作人 (Producer) tool-set
// ---------------------------------------------------------------------------

export interface ProducerTools {
  create_project(params: {
    readonly inspirationUri: WorkspaceUri<'inspiration'>;
    readonly genre: string;
    readonly tone: string;
    readonly targetAudience: string;
    readonly chapterCount: number;
  }): Promise<Project>;

  update_project(params: {
    readonly projectUri: WorkspaceUri<'project'>;
    readonly updates: Partial<Pick<Project, 'genre' | 'tone' | 'targetAudience' | 'chapterCount'>>;
  }): Promise<Project>;

  create_chapter(params: {
    readonly projectUri: WorkspaceUri<'project'>;
    readonly chapterNumber: number;
    readonly outline: string;
    readonly previousChapterUri?: WorkspaceUri<'chapter'>;
  }): Promise<Chapter>;

  update_chapter(params: {
    readonly chapterUri: WorkspaceUri<'chapter'>;
    readonly updates: Partial<Pick<Chapter, 'outline'>>;
  }): Promise<Chapter>;

  create_route(params: {
    readonly projectUri: WorkspaceUri<'project'>;
    readonly routeName: string;
    readonly description: string;
    readonly branchCondition: string;
  }): Promise<Route>;

  update_route(params: {
    readonly routeUri: WorkspaceUri<'route'>;
    readonly updates: Partial<Pick<Route, 'routeName' | 'description' | 'branchCondition'>>;
  }): Promise<Route>;

  create_ending(params: {
    readonly routeUri: WorkspaceUri<'route'>;
    readonly endingType: 'normal' | 'true' | 'bad';
    readonly description: string;
  }): Promise<Ending>;

  update_ending(params: {
    readonly endingUri: WorkspaceUri<'ending'>;
    readonly updates: Partial<Pick<Ending, 'endingType' | 'description'>>;
  }): Promise<Ending>;
}

// ---------------------------------------------------------------------------
// 2. 编剧 (Writer) tool-set
// ---------------------------------------------------------------------------

export interface WriterTools {
  create_script(params: {
    readonly chapterUri: WorkspaceUri<'chapter'>;
    readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
  }): Promise<Script>;

  update_script(params: {
    readonly scriptUri: WorkspaceUri<'script'>;
    readonly updates: Partial<Pick<Script, 'scenes'>>;
  }): Promise<Script>;
}

// ---------------------------------------------------------------------------
// 3. 分镜师 (Storyboarder) tool-set
// ---------------------------------------------------------------------------

export interface StoryboarderTools {
  create_storyboard(params: {
    readonly scriptUri: WorkspaceUri<'script'>;
    readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
    readonly sceneUris: ReadonlyArray<WorkspaceUri<'scene'>>;
  }): Promise<Storyboard>;

  update_storyboard(params: {
    readonly storyboardUri: WorkspaceUri<'storyboard'>;
    readonly updates: Partial<Pick<Storyboard, 'shots'>>;
  }): Promise<Storyboard>;

  create_cutscene(params: {
    readonly storyboardUri: WorkspaceUri<'storyboard'>;
    readonly characterUris: ReadonlyArray<WorkspaceUri<'character'>>;
    readonly sceneUris: ReadonlyArray<WorkspaceUri<'scene'>>;
    readonly videoType: 'opening' | 'ending' | 'transition' | 'key_scene';
    readonly referenceImageUri?: string;
  }): Promise<Cutscene>;

  update_cutscene(params: {
    readonly cutsceneUri: WorkspaceUri<'cutscene'>;
    readonly updates: Partial<Pick<Cutscene, 'videoType' | 'referenceImageUri'>>;
  }): Promise<Cutscene>;
}

// ---------------------------------------------------------------------------
// 4. 角色设计师 (Character Designer) tool-set
// ---------------------------------------------------------------------------

export interface CharacterDesignerTools {
  create_character(params: {
    readonly name: string;
    readonly description: string;
    readonly visualDescription: string;
    readonly voiceTag?: string;
  }): Promise<Character>;

  update_character(params: {
    readonly characterUri: WorkspaceUri<'character'>;
    readonly updates: Partial<Pick<Character, 'name' | 'description' | 'visualDescription' | 'voiceTag'>>;
  }): Promise<Character>;

  generate_expression_variant(params: {
    readonly characterUri: WorkspaceUri<'character'>;
    readonly expressionName: string;
  }): Promise<ExpressionVariant>;

  generate_dynamic_sprite(params: {
    readonly characterUri: WorkspaceUri<'character'>;
    readonly motionDescription: string;
  }): Promise<PlaceholderInfo>;
}

// ---------------------------------------------------------------------------
// 5. 场景/道具设计师 (Scene Designer) tool-set
// ---------------------------------------------------------------------------

export interface SceneDesignerTools {
  create_scene(params: {
    readonly name: string;
    readonly description: string;
  }): Promise<Scene>;

  update_scene(params: {
    readonly sceneUri: WorkspaceUri<'scene'>;
    readonly updates: Partial<Pick<Scene, 'name' | 'description'>>;
  }): Promise<Scene>;

  create_prop(params: {
    readonly name: string;
    readonly description: string;
    readonly sceneUri?: WorkspaceUri<'scene'>;
  }): Promise<Prop>;

  update_prop(params: {
    readonly propUri: WorkspaceUri<'prop'>;
    readonly updates: Partial<Pick<Prop, 'name' | 'description'>>;
  }): Promise<Prop>;

  generate_time_variant(params: {
    readonly sceneUri: WorkspaceUri<'scene'>;
    readonly timeOfDay: string;
    readonly lightingDescription: string;
  }): Promise<TimeVariant>;
}

// ---------------------------------------------------------------------------
// 6. Ren'Py 编码师 (Coder) tool-set
// ---------------------------------------------------------------------------

export interface CoderTools {
  generate_rpy(params: {
    readonly storyboardUri: WorkspaceUri<'storyboard'>;
    readonly cutsceneUris?: ReadonlyArray<WorkspaceUri<'cutscene'>>;
    readonly assetRegistryUri: WorkspaceUri<'assetRegistry'>;
  }): Promise<RpyFile>;

  update_rpy(params: {
    readonly rpyFileUri: WorkspaceUri<'rpyFile'>;
    readonly updates: Partial<Pick<RpyFile, 'rpyContent'>>;
  }): Promise<RpyFile>;

  swap_asset_placeholder(params: {
    readonly assetRegistryUri: WorkspaceUri<'assetRegistry'>;
    readonly placeholderId: string;
    readonly realAssetUri: string;
  }): Promise<AssetRegistry>;
}

// ---------------------------------------------------------------------------
// 7. QA 测试员 tool-set
// ---------------------------------------------------------------------------

export interface QaTools {
  run_test(params: {
    readonly rpyFileUri: WorkspaceUri<'rpyFile'>;
    readonly renpyVersion: string;
  }): Promise<TestRun>;

  create_bug_report(params: {
    readonly testRunUri: WorkspaceUri<'testRun'>;
    readonly severity: 'critical' | 'high' | 'medium' | 'low';
    readonly description: string;
    readonly stepsToReproduce: ReadonlyArray<string>;
  }): Promise<BugReport>;

  kick_back_to_coder(params: {
    readonly bugReportUri: WorkspaceUri<'bugReport'>;
    readonly rpyFileUri: WorkspaceUri<'rpyFile'>;
  }): Promise<void>;
}

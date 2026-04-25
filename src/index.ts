export type {
  DocumentKind,
  WorkspaceUri,
  DocumentStatus,
  BaseDocument,
  PlaceholderStatus,
  PlaceholderInfo,
  SceneDialogueBlock,
  DialogueLine,
  ExpressionVariant,
  TimeVariant,
  Shot,
  AssetRegistryEntry,
  Inspiration,
  Project,
  Chapter,
  Route,
  Ending,
  Script,
  Character,
  Scene,
  Prop,
  Storyboard,
  Cutscene,
  BgmTrack,
  VoiceLine,
  Sfx,
  UiDesign,
  RpyFile,
  AssetRegistry,
  TestRun,
  BugReport,
  WorkspaceDocument,
} from './schema/galgame-workspace.js';

export type {
  RunningHubClient,
  RunningHubSubmitParams,
  RunningHubTaskResult,
  RunningHubTaskStatus,
  AiAppSchema,
  AiAppNodeFieldSchema,
  AiAppNodeInput,
  AiAppFieldRole,
  FetchLike,
  HttpRunningHubClientOptions,
} from './executers/common/runninghub-client.js';
export {
  HttpRunningHubClient,
  RunningHubError,
  RUNNINGHUB_DEFAULT_BASE_URL,
} from './executers/common/runninghub-client.js';

export {
  RUNNINGHUB_APP_IDENTITIES,
  RUNNINGHUB_APP_SCHEMAS,
  getAppWebappId,
  isSchemaConfigured,
} from './executers/common/runninghub-schemas.js';
export type {
  RunningHubAppKey,
  RunningHubAppIdentity,
} from './executers/common/runninghub-schemas.js';

export { runImageTask, RunImageTaskError } from './executers/common/run-image-task.js';
export type {
  RunImageTaskParams,
  RunImageTaskSuccess,
} from './executers/common/run-image-task.js';

export {
  loadRegistry,
  saveRegistry,
  upsertEntry,
  findByLogicalKey,
  findByPlaceholderId,
  registryPathForGame,
  computePlaceholderId,
  ASSET_REGISTRY_FILENAME,
} from './assets/registry.js';
export type {
  AssetRegistryFile,
  AssetRegistryEntry as RuntimeAssetRegistryEntry,
  AssetType,
  AssetStatus,
} from './assets/registry.js';

export { downloadAsset, inferExtensionFromUrl, slugForFilename } from './assets/download.js';
export type { DownloadAssetParams, DownloadAssetResult } from './assets/download.js';

export { swapAssetPlaceholder, markAssetError } from './assets/swap.js';
export type {
  SwapAssetPlaceholderParams,
  SwapAssetPlaceholderResult,
} from './assets/swap.js';

export {
  generateCharacterMainImage,
  buildCharacterMainPrompt,
} from './executers/character-designer/generate-main-image.js';
export type {
  GenerateCharacterMainImageParams,
  GenerateCharacterMainImageResult,
} from './executers/character-designer/generate-main-image.js';

export {
  generateSceneBackground,
  buildSceneBackgroundPrompt,
} from './executers/scene-designer/generate-background.js';
export type {
  GenerateSceneBackgroundParams,
  GenerateSceneBackgroundResult,
} from './executers/scene-designer/generate-background.js';

export {
  generatePropImage,
  buildPropPrompt,
} from './executers/scene-designer/generate-prop.js';
export type {
  GeneratePropImageParams,
  GeneratePropImageResult,
} from './executers/scene-designer/generate-prop.js';

export {
  generateSceneTimeVariant,
  buildSceneTimeVariantPrompt,
} from './executers/scene-designer/generate-time-variant.js';
export type {
  GenerateSceneTimeVariantParams,
  GenerateSceneTimeVariantResult,
} from './executers/scene-designer/generate-time-variant.js';

export {
  generateCharacterExpression,
  buildCharacterExpressionPrompt,
} from './executers/character-designer/generate-expression.js';
export type {
  GenerateCharacterExpressionParams,
  GenerateCharacterExpressionResult,
} from './executers/character-designer/generate-expression.js';

export {
  generateCutsceneVideo,
  buildCutscenePrompt,
} from './executers/storyboarder/generate-cutscene.js';
export type {
  CutsceneKind,
  GenerateCutsceneVideoParams,
  GenerateCutsceneVideoResult,
} from './executers/storyboarder/generate-cutscene.js';

export {
  logicalKeyForCharacter,
  logicalKeyForCharacterExpression,
  logicalKeyForScene,
  logicalKeyForSceneTimeVariant,
  logicalKeyForProp,
  logicalKeyForBgm,
  logicalKeyForVoiceLine,
  logicalKeyForSfx,
  logicalKeyForCutscene,
} from './assets/logical-key.js';
export type { SfxCue } from './assets/logical-key.js';

// --- v0.2 minimal pipeline ---

export type {
  LlmClient,
  LlmChatParams,
  LlmMessage,
  LlmResponse,
  LlmUsage,
} from './llm/types.js';

export {
  ClaudeLlmClient,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_DIRECT_DEFAULT_MODEL,
  CLAUDE_BEDROCK_DEFAULT_MODEL,
  CLAUDE_DEFAULT_MAX_TOKENS,
  extractJsonBlock,
  resolveClaudeMode,
} from './llm/claude-client.js';
export type { ClaudeTransportMode, ClaudeLlmClientOptions } from './llm/claude-client.js';

export type {
  PlannerOutput,
  WriterOutput,
  StoryboarderOutput,
  StoryboarderOutputShot,
  StoryboarderOutputCutscene,
  TestRunResult,
  PipelineResult,
  AudioUiPipelineStats,
  CutscenePipelineStats,
} from './pipeline/types.js';

export { runPlanner } from './pipeline/planner.js';
export { runWriter } from './pipeline/writer.js';
export { runStoryboarder } from './pipeline/storyboarder.js';
export {
  generateGameProject,
  writeGameProject,
  renderScriptRpy,
} from './pipeline/coder.js';
export { runQa, parseLintOutput } from './pipeline/qa.js';
export { runPipeline, slugifyStoryName } from './pipeline/run-pipeline.js';
export { rebuildGameProject } from './pipeline/rebuild.js';
export type { RebuildOptions, RebuildResult } from './pipeline/rebuild.js';

export { runCutsceneStage } from './pipeline/cutscene-stage.js';
export type {
  CutsceneStageStats,
  CutsceneStageSkipped,
  CutsceneStageOutput,
  CutsceneStageLogger,
  RunCutsceneStageParams,
} from './pipeline/cutscene-stage.js';

export {
  saveStoryWorkspace,
  loadStoryWorkspace,
  workspacePathsForGame,
  WORKSPACE_DIRNAME,
  PLANNER_FILENAME,
  WRITER_FILENAME,
  STORYBOARDER_FILENAME,
} from './pipeline/workspace.js';
export type {
  StoryWorkspacePaths,
  StoryWorkspaceSnapshot,
} from './pipeline/workspace.js';

export {
  modifyCharacterAppearance,
  modifyDialogueLine,
  reorderShots,
} from './pipeline/modify.js';
export type {
  ModifyCharacterAppearanceParams,
  ModifyCharacterAppearanceResult,
  ModifyDialogueLineParams,
  ReorderShotsParams,
  ModifyContext,
} from './pipeline/modify.js';

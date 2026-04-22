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
  RpyFile,
  AssetRegistry,
  TestRun,
  BugReport,
  WorkspaceDocument,
} from './schema/galgame-workspace.js';

export type {
  PocRole,
  WorkflowContext,
  ValidationResult,
  TaskResult,
  CommonTools,
  ProducerTools,
  WriterTools,
  StoryboarderTools,
  CharacterDesignerTools,
  SceneDesignerTools,
  CoderTools,
  QaTools,
} from './workflows/galgame-workflows.js';

export type { PlannerTools } from './planner/index.js';

export type {
  RunningHubClient,
  RunningHubSubmitParams,
  RunningHubTaskResult,
  RunningHubTaskStatus,
  AiAppSchema,
  FetchLike,
  HttpRunningHubClientOptions,
} from './executers/common/runninghub-client.js';
export {
  HttpRunningHubClient,
  RunningHubError,
  RUNNINGHUB_DEFAULT_BASE_URL,
} from './executers/common/runninghub-client.js';

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
  TestRunResult,
  PipelineResult,
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

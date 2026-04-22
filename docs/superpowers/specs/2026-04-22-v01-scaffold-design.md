# v0.1 Scaffold Design

> Date: 2026-04-22
> Scope: PLAN.md §10 v0.1 — architecture foundations, typed contracts, no runtime code

## Goal

Set up the TypeScript project infrastructure and write the typed contracts (schemas + workflow signatures) that form the Planner's system prompt. Executers get stub directories. No HTTP calls, no DB, no CLI entry point yet.

## Project Structure

```
src/
├── schema/
│   └── galgame-workspace.ts      # 15 document interfaces + URI branded types
├── workflows/
│   └── galgame-workflows.ts      # 7 POC tool-set interfaces + common tools
├── planner/
│   └── index.ts                  # Planner agent stub (exports type only)
├── executers/
│   ├── common/
│   │   ├── runninghub-client.ts  # RunningHub API client type contract
│   │   └── types.ts              # V5 common tools interface + shared types
│   ├── producer/index.ts
│   ├── writer/index.ts
│   ├── storyboarder/index.ts
│   ├── character-designer/index.ts
│   ├── scene-designer/index.ts
│   ├── coder/index.ts
│   └── qa/index.ts
└── index.ts                      # Entry point placeholder
```

Root config files: `package.json`, `tsconfig.json`.

## Data Model — 15 Document Schemas

### URI System

```typescript
type WorkspaceUri<T extends DocumentKind> = string & { readonly __kind: T };
type DocumentKind =
  | 'inspiration' | 'project' | 'chapter' | 'route' | 'ending'
  | 'script' | 'character' | 'scene' | 'prop'
  | 'storyboard' | 'cutscene'
  | 'rpyFile' | 'assetRegistry' | 'testRun' | 'bugReport';
```

### Base Document

All documents share: `uri`, `title`, `status` (`'draft' | 'ready' | 'error'`), `createdAt`, `updatedAt`.

### Dependency Map

| Document       | Dependencies                                          |
|----------------|-------------------------------------------------------|
| Inspiration    | —                                                     |
| Project        | inspirationUri                                        |
| Chapter        | projectUri                                            |
| Route          | projectUri                                            |
| Ending         | routeUri                                              |
| Script         | chapterUri, characterUri[]                            |
| Character      | — (dynamicSpriteUri depends on own mainImageUri)      |
| Scene          | —                                                     |
| Prop           | sceneUri?                                             |
| Storyboard     | scriptUri, characterUri[], sceneUri[]                 |
| Cutscene       | storyboardUri, characterUri[], sceneUri[]             |
| RpyFile        | storyboardUri, cutsceneUri[], assetRegistryUri        |
| AssetRegistry  | rpyFileUri                                            |
| TestRun        | rpyFileUri                                            |
| BugReport      | testRunUri                                            |

### Placeholder Tracking

Documents that reference generated assets (Character, Scene, Cutscene) carry:

```typescript
interface PlaceholderInfo {
  placeholderId: string;
  placeholderUri: string;    // Solid() or Transform(Solid,...) uri
  realAssetUri?: string;     // filled when Stage B completes
  status: 'placeholder' | 'generating' | 'ready' | 'error';
}
```

### Domain Fields Per Document

- **Inspiration**: `rawText`, `rawImageUri?`, `sourceType` ('text' | 'image' | 'outline')
- **Project**: `inspirationUri`, `genre`, `tone`, `targetAudience`, `chapterCount`
- **Chapter**: `projectUri`, `chapterNumber`, `outline`, `previousChapterUri?`
- **Route**: `projectUri`, `routeName`, `description`, `branchCondition`
- **Ending**: `routeUri`, `endingType` ('normal' | 'true' | 'bad'), `description`
- **Script**: `chapterUri`, `characterUris`, `scenes` (array of scene-level dialogue blocks)
- **Character**: `name`, `description`, `visualDescription`, `mainImageUri`, `mainImagePlaceholder`, `expressions` (expression variant array), `dynamicSpriteUri?`, `voiceTag?`
- **Scene**: `name`, `description`, `backgroundUri`, `backgroundPlaceholder`, `timeVariants?`
- **Prop**: `name`, `description`, `imageUri`, `imagePlaceholder`, `sceneUri?`
- **Storyboard**: `scriptUri`, `characterUris`, `sceneUris`, `shots` (Shot[] with staging, transforms, dialogue refs)
- **Cutscene**: `storyboardUri`, `characterUris`, `sceneUris`, `videoType` ('opening' | 'ending' | 'transition' | 'key_scene'), `videoUri`, `videoPlaceholder`, `referenceImageUri`
- **RpyFile**: `storyboardUri`, `cutsceneUris`, `assetRegistryUri`, `fileName`, `rpyContent`
- **AssetRegistry**: `rpyFileUri`, `entries` (placeholderId → PlaceholderInfo mapping)
- **TestRun**: `rpyFileUri`, `renpyVersion`, `result` ('pass' | 'fail'), `syntaxErrors`, `runtimeErrors`
- **BugReport**: `testRunUri`, `severity`, `description`, `stepsToReproduce`, `assignedTo?`

## Workflows — 7 POC Tool-Sets

### Common Tools (all executers)

```typescript
interface CommonTools {
  active_workflow(workflowId: string): Promise<WorkflowContext>;
  handoff_to_agent(pocRole: PocRole): Promise<void>;
  check_workflow_params(params: Record<string, unknown>): Promise<ValidationResult>;
  call_task_agent(agentName: string, params: Record<string, unknown>): Promise<TaskResult>;
  get_workflow_guide(topic: string): Promise<string>;
}
```

### Per-POC Tools

**ProducerTools**: `create_project`, `update_project`, `create_chapter`, `update_chapter`, `create_route`, `update_route`, `create_ending`, `update_ending`

**WriterTools**: `create_script`, `update_script`

**StoryboarderTools**: `create_storyboard`, `update_storyboard`, `create_cutscene`, `update_cutscene`

**CharacterDesignerTools**: `create_character`, `update_character`, `generate_expression_variant`, `generate_dynamic_sprite`

**SceneDesignerTools**: `create_scene`, `update_scene`, `create_prop`, `update_prop`, `generate_time_variant`

**CoderTools**: `generate_rpy`, `update_rpy`, `swap_asset_placeholder`

**QaTools**: `run_test`, `create_bug_report`, `kick_back_to_coder`

Each tool takes typed params referencing workspace URIs and returns the created/updated document.

## RunningHub Client Contract

```typescript
interface RunningHubClient {
  submitTask(params: {
    apiId: string;
    prompt: string;
    referenceImageUri?: string;
  }): Promise<{ taskId: string }>;

  pollTask(taskId: string): Promise<{
    status: 'pending' | 'running' | 'done' | 'error';
    outputUri?: string;
    errorMessage?: string;
  }>;
}
```

No HTTP implementation yet — just the typed interface.

## Planner Stub

Exports the Planner's type contract only:

```typescript
interface PlannerTools {
  output_with_plan(plan: string): Promise<void>;
  output_with_finish(taskSummary: string): Promise<void>;
  read_from_uri(uri: string): Promise<WorkspaceDocument>;
}
```

## Dependencies

- `typescript` ^5.5 (compile-time only)
- `dotenv` ^16 (for future .env loading)
- `@types/node` ^20

No runtime dependencies. `tsconfig.json` targets `ES2022`, module `Node16`, strict mode enabled.

## Out of Scope

- No CLI entry point (v0.2)
- No SQLite / workspace DB (v0.2)
- No HTTP client implementation (v0.3)
- No tests yet (schemas are pure types; tests come when implementations arrive)

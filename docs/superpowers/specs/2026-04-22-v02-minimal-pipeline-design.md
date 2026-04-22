# v0.2 Minimal Pipeline Design

> Date: 2026-04-22
> Scope: PLAN.md §10 v0.2 — end-to-end pipeline from inspiration to playable Stage A Ren'Py demo

## Goal

Build a CLI that takes an inspiration string, runs a Planner → Writer → Storyboarder → Coder → QA pipeline, and outputs a playable Ren'Py project with placeholder assets (Solid() colors, Transform particles). Single chapter, up to 8 shots, matching baiying-demo's scope.

## Architecture

```
CLI ("npx renpy-agent <inspiration>")
  │
  ▼
runPipeline(inspiration, storyName)
  │
  ├─ 1. LlmClient (provider-agnostic interface)
  │     └─ ClaudeLlmClient (@anthropic-ai/sdk)
  │
  ├─ 2. Planner: LLM with TS schemas as system prompt
  │     → PlannerOutput (project metadata, characters, scenes, chapter outline)
  │
  ├─ 3. Writer: LLM with planner output
  │     → WriterOutput (scene-level dialogue blocks)
  │
  ├─ 4. Storyboarder: LLM with script + characters + scenes
  │     → StoryboarderOutput (up to 8 shots with staging/transforms)
  │
  ├─ 5. Coder: deterministic template generation
  │     → script.rpy + gui.rpy + options.rpy + screens.rpy
  │     → writes to runtime/games/<storyName>/game/
  │
  ├─ 6. QA: renpy-sdk lint
  │     → TestRun (pass/fail + errors)
  │
  └─ Result: { gamePath, testRun }
```

Key decisions:
- Each POC is a pure function: `(input, llmClient) => Promise<Output>`. No state, no side effects except Coder which writes files.
- Pipeline runner orchestrates sequentially. If any step fails, pipeline stops with a clear error.
- All intermediate documents are held in memory (no SQLite yet).
- QA uses Ren'Py's built-in `--lint`. If SDK not installed, QA skips with a warning.
- Planner is the smart LLM brain; Writer/Storyboarder are focused single-LLM-call functions; Coder is deterministic.

## LLM Client Interface

```typescript
// src/llm/types.ts

interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

interface LlmResponse {
  readonly content: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

interface LlmClient {
  chat(params: {
    readonly messages: ReadonlyArray<LlmMessage>;
    readonly maxTokens?: number;
    readonly temperature?: number;
  }): Promise<LlmResponse>;
}
```

### ClaudeLlmClient (`src/llm/claude-client.ts`)

- Implements LlmClient using `@anthropic-ai/sdk`
- Reads `ANTHROPIC_API_KEY` from `process.env`
- Model: `claude-sonnet-4-6-20250514`
- No tool use, no streaming, no thinking — each POC gets structured JSON via markdown code blocks in the response
- Throws on missing API key or API errors with clear messages

## Pipeline POC Implementations

### PlannerOutput shape

```typescript
interface PlannerOutput {
  readonly projectTitle: string;
  readonly genre: string;
  readonly tone: string;
  readonly characters: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly visualDescription: string;
  }>;
  readonly scenes: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
  }>;
  readonly chapterOutline: string;
}
```

System prompt includes the full content of `src/schema/galgame-workspace.ts`. User prompt is the inspiration text. LLM returns JSON in a markdown code block.

### WriterOutput shape

```typescript
interface WriterOutput {
  readonly scenes: ReadonlyArray<{
    readonly location: string;
    readonly characters: ReadonlyArray<string>;
    readonly lines: ReadonlyArray<{
      readonly speaker: string;
      readonly text: string;
      readonly emotion?: string;
      readonly direction?: string;
    }>;
  }>;
}
```

Takes PlannerOutput. System prompt explains it's a galgame script writer for Ren'Py.

### StoryboarderOutput shape

```typescript
interface StoryboarderOutput {
  readonly shots: ReadonlyArray<{
    readonly shotNumber: number;
    readonly description: string;
    readonly characters: ReadonlyArray<string>;
    readonly sceneName: string;
    readonly staging: string;
    readonly transforms: string;
    readonly transition: string;
    readonly effects?: string;
    readonly dialogueLines: ReadonlyArray<{
      readonly speaker: string;
      readonly text: string;
    }>;
  }>;
}
```

Takes WriterOutput + characters + scenes. System prompt includes `resources/renpy-storyboard/SKILL.md` as reference. Returns up to 8 shots following baiying-demo patterns.

### Coder (`src/pipeline/coder.ts`)

Deterministic template generation (no LLM call):
- `Solid()` placeholders for all backgrounds
- `Transform(Solid(...), size=(8,8))` for particle effects
- Character definitions with `define` and color
- Transform blocks modeled after baiying-demo patterns (stand, lookup, front, etc.)
- Shot-by-shot label/dialogue/staging from Storyboard
- Copies gui.rpy, screens.rpy, options.rpy from templates

### QA (`src/pipeline/qa.ts`)

Runs `renpy-sdk/renpy.sh <game-path> lint` (or `.exe` on Windows). Parses output for errors/warnings. Returns TestRun document. If SDK not found, returns warning-level TestRun.

## CLI

```
npx renpy-agent "一个关于樱花树下告白的故事"
npx renpy-agent --name "sakura-night" "一个关于樱花树下告白的故事"
```

- `--name` optional, defaults to slugified timestamp (`story-20260422-143000`)
- Reads `.env` from project root via dotenv
- Prints progress to stdout: `[planner] Planning...`, `[writer] Writing script...`, etc.
- On success: prints path to game directory
- On failure: prints error and exits with code 1

## File Structure (additions to v0.1)

```
src/
├── llm/
│   ├── types.ts              # LlmClient interface, LlmMessage, LlmResponse
│   └── claude-client.ts      # ClaudeLlmClient implementation
├── pipeline/
│   ├── run-pipeline.ts       # Sequential orchestrator
│   ├── planner.ts            # Planner POC (LLM call)
│   ├── writer.ts             # Writer POC (LLM call)
│   ├── storyboarder.ts       # Storyboarder POC (LLM call)
│   ├── coder.ts              # Coder POC (deterministic template)
│   ├── qa.ts                 # QA POC (renpy lint)
│   └── types.ts              # PlannerOutput, WriterOutput, StoryboarderOutput
├── templates/
│   ├── gui.rpy               # Copied from baiying-demo
│   ├── screens.rpy           # Copied from baiying-demo
│   └── options.rpy           # Template with {{title}} placeholder
├── cli.ts                    # Entry point
└── index.ts                  # Add pipeline re-exports
```

## Dependencies

- `@anthropic-ai/sdk` — Claude API client (new)
- `vitest` — test framework (new, devDependency)
- `dotenv` — already present
- `typescript`, `@types/node` — already present

### package.json changes

- Add `"bin": { "renpy-agent": "dist/cli.js" }` for npx support
- Add script to copy `src/templates/*.rpy` to `dist/templates/` during build

## Testing Strategy

**Unit tests (vitest):**
- `coder.test.ts` — deterministic, fully testable: give known Storyboard, verify .rpy output matches expected
- `qa.test.ts` — mock child process exec, verify lint output parsing
- `claude-client.test.ts` — mock HTTP, verify message formatting and response parsing
- `cli.test.ts` — mock runPipeline, verify argument parsing

**Integration test (manual):**
- Run full pipeline with real API key
- Verify output .rpy runs in Ren'Py without errors

**No LLM-dependent unit tests** — Writer/Storyboarder/Planner are thin LLM wrappers. Testing prompt quality is done via integration test. Mocking LLM responses only tests JSON parsing.

## Out of Scope

- No SQLite workspace DB (v0.3)
- No RunningHub asset generation (v0.3)
- No modification/iteration loops (v0.4)
- No multi-chapter/route support (v1.0)
- No Producer POC (not needed for single-chapter pipeline)
- No Executer tool-use loops (POCs are single-call functions)

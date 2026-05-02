# V5 Modify Chain — Planner Traces

**Spec:** [docs/superpowers/plans/2026-05-01-v0.7-phase-2-plan.md §5.5](./superpowers/plans/2026-05-01-v0.7-phase-2-plan.md)
**CLI:** `renpy-agent v5-modify <story> "<intent>" [--budget-cap <usd>]`
**Entry point:** [src/agents/run-v5.ts](../src/agents/run-v5.ts) — `runV5Modify`

This document demonstrates four end-to-end Planner traces captured from the scripted
suite in [src/agents/run-v5-modify.test.ts](../src/agents/run-v5-modify.test.ts). Each
trace answers the central question of §5.5: given a **natural-language modify intent**
against an existing Ren'Py project, does the V5 Planner arrive at the **minimum set of
POC handoffs** that realize it?

The scripted tests pin the Planner's behaviour with a mock LLM so the orchestration
wiring (mode:'modify' prompt swap, dirty-state propagation, byte-for-byte invariance
of untouched documents) stays green on every commit. The real-model behaviour this
trace imitates is captured in the Planner's few-shot examples in
[src/agents/planner.ts](../src/agents/planner.ts) under `PLANNER_RULES_MODIFY`.

Every trace below lists, for each Planner turn: the tool emitted, the Executer sub-
conversation (if any), and the Executer's final `taskSummary` returned to the
Planner. Style mirrors the M5 smoke report §2.

---

## Trace 1 — Change appearance ("short hair")

**Intent:** `Change character Baiying to have a short bob haircut`
**Expected behaviour:** only `character/baiying.json` changes; storyboard / script /
project / chapter / other characters / scenes are byte-identical to pre-run.

| Turn | Planner tool | Brief / args | Executer sub-chain | Summary |
|------|--------------|--------------|--------------------|---------|
| 1 | `read_from_uri` | `workspace://character/baiying` | — | (reads the target doc to confirm the character exists before acting) |
| 2 | `handoff_to_agent` | `character_designer`; brief = "Update visualDescription to 'short bob haircut, school uniform'" | read → `create_or_update_character` → `output_with_finish` | "baiying visualDescription updated; main image marked placeholder" |
| 3 | `output_with_finish` | `character_designer updated baiying` | — | — |
| 4 | `handoff_to_agent` | `coder` | read storyboard → read script → `write_game_project` → finish | "rpy rebuilt (baiying main image will render as placeholder)" |
| 5 | `output_with_finish` | `coder rebuilt .rpy project` | — | — |
| 6 | `handoff_to_agent` | `qa` | 6× `read_from_uri` → `run_qa` → finish | "qa skipped (no sdk)" |
| 7 | `output_with_finish` | `qa ran` | — | — |
| 8 | `output_with_finish` | **final**: `modify applied: Baiying visualDescription changed to short bob; coder+qa re-ran` | — | — |

**Dirty-state propagation verified:**

- `character_designer.create_or_update_character` detects that `visualDescription`
  differs from the existing doc, so it flips every asset-registry entry whose
  `logicalKey` starts with `character:baiying:` back to `status: 'placeholder'`
  while preserving `realAssetLocalPath` as audit history (see
  [`markCharacterAssetsPlaceholder`](../src/executers/character-designer/tools.ts)).
- The character doc's `mainImageUri` is **preserved** (audit history); only the
  registry entry's status flips. Coder's next `swap_asset_placeholder` round will
  render the Solid()/Image() placeholder again.

**Byte-for-byte invariance (test assertion):** `project.json`, `chapter.json`,
`script.json`, `storyboard.json`, `scenes/classroom.json` all match their pre-run
bytes exactly.

---

## Trace 2 — Change dialogue

**Intent:** `Change shot 1 line 0 dialogue to "the tree is blooming."`
**Expected behaviour:** only `storyboard.json` changes; `script.json` (and all other
docs) stay byte-identical.

| Turn | Planner tool | Brief / args | Executer sub-chain | Summary |
|------|--------------|--------------|--------------------|---------|
| 1 | `read_from_uri` | `workspace://storyboard` | — | (locate shot 1 line 0) |
| 2 | `handoff_to_agent` | `storyboarder`; brief = "Update shot 1 line 0 dialogueLines[0].text to '…'" | read storyboard → read script → `condense_to_shots` (re-emits full storyboard via scripted `emit_storyboarder_output`) → finish | "storyboard re-condensed with updated line" |
| 3 | `output_with_finish` | `storyboarder updated` | — | — |
| 4 | `output_with_finish` | **final**: `modify applied: shot 1 line 0 updated` | — | — |

**Why storyboarder and not writer:** the dialogueLines array lives on the **shot**
(not on the script). Per the schema's dependency map, the owning document is
`storyboard`, so the Planner's few-shot (B) pattern routes to storyboarder.
`script.json` is a sibling reference and not touched.

---

## Trace 3 — Add a new character (Planner self-routing)

**Intent:** `Add a barista character named Takeda and have him say one line`
**Expected behaviour:** the Planner **decides on its own** that 3 POCs must run
(none of them named in the intent): `producer` (chapter.cast), `character_designer`
(new character doc), `writer` (splice a line).

| Turn | Planner tool | Brief / args | Executer sub-chain | Summary |
|------|--------------|--------------|--------------------|---------|
| 1 | `read_from_uri` | `workspace://chapter` | — | (inspect current cast) |
| 2 | `handoff_to_agent` | `producer`; brief = "Add Takeda to chapter.cast" | read chapter → `create_chapter` (outline+new cast) → finish | "chapter.cast updated to include Takeda" |
| 3 | `output_with_finish` | `producer added takeda to chapter.cast` | — | — |
| 4 | `handoff_to_agent` | `character_designer`; brief = "Create character Takeda: 'gruff barista…'" | `create_or_update_character` → finish | "character/takeda created (placeholder image)" |
| 5 | `output_with_finish` | `created character/takeda` | — | — |
| 6 | `handoff_to_agent` | `writer`; brief = "Add one spoken line from Takeda in classroom" | read chapter + baiying + takeda → finish (line-splice deferred to next full redraft in scripted run) | "writer acknowledged; line-splice deferred" |
| 7 | `output_with_finish` | `writer added one line from Takeda` | — | — |
| 8 | `output_with_finish` | **final**: `modify applied: added character Takeda; cast, character doc, and one script line updated` | — | — |

**Invariance assertion:** the original `characters/baiying.json` is byte-identical
to pre-run; the new `characters/takeda.json` is created. No character cross-talk.

---

## Trace 4 — Out-of-range intent (graceful refusal)

**Intent:** `Change shot 99 line 0 dialogue to something`
**Expected behaviour:** the Planner inspects the storyboard, notes that shot 99 does
not exist, and finishes without crashing or making any changes.

| Turn | Planner tool | Brief / args | Executer sub-chain | Summary |
|------|--------------|--------------|--------------------|---------|
| 1 | `read_from_uri` | `workspace://storyboard` | — | (only 1 shot found) |
| 2 | `output_with_finish` | **final**: `cannot apply: shot 99 not found in current storyboard (only 1 shot exists)` | — | — |

**Invariance assertion:** every seeded workspace file is byte-identical to pre-run.
The `cannot apply: …` prefix is matched by `isDoneSummary` so the Planner loop
exits with `done: true` rather than looping through its full `maxPlannerTasks`.

---

## System-prompt contract

Prompts live in [src/agents/planner.ts](../src/agents/planner.ts):

- `PLANNER_SYSTEM_PROMPT_MODIFY`: cacheable static segment that replaces
  `PLANNER_SYSTEM_PROMPT` when `runPlannerTask({ mode: 'modify' })` is used.
  Contains:
  - **9 rules** covering minimum-handoff, out-of-range graceful refusal, and the
    explicit carve-out that the idempotent-finish shortcut from generate-mode
    Rule 8 does **not** apply in modify mode.
  - **4 few-shot handoff patterns** (A–D) for: change appearance, change dialogue,
    add character, out-of-range. These constrain Planner behaviour to the
    byte-for-byte invariance boundary the §5.5 tests assert.
- `buildPlannerDynamicSegmentModify`: per-run segment that injects the `modifyIntent`
  and the current workspace index. Deliberately omits the "prior Stage A delivered,
  short-circuit to finish" hint from generate-mode so the Planner always executes
  at least one handoff.

## Cost expectation

Per the plan's §5.5.5 acceptance criteria:

- Simple intent (change appearance / dialogue): **< $1** on Sonnet 4.6 with prompt
  cache warm (system prompt + schema digest + workspace index are all in the
  cacheable static segment, which is well past Bedrock's 4096-char cache threshold
  thanks to the §8 inflation work).
- Complex intent (add character, rebuild cascade): **$1–$2**.
- Real-key smoke against the `smoke-v5` workspace is tracked in
  [docs/smoke-reports/](smoke-reports/) once run.

## Deprecation of v0.4 `modify.ts`

The three v0.4 helpers (`modifyCharacterAppearance`, `modifyDialogueLine`,
`reorderShots`) in [src/pipeline/modify.ts](../src/pipeline/modify.ts) are marked
`@deprecated` with the note "Use `renpy-agent v5-modify` instead; will be removed
in v0.8." They remain wired to the `renpy-agent modify <op> …` CLI subcommand so
existing callers keep working until v0.8 cuts them.

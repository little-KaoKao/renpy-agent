// v0.5 audio + UI stage:按最小集合策略(Plan 2 §5)并发跑四位 POC。
//
// 最小集合(为了证明闭环,不做全量生成):
//   - BGM:每个 scene 一条,描述取 scene.description。
//   - Voice:按 Storyboarder shot 顺序取前 5 句非 narrator 对白。key 用
//     (shotNumber, shotLineIndex) —— 和 Coder 渲染时的索引一致,
//     不会因 Storyboarder 压缩丢句而错位。之前是按 Writer 前 5 句走
//     (sceneNumber, lineIndex),Storyboarder 不保留 Writer 序号就会错位。
//   - SFX:每个 shot 的 enter cue,仅当 shot.effects 包含 door/footsteps/wind 等关键词。
//   - UI:只生成 main_menu 一个 screen。
//
// 失败策略:单条资产失败不整体失败,executer 已 markAssetError,Coder 查 registry
// 时视为未命中走占位;stage 只汇总 ok/err 数,日志透出。
//
// 并发:BGM / Voice / SFX 三组都写同一个 `asset-registry.json`,load→compute→save
// 不是原子的,所以它们串行执行(组间排队、组内再串行),避免并发写时互相覆盖
// 彼此的 entry。UI 批不触碰 registry,可以和 RunningHub 组并发。

import type { LlmClient } from '../llm/types.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import type { FetchLike } from '../assets/download.js';
import type {
  PlannerOutput,
  StoryboarderOutput,
  WriterOutput,
} from './types.js';
import { generateBgmTrack } from '../executers/music-director/generate-bgm-track.js';
import { generateVoiceLine } from '../executers/voice-director/generate-voice-line.js';
import { generateSfx, type SfxCue } from '../executers/sfx-designer/generate-sfx.js';
import { generateUiPatch } from '../executers/ui-designer/generate-ui-patch.js';
import type {
  BgmSnapshot,
  SfxSnapshot,
  UiSnapshot,
  VoiceSnapshot,
} from './workspace.js';

export interface AudioUiStageStats {
  readonly bgm: { readonly ok: number; readonly err: number };
  readonly voice: { readonly ok: number; readonly err: number };
  readonly sfx: { readonly ok: number; readonly err: number };
  readonly ui: { readonly ok: number; readonly err: number };
}

export interface AudioUiStageOutput {
  readonly stats: AudioUiStageStats;
  readonly bgm: BgmSnapshot;
  readonly voice: VoiceSnapshot;
  readonly sfx: SfxSnapshot;
  readonly ui: UiSnapshot;
  readonly uiPatches: ReadonlyArray<{ readonly screen: string; readonly patch: string }>;
}

export interface AudioUiStageLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface RunAudioUiStageParams {
  readonly planner: PlannerOutput;
  readonly writer: WriterOutput;
  readonly storyboarder: StoryboarderOutput;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly runningHubClient: RunningHubClient;
  readonly llm: LlmClient;
  readonly logger?: AudioUiStageLogger;
  readonly voiceTagDefault?: string;
  readonly uiMoodTag?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  /** Override the fetch used by asset downloads (tests, proxies). */
  readonly fetchFn?: FetchLike;
}

// Qwen3 TTS 的 voice_text 是「创意提示」,不是 TTS 音色参数 —— 模型会基于它
// 解读年龄 / 性别 / 情绪,英文描述实测效果差(会触发模型把英文当台词读一部分)。
// 用短的中文角色卡式描述效果稳定得多。
const DEFAULT_VOICE_TAG = '成年女声,自然温柔,语速平稳';
const DEFAULT_UI_MOOD = 'soft pastel visual-novel menu';
const VOICE_LINE_BUDGET = 5;
const SFX_KEYWORDS = ['door', 'footstep', 'wind', 'rain', 'thunder', 'clock', 'heartbeat'];

export async function runAudioUiStage(
  params: RunAudioUiStageParams,
): Promise<AudioUiStageOutput> {
  const log = params.logger ?? silentLogger;

  const bgmPlan = planBgmTracks(params.planner);
  const voicePlan = planVoiceLines(params.storyboarder, params.planner, params.voiceTagDefault);
  const sfxPlan = planSfxCues(params.storyboarder);
  const uiPlan = planUiPatches(params.planner, params.uiMoodTag);

  log.info(
    `[audio-ui] plan: bgm=${bgmPlan.length} voice=${voicePlan.length} ` +
      `sfx=${sfxPlan.length} ui=${uiPlan.length}`,
  );

  // UI batch does not share registry state with the RunningHub batches, so it
  // can run concurrently with them. The three registry-writing batches must
  // run sequentially to avoid racing on `asset-registry.json`.
  const [registryBatches, uiResult] = await Promise.all([
    (async () => {
      const bgm = await runBgmBatch(bgmPlan, params, log);
      const voice = await runVoiceBatch(voicePlan, params, log);
      const sfx = await runSfxBatch(sfxPlan, params, log);
      return { bgm, voice, sfx };
    })(),
    runUiBatch(uiPlan, params, log),
  ]);
  const { bgm: bgmResult, voice: voiceResult, sfx: sfxResult } = registryBatches;

  const stats: AudioUiStageStats = {
    bgm: bgmResult.stats,
    voice: voiceResult.stats,
    sfx: sfxResult.stats,
    ui: uiResult.stats,
  };
  log.info(
    `[audio-ui] done: bgm ${stats.bgm.ok}/${stats.bgm.ok + stats.bgm.err} ` +
      `voice ${stats.voice.ok}/${stats.voice.ok + stats.voice.err} ` +
      `sfx ${stats.sfx.ok}/${stats.sfx.ok + stats.sfx.err} ` +
      `ui ${stats.ui.ok}/${stats.ui.ok + stats.ui.err}`,
  );

  return {
    stats,
    bgm: { tracks: bgmPlan },
    voice: { lines: voicePlan },
    sfx: { cues: sfxPlan },
    ui: { patches: uiResult.patches },
    uiPatches: uiResult.patches.map((p) => ({ screen: p.screen, patch: p.rpyScreenPatch })),
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function planBgmTracks(planner: PlannerOutput) {
  return planner.scenes.map((scene) => ({
    sceneName: scene.name,
    trackName: scene.name,
    styleDescription: `${scene.description || scene.name}, ambient visual novel BGM, loopable`,
  }));
}

function planVoiceLines(
  storyboarder: StoryboarderOutput,
  planner: PlannerOutput,
  defaultTag?: string,
) {
  const fallbackTag = defaultTag ?? DEFAULT_VOICE_TAG;
  const voiceTagByChar = new Map<string, string>();
  for (const c of planner.characters) {
    // PlannerOutputCharacter has no voiceTag field in v0.5 — fall back to a
    // canned tag. Later versions can carry a per-character tag from Planner.
    voiceTagByChar.set(c.name, fallbackTag);
  }

  const plan: Array<{
    shotNumber: number;
    lineIndex: number;
    speaker: string;
    text: string;
    voiceTag: string;
  }> = [];
  // Walk shots in storyboard order; pick the first VOICE_LINE_BUDGET non-narrator
  // lines. Key by (shotNumber, shotLineIndex) so Coder's shot-based rendering
  // finds the right voice asset regardless of how Storyboarder compressed Writer.
  outer: for (const shot of storyboarder.shots) {
    for (let i = 0; i < shot.dialogueLines.length; i++) {
      if (plan.length >= VOICE_LINE_BUDGET) break outer;
      const line = shot.dialogueLines[i]!;
      if (line.speaker === 'narrator') continue;
      plan.push({
        shotNumber: shot.shotNumber,
        lineIndex: i,
        speaker: line.speaker,
        text: line.text,
        voiceTag: voiceTagByChar.get(line.speaker) ?? fallbackTag,
      });
    }
  }
  return plan;
}

function planSfxCues(storyboarder: StoryboarderOutput) {
  const plan: Array<{ shotNumber: number; cue: SfxCue; description: string }> = [];
  for (const shot of storyboarder.shots) {
    const effects = (shot.effects ?? '').toLowerCase();
    const matched = SFX_KEYWORDS.find((kw) => effects.includes(kw));
    if (!matched) continue;
    plan.push({
      shotNumber: shot.shotNumber,
      cue: 'enter',
      description: shot.effects ?? matched,
    });
  }
  return plan;
}

function planUiPatches(planner: PlannerOutput, moodTag?: string) {
  return [
    {
      screen: 'main_menu' as const,
      moodTag: moodTag ?? DEFAULT_UI_MOOD,
      projectTitle: planner.projectTitle,
    },
  ];
}

// ---------------------------------------------------------------------------
// Batch runners — each group runs sequentially internally.
// ---------------------------------------------------------------------------

async function runBgmBatch(
  plan: ReadonlyArray<{ sceneName: string; trackName: string; styleDescription: string }>,
  params: RunAudioUiStageParams,
  log: AudioUiStageLogger,
) {
  let ok = 0;
  let err = 0;
  for (const item of plan) {
    try {
      await generateBgmTrack({
        trackName: item.trackName,
        styleDescription: item.styleDescription,
        gameDir: params.gameDir,
        registryPath: params.registryPath,
        client: params.runningHubClient,
        ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
        ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
        ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
      });
      ok++;
    } catch (e) {
      err++;
      log.error(`[audio-ui] bgm failed for "${item.trackName}": ${asMessage(e)}`);
    }
  }
  return { stats: { ok, err } };
}

async function runVoiceBatch(
  plan: ReadonlyArray<{
    shotNumber: number;
    lineIndex: number;
    speaker: string;
    text: string;
    voiceTag: string;
  }>,
  params: RunAudioUiStageParams,
  log: AudioUiStageLogger,
) {
  let ok = 0;
  let err = 0;
  for (const item of plan) {
    try {
      await generateVoiceLine({
        shotNumber: item.shotNumber,
        lineIndex: item.lineIndex,
        text: item.text,
        voiceTag: item.voiceTag,
        gameDir: params.gameDir,
        registryPath: params.registryPath,
        client: params.runningHubClient,
        ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
        ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
        ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
      });
      ok++;
    } catch (e) {
      err++;
      log.error(
        `[audio-ui] voice failed for shot_${item.shotNumber}:line_${item.lineIndex}: ${asMessage(e)}`,
      );
    }
  }
  return { stats: { ok, err } };
}

async function runSfxBatch(
  plan: ReadonlyArray<{ shotNumber: number; cue: SfxCue; description: string }>,
  params: RunAudioUiStageParams,
  log: AudioUiStageLogger,
) {
  let ok = 0;
  let err = 0;
  for (const item of plan) {
    try {
      await generateSfx({
        shotNumber: item.shotNumber,
        cue: item.cue,
        description: item.description,
        gameDir: params.gameDir,
        registryPath: params.registryPath,
        client: params.runningHubClient,
        ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
        ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
        ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
      });
      ok++;
    } catch (e) {
      err++;
      log.error(`[audio-ui] sfx failed for shot_${item.shotNumber}:${item.cue}: ${asMessage(e)}`);
    }
  }
  return { stats: { ok, err } };
}

async function runUiBatch(
  plan: ReadonlyArray<{
    screen: 'main_menu';
    moodTag: string;
    projectTitle: string;
  }>,
  params: RunAudioUiStageParams,
  log: AudioUiStageLogger,
) {
  let ok = 0;
  let err = 0;
  const patches: Array<{ screen: string; moodTag: string; rpyScreenPatch: string }> = [];
  for (const item of plan) {
    try {
      const result = await generateUiPatch({
        screen: item.screen,
        moodTag: item.moodTag,
        projectTitle: item.projectTitle,
        llmClient: params.llm,
      });
      patches.push({
        screen: item.screen,
        moodTag: item.moodTag,
        rpyScreenPatch: result.rpyScreenPatch,
      });
      ok++;
    } catch (e) {
      err++;
      log.error(`[audio-ui] ui patch failed for ${item.screen}: ${asMessage(e)}`);
    }
  }
  return { stats: { ok, err }, patches };
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const silentLogger: AudioUiStageLogger = {
  info: () => {},
  error: () => {},
};

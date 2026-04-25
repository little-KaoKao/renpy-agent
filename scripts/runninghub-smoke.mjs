// RunningHub 真 key smoke —— 8 个 AppKey 一次性体检。
//
// 与 src/executers/common/runninghub-{client,schemas}.ts 对齐,使用 `dist/`
// 产物以复用生产代码。先 `pnpm build`,再:
//
//   node --env-file=.env scripts/runninghub-smoke.mjs            # 全跑 8 条
//   node --env-file=.env scripts/runninghub-smoke.mjs CHARACTER_MAIN_IMAGE SCENE_BACKGROUND
//
// 结果落在 `runtime/smoke/<ISO8601-timestamp>/`:每条 case 一个 `.json`
// 和(若下载成功)一份真产物,外加 `summary.json` 汇总。依赖缺失时直接报错
// 退出,不自动补齐 —— 显式让用户选。
//
// 成本提醒:完整 8 条 = MJv7 1 + Nanobanana2 ×2 + Seedance ×2(视频贵)+
// Qwen3 TTS ×2 + SunoV5(贵)。脚本起跑前有 3s 确认窗口,Ctrl-C 可中止。

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  HttpRunningHubClient,
  RUNNINGHUB_APP_SCHEMAS,
  runImageTask,
  downloadAsset,
  inferExtensionFromUrl,
} from '../dist/index.js';

const APP_KEYS = [
  'CHARACTER_MAIN_IMAGE',
  'SCENE_BACKGROUND',
  'CHARACTER_EXPRESSION',
  'CHARACTER_DYNAMIC_SPRITE',
  'CUTSCENE_IMAGE_TO_VIDEO',
  'VOICE_LINE',
  'SFX',
  'BGM_TRACK',
];

// Dependency edges: downstream → upstream. Downstream case inherits the
// upstream case's outputUri as a role value (see CASES below).
const DEPENDENCIES = {
  CHARACTER_EXPRESSION: ['SCENE_BACKGROUND'],
  CUTSCENE_IMAGE_TO_VIDEO: ['SCENE_BACKGROUND'],
  CHARACTER_DYNAMIC_SPRITE: ['CHARACTER_MAIN_IMAGE'],
};

// Per-AppKey smoke definition:
//   - `inputs(ctx)` returns the AiAppNodeInput[] to submit. `ctx` exposes the
//     outputUri of any already-completed upstream case.
//   - `extFallback` is the file extension to save with if inferExtensionFromUrl
//     can't figure one out from the URL.
const CASES = {
  CHARACTER_MAIN_IMAGE: {
    inputs: () => [{ role: 'prompt', value: 'a cat girl in school uniform, anime style' }],
    extFallback: '.png',
  },
  SCENE_BACKGROUND: {
    inputs: () => [{ role: 'prompt', value: 'anime classroom at sunset, soft warm light' }],
    extFallback: '.png',
  },
  CHARACTER_EXPRESSION: {
    inputs: (ctx) => [
      { role: 'prompt', value: 'smiling face, close-up portrait' },
      { role: 'reference_image_1', value: ctx.uriOf('SCENE_BACKGROUND') },
    ],
    extFallback: '.png',
  },
  CHARACTER_DYNAMIC_SPRITE: {
    inputs: (ctx) => [
      { role: 'prompt', value: 'gentle breathing, subtle hair movement' },
      { role: 'first_frame', value: ctx.uriOf('CHARACTER_MAIN_IMAGE') },
    ],
    extFallback: '.mp4',
  },
  CUTSCENE_IMAGE_TO_VIDEO: {
    inputs: (ctx) => [
      { role: 'prompt', value: 'slow camera pan, cinematic lighting' },
      { role: 'first_frame', value: ctx.uriOf('SCENE_BACKGROUND') },
    ],
    extFallback: '.mp4',
  },
  VOICE_LINE: {
    inputs: () => [
      { role: 'voice_text', value: 'gentle female voice, soft and warm' },
      { role: 'line_text', value: '你好,初次见面。' },
    ],
    extFallback: '.mp3',
  },
  SFX: {
    inputs: () => [
      { role: 'voice_text', value: 'ambient sound field, no voice, pure environmental audio' },
      { role: 'line_text', value: 'rain on window' },
    ],
    extFallback: '.mp3',
  },
  BGM_TRACK: {
    inputs: () => [
      { role: 'title', value: 'smoke-test' },
      { role: 'prompt', value: 'piano ballad, melancholic, slow tempo' },
    ],
    extFallback: '.mp3',
  },
};

function parseAppKeys(argv) {
  if (argv.length === 0) return APP_KEYS.slice();
  const unknown = argv.filter((k) => !APP_KEYS.includes(k));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown AppKey(s): ${unknown.join(', ')}\n` +
        `Valid keys: ${APP_KEYS.join(', ')}`,
    );
  }
  return Array.from(new Set(argv));
}

function checkDependencies(selected) {
  const inSet = new Set(selected);
  const missing = [];
  for (const key of selected) {
    const deps = DEPENDENCIES[key] ?? [];
    for (const dep of deps) {
      if (!inSet.has(dep)) missing.push({ key, dep });
    }
  }
  if (missing.length > 0) {
    const lines = missing.map(
      ({ key, dep }) =>
        `  ${key} requires ${dep} in the run list.`,
    );
    throw new Error(
      `Missing dependencies:\n${lines.join('\n')}\n` +
        `Either add the upstream key(s) explicitly, or omit all arguments to run the full set.`,
    );
  }
}

function topoSort(selected) {
  const inSet = new Set(selected);
  const visited = new Set();
  const out = [];
  const visit = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    for (const dep of DEPENDENCIES[key] ?? []) {
      if (inSet.has(dep)) visit(dep);
    }
    out.push(key);
  };
  for (const key of selected) visit(key);
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timestampSlug(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function runCase(appKey, client, smokeDir, ctx) {
  const definition = CASES[appKey];
  const deps = DEPENDENCIES[appKey] ?? [];
  const missingDep = deps.find((d) => !ctx.results[d] || ctx.results[d].status !== 'ok');
  if (missingDep) {
    return {
      appKey,
      status: 'skipped',
      reason: `upstream ${missingDep} did not succeed`,
    };
  }

  const t0 = Date.now();
  let inputs;
  try {
    inputs = definition.inputs(ctx);
  } catch (err) {
    return {
      appKey,
      status: 'error',
      durationMs: Date.now() - t0,
      error: `could not build inputs: ${String(err?.message ?? err)}`,
    };
  }

  let taskId;
  let outputUri;
  try {
    const result = await runImageTask({ client, appKey, inputs });
    taskId = result.taskId;
    outputUri = result.outputUri;
  } catch (err) {
    return {
      appKey,
      status: 'error',
      durationMs: Date.now() - t0,
      taskId: err?.taskId,
      error: String(err?.message ?? err),
    };
  }

  let localFile;
  let byteLength;
  try {
    const ext = inferExtensionFromUrl(outputUri);
    const filename = ext === '.bin' ? `${appKey}${definition.extFallback}` : `${appKey}${ext}`;
    const dl = await downloadAsset({
      remoteUrl: outputUri,
      gameDir: smokeDir,
      targetRelativePath: filename,
    });
    localFile = dl.localRelativePath;
    byteLength = dl.byteLength;
  } catch (err) {
    return {
      appKey,
      status: 'error',
      durationMs: Date.now() - t0,
      taskId,
      outputUri,
      error: `submit+poll ok but download failed: ${String(err?.message ?? err)}`,
    };
  }

  return {
    appKey,
    status: 'ok',
    durationMs: Date.now() - t0,
    taskId,
    outputUri,
    localFile,
    byteLength,
  };
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function main() {
  const apiKey = process.env.RUNNINGHUB_API_KEY;
  if (!apiKey) {
    console.error('❌ RUNNINGHUB_API_KEY 未设置,请检查 .env');
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  let selected;
  try {
    selected = parseAppKeys(argv);
    checkDependencies(selected);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  const ordered = topoSort(selected);

  console.log('Smoke plan (in execution order):');
  for (const key of ordered) console.log(`  - ${key}`);
  console.log(
    `\n⚠️  This will submit ${ordered.length} paid RunningHub job(s) ` +
      `(MJv7 / Nanobanana2 / Seedance / Qwen3 TTS / SunoV5, ~seconds to minutes each).\n` +
      `   Press Ctrl-C within 3s to abort...`,
  );
  await sleep(3000);
  console.log('Starting.\n');

  const client = new HttpRunningHubClient({
    apiKey,
    appSchemas: RUNNINGHUB_APP_SCHEMAS,
  });

  const smokeDir = resolve(process.cwd(), 'runtime', 'smoke', timestampSlug());
  await mkdir(smokeDir, { recursive: true });

  const ctx = {
    results: {},
    uriOf(key) {
      const r = this.results[key];
      if (!r || r.status !== 'ok' || !r.outputUri) {
        throw new Error(`upstream ${key} has no outputUri (status=${r?.status ?? 'missing'})`);
      }
      return r.outputUri;
    },
  };

  for (const appKey of ordered) {
    process.stdout.write(`[${appKey}] running... `);
    const result = await runCase(appKey, client, smokeDir, ctx);
    ctx.results[appKey] = result;
    await writeJson(resolve(smokeDir, `${appKey}.json`), result);
    if (result.status === 'ok') {
      console.log(`ok (${result.durationMs}ms, ${result.byteLength}B → ${result.localFile})`);
    } else if (result.status === 'skipped') {
      console.log(`skipped (${result.reason})`);
    } else {
      console.log(`error: ${result.error}`);
    }
  }

  const summary = {
    startedAt: new Date().toISOString(),
    smokeDir,
    requested: argv.length > 0 ? selected : 'all',
    results: ordered.map((k) => ctx.results[k]),
  };
  await writeJson(resolve(smokeDir, 'summary.json'), summary);

  const okCount = summary.results.filter((r) => r.status === 'ok').length;
  const errCount = summary.results.filter((r) => r.status === 'error').length;
  const skipCount = summary.results.filter((r) => r.status === 'skipped').length;
  console.log(
    `\nSummary: ${okCount} ok, ${errCount} error, ${skipCount} skipped.\n` +
      `Artifacts: ${smokeDir}`,
  );
  process.exit(okCount > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});

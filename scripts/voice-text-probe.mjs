// Ad-hoc probe: does Qwen3 TTS read `voice_text` aloud alongside `line_text`?
//
// Background: VOICE_LINE smoke produced a 44.8-second FLAC for the line
// "你好,初次见面。" (should be ~3s). Hypothesis: the node treats voice_text
// as something it speaks, not as a tone descriptor. This script sends the
// same line under three conditions and reports duration/size:
//
//   A: voice_text = English tone description + Chinese line
//   B: voice_text = omitted (undefined) + Chinese line
//   C: voice_text = Chinese tone label + Chinese line
//
// If B is short and A is long, the fix is to stop sending voice_text.
//
// Run:  node --env-file=.env scripts/voice-text-probe.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  HttpRunningHubClient,
  RUNNINGHUB_APP_SCHEMAS,
  runImageTask,
  downloadAsset,
  inferExtensionFromUrl,
} from '../dist/index.js';

const LINE = '你好,初次见面。';

const CASES = [
  {
    name: 'A_english_voice_text',
    inputs: [
      { role: 'voice_text', value: 'gentle female voice, soft and warm' },
      { role: 'line_text', value: LINE },
    ],
  },
  {
    name: 'B_no_voice_text',
    inputs: [
      { role: 'line_text', value: LINE },
    ],
  },
  {
    name: 'C_chinese_voice_text',
    inputs: [
      { role: 'voice_text', value: '温柔女声' },
      { role: 'line_text', value: LINE },
    ],
  },
];

function probeFlacDuration(buf) {
  if (buf.slice(0, 4).toString('ascii') !== 'fLaC') return null;
  const size = buf.readUIntBE(5, 3);
  const si = buf.subarray(8, 8 + size);
  const b10 = si.readBigUInt64BE(10);
  const sampleRate = Number((b10 >> 44n) & 0xFFFFFn);
  const totalSamples = Number(b10 & ((1n << 36n) - 1n));
  return sampleRate ? totalSamples / sampleRate : null;
}

async function main() {
  const apiKey = process.env.RUNNINGHUB_API_KEY;
  if (!apiKey) {
    console.error('RUNNINGHUB_API_KEY 未设置');
    process.exit(1);
  }
  const client = new HttpRunningHubClient({
    apiKey,
    appSchemas: RUNNINGHUB_APP_SCHEMAS,
  });

  const dir = resolve(
    process.cwd(),
    'runtime',
    'smoke',
    'voice-probe-' + new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(dir, { recursive: true });

  console.log(`⚠️  3 paid VOICE_LINE jobs. Ctrl-C in 3s to abort...\n`);
  await new Promise((r) => setTimeout(r, 3000));

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`[${c.name}] running... `);
    const t0 = Date.now();
    try {
      const task = await runImageTask({
        client,
        appKey: 'VOICE_LINE',
        inputs: c.inputs,
      });
      const ext = inferExtensionFromUrl(task.outputUri);
      const filename = `${c.name}${ext}`;
      const dl = await downloadAsset({
        remoteUrl: task.outputUri,
        gameDir: dir,
        targetRelativePath: filename,
      });
      const { readFile } = await import('node:fs/promises');
      const buf = await readFile(resolve(dir, filename));
      const dur = probeFlacDuration(buf);
      const result = {
        ...c,
        durationMs: Date.now() - t0,
        taskId: task.taskId,
        outputUri: task.outputUri,
        byteLength: dl.byteLength,
        audioDurationSeconds: dur,
      };
      results.push(result);
      console.log(
        `ok  audio=${dur ? dur.toFixed(2) + 's' : '?'}  size=${dl.byteLength}B  file=${filename}`,
      );
    } catch (e) {
      const result = { ...c, error: String(e?.message ?? e) };
      results.push(result);
      console.log(`error: ${result.error}`);
    }
  }

  await writeFile(
    resolve(dir, 'summary.json'),
    JSON.stringify(results, null, 2) + '\n',
    'utf8',
  );
  console.log(`\nArtifacts: ${dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

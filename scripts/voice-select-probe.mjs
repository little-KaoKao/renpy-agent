// Probe: does `select="2"` switch Qwen3 TTS from random mode to
// "use-my-text" mode?
//
// Prior probe produced unrelated speech (甲虫 / 坐坐) with select="1"
// on both nodes, confirming inputs were ignored. Official curl docs
// describe the selects as "随机/手写音色文本" and "随机/手写台词文本",
// so one of {1, 2} is "手写". Test select="2" on both.
//
// Run: node --env-file=.env scripts/voice-select-probe.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  HttpRunningHubClient,
  RUNNINGHUB_APP_SCHEMAS,
  runImageTask,
  downloadAsset,
  inferExtensionFromUrl,
} from '../dist/index.js';

const LINE = '你好,初次见面。';

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
    'voice-select-' + new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(dir, { recursive: true });

  console.log(`⚠️  1 paid VOICE_LINE job with select="2". Ctrl-C in 3s...\n`);
  await new Promise((r) => setTimeout(r, 3000));

  // Override both `option` fields by nodeId to "2" (hypothesis: 手写模式).
  const inputs = [
    { role: 'option', nodeId: '7', fieldName: 'select', value: '2' },
    { role: 'option', nodeId: '6', fieldName: 'select', value: '2' },
    { role: 'voice_text', value: '30 岁温柔女声' },
    { role: 'line_text', value: LINE },
  ];

  process.stdout.write(`[select=2] running... `);
  const t0 = Date.now();
  try {
    const task = await runImageTask({ client, appKey: 'VOICE_LINE', inputs });
    const ext = inferExtensionFromUrl(task.outputUri);
    const filename = `select2${ext}`;
    const dl = await downloadAsset({
      remoteUrl: task.outputUri,
      gameDir: dir,
      targetRelativePath: filename,
    });
    const buf = await readFile(resolve(dir, filename));
    const dur = probeFlacDuration(buf);
    console.log(
      `ok  audio=${dur?.toFixed(2)}s  size=${dl.byteLength}B  file=${filename}`,
    );
    await writeFile(
      resolve(dir, 'summary.json'),
      JSON.stringify(
        {
          inputs,
          line: LINE,
          taskId: task.taskId,
          outputUri: task.outputUri,
          durationMs: Date.now() - t0,
          audioDurationSeconds: dur,
          byteLength: dl.byteLength,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`\nFile: ${resolve(dir, filename)}`);
    console.log(`Listen to it. Expected content: "${LINE}"`);
  } catch (e) {
    console.log(`error: ${e?.message ?? e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// One-shot: regenerate all 5 voice lines for yandere-mita-demo-v5 using the
// fixed schema (select="2" 手写模式) and speaker-differentiated Chinese voice
// tags. Cheaper than rerunning the whole audio-ui stage.
//
// Run: node --env-file=.env scripts/regen-voice-v5.mjs

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  HttpRunningHubClient,
  RUNNINGHUB_APP_SCHEMAS,
} from '../dist/index.js';
import { generateVoiceLine } from '../dist/executers/voice-director/generate-voice-line.js';

const STORY = 'yandere-mita-demo-v5';
const GAME_DIR = resolve(process.cwd(), 'runtime', 'games', STORY, 'game');
const REGISTRY_PATH = resolve(process.cwd(), 'runtime', 'games', STORY, 'asset-registry.json');

// Per-character voice tag. Qwen3 TTS reads these as creative hints, not hard
// params, but short Chinese descriptions steer it better than English.
const VOICE_TAG_BY_SPEAKER = {
  沈依依: '年轻女声,甜美温柔带一丝偏执',
  凌晓: '年轻男声,大学生,有些不安',
};

async function main() {
  const apiKey = process.env.RUNNINGHUB_API_KEY;
  if (!apiKey) {
    console.error('RUNNINGHUB_API_KEY 未设置');
    process.exit(1);
  }

  const plan = JSON.parse(
    await readFile(resolve(GAME_DIR, '..', 'workspace', 'voice.json'), 'utf8'),
  );
  console.log(`Regenerating ${plan.lines.length} voice lines for "${STORY}"...`);

  const client = new HttpRunningHubClient({
    apiKey,
    appSchemas: RUNNINGHUB_APP_SCHEMAS,
  });

  let ok = 0;
  let err = 0;
  for (const line of plan.lines) {
    const voiceTag = VOICE_TAG_BY_SPEAKER[line.speaker] ?? '成年女声,自然温柔,语速平稳';
    process.stdout.write(
      `[shot ${line.shotNumber} line ${line.lineIndex}] ${line.speaker}: "${line.text.slice(0, 20)}..." ... `,
    );
    try {
      const result = await generateVoiceLine({
        shotNumber: line.shotNumber,
        lineIndex: line.lineIndex,
        text: line.text,
        voiceTag,
        gameDir: GAME_DIR,
        registryPath: REGISTRY_PATH,
        client,
      });
      console.log(`ok (${result.byteLength}B)`);
      ok++;
    } catch (e) {
      console.log(`error: ${e?.message ?? e}`);
      err++;
    }
  }
  console.log(`\nDone: ${ok} ok, ${err} err.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

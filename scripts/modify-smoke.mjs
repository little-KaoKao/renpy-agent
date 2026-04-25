// 修改闭环 e2e 冒烟 —— 纯本地,不花钱。
//
// 目的:验证 v0.2 pipeline → character/scene executer → modify → rebuild 这条
// 代码路径是通的,并且 script.rpy 里能真实看到 Stage A 占位 ↔ Stage B 真资产 ↔
// Stage A 再占位 的三次切换。
//
// 不做:真 Claude / RunningHub 调用。LLM 用 scripted 回放,RunningHub 用 mock
// 客户端。如果想跑真 key 版,用 scripts/runninghub-smoke.mjs(付费)。
//
// 依赖:`pnpm build` 先跑一次(本脚本从 dist/ 导入生产代码)。
//
// 运行:
//   node scripts/modify-smoke.mjs
//   node scripts/modify-smoke.mjs --keep  # 不清理 tmpdir,方便查产物

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  runPipeline,
  generateCharacterMainImage,
  generateSceneBackground,
  modifyCharacterAppearance,
  rebuildGameProject,
  registryPathForGame,
  loadRegistry,
} from '../dist/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLANNER = {
  projectTitle: '樱之低语',
  genre: 'romance',
  tone: 'tender, dreamlike',
  characters: [
    {
      name: '白樱',
      description: '温柔神秘的少女,似乎存在于屏幕边缘',
      visualDescription: '长发飘逸,淡紫眼眸,白色和风连衣裙',
    },
  ],
  scenes: [
    {
      name: 'sakura_midnight',
      description: '深夜古樱花树下,花瓣在月光中如雪旋转',
    },
  ],
  chapterOutline: '深夜,玩家无意启动一款视觉小说,屏幕中的白樱逐渐流露出超越程序逻辑的情感。',
};

const WRITER = {
  scenes: [
    {
      location: 'sakura_midnight',
      characters: ['白樱'],
      lines: [
        { speaker: 'narrator', text: '屏幕亮起,樱花树下有一个身影。' },
        { speaker: '白樱', text: '……你终于来了。' },
      ],
    },
  ],
};

const STORYBOARDER = {
  shots: [
    {
      shotNumber: 1,
      description: 'baiying turns to greet the player under the sakura tree',
      characters: ['白樱'],
      sceneName: 'sakura_midnight',
      staging: 'enter',
      transforms: 'stand',
      transition: 'fade',
      dialogueLines: [
        { speaker: 'narrator', text: '屏幕亮起,樱花树下有一个身影。' },
        { speaker: '白樱', text: '……你终于来了。' },
      ],
    },
  ],
};

function wrapJson(obj) {
  return '```json\n' + JSON.stringify(obj) + '\n```';
}

class ScriptedLlm {
  constructor(queue) {
    this.queue = [...queue];
    this.calls = [];
  }
  async chat(params) {
    this.calls.push(params);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error('ScriptedLlm: ran out of canned responses');
    }
    return { content: next, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

function makeRunningHubMock() {
  let callIx = 0;
  return {
    async submitTask(p) {
      callIx++;
      return { taskId: `${p.appKey}-task-${callIx}` };
    },
    async pollTask(taskId) {
      // Deterministic cdn URL keyed on appKey so assertions can check them.
      const ext = taskId.startsWith('CHARACTER') ? '.png' : '.png';
      return { status: 'done', outputUri: `https://cdn.mock/${taskId}${ext}` };
    },
  };
}

// Minimal fetch replacement that produces a tiny binary blob for downloadAsset.
const mockFetch = async () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(cond, message) {
  if (!cond) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

function assertContains(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(
      `ASSERT FAILED: ${label} — expected to contain ${JSON.stringify(needle)}`,
    );
  }
}

function assertNotContains(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(
      `ASSERT FAILED: ${label} — expected NOT to contain ${JSON.stringify(needle)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepA_initialPipeline(tmp) {
  console.log('[A] run v0.2 pipeline with scripted LLM (no RunningHub yet)...');
  const llm = new ScriptedLlm([
    wrapJson(PLANNER),
    wrapJson(WRITER),
    wrapJson(STORYBOARDER),
  ]);
  const result = await runPipeline({
    inspiration: '深夜的屏幕里有人在等你',
    storyName: 'modify-smoke',
    llm,
    repoRoot: tmp,
    logger: { info: () => {}, error: (m) => console.error('    ' + m) },
  });
  const scriptRpy = await readFile(resolve(result.gamePath, 'script.rpy'), 'utf8');
  assertContains(scriptRpy, 'image bg_sakura_midnight = Solid(', 'Stage A scene placeholder');
  assertContains(scriptRpy, 'image sprite_', 'Stage A character placeholder');
  assertContains(scriptRpy, 'Transform(Solid(', 'Stage A Transform placeholder');
  console.log('    ok: Stage A placeholders present in script.rpy');
  return result;
}

async function stepB_realAssets(tmp, gameDir) {
  console.log('[B] run character + scene executers with mock RunningHub...');
  const registryPath = registryPathForGame(gameDir);
  const client = makeRunningHubMock();
  const common = {
    gameDir,
    registryPath,
    client,
    fetchFn: mockFetch,
    sleep: async () => {},
    pollIntervalMs: 0,
  };

  await generateCharacterMainImage({
    characterName: '白樱',
    visualDescription: PLANNER.characters[0].visualDescription,
    ...common,
  });
  await generateSceneBackground({
    sceneName: 'sakura_midnight',
    description: PLANNER.scenes[0].description,
    ...common,
  });

  const reg = await loadRegistry(registryPath);
  const keys = reg.entries.map((e) => e.logicalKey).sort();
  assert(
    keys.includes('character:bai_ying:main') || keys.includes('character:asset:main'),
    `expected a character:*:main entry, got ${JSON.stringify(keys)}`,
  );
  assert(
    keys.some((k) => k.startsWith('scene:') && k.endsWith(':bg')),
    `expected a scene:*:bg entry, got ${JSON.stringify(keys)}`,
  );
  console.log('    ok: registry has ready character + scene entries');
  console.log('        keys:', keys);
  return registryPath;
}

async function stepC_rebuildWithRealAssets(tmp, gameDir) {
  console.log('[C] rebuild script.rpy — expect real asset paths...');
  const result = await rebuildGameProject({
    storyName: 'modify-smoke',
    runtimeRoot: resolve(tmp, 'runtime'),
    repoRoot: tmp,
  });
  const scriptRpy = await readFile(resolve(result.gamePath, 'script.rpy'), 'utf8');
  assertContains(
    scriptRpy,
    'image bg_sakura_midnight = "images/bg/',
    'Stage B scene bg wired to real asset',
  );
  assertContains(scriptRpy, 'image sprite_', 'Stage B sprite wired');
  assertContains(scriptRpy, 'images/char/', 'Stage B character real path');
  console.log('    ok: script.rpy references real assets under images/');
  return scriptRpy;
}

async function stepD_modifyCharacter(tmp, gameDir) {
  console.log('[D] modify character appearance (simulated "改短发")...');
  const result = await modifyCharacterAppearance({
    gameDir,
    characterName: '白樱',
    newVisualDescription: '短发粉色双马尾,淡紫眼眸,日常校服',
  });
  assert(
    result.registryChanged === true,
    'expected registryChanged=true because the character had a ready main image',
  );
  assert(
    result.snapshot.planner.characters[0].visualDescription.startsWith('短发'),
    'planner snapshot should reflect new visualDescription',
  );

  const registryPath = registryPathForGame(gameDir);
  const reg = await loadRegistry(registryPath);
  const charEntry = reg.entries.find((e) => e.assetType === 'character_main');
  assert(charEntry, 'expected character_main entry to still exist');
  assert(
    charEntry.status === 'placeholder',
    `expected character_main status=placeholder after modify, got "${charEntry.status}"`,
  );
  assert(
    charEntry.realAssetLocalPath !== undefined,
    'expected realAssetLocalPath to remain as historical breadcrumb',
  );
  console.log('    ok: character registry entry rolled back to placeholder');
}

async function stepE_rebuildAfterModify(tmp, gameDir) {
  console.log('[E] rebuild — character should regress to Solid placeholder, scene stays real...');
  const result = await rebuildGameProject({
    storyName: 'modify-smoke',
    runtimeRoot: resolve(tmp, 'runtime'),
    repoRoot: tmp,
  });
  const scriptRpy = await readFile(resolve(result.gamePath, 'script.rpy'), 'utf8');
  // Character sprite back to Transform(Solid(...)) placeholder.
  assertContains(
    scriptRpy,
    'Transform(Solid(',
    'character sprite should regress to Transform placeholder after modify',
  );
  // Scene background still uses the real image — modify only invalidated character.
  assertContains(
    scriptRpy,
    'image bg_sakura_midnight = "images/bg/',
    'scene should remain real after character-only modify',
  );
  // The character sprite line should NOT point at images/char/ anymore.
  const spriteLines = scriptRpy
    .split('\n')
    .filter((l) => l.trim().startsWith('image sprite_'));
  assert(
    spriteLines.length > 0,
    'expected at least one `image sprite_*` line in script.rpy',
  );
  const hasRealSprite = spriteLines.some((l) => l.includes('images/char/'));
  assert(
    !hasRealSprite,
    `after modify, no sprite_* should still point at images/char/, got:\n${spriteLines.join('\n')}`,
  );
  console.log('    ok: character placeholder restored, scene preserved');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const keep = process.argv.includes('--keep');
  const tmp = await mkdtemp(join(tmpdir(), 'renpy-modify-smoke-'));
  console.log(`tmp: ${tmp}`);

  let failed = false;
  let gameDir;
  try {
    const pipelineResult = await stepA_initialPipeline(tmp);
    gameDir = pipelineResult.gamePath;
    await stepB_realAssets(tmp, gameDir);
    await stepC_rebuildWithRealAssets(tmp, gameDir);
    await stepD_modifyCharacter(tmp, gameDir);
    await stepE_rebuildAfterModify(tmp, gameDir);
    console.log('\n✅ modify smoke passed');
  } catch (err) {
    failed = true;
    console.error(`\n❌ modify smoke failed: ${err?.message ?? err}`);
    if (err?.stack) console.error(err.stack);
  } finally {
    if (!keep) {
      await rm(tmp, { recursive: true, force: true });
    } else {
      console.log(`\n(kept) artifacts at: ${tmp}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});

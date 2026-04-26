#!/usr/bin/env node
// prompt-cache-probe.mjs — 小成本验证 Anthropic prompt cache 在两路的行为。
//
// 覆盖 plan §5.6 step 5。跑法:
//   node --env-file=.env scripts/prompt-cache-probe.mjs
//
// 脚本会:
//   1. 构造一段 ≥ 1024 token 的 system prompt
//   2. 用直连 SDK + 挂 cache_control,背靠背跑两次;记录两次的 usage
//      - 第一次应该有 cache_creation_input_tokens > 0
//      - 第二次应该有 cache_read_input_tokens > 0(5 分钟 TTL)
//   3. 对 Bedrock SDK 重复同样的两次请求(需要 CLAUDE_CODE_USE_BEDROCK=1 或者四件套 env)
//   4. 打印对比表 + 人类可读结论,落 JSON 报告到
//      runtime/prompt-cache-probe-<ts>.json
//
// 不触碰业务代码,不写任何 runtime/games/*。成本预算 ≤ $0.30 —— 每路两次
// <1.5k token 的 ping,总共 ~6k input token + ~200 output token。

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

const DIRECT_MODEL = process.env.CLAUDE_DIRECT_MODEL ?? 'claude-sonnet-4-6';
const BEDROCK_MODEL = process.env.CLAUDE_BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

// ~1100 token 的固定 system(用 ASCII 保证 token 估算可靠)。每次 probe 之间
// 字节恒定,两次请求才能命中同一份 cache。
function buildCacheableSystem() {
  const seed = [
    'You are a deterministic diagnostic assistant whose only job is to echo',
    'a short acknowledgement so we can observe prompt cache behavior.',
    'Rules: respond with one line. Do not narrate. Do not apologize.',
    'Context for diagnosis (repeat-safe, byte-identical across requests):',
  ].join(' ');
  // Repeat until we comfortably clear the ~1024-token floor (seed ≈ 50 tokens).
  return Array.from({ length: 30 }, () => seed).join('\n');
}

const USER_PROMPT = 'ping';

function isoTimestamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

function pickUsage(u) {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? null,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? null,
  };
}

async function probeOne(client, model, label) {
  const system = buildCacheableSystem();
  const body = {
    model,
    max_tokens: 32,
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: USER_PROMPT }],
  };
  const t0 = Date.now();
  let res;
  let error = null;
  try {
    res = await client.messages.create(body);
  } catch (err) {
    error = { name: err?.name, message: String(err?.message ?? err) };
  }
  return {
    label,
    model,
    durationMs: Date.now() - t0,
    usage: res ? pickUsage(res.usage) : null,
    stopReason: res?.stop_reason ?? null,
    textHead: res?.content?.find?.((b) => b.type === 'text')?.text?.slice(0, 120) ?? null,
    error,
  };
}

async function runDirect() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { skipped: true, reason: 'ANTHROPIC_API_KEY not set' };
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const first = await probeOne(client, DIRECT_MODEL, 'direct/1');
  // 背靠背第二发,5 分钟 ephemeral cache 应当命中。
  const second = await probeOne(client, DIRECT_MODEL, 'direct/2');
  return { skipped: false, first, second };
}

async function runBedrock() {
  const region = process.env.AWS_REGION;
  const bearer = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!region || (!bearer && !process.env.AWS_ACCESS_KEY_ID)) {
    return {
      skipped: true,
      reason:
        'AWS_REGION 和 AWS_BEARER_TOKEN_BEDROCK(或 AWS_ACCESS_KEY_ID) 至少有一个缺失',
    };
  }
  const client = new AnthropicBedrock({
    awsRegion: region,
    apiKey: bearer,
    maxRetries: 2,
  });
  const first = await probeOne(client, BEDROCK_MODEL, 'bedrock/1');
  const second = await probeOne(client, BEDROCK_MODEL, 'bedrock/2');
  return { skipped: false, first, second };
}

function interpret(pair) {
  if (pair.skipped) return `SKIPPED: ${pair.reason}`;
  const a = pair.first;
  const b = pair.second;
  if (a.error) return `REQUEST-1 ERROR: ${a.error.message}`;
  if (b.error) return `REQUEST-2 ERROR: ${b.error.message}`;
  const created = a.usage?.cacheCreationInputTokens;
  const read = b.usage?.cacheReadInputTokens;
  if (created && created > 0 && read && read > 0) {
    return `SUPPORTED: write=${created}, read=${read}`;
  }
  if (created && created > 0 && (!read || read === 0)) {
    return `PARTIAL: first wrote ${created} tokens, second did not read (cache not returned)`;
  }
  if ((!created || created === 0) && (!read || read === 0)) {
    return 'NO CACHE: usage fields are 0/null — cache_control appears ignored or unsupported';
  }
  return `MIXED: write=${created ?? 'n/a'}, read=${read ?? 'n/a'}`;
}

function printRow(label, probe) {
  if (probe.skipped) {
    console.log(`  ${label.padEnd(12)} SKIPPED (${probe.reason})`);
    return;
  }
  const fmt = (p) => {
    if (p.error) return `ERROR ${p.error.message}`;
    const u = p.usage;
    return [
      `in=${u.inputTokens}`,
      `out=${u.outputTokens}`,
      `cache_create=${u.cacheCreationInputTokens ?? 'null'}`,
      `cache_read=${u.cacheReadInputTokens ?? 'null'}`,
      `dur=${p.durationMs}ms`,
    ].join(' ');
  };
  console.log(`  ${label.padEnd(12)} [1] ${fmt(probe.first)}`);
  console.log(`  ${''.padEnd(12)} [2] ${fmt(probe.second)}`);
}

async function main() {
  const repoRoot = process.cwd();
  const reportDir = resolve(repoRoot, 'runtime');
  await mkdir(reportDir, { recursive: true });
  const reportFile = resolve(reportDir, `prompt-cache-probe-${isoTimestamp()}.json`);

  console.log('— prompt cache probe —');
  console.log(`direct model:  ${DIRECT_MODEL}`);
  console.log(`bedrock model: ${BEDROCK_MODEL}`);
  console.log();

  const [directResult, bedrockResult] = await Promise.all([runDirect(), runBedrock()]);

  console.log('Direct (api.anthropic.com):');
  printRow('direct', directResult);
  console.log();
  console.log('Bedrock:');
  printRow('bedrock', bedrockResult);
  console.log();
  console.log(`direct:  ${interpret(directResult)}`);
  console.log(`bedrock: ${interpret(bedrockResult)}`);

  const report = {
    ts: new Date().toISOString(),
    directModel: DIRECT_MODEL,
    bedrockModel: BEDROCK_MODEL,
    direct: {
      ...directResult,
      conclusion: interpret(directResult),
    },
    bedrock: {
      ...bedrockResult,
      conclusion: interpret(bedrockResult),
    },
  };
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\nreport: ${reportFile}`);
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});

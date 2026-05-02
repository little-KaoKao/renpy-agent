#!/usr/bin/env node
// v5-real-key-smoke.mjs — V5 Planner/Executer 门禁 smoke(real-key)。
//
// 先 `pnpm build`,再:
//
//   node --env-file=.env scripts/v5-real-key-smoke.mjs
//
// 覆盖 plan §2.6 step 1:
//   - 校验 Bedrock 三件套 + RUNNINGHUB_API_KEY(四件套)
//   - 3 秒倒计时(Ctrl-C 可中止)
//   - 包一层 LlmClient 和 logger,每次 LLM 调用 / tool_use / tool_result / tool_result
//     都 dump 到 runtime/games/smoke-v5/logs/v5-trace.jsonl
//   - 调 runV5({ storyName: 'smoke-v5', inspiration: '...' })
//   - 结束打印 Planner task 数 / 总 token / 粗估成本 / 产物路径
//
// 本脚本**不修**任何 src/ 代码;发现问题产报告,不打补丁。
//
// 注意:v0.6 的 runV5 默认 taskAgents={} —— 角色主图 / 场景背景 /
// 表情等走 stub,落 `placeholder` 状态。这是**预期**行为,smoke 要记录下来。
// 若 Planner 绕过 stub 继续推进,报告里应当写明;若 Planner 死循环,也应记录。

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ClaudeLlmClient } from '../dist/llm/claude-client.js';
import { runV5 } from '../dist/agents/run-v5.js';

const STORY_NAME = 'smoke-v5';
const INSPIRATION = '一个樱花树下的告白故事';

// Sonnet 4.6 on-demand pricing (2026-04 rough numbers; see Anthropic pricing page).
const USD_PER_MTOK_INPUT = 3;
const USD_PER_MTOK_OUTPUT = 15;

// Safety caps. Numbers are deliberately loose — the run should normally hit
// single-digit dollars; the cap is there to stop a runaway tool_use loop from
// burning through the wallet while the operator is AFK.
const DEFAULT_BUDGET_CAP_USD = 10;
// M0 trace: MJ v7 image tasks averaged 2-3 min each. 5 min leaves room for
// slower scene backgrounds without rewarding hangs.
const DEFAULT_TASK_AGENT_TIMEOUT_MS = 5 * 60 * 1000;

function parseCliArgs(argv) {
  const opts = {
    budgetCapUsd: DEFAULT_BUDGET_CAP_USD,
    taskAgentTimeoutMs: DEFAULT_TASK_AGENT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--budget-cap') {
      const raw = argv[++i];
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`❌ --budget-cap expects a positive number (got ${JSON.stringify(raw)})`);
        process.exit(1);
      }
      opts.budgetCapUsd = n;
    } else if (arg.startsWith('--budget-cap=')) {
      const n = Number.parseFloat(arg.slice('--budget-cap='.length));
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`❌ --budget-cap expects a positive number`);
        process.exit(1);
      }
      opts.budgetCapUsd = n;
    } else if (arg === '--task-agent-timeout-ms') {
      const raw = argv[++i];
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`❌ --task-agent-timeout-ms expects a positive integer (got ${JSON.stringify(raw)})`);
        process.exit(1);
      }
      opts.taskAgentTimeoutMs = n;
    }
  }
  return opts;
}

function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(`❌ ${name} 未设置 ${hint ? `(${hint})` : ''}`);
    return null;
  }
  return v;
}

function checkEnv() {
  const errors = [];
  if (process.env.CLAUDE_CODE_USE_BEDROCK !== '1') {
    errors.push('CLAUDE_CODE_USE_BEDROCK=1 必须设置(本项目默认走 Bedrock)');
  }
  if (!requireEnv('AWS_REGION', '例如 us-east-1')) errors.push('AWS_REGION missing');
  if (!requireEnv('AWS_BEARER_TOKEN_BEDROCK', 'Bedrock bearer token')) {
    errors.push('AWS_BEARER_TOKEN_BEDROCK missing');
  }
  if (!requireEnv('RUNNINGHUB_API_KEY', '需求见 .env.example')) {
    errors.push('RUNNINGHUB_API_KEY missing');
  }
  if (errors.length > 0) {
    console.error('\n检查 .env 后重试。本脚本不会静默跳过缺失的 key。');
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoTimestamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

class JsonlAppender {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }
  append(event) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
    this.queue = this.queue
      .then(() => appendFile(this.filePath, line, 'utf8'))
      .catch((err) => {
        // Trace write failures must not swallow the run — print to stderr.
        console.error(`[smoke:trace-write-error] ${err.message}`);
      });
    return this.queue;
  }
  async flush() {
    await this.queue;
  }
}

function wrapLlmClient(inner, tracer) {
  return {
    async chat(params) {
      const t0 = Date.now();
      try {
        const res = await inner.chat(params);
        tracer.append({
          type: 'llm_chat',
          durationMs: Date.now() - t0,
          usage: res.usage,
          messageCount: params.messages.length,
          lastRole: params.messages[params.messages.length - 1]?.role,
        });
        return res;
      } catch (err) {
        tracer.append({
          type: 'llm_chat_error',
          durationMs: Date.now() - t0,
          error: String(err?.message ?? err),
        });
        throw err;
      }
    },
    async chatWithTools(params) {
      const t0 = Date.now();
      // Dump the tail of messages so we can see the prompt drift across turns.
      // Last message is always either a user(tool_result[]) or initial user text;
      // previous assistant message shows the tool_use plan.
      const tail = params.messages.slice(-2).map(summarizeMessage);
      tracer.append({
        type: 'llm_chat_with_tools_request',
        messageCount: params.messages.length,
        toolCount: params.tools.length,
        toolNames: params.tools.map((t) => t.name),
        tailSummary: tail,
      });
      try {
        const res = await inner.chatWithTools(params);
        const toolUses = res.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));
        const text = res.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text.slice(0, 400))
          .join('\n---\n');
        tracer.append({
          type: 'llm_chat_with_tools_response',
          durationMs: Date.now() - t0,
          stopReason: res.stopReason,
          usage: res.usage,
          toolUseCount: toolUses.length,
          toolUses,
          textHead: text.length > 0 ? text : undefined,
        });
        return res;
      } catch (err) {
        tracer.append({
          type: 'llm_chat_with_tools_error',
          durationMs: Date.now() - t0,
          error: String(err?.message ?? err),
        });
        throw err;
      }
    },
  };
}

function summarizeMessage(m) {
  if (typeof m.content === 'string') {
    return { role: m.role, text: m.content.slice(0, 300) };
  }
  const blocks = m.content.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text.slice(0, 300) };
    if (b.type === 'tool_use') return { type: 'tool_use', name: b.name, input: b.input };
    if (b.type === 'tool_result') {
      const c = typeof b.content === 'string' ? b.content.slice(0, 400) : b.content;
      return { type: 'tool_result', toolUseId: b.toolUseId, content: c };
    }
    return { type: 'unknown' };
  });
  return { role: m.role, blocks };
}

function makeFileLogger(tracer) {
  const mirror = (level) => (message, meta) => {
    // Keep console output so operator can watch the run live.
    const line = `[v5:${level}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    tracer.append({ type: `logger_${level}`, message, meta: meta ?? null });
  };
  return {
    info: mirror('info'),
    warn: mirror('warn'),
    error: mirror('error'),
  };
}

async function main() {
  checkEnv();
  const cli = parseCliArgs(process.argv.slice(2));

  const repoRoot = process.cwd();
  const gameDir = resolve(repoRoot, 'runtime', 'games', STORY_NAME, 'game');
  const logsDir = resolve(repoRoot, 'runtime', 'games', STORY_NAME, 'logs');
  await mkdir(logsDir, { recursive: true });
  const traceFile = resolve(logsDir, `v5-trace-${isoTimestamp()}.jsonl`);
  const tracer = new JsonlAppender(traceFile);

  console.log('— V5 real-key smoke —');
  console.log(`storyName:       ${STORY_NAME}`);
  console.log(`inspiration:     ${INSPIRATION}`);
  console.log(`gameDir:         ${gameDir}`);
  console.log(`trace:           ${traceFile}`);
  console.log(`budgetCapUsd:    $${cli.budgetCapUsd}`);
  console.log(`taskAgentTimeout: ${cli.taskAgentTimeoutMs} ms`);
  console.log(
    '\n⚠️  This will burn real Bedrock + RunningHub tokens.\n' +
      '    Expected cost: Planner + Executers × 7 tasks ≈ $0.5 – $1.0.\n' +
      `    Hard cap: $${cli.budgetCapUsd} (pass --budget-cap <usd> to change).\n` +
      '    Press Ctrl-C within 3s to abort...',
  );
  await sleep(3000);
  console.log('Starting.\n');

  const baseLlm = new ClaudeLlmClient();
  const llm = wrapLlmClient(baseLlm, tracer);
  const logger = makeFileLogger(tracer);

  tracer.append({
    type: 'run_start',
    storyName: STORY_NAME,
    inspiration: INSPIRATION,
    mode: baseLlm.mode,
    gameDir,
  });

  const t0 = Date.now();
  let runResult = null;
  let runError = null;
  try {
    runResult = await runV5({
      storyName: STORY_NAME,
      inspiration: INSPIRATION,
      llm,
      gameDir,
      logger,
      budgetCapUsd: cli.budgetCapUsd,
      taskAgentTimeoutMs: cli.taskAgentTimeoutMs,
      // Don't inject taskAgents — v0.6 default behavior; characters/scenes
      // will route through stub hints and end up in `placeholder` state.
    });
  } catch (err) {
    runError = err;
    tracer.append({ type: 'run_error', error: String(err?.message ?? err), stack: err?.stack });
  }
  const durationMs = Date.now() - t0;

  // Aggregate token + cost from the trace. We read the queue first (flush),
  // then re-read the file to tally.
  await tracer.flush();

  const { totalIn, totalOut, llmCalls, taskAgentTimeouts } = await tallyUsage(traceFile);
  const estimatedCostUsd =
    (totalIn / 1_000_000) * USD_PER_MTOK_INPUT +
    (totalOut / 1_000_000) * USD_PER_MTOK_OUTPUT;

  const summary = {
    storyName: STORY_NAME,
    inspiration: INSPIRATION,
    mode: baseLlm.mode,
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    durationMs,
    traceFile,
    runResult,
    runError: runError ? { message: String(runError?.message ?? runError), stack: runError?.stack } : null,
    budgetCapUsd: cli.budgetCapUsd,
    budgetCappedEarly: runResult?.budgetCappedEarly ?? false,
    // runV5's own conservative tally (source of truth for cap decisions).
    totalCostUsd:
      typeof runResult?.totalCostUsd === 'number'
        ? Number(runResult.totalCostUsd.toFixed(4))
        : null,
    taskAgentTimeouts,
    usage: {
      llmCalls,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
    },
  };
  await writeFile(
    resolve(logsDir, `v5-smoke-summary-${isoTimestamp()}.json`),
    JSON.stringify(summary, null, 2) + '\n',
    'utf8',
  );
  tracer.append({ type: 'run_end', summary });
  await tracer.flush();

  console.log('\n— summary —');
  console.log(`durationMs:         ${durationMs}`);
  console.log(`plannerTaskCount:   ${runResult?.plannerTaskCount ?? '(n/a)'}`);
  console.log(`finalSummary:       ${runResult?.finalSummary ?? '(n/a)'}`);
  console.log(`llmCalls:           ${llmCalls}`);
  console.log(`totalInputTokens:   ${totalIn}`);
  console.log(`totalOutputTokens:  ${totalOut}`);
  console.log(`estimatedCost:      $${estimatedCostUsd.toFixed(4)} (trace tally)`);
  console.log(`runV5 totalCostUsd: $${(runResult?.totalCostUsd ?? 0).toFixed(4)}`);
  console.log(`budgetCapUsd:       $${cli.budgetCapUsd}`);
  console.log(`budgetCappedEarly:  ${runResult?.budgetCappedEarly ?? false}`);
  console.log(`taskAgentTimeouts:  ${taskAgentTimeouts}`);
  console.log(`trace:              ${traceFile}`);
  console.log(`gameDir:            ${gameDir}`);

  if (runError) {
    console.error(`\n❌ V5 run threw: ${runError.message}`);
    process.exit(2);
  }
  console.log('\n✅ smoke run finished (run completion != asset completion — inspect trace).');
  console.log(`   Try: renpy-sdk/renpy.exe "${gameDir}"`);
}

async function tallyUsage(traceFile) {
  const { readFile } = await import('node:fs/promises');
  let totalIn = 0;
  let totalOut = 0;
  let llmCalls = 0;
  let taskAgentTimeouts = 0;
  try {
    const raw = await readFile(traceFile, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type === 'llm_chat_with_tools_response' || obj.type === 'llm_chat') {
        llmCalls++;
        totalIn += obj.usage?.inputTokens ?? 0;
        totalOut += obj.usage?.outputTokens ?? 0;
      } else if (obj.type === 'logger_warn' && obj.message === 'task_agent_timeout') {
        taskAgentTimeouts++;
      }
    }
  } catch (err) {
    console.error(`[smoke:tally-error] ${err.message}`);
  }
  return { totalIn, totalOut, llmCalls, taskAgentTimeouts };
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});

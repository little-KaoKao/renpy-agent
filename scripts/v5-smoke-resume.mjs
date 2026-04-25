#!/usr/bin/env node
// v5-smoke-resume.mjs
//
// Resume a V5 smoke run that died partway (network hiccup, Tier 2 hallucination,
// etc). The Planner+Executer loop's value is that all state is on disk as
// per-URI JSONs + asset-registry.json, so finishing a run doesn't require any
// new LLM calls once storyboard + script + characters + scenes are written.
//
// This script reads workspace/<story>/ and runs coder.write_game_project +
// qa.run_qa directly (bypassing the LLM loop). It's the cheapest way to verify
// that a partial run produced valid state.
//
// Usage:
//   node scripts/v5-smoke-resume.mjs <storyName>
//
// Example:
//   node scripts/v5-smoke-resume.mjs smoke-v5-yandere

import { resolve } from 'node:path';
import { coderTools } from '../dist/executers/coder/tools.js';
import { qaTools } from '../dist/executers/qa/tools.js';

const storyName = process.argv[2];
if (!storyName) {
  console.error('Usage: node scripts/v5-smoke-resume.mjs <storyName>');
  process.exit(1);
}

const gameDir = resolve(process.cwd(), 'runtime', 'games', storyName, 'game');
const workspaceDir = resolve(process.cwd(), 'runtime', 'games', storyName, 'workspace');
const memoryDir = resolve(process.cwd(), 'runtime', 'games', storyName, 'planner_memories');

const logger = {
  info: (msg, meta) => console.log(`[resume:info] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[resume:warn] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[resume:error] ${msg}`, meta ?? ''),
};

const ctx = {
  storyName,
  gameDir,
  workspaceDir,
  memoryDir,
  taskAgents: {},
  logger,
};

console.log(`\n— resuming V5 smoke for "${storyName}" —`);
console.log(`gameDir:      ${gameDir}`);
console.log(`workspaceDir: ${workspaceDir}\n`);

console.log('→ coder.write_game_project');
const coderResult = await coderTools.executors.write_game_project({}, ctx);
console.log('  result:', coderResult);
if ('error' in coderResult) {
  console.error('\n❌ coder failed, aborting.');
  process.exit(1);
}

console.log('\n→ qa.run_qa');
const qaResult = await qaTools.executors.run_qa({}, ctx);
console.log('  result:', qaResult);

console.log(`\n✅ Resume complete. Game at: ${gameDir}`);
console.log(`   Run: renpy-sdk/renpy.exe "${gameDir}"`);

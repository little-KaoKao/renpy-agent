import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { platform } from 'node:os';
import type { TestRunResult } from './types.js';

export interface RenpyRunner {
  (sdkExecutable: string, gamePath: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export interface RunQaParams {
  readonly gamePath: string;
  readonly sdkPath?: string;          // default: <repoRoot>/renpy-sdk
  readonly repoRoot?: string;          // default: process.cwd()
  readonly runner?: RenpyRunner;       // injectable for tests
}

export async function runQa(params: RunQaParams): Promise<TestRunResult> {
  const repoRoot = params.repoRoot ?? process.cwd();
  const sdkPath = params.sdkPath ?? resolve(repoRoot, 'renpy-sdk');
  const executable = resolve(sdkPath, platform() === 'win32' ? 'renpy.exe' : 'renpy.sh');

  try {
    await access(executable, constants.X_OK);
  } catch {
    return {
      result: 'skipped',
      syntaxErrors: [],
      runtimeErrors: [],
      warningMessage: `Ren'Py SDK executable not found at ${executable}; QA skipped.`,
    };
  }

  const runner = params.runner ?? defaultRenpyRunner;
  const { stdout, stderr, exitCode } = await runner(executable, params.gamePath);
  return parseLintOutput(stdout, stderr, exitCode);
}

export function parseLintOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
): TestRunResult {
  const combined = `${stdout}\n${stderr}`;
  const syntaxErrors: string[] = [];
  const runtimeErrors: string[] = [];

  for (const raw of combined.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^File ".+\.rpy", line \d+:/i.test(line)) {
      syntaxErrors.push(line);
    } else if (/^(SyntaxError|ParseError):/i.test(line)) {
      syntaxErrors.push(line);
    } else if (/(^|\s)Error:/i.test(line) && !/\b0 errors\b/i.test(line)) {
      runtimeErrors.push(line);
    }
  }

  const failed = exitCode !== 0 || syntaxErrors.length > 0 || runtimeErrors.length > 0;
  return {
    result: failed ? 'fail' : 'pass',
    syntaxErrors,
    runtimeErrors,
  };
}

const defaultRenpyRunner: RenpyRunner = (executable, gamePath) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [gamePath, 'lint'], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ stdout, stderr, exitCode: code ?? 0 });
    });
  });

// 通用 submit + poll helper:任何"吃 prompt,产出单个 URI"的 AI-App 都走这个。
//
// 用途:角色设计师 / 场景设计师 / 分镜师在 v0.3b/c 都会调它,省掉散写 submit+sleep+poll 的样板。
// Scope:只封装流程,不下载;不决定占位策略 —— 那是 caller 的事(见 download-asset.ts 和
// character-designer/scene-designer)。

import type {
  RunningHubClient,
  RunningHubSubmitParams,
  RunningHubTaskResult,
} from './runninghub-client.js';

export interface RunImageTaskParams extends RunningHubSubmitParams {
  readonly client: RunningHubClient;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly onProgress?: (update: RunningHubTaskResult & { readonly taskId: string }) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface RunImageTaskSuccess {
  readonly taskId: string;
  readonly outputUri: string;
}

export class RunImageTaskError extends Error {
  constructor(
    message: string,
    readonly taskId: string,
    readonly lastResult?: RunningHubTaskResult,
  ) {
    super(message);
    this.name = 'RunImageTaskError';
  }
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 提交任务后反复 poll,直到 done / error / 超时。
 *
 * 超时 / error 都以 RunImageTaskError 抛出,携带 taskId 方便事后到 RunningHub 控制台查。
 */
export async function runImageTask(params: RunImageTaskParams): Promise<RunImageTaskSuccess> {
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;

  const submitArgs: RunningHubSubmitParams = {
    apiId: params.apiId,
    prompt: params.prompt,
    ...(params.referenceImageUri !== undefined
      ? { referenceImageUri: params.referenceImageUri }
      : {}),
  };
  const { taskId } = await params.client.submitTask(submitArgs);

  const deadline = now() + timeoutMs;
  let lastResult: RunningHubTaskResult | undefined;

  while (now() <= deadline) {
    await sleep(pollIntervalMs);
    lastResult = await params.client.pollTask(taskId);
    params.onProgress?.({ ...lastResult, taskId });

    if (lastResult.status === 'done') {
      if (!lastResult.outputUri) {
        throw new RunImageTaskError(
          `task ${taskId} reported done but no outputUri`,
          taskId,
          lastResult,
        );
      }
      return { taskId, outputUri: lastResult.outputUri };
    }
    if (lastResult.status === 'error') {
      throw new RunImageTaskError(
        `task ${taskId} failed: ${lastResult.errorMessage ?? 'unknown error'}`,
        taskId,
        lastResult,
      );
    }
  }

  throw new RunImageTaskError(
    `task ${taskId} timed out after ${timeoutMs}ms (last status: ${lastResult?.status ?? 'none'})`,
    taskId,
    lastResult,
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

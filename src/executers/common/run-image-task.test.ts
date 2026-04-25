import { describe, expect, it, vi } from 'vitest';
import { runImageTask, RunImageTaskError } from './run-image-task.js';
import type {
  AiAppNodeInput,
  RunningHubClient,
  RunningHubTaskResult,
} from './runninghub-client.js';

function fakeClient(
  statuses: ReadonlyArray<RunningHubTaskResult>,
  taskId = 'task-fake',
): { client: RunningHubClient; submit: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> } {
  const submit = vi.fn().mockResolvedValue({ taskId });
  let i = 0;
  const poll = vi.fn(async () => statuses[Math.min(i++, statuses.length - 1)]!);
  return { client: { submitTask: submit, pollTask: poll }, submit, poll };
}

const NO_SLEEP = async () => {};
const PROMPT_INPUT: ReadonlyArray<AiAppNodeInput> = [{ role: 'prompt', value: 'p' }];

describe('runImageTask', () => {
  it('resolves with outputUri when task eventually reports done', async () => {
    const { client, submit, poll } = fakeClient([
      { status: 'pending' },
      { status: 'running' },
      { status: 'done', outputUri: 'https://cdn/out.png' },
    ]);

    const result = await runImageTask({
      appKey: 'CHARACTER_MAIN_IMAGE',
      inputs: PROMPT_INPUT,
      client,
      sleep: NO_SLEEP,
      pollIntervalMs: 0,
    });

    expect(result.outputUri).toBe('https://cdn/out.png');
    expect(result.taskId).toBe('task-fake');
    expect(submit).toHaveBeenCalledWith({
      appKey: 'CHARACTER_MAIN_IMAGE',
      inputs: PROMPT_INPUT,
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('forwards additional inputs (e.g. first_frame) through to submitTask', async () => {
    const { client, submit } = fakeClient([
      { status: 'done', outputUri: 'https://cdn/out.png' },
    ]);
    const inputs: AiAppNodeInput[] = [
      { role: 'prompt', value: 'p' },
      { role: 'first_frame', value: 'https://ref' },
    ];
    await runImageTask({
      appKey: 'CUTSCENE_IMAGE_TO_VIDEO',
      inputs,
      client,
      sleep: NO_SLEEP,
      pollIntervalMs: 0,
    });
    expect(submit).toHaveBeenCalledWith({
      appKey: 'CUTSCENE_IMAGE_TO_VIDEO',
      inputs,
    });
  });

  it('forwards instanceType and usePersonalQueue when provided', async () => {
    const { client, submit } = fakeClient([
      { status: 'done', outputUri: 'https://cdn/out.png' },
    ]);
    await runImageTask({
      appKey: 'CHARACTER_MAIN_IMAGE',
      inputs: PROMPT_INPUT,
      instanceType: 'plus',
      usePersonalQueue: true,
      client,
      sleep: NO_SLEEP,
      pollIntervalMs: 0,
    });
    expect(submit).toHaveBeenCalledWith({
      appKey: 'CHARACTER_MAIN_IMAGE',
      inputs: PROMPT_INPUT,
      instanceType: 'plus',
      usePersonalQueue: true,
    });
  });

  it('throws RunImageTaskError when status=error', async () => {
    const { client } = fakeClient([{ status: 'error', errorMessage: 'prompt blocked' }]);
    await expect(
      runImageTask({
        appKey: 'CHARACTER_MAIN_IMAGE',
        inputs: PROMPT_INPUT,
        client,
        sleep: NO_SLEEP,
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/prompt blocked/);
  });

  it('throws when done but no outputUri', async () => {
    const { client } = fakeClient([{ status: 'done' }]);
    await expect(
      runImageTask({
        appKey: 'CHARACTER_MAIN_IMAGE',
        inputs: PROMPT_INPUT,
        client,
        sleep: NO_SLEEP,
        pollIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(RunImageTaskError);
  });

  it('throws timeout when deadline passes before done', async () => {
    const { client } = fakeClient([{ status: 'running' }]);
    let clock = 0;
    const now = () => clock;
    const sleep = async (ms: number) => {
      clock += ms;
    };
    await expect(
      runImageTask({
        appKey: 'CHARACTER_MAIN_IMAGE',
        inputs: PROMPT_INPUT,
        client,
        sleep,
        now,
        pollIntervalMs: 100,
        timeoutMs: 250,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('calls onProgress for each poll', async () => {
    const { client } = fakeClient([
      { status: 'running' },
      { status: 'done', outputUri: 'https://cdn/o.png' },
    ]);
    const onProgress = vi.fn();
    await runImageTask({
      appKey: 'CHARACTER_MAIN_IMAGE',
      inputs: PROMPT_INPUT,
      client,
      sleep: NO_SLEEP,
      pollIntervalMs: 0,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0]![0].status).toBe('running');
    expect(onProgress.mock.calls[1]![0].status).toBe('done');
  });
});
